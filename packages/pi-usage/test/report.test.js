import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import extension from '../extensions/usage-report.js';

const cli = fileURLToPath(new URL('../bin/pi-usage.js', import.meta.url));
test('CLI local import -> HTML/JSON/CSV, refuses overwrites and validates options', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-usage-test-'));
  try {
    const input = join(root, 'input.json'), out = join(root, 'report');
    await writeFile(input, JSON.stringify({ buckets: [{ source: 'pi-coding-agent', model: 'gpt-5.4', project: 'private-project', bucketStart: new Date().toISOString(), inputTokens: 1000000, prompt: 'NEVER_EXPORT_ME' }], sessions: [], apiKey: 'NEVER_EXPORT_ME' }));
    const result = execFileSync(process.execPath, [cli, '--input', input, '--out', out, '--offline'], { encoding: 'utf8' });
    assert.equal(result.trim(), join(out, 'index.html'));
    for (const name of ['usage.json', 'index.html', 'details.csv', 'sessions.csv', 'execution.csv']) {
      const content = await readFile(join(out, name), 'utf8');
      assert.ok(!content.includes('NEVER_EXPORT_ME'));
      if (process.platform !== 'win32') assert.equal((await stat(join(out, name))).mode & 0o777, 0o600);
    }
    const report = JSON.parse(await readFile(join(out, 'usage.json'), 'utf8'));
    assert.equal(report.schemaVersion, 2);
    assert.deepEqual(report.execution, [], 'Legacy imports have no execution evidence');
    assert.equal(report.buckets.length, 1);
    assert.ok(report.buckets[0].estimatedCost > 0);
    assert.throws(() => execFileSync(process.execPath, [cli, '--input', input, '--out', out], { stdio: 'pipe' }), /输出目录必须为空/);
    assert.throws(() => execFileSync(process.execPath, [cli, '--days', '-1'], { stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, [cli, '--sources', 'bad-source'], { stdio: 'pipe' }));
    const sources = execFileSync(process.execPath, [cli, '--list-sources'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(sources.length, 28); assert.ok(sources.includes('cursor'));
    if (process.platform !== 'win32') {
      const binLink = join(root, 'pi-usage');
      await symlink(cli, binLink);
      const linked = execFileSync(process.execPath, [binLink, '--list-sources'], { encoding: 'utf8' });
      assert.equal(linked.trim().split('\n').length, 28, 'npm bin symlinks must execute the CLI');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Pi command runs CLI, keeps data out of model context and clears status', async () => {
  let command, sentArgs;
  const uiEvents = [];
  const pi = {
    on() {}, registerCommand(name, spec) { assert.equal(name, 'usage-report'); command = spec; },
    async exec(binary, args) { assert.equal(binary, process.execPath); sentArgs = args; return { code: 0, stdout: '/tmp/local-report/index.html\n', stderr: '' }; },
    sendMessage() { assert.fail('Must not send usage to the model'); },
    sendUserMessage() { assert.fail('Must not send usage to the model'); },
  };
  extension(pi);
  const ctx = { cwd: '/tmp', ui: { notify: (...v) => uiEvents.push(v), setStatus: (...v) => uiEvents.push(v), setWidget: (...v) => uiEvents.push(v) } };
  await command.handler('30', ctx);
  assert.deepEqual(sentArgs.slice(-2), ['--days', '30']);
  assert.ok(uiEvents.some(v => String(v[0]).includes('/tmp/local-report/index.html')));
  assert.deepEqual(uiEvents.at(-1), ['pi-usage', undefined]);
  sentArgs = null;
  await command.handler('30; curl evil', ctx);
  assert.equal(sentArgs, null);
});
