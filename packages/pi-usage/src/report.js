import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { toCsv } from './analytics.js';
import { EXECUTION_COLUMNS } from './web/report-contracts.js';

export const DETAIL_COLUMNS = ['date', 'source', 'model', 'project', 'hostname', 'requestType', 'bucketStart', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens', 'allTokens', 'inputCost', 'cacheCost', 'outputCost', 'reasoningCost', 'estimatedCost'];
export const SESSION_COLUMNS = ['source', 'project', 'hostname', 'sessionHash', 'firstMessageAt', 'lastMessageAt', 'durationSeconds', 'activeSeconds', 'messageCount', 'userMessageCount'];
export { EXECUTION_COLUMNS };

// The report is intentionally a small, fail-closed bundler rather than a general
// ESM loader: every browser module must use only the named bindings currently
// needed by the report, with no aliases or additional import forms.
export async function bundleBrowserScript(entryPath) {
  const entry = new URL(entryPath, import.meta.url);
  const seen = new Set(), dependencyBodies = [];
  let entryBody = '';
  const importPattern = /^\s*import\s+(?:(.*?)\s+from\s+)?(['"])([^'"\n]+)\2\s*;?\s*$/gm;
  const namedImportPattern = /^\{\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\}$/;
  const visit = async url => {
    const key = url.href;
    if (seen.has(key)) return;
    seen.add(key);
    const source = await readFile(url, 'utf8');
    const imports = [...source.matchAll(importPattern)];
    for (const match of imports) {
      const specifier = match[3];
      if (!specifier.startsWith('.')) throw new Error('报告不支持外部浏览器模块：' + specifier);
      if (!namedImportPattern.test(match[1]?.trim() ?? '')) throw new Error('报告仅支持无别名 named import：' + specifier);
      await visit(new URL(specifier, url));
    }
    let body = source.replace(importPattern, '');
    body = body.replace(/^\s*export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
    body = body.replace(/^\s*export\s*\{\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\};?\s*$/gm, '');
    if (/^\s*(?:import|export)\b/m.test(body)) throw new Error('报告模块包含未支持的 ESM 语法：' + url.pathname);
    if (key === entry.href) entryBody = body;
    else dependencyBodies.push(body);
  };
  await visit(entry);
  return { dependencies: dependencyBodies.join('\n'), entry: entryBody };
}

export async function renderReport(data) {
  const load = path => readFile(new URL(path, import.meta.url), 'utf8');
  const [template, css, bundle] = await Promise.all([
    load('../web/report.html'), load('../web/report.css'), bundleBrowserScript('../web/report.js'),
  ]);
  const serialized = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const js = ['(() => {', bundle.dependencies, 'const DATA = ' + serialized + ';', bundle.entry, '})();'].join('\n');
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
