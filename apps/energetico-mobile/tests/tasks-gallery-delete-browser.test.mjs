import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('deleting a task keeps the real browser scroll and second page through the success popup', { timeout: 90000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 768]]) {
      const result = await runBrowserLayout(browser, { width, height,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tasks-gallery-responsive.html?preserve=1&delete=1` });
      const dom = new JSDOM(result.stdout);
      try {
        const state = JSON.parse(dom.window.document.documentElement.dataset.layout), diagnostic = JSON.stringify({ width, state });
        assert.equal(state.snapshots, 1, diagnostic);
        assert.deepEqual(state.writes, [{ operation: 'delete', id: '188' }], diagnostic);
        assert.equal(state.page, 'Página 2 de 3', diagnostic);
        for (const field of ['removed', 'sameNeighbor', 'neighborExpanded', 'receipt']) assert.equal(state[field], true, diagnostic);
        assert.equal(state.loading, false, diagnostic);
        assert.ok(state.before.content > 0, diagnostic);
        assert.deepEqual(state.after, state.before, diagnostic);
        assert.deepEqual(state.afterClose, state.before, diagnostic);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
