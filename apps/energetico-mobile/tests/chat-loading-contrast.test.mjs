import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path));

test('cartão de processamento se destaca do fundo no celular e desktop, claro e escuro', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/chat-loading-contrast.html`;
    for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[390, 844], [1365, 768]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, colorScheme, url });
      const dom = new JSDOM(stdout);
      const result = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      assert.equal(result.cardVisible, true, `${colorScheme} ${width}x${height}`);
      assert.ok(result.contrast >= 1.12, `${colorScheme} ${width}x${height}: contraste ${result.contrast.toFixed(2)}`);
      assert.ok(result.borderWidth >= 1, `${colorScheme} ${width}x${height}: borda ${result.borderWidth}`);
    }
  } finally { await server.close(); }
});
