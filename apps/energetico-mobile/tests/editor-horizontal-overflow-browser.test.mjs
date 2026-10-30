import assert from 'node:assert/strict';
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
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate));

async function serve() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = resolve(root, `.${pathname}`);
    if (request.method !== 'GET' || !target.startsWith(`${resolve(root)}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end('not found'); return;
    }
    const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : target.endsWith('.png') ? 'image/png' : 'text/javascript';
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/tests/fixtures/editor-horizontal-overflow.html` };
}

for (const [width, height] of [[320, 900], [390, 950], [844, 390], [1365, 900]]) {
  test(`real selected catalog chip cannot pan the editor sideways at ${width}x${height}`, { timeout: 60_000, skip: !browser }, async t => {
    const { server, url } = await serve();
    t.after(() => new Promise(resolve => server.close(resolve)));
    const directory = process.env.EDITOR_HORIZONTAL_OVERFLOW_ARTIFACT_DIR;
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height, mobile: width < 1000, url, captureScreenshot: Boolean(directory) && width < 400 });
    const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (directory) {
      await mkdir(resolve(directory), { recursive: true });
      await writeFile(join(directory, `editor-horizontal-overflow-${width}.json`), JSON.stringify(result, null, 2));
      await writeFile(join(directory, `editor-horizontal-overflow-${width}.html`), stdout);
      if (screenshot) await writeFile(join(directory, `editor-horizontal-overflow-${width}.png`), screenshot);
    }
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.writes, 0);
    assert.ok(result.internalPan.scrollLeft > 0, 'input caret/content pan remains available');
    assert.equal(result.status, 'passed', result.failures.join('\n'));
    assert.deepEqual(result.samples.map(sample => sample.stage), ['form-variant-open', 'selected-chip', 'lookup-dropdown-open', 'chosen-lookup-chip', 'input-internal-pan', 'nested-report-pan']);
    assert.ok(result.nestedPan.scrollWidth <= result.nestedPan.clientWidth + 1 || result.nestedPan.scrollLeft > 0, 'production report table can pan locally');
    for (const sample of result.samples) {
      assert.ok(sample.scrollLeft <= 1);
      assert.deepEqual(sample.outside, []);
    }
    t.diagnostic(`${width}px: ${JSON.stringify(result.samples.map(({ stage, clientWidth, scrollWidth, scrollLeft }) => ({ stage, clientWidth, scrollWidth, scrollLeft })))}`);
  });
}
