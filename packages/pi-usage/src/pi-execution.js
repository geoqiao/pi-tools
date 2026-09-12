// Native Pi evidence adapter. Raw bodies/arguments/results never leave this module.
import { createHash } from 'node:crypto';
import { requestTypeFor, mergeRequestTypes } from './analytics.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1000 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => values.every(v => v !== null) && Number.isSafeInteger(values.reduce((a,b) => a+b,0)) ? values.reduce((a,b) => a+b,0) : null;

export function createPiExecutionCollector(source) {
  const responses = new Map();
  let calls = new Map(), cells = new Map(), anonymous = 0, unlinked = false;
  const scope = (session, value) => JSON.stringify([session,value]);
  function beginFile() { calls = new Map(); cells = new Map(); }
  function observe(entry, { sessionId, project }) {
    const m = entry.message;
    if (entry.type !== 'message' || !m) return;
    const rawTime = entry.timestamp ?? m.timestamp;
    const date = new Date(rawTime);
    if (rawTime == null || !Number.isFinite(date.getTime())) return;
    if (m.role === 'assistant') {
      const provider = m.provider || 'unknown', model = m.model || m.modelId || entry.model || 'unknown';
      const identity = id(m.responseId) ? JSON.stringify([source,provider,model,m.responseId])
        : JSON.stringify([source,sessionId,id(entry.id) ?? 'anonymous-' + (++anonymous)]);
      let r = responses.get(identity);
      const u = m.usage ?? {};
      const fullInput = sum([count(u.input),count(u.cacheRead),count(u.cacheWrite)]);
      const output = count(u.output), score = (fullInput ?? 0) + (output ?? 0);
      if (!r) {
        // Use the same native session hash as the existing sessions export.
        r = { row: { source,provider,model,project,timestamp:date.toISOString(),sessionHash:hash(sessionId).slice(0,16),
            responseHash:hash(identity).slice(0,24),requestType:requestTypeFor(m),
            fullInputTokens:fullInput,cacheReadTokens:count(u.cacheRead),outputTokens:output },
          score, units:new Map(), toolIds:new Set(), waitIds:new Set(), contentKnown:Array.isArray(m.content), codeEvidence:false };
        responses.set(identity,r);
      } else {
        r.row.requestType = mergeRequestTypes(r.row.requestType,requestTypeFor(m));
        r.contentKnown ||= Array.isArray(m.content);
        if (score > r.score || (r.row.fullInputTokens === null && fullInput !== null)) {
          Object.assign(r.row,{fullInputTokens:fullInput,cacheReadTokens:count(u.cacheRead),outputTokens:output});
          r.score = score;
        }
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c?.type !== 'toolCall' || !id(c.id) || !id(c.name)) continue;
        r.toolIds.add(c.id);
        let unit;
        if (c.name === 'exec') {
          if (!r.units.has(c.id)) r.units.set(c.id,{ owner:r, cellId:null, traces:new Map(), observedCount:0, finalCount:null, terminal:false, pending:false, unknown:false, code:false, error:false });
          unit = r.units.get(c.id);
        } else if (c.name === 'wait') {
          r.waitIds.add(c.id);
          const cell = id(c.arguments?.cell_id);
          const previousCall = calls.get(scope(sessionId,c.id));
          // Replayed copies of the same wait retain their association, but a new
          // wait may only attach to a runtime cell still open in this file.
          if (previousCall?.response === r && previousCall.name === 'wait') unit = previousCall.unit;
          else if (cell) unit = cells.get(scope(sessionId,cell));
        }
        calls.set(scope(sessionId,c.id),{response:r,unit,name:c.name});
      }
      return;
    }
    if (m.role !== 'toolResult') return;
    const d = m.details;
    const found = calls.get(scope(sessionId,m.toolCallId));
    if (!found) {
      if (d?.codeMode === true) unlinked = true;
      return;
    }
    const unit = found.unit;
    if (!unit) {
      if (d?.codeMode === true && found.name === 'wait') unlinked = true;
      return;
    }
    if (m.isError === true || typeof d?.scriptError === 'string') unit.error = true;
    if (d?.codeMode !== true || !id(d.cellId) || !['yielded','result','terminated'].includes(d.status)) {
      unit.unknown = true;
      return;
    }
    if (unit.cellId !== null && unit.cellId !== d.cellId) {
      unit.unknown = true;
      return;
    }
    unit.cellId = d.cellId;
    unit.code = true; unit.owner.codeEvidence = true; found.response.codeEvidence = true;
    const cellKey = scope(sessionId,d.cellId);
    if (d.status === 'yielded') cells.set(cellKey,unit);
    else if (cells.get(cellKey) === unit) cells.delete(cellKey);
    const traces = d.traces === undefined ? [] : d.traces;
    const dropped = d.droppedTraceCount === undefined ? 0 : count(d.droppedTraceCount);
    const snapshot = new Set();
    let valid = Array.isArray(traces) && dropped !== null;
    for (const t of Array.isArray(traces) ? traces : []) {
      if (!id(t?.id) || !id(t.name) || !['running','blocked','done','error'].includes(t.status)
        || snapshot.has(t.id)) { valid = false; continue; }
      snapshot.add(t.id);
      const previous = unit.traces.get(t.id) ?? { error:false, shellNonzero:false };
      unit.traces.set(t.id,{
        error:previous.error || t.status === 'error',
        shellNonzero:previous.shellNonzero || (t.name === 'exec_command'
          && Number.isInteger(t.result?.details?.exit_code) && t.result.details.exit_code !== 0),
      });
    }
    if (!valid) unit.unknown = true;
    const total = valid ? sum([dropped,snapshot.size]) : null;
    unit.observedCount = Math.max(unit.observedCount,unit.traces.size,total ?? 0);
    if (d.status === 'yielded') {
      if (!unit.terminal) unit.pending = true;
    } else {
      unit.terminal = true; unit.pending = false;
      if (total === null || total < unit.observedCount) unit.unknown = true;
      else unit.finalCount = Math.max(unit.finalCount ?? 0,total);
    }
  }
  function finish() {
    const rows = [];
    for (const r of responses.values()) {
      const row = {...r.row,mode:r.codeEvidence ? 'code_mode' : r.units.size || r.waitIds.size ? 'unknown'
        : r.toolIds.size ? 'other_tools' : r.contentKnown && r.row.requestType === 'non_tool' ? 'no_tools' : 'unknown',
        outerToolCalls:r.toolIds.size,execCalls:r.units.size,waitCalls:r.waitIds.size,execHistogram:{},
        pendingExecs:0,unknownExecs:0,incompleteToolCalls:0,outerExecErrors:0,nestedToolErrors:0,shellNonzero:0};
      for (const unit of r.units.values()) {
        if (unit.code && unit.terminal && !unit.unknown && unit.finalCount !== null) {
          row.execHistogram[unit.finalCount] = (row.execHistogram[unit.finalCount] || 0)+1;
        } else {
          if (unit.pending && !unit.unknown) row.pendingExecs++;
          else row.unknownExecs++;
          row.incompleteToolCalls += unit.observedCount;
        }
        if (unit.error) row.outerExecErrors++;
        for (const t of unit.traces.values()) {
          if (t.error) row.nestedToolErrors++;
          if (t.shellNonzero) row.shellNonzero++;
        }
      }
      rows.push(row);
    }
    return {rows,warnings:unlinked ? ['Pi execution evidence contains unlinked results; execution statistics cover only associated calls.'] : []};
  }
  return {beginFile,observe,finish};
}
