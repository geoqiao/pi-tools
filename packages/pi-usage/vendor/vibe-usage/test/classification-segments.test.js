import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../src/parsers/codex.js';

test('merged copies retain turn boundaries and reject mismatched response evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-segment-classification-'));
  const env = { CODEX_HOME: root, PI_USAGE_CACHE_DIR: join(root, 'cache'), VIBE_USAGE_CINDY_DIRS: join(root, 'no-cindy') };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    mkdirSync(join(root, 'sessions'));
    const timestamp = '2026-09-01T00:00:00Z';
    const usage = { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120 };
    for (const boundary of ['turn_context', 'task_started']) {
      for (const turn of ['expected', 'wrong']) {
        rmSync(env.PI_USAGE_CACHE_DIR, { recursive: true, force: true });
        const rows = [
          { type: 'session_meta', payload: { id: 's', cwd: '/synthetic' } },
          boundary === 'turn_context' ? { type: boundary, payload: { model: 'test', turn_id: 'expected' } }
            : { type: 'event_msg', payload: { type: boundary, turn_id: 'expected' } },
          { type: 'response_item', payload: { type: 'function_call', internal_chat_message_metadata_passthrough: { turn_id: turn }, arguments: 'PRIVATE_ARGS' } },
          { type: 'event_msg', payload: { type: 'token_count', info: { model: 'test', last_token_usage: usage, total_token_usage: usage } } },
        ].map(row => JSON.stringify({ timestamp, ...row })).join('\n') + '\n';
        for (const name of ['a', 'b']) writeFileSync(join(root, 'sessions', `${name}.jsonl`), rows);
        const result = await parse();
        assert.equal(result.buckets.reduce((sum, row) => sum + row.totalTokens, 0), 120);
        assert.equal(result.buckets[0].requestType ?? 'other', turn === 'expected' ? 'tool' : 'other', `${boundary}: ${turn}`);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ARGS/);
      }
    }
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});
