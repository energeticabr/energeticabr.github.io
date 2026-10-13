import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('attendance entries/exits stay aligned in two colored rows with a full-height status on phone and desktop', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, presentation] of [[320, 'attendance_multi_select'], [360, 'attendance_multi_select'], [390, 'accordion'], [1280, 'attendance_supplier_sync']]) {
      const { stdout } = await runBrowserLayout(browser, { width, height: 844, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-punch-pairs.html?presentation=${presentation}` });
      const dom = new JSDOM(stdout);
      try {
        const rows = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(rows.length, 6);
        assert.deepEqual(rows[0].cells.map(cell => cell.text), ['E1- 06:45', 'S1- 12:00', 'E2- 13:00', 'S2- 16:30']);
        for (const row of rows) {
          const diagnostic = JSON.stringify({ width, row });
          assert.equal(row.cells.length, 4, diagnostic);
          const [e1, s1, e2, s2] = row.cells;
          assert.equal(e1.top, s1.top, diagnostic);
          assert.equal(e2.top, s2.top, diagnostic);
          assert.equal(e1.left, e2.left, diagnostic);
          assert.equal(s1.left, s2.left, diagnostic);
          assert.ok(e2.top >= e1.bottom, diagnostic);
          assert.ok(row.badge.top <= e1.top + 1 && row.badge.bottom >= e2.bottom - 1, diagnostic);
          assert.ok(row.badge.left >= s1.right && row.badge.right <= row.bounds.right + 1, diagnostic);
          assert.ok(row.badgeTextRects.every(rect => rect.left >= row.badge.left && rect.right <= row.badge.right), diagnostic);
          for (const [index, cell] of row.cells.entries()) {
            const [r, g] = cell.color.match(/\d+/g).map(Number);
            assert.ok(index % 2 === 0 ? g > r : r > g, diagnostic);
            assert.equal(new Set(cell.textRects.map(rect => Math.round(rect.top))).size, 1, diagnostic);
            assert.ok(cell.textRects.every(rect => rect.left >= cell.left - 1 && rect.right <= cell.right + 1), diagnostic);
          }
        }
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
