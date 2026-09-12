// One repeatable local/CI entry point. Only the synthetic generator is invoked:
// there is deliberately no option to pass a personal report or session directory.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import checkReport from './browser-check.js';

const directory = await mkdtemp(join(tmpdir(), 'pi-usage-browser-'));
const report = join(directory, 'report'), screenshotDir = join(directory, 'screenshots');
await mkdir(screenshotDir);
console.log('Synthetic browser artifacts:', directory);
execFileSync(process.execPath, [fileURLToPath(new URL('./demo.js', import.meta.url)), report, '90'], { stdio: 'pipe' });
const [data, shortData, legacyData] = await Promise.all(['', 'short', 'legacy'].map(async variant =>
  JSON.parse(await readFile(join(report, variant, 'usage.json'), 'utf8'))));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(10000);
try {
  await page.goto(pathToFileURL(join(report, 'index.html')).href);
  const result = await checkReport(page, { data, shortData, legacyData, screenshotDir });
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(screenshotDir, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
