import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const browser = [process.env.CHROME_PATH, process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate));

async function serve() {
  // Optional read-only RED replay: serve the committed base module in memory.
  // Never roll back or rewrite production files while the main worker edits.
  const baseSource = process.env.GALLERY_EDITOR_BACK_BASELINE === '1'
    ? execFileSync('git', ['show', 'HEAD:apps/energetico-mobile/src/ui/gallery-record-actions.js'], { cwd: root, encoding: 'utf8' }) : null;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = resolve(root, `.${pathname}`);
    if (request.method !== 'GET' || !target.startsWith(`${resolve(root)}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end('not found'); return;
    }
    const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    if (baseSource && pathname === '/apps/energetico-mobile/src/ui/gallery-record-actions.js') response.end(baseSource);
    else createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/tests/fixtures/gallery-editor-back.html` };
}

for (const [width, height] of [[320, 900], [390, 950], [1365, 900]]) {
  test(`top-left Back discards the real editor draft and preserves gallery state at ${width}px`, { timeout: 60_000, skip: !browser }, async t => {
    const { server, url } = await serve(); t.after(() => new Promise(resolve => server.close(resolve)));
    const directory = process.env.GALLERY_EDITOR_BACK_ARTIFACT_DIR;
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height, mobile: width < 700, url, captureScreenshot: Boolean(directory) });
    const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (directory) {
      await mkdir(resolve(directory), { recursive: true });
      await writeFile(join(directory, `gallery-editor-back-${width}.json`), JSON.stringify(result, null, 2));
      await writeFile(join(directory, `gallery-editor-back-${width}.html`), stdout);
      if (screenshot) await writeFile(join(directory, `gallery-editor-back-${width}.png`), screenshot);
    }
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 'passed');
    assert.equal(result.writes, 0); assert.equal(result.changed, 0); assert.equal(result.loads, 2);
    assert.deepEqual(result.after, result.baseline);
    assert.equal(result.measurements.length, 2);
    assert.deepEqual(result.errors, []); assert.deepEqual(result.securityViolations, []);
    assert.ok(result.baseline.scrollTop > 0);
    t.diagnostic(`${width}px: 48px accessible Back, dirty field/deletion discarded, gallery page/query/scroll and focus preserved`);
  });
}
