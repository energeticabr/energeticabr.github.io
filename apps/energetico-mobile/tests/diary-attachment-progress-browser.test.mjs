import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('diary percentage stays beside spinner inside loading card on phone and PC', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen(); t.after(() => server.close());
  for (const colorScheme of ['light', 'dark']) for (const [width, height] of [[320, 740], [390, 844], [1365, 768]]) {
    for (const percent of [0, 37, 100]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, colorScheme,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/diary-attachment-progress.html?percent=${percent}` });
      const dom = new JSDOM(stdout);
      const data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      assert.deepEqual(data, { percent: String(percent), adjacent: true, aligned: true, contained: true, overflow: false },
        JSON.stringify({ width, height, percent, colorScheme, data }));
    }
  }
});
