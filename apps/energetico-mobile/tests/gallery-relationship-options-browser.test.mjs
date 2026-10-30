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
const expectedFields = ['FORNECEDOR', 'RESPONSAVEL', 'FORNECEDORES', 'RESPONSAVEIS'];

// Same plain loopback server and isolated browser harness as the asset test;
// no builds, Vite cache, user tabs, authentication or real data transports.
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
  return { server, requests, url: `http://127.0.0.1:${server.address().port}/tests/fixtures/gallery-relationship-options.html` };
}

for (const width of [320, 390]) {
  test(`gallery native relationships real repository/data/actions/form pipeline at ${width}px`, { timeout: 90_000, skip: !chrome }, async t => {
    const { server, requests, url } = await serveFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { stdout, screenshot } = await runBrowserLayout(chrome, { width, height: 950, mobile: true, url,
      captureScreenshot: Boolean(process.env.GALLERY_RELATIONSHIP_OPTIONS_ARTIFACT_DIR), readyTimeoutMs: 30_000 });
    const dom = new JSDOM(stdout);
    const result = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    if (process.env.GALLERY_RELATIONSHIP_OPTIONS_ARTIFACT_DIR) {
      const directory = resolve(process.env.GALLERY_RELATIONSHIP_OPTIONS_ARTIFACT_DIR);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `gallery-relationship-options-${width}.json`), JSON.stringify({ ...result, requests }, null, 2));
      await writeFile(join(directory, `gallery-relationship-options-${width}.html`), stdout);
      if (screenshot) await writeFile(join(directory, `gallery-relationship-options-${width}.png`), screenshot);
    }
    assert.equal(result.status, 'passed', JSON.stringify(result, null, 2));
    assert.equal(result.frozenRepository, true);
    assert.equal(result.contextCount, 3, 'cold open, reopen after cancel, reopen after save');
    assert.deepEqual(result.checks.map(check => check.field), expectedFields);
    for (const check of result.checks) {
      for (const property of ['secondPage', 'clearLabelPreserveIds', 'typedMatch', 'invalidSubmitBlocked', 'zeroResult', 'clearReload', 'replacement']) assert.equal(check[property], true, `${check.field}: ${property}`);
    }
    assert.deepEqual(result.checks.map(check => check.multiple), [false, false, true, true]);
    assert.equal(result.staleGeneration, true);
    assert.equal(result.submitCount, 1);
    assert.equal(result.changedCount, 1);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].ifMatch, '"relationship-v1"');
    assert.deepEqual(result.writes[0].body, { FORNECEDORLookupId: 24, RESPONSAVELLookupId: 25, FORNECEDORESLookupId: [1, 25], RESPONSAVEISLookupId: [1, 25] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.networkViolations, []);
    assert.equal(result.layout.width, width);
    assert.equal(result.layout.overflow, false);
    assert.equal(result.layout.page25Visible, true);
    assert.ok(requests.every(request => request.method === 'GET'), 'HTTP server must never receive a mutation');
    t.diagnostic(`${width}px: Graph lookup + REST person, single/multiple selections, stale query ignored, one in-memory LookupId PATCH; zero real writes`);
  });
}
