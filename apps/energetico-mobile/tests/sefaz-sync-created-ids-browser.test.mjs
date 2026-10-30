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
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate));

async function serve() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname), target = resolve(root, `.${pathname}`);
    if (request.method !== 'GET' || !target.startsWith(`${resolve(root)}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end('not found'); return;
    }
    const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/tests/fixtures/sefaz-sync-created-ids.html` };
}

for (const [width, height] of [[320, 900], [390, 950], [1365, 900]]) {
  test(`fiscal receipt keeps exact created IDs on the left of each source at ${width}px`, { timeout: 60_000, skip: !browser }, async t => {
    const { server, requests, url } = await serve(); t.after(() => new Promise(resolve => server.close(resolve)));
    const directory = process.env.SEFAZ_SYNC_CREATED_IDS_ARTIFACT_DIR;
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height, mobile: width < 700, url, captureScreenshot: Boolean(directory) });
    const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (directory) {
      await mkdir(resolve(directory), { recursive: true });
      await writeFile(join(directory, `sefaz-sync-created-ids-${width}.json`), JSON.stringify({ ...result, requests }, null, 2));
      await writeFile(join(directory, `sefaz-sync-created-ids-${width}.html`), stdout);
      if (screenshot) await writeFile(join(directory, `sefaz-sync-created-ids-${width}.png`), screenshot);
    }
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.measurements.map(item => [item.name, item.badgeCount]), [['few', 6], ['many', 48], ['long', 3], ['zero', 0], ['legacy', 0]]);
    assert.equal(result.acknowledgements, 5, 'only fake in-memory acknowledgements');
    assert.deepEqual(result.errors, []); assert.deepEqual(result.securityViolations, []);
    assert.deepEqual([result.width, result.height], [width, height]);
    assert.ok(requests.every(request => request.method === 'GET'), 'no network mutations');
    t.diagnostic(`${width}px: 5 real receipt states; source-owned IDs, long/many badges, zero/legacy, and Entendi verified`);
  });
}
