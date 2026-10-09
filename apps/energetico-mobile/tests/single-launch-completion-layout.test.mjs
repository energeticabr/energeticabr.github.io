import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('single confirmation card is readable without horizontal overflow on phone, tablet and PC', { timeout: 240000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height, large] of [[320, 740, false], [390, 844, false], [390, 844, true], [1024, 768, false], [1365, 900, true]]) {
      const result = await runBrowserLayout(browser, { width, height, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/single-launch-completion.html${large ? '?large' : ''}` });
      const dom = new JSDOM(result.stdout);
      const layout = JSON.parse(dom.window.document.querySelector('#layout-result').textContent);
      dom.window.close();
      assert.equal(layout.missing, undefined);
      assert.ok(layout.pageWidth <= width, JSON.stringify(layout));
      assert.equal(layout.cardOverflow, false, JSON.stringify(layout));
      assert.ok(layout.headingFont >= 18, JSON.stringify(layout));
      assert.equal(layout.data.length, 6);
      for (const field of layout.data) assert.ok(field.left >= 0 && field.right <= width && field.font >= 12 && !field.overflow, JSON.stringify({ width, field }));
      if (width >= 1024) assert.ok(layout.cardWidth >= width * .65, JSON.stringify(layout));
    }
  } finally { await server.close(); }
});
