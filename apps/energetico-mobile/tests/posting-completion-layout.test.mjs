import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('other posting cards remain readable on phone, tablet and PC with every ID visible', { timeout: 240000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1365, 900]]) {
      for (const [sample, expected] of [
        ['settlement', ['ID 308', 'ID 403', 'ID 3567']],
        ['multiple', ['IDS 3551, 3552, 3553, 3554, 3555, 3556', 'IDS 390, 391', 'ID 9007199254740993', 'R$ 1.234.567,89']],
        ['provision', ['IDS 501, 502', 'IDS 101, 102']],
        ['registration', ['ID 201']],
        ['technical', ['ID 901']],
      ]) {
        const result = await runBrowserLayout(browser, { width, height, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/posting-completion.html?sample=${sample}` });
        const dom = new JSDOM(result.stdout);
        const layout = JSON.parse(dom.window.document.querySelector('#layout-result').textContent);
        dom.window.close();
        assert.equal(layout.missing, undefined);
        assert.ok(layout.pageWidth <= width, JSON.stringify(layout));
        assert.equal(layout.cardOverflow, false, JSON.stringify(layout));
        assert.ok(layout.headingFont >= 18, JSON.stringify(layout));
        assert.equal(layout.paragraphWeight, '400');
        assert.deepEqual(layout.data.filter((_, i) => i % 2).map(field => field.text), expected);
        for (const field of layout.data) assert.ok(field.left >= 0 && field.right <= width && field.font >= 12 && !field.overflow, JSON.stringify({ width, sample, field }));
        if (sample === 'multiple') assert.equal(layout.details, '📎 Anexos enviados: 4');
        if (width >= 1024) assert.ok(layout.cardWidth >= width * .65, JSON.stringify(layout));
      }
    }
  } finally { await server.close(); }
});
