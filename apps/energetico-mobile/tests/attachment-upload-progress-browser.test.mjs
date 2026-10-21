import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path));

test('upload badge stays next to spinner on phones and PC, in both themes', { timeout: 120000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen(); t.after(() => server.close());
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[320, 740], [390, 844], [1365, 768]]) {
    for (const percent of [0, 37, 100]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, colorScheme,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-upload-progress.html?percent=${percent}` });
      const dom = new JSDOM(stdout), data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      assert.deepEqual(data, { percent: `${percent}%`, adjacent: true, aligned: true, contained: true, overflow: false },
        JSON.stringify({ width, height, percent, colorScheme, data }));
    }
  }
});

test('real browser uploads a binary file once and paints receipt-confirmed progress; HTTP errors never paint 100', { timeout: 90000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const requests = [];
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'local-upload-receipt', configureServer(server) {
      server.middlewares.use('/api/portal-upload', (req, res) => {
        const item = { bytes: 0, auth: req.headers.authorization, fileName: req.headers['x-portal-file-name'] };
        requests.push(item);
        req.on('data', chunk => { item.bytes += chunk.length; });
        req.on('end', () => setTimeout(() => {
          const denied = req.url.includes('denied');
          res.writeHead(denied ? 401 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(denied ? { error: 'Envio não autorizado' } : { status: 'processed', messages: [], attachments: [
            { id: 'test-receipt', fileName: 'documento-teste.pdf', mimeType: 'application/pdf', size: item.bytes, mediaUrl: '/api/portal-media/test-receipt' },
          ] }));
        }, 350));
      });
    } }] });
  await server.listen(); t.after(() => server.close());
  for (const denied of [false, true]) {
    const { stdout } = await runBrowserLayout(browser, { width: 390, height: 844,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-upload-progress.html?mode=network${denied ? '&denied' : ''}` });
    const dom = new JSDOM(stdout), data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(data.success, !denied);
    assert.ok(data.seen.includes(0)); assert.ok(data.seen.includes(99), 'sent body must wait below 100 for the HTTP receipt');
    assert.equal(data.seen.includes(100), !denied);
    assert.deepEqual(data.displayed, data.seen.map(p => `${p}%`), 'real view must repaint every measured change');
    assert.equal(data.confirmed, denied ? 0 : 1); assert.equal(data.pending, 0); assert.equal(data.badgeCleared, true);
  }
  assert.equal(requests.length, 2, 'one real upload per selected file, with no duplicate POST');
  for (const request of requests) assert.deepEqual(request, { bytes: 16777216, auth: 'Bearer local-test-token', fileName: 'documento-teste.pdf' });
});
