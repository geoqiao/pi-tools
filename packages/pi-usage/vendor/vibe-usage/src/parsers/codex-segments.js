import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
function pick(value, keys) {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
const usageKeys = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_read_input_tokens', 'reasoning_output_tokens', 'total_tokens'];

// Retain only fields consumed by the existing token/timing/classification parser. Full JSON is
// hashed transiently to identify exact copies; chat/tool text is never retained.
function accountingRecord(obj, context) {
  const next = { type: obj.type, timestamp: obj.timestamp };
  const p = obj.payload;
  if (obj.type === 'session_meta' && p) {
    next.payload = pick(p, ['id', 'timestamp', 'cwd', 'forked_from_id', 'parent_thread_id', 'thread_source']);
    if (p.git) next.payload.git = pick(p.git, ['repository_url']);
    if (typeof p.source === 'string') next.payload.source = p.source;
    else if (p.source && typeof p.source === 'object' && 'subagent' in p.source) {
      next.payload.source = { subagent: { thread_spawn: pick(p.source.subagent?.thread_spawn, ['parent_thread_id']) } };
    }
  } else if (obj.type === 'turn_context') {
    next.payload = pick(p, ['model', 'service_tier', 'turn_id']);
  } else if (obj.type === 'event_msg' && p) {
    next.payload = pick(p, ['type', 'started_at', 'model', 'turn_id']);
    if (p.type === 'token_count') {
      next._tokenFingerprint = hash(p).slice(0, 16);
      next._segmentContext = { ...context };
      if (p.info) next.payload.info = {
        ...pick(p.info, ['model']),
        total_token_usage: pick(p.info.total_token_usage, usageKeys),
        last_token_usage: pick(p.info.last_token_usage, usageKeys),
      };
    } else if (p.type === 'thread_settings_applied') {
      next.payload.thread_settings = pick(p.thread_settings, ['model', 'service_tier']);
    }
  } else if (obj.type === 'response_item' && p) {
    // The request classifier needs structural response evidence, but merged
    // segment caches must never retain response text or tool arguments.
    next.payload = pick(p, ['type', 'role', 'phase', 'id', 'response_id']);
    if (Array.isArray(p.content)) {
      next.payload.content = p.content.map(part => (
        part && typeof part === 'object' && typeof part.type === 'string'
          ? { type: part.type }
          : null
      ));
    }
    const turnId = p.internal_chat_message_metadata_passthrough?.turn_id;
    if (typeof turnId === 'string' && turnId) {
      next.payload.internal_chat_message_metadata_passthrough = { turn_id: turnId };
    }
  } else if (obj.type === 'token_usage_record' && p) {
    // IDs and the validated per-response usage corroborate token_count; no
    // account/session payload, prompt, or tool argument crosses the cache.
    next.payload = pick(p, ['thread_id', 'turn_id', 'response_id']);
    if (p.usage && typeof p.usage === 'object') next.payload.usage = pick(p.usage, usageKeys);
  }
  return JSON.stringify(next);
}

/**
 * Merge exact cross-file copies with multiplicity: occurrence N of a record in
 * one file matches occurrence N in another. Repetitions within a file survive.
 * Preserve each file's order (including rewritten-timestamp fork replay); use
 * timestamps only to order independent segments. Contradictory order fails the
 * source instead of inventing a potentially double-counting sequence.
 */
export async function mergeCodexSegments(members, readLines) {
  const nodes = new Map();
  let canonicalKey = null;
  for (const [fileIndex, file] of members.entries()) {
    const occurrences = new Map();
    let previous = null;
    const context = {};
    for await (const line of readLines(file.filePath, file.snapshotSize)) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (!obj || typeof obj !== 'object') continue;
      const settings = obj.type === 'turn_context' ? obj.payload
        : obj.type === 'event_msg' && obj.payload?.type === 'thread_settings_applied' ? obj.payload.thread_settings : null;
      if (settings?.model) context.model = settings.model;
      if (Object.hasOwn(settings || {}, 'service_tier')) context.serviceTier = settings.service_tier;
      const fingerprint = hash(obj);
      const occurrence = (occurrences.get(fingerprint) || 0) + 1;
      occurrences.set(fingerprint, occurrence);
      const key = `${fingerprint}:${occurrence}`;
      if (fileIndex === 0 && canonicalKey === null && obj.type === 'session_meta') canonicalKey = key;
      if (!nodes.has(key)) nodes.set(key, {
        key, line: accountingRecord(obj, context), time: Date.parse(obj.timestamp),
        ordinal: nodes.size, successors: new Set(), incoming: 0,
      });
      if (previous && previous !== key && !nodes.get(previous).successors.has(key)) {
        nodes.get(previous).successors.add(key);
        nodes.get(key).incoming++;
      }
      previous = key;
    }
  }
  const ready = [...nodes.values()].filter(node => !node.incoming);
  const result = [];
  function compare(a, b) {
    if (a.key === canonicalKey || b.key === canonicalKey) return a.key === canonicalKey ? -1 : 1;
    if (Number.isFinite(a.time) && Number.isFinite(b.time) && a.time !== b.time) return a.time - b.time;
    return a.ordinal - b.ordinal;
  }
  while (ready.length) {
    ready.sort(compare);
    const node = ready.shift();
    result.push(node.line);
    for (const key of node.successors) {
      const next = nodes.get(key);
      if (--next.incoming === 0) ready.push(next);
    }
  }
  if (result.length !== nodes.size) throw new Error('Codex continuation copies have conflicting record order');
  return result;
}

// The disposable group cache is invalidated by ANY member changing, appearing,
// disappearing, or moving. It never shares the selected physical file's cache.
export function codexSegmentSignature(members) {
  return {
    size: members.reduce((sum, file) => sum + file.snapshotSize, 0),
    mtimeMs: Math.max(...members.map(file => file.signature.mtimeMs)),
    dev: 'codex-segments',
    ino: hash(members.map(file => [file.filePath, file.signature]).sort((a, b) => a[0].localeCompare(b[0]))),
  };
}
