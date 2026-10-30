import assert from 'node:assert/strict';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const chrome = [process.env.CHROME_PATH, process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(candidate => candidate && existsSync(candidate));

async function serveFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    requests.push({ method: request.method, pathname });
    const target = resolve(repoRoot, `.${pathname}`);
    if (request.method !== 'GET' || !target.startsWith(`${resolve(repoRoot)}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end('not found'); return;
    }
    const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.css') ? 'text/css' : 'text/javascript';
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/tests/fixtures/gallery-attachments-layout.html` };
}

for (const [width, height] of [[320, 900], [390, 950], [844, 390], [1365, 900]]) {
  test(`real gallery attachment editor cascade and states at ${width}x${height}`, { timeout: 60_000, skip: !chrome }, async t => {
    const { server, requests, url } = await serveFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    const artifactDir = process.env.GALLERY_ATTACHMENTS_LAYOUT_ARTIFACT_DIR;
    const { stdout, screenshot } = await runBrowserLayout(chrome, { width, height, mobile: width < 1000, url,
      captureScreenshot: Boolean(artifactDir) && width < 400 });
    const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (artifactDir) {
      const directory = resolve(artifactDir); await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `gallery-attachments-layout-${width}.json`), JSON.stringify({ ...result, requests }, null, 2));
      await writeFile(join(directory, `gallery-attachments-layout-${width}.html`), stdout);
      if (screenshot) await writeFile(join(directory, `gallery-attachments-layout-${width}.png`), screenshot);
    }
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 'passed', result.failures?.join('\n'));
    assert.deepEqual(result.measurements.map(item => item.stage), ['saved', 'pending', 'removed', 'restored', 'empty', 'readOnly', 'busy']);
    assert.equal(result.submissions.length, 1, 'only an in-memory busy-state save');
    assert.equal(result.reads, 0);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.securityViolations, []);
    assert.deepEqual(result.viewport, { width, height });
    assert.ok(requests.every(request => request.method === 'GET'), 'local server cannot receive uploads or writes');
    t.diagnostic(`${width}x${height}: long/encoded names, pending/removal/restore, empty/read-only/busy; no real writes`);
  });
}
