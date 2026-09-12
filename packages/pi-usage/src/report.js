import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { toCsv } from './analytics.js';

export const DETAIL_COLUMNS = ['date', 'source', 'model', 'project', 'hostname', 'requestType', 'bucketStart', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens', 'allTokens', 'inputCost', 'cacheCost', 'outputCost', 'reasoningCost', 'estimatedCost'];
export const SESSION_COLUMNS = ['source', 'project', 'hostname', 'sessionHash', 'firstMessageAt', 'lastMessageAt', 'durationSeconds', 'activeSeconds', 'messageCount', 'userMessageCount'];
export const EXECUTION_COLUMNS = ['date', 'source', 'provider', 'model', 'project', 'hostname', 'requestType', 'timestamp', 'sessionHash', 'responseHash', 'mode', 'fullInputTokens', 'cacheReadTokens', 'outputTokens', 'outerToolCalls', 'execCalls', 'waitCalls', 'execHistogram', 'pendingExecs', 'unknownExecs', 'incompleteToolCalls', 'outerExecErrors', 'nestedToolErrors', 'shellNonzero'];

export async function renderReport(data) {
  const load = path => readFile(new URL(path, import.meta.url), 'utf8');
  const [template, css, analytics, execution, app] = await Promise.all([
    load('../web/report.html'), load('../web/report.css'), load('./analytics.js'), load('./execution.js'), load('../web/report.js'),
  ]);
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const shared = analytics.replace(/^import .* from '\.\/execution\.js';$/gm, '').replace(/^export /gm, '');
  const js = `(() => {\n${execution.replace(/^export /gm, '')}\n${shared}\nconst DATA = ${serialized};\n${app}\n})();`;
  const hash = createHash('sha256').update(js).digest('base64');
  // Hash-authorized script; no network, frames, forms, remote fonts or images.
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
  return template.replace('<!--CSP-->', () => `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('/*STYLE*/', () => css).replace('/*SCRIPT*/', () => js);
}

export async function writeReport(data, out) {
  let directory;
  if (out) {
    directory = resolve(out);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await readdir(directory)).length) throw new Error('输出目录必须为空，避免覆盖已有报告');
  } else {
    const root = join(homedir(), '.pi', 'usage', 'reports');
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(root, 'report-'));
  }
  // Exclusive writes and HTML last: an interrupted run never exposes a finished-looking report.
  const save = (name, content) => writeFile(join(directory, name), content, { flag: 'wx', mode: 0o600 });
  const html = await renderReport(data);
  await save('usage.json', JSON.stringify(data) + '\n');
  await save('details.csv', toCsv(data.buckets, DETAIL_COLUMNS));
  await save('sessions.csv', toCsv(data.sessions, SESSION_COLUMNS));
  await save('execution.csv', toCsv((data.execution ?? []).map(row => ({ ...row, execHistogram: JSON.stringify(row.execHistogram) })), EXECUTION_COLUMNS));
  await save('index.html', html);
  return join(directory, 'index.html');
}
