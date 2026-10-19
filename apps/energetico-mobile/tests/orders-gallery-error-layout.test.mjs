import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('orders load errors stay readable above retry without overlapping sorting on phones and PC', { timeout: 120000 }, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!chrome) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); t.after(() => server.close());
  for (const width of [320, 589, 844, 1365]) {
    const { stdout } = await runBrowserLayout(chrome, { width, height: 1000, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/orders-gallery-responsive.html?failure=1` });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.ok(layout.alertVisible && layout.sortHidden && layout.fits && layout.beforeRetry && layout.noOverflow, JSON.stringify({ width, layout }));
    assert.match(layout.text, /Não foi possível carregar pedidos.*Microsoft Graph/);
  }
});
