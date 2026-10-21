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
        ['provision-attachments', ['ID 330']],
        ['provision-attachments-multiple', ['ID 330', 'ID 9007199254740993']],
        ['order-attachments', ['ID 406']],
        ['order-attachments-multiple', ['ID 406', 'ID 9007199254740993']],
        ['settlement', ['ID 308', 'ID 403', 'ID 3567']],
        ['diary', ['ID 214']],
        ['description-settlement', ['ID 12', 'ID 325', 'ID 406', 'ID 3570']],
        ['description-multiple', ['ID 12', 'ID 325', 'ID 326', 'ID 327', 'ID 406', 'ID 407', 'ID 408', 'ID 3570', 'ID 3571', 'ID 9007199254740993']],
        ['description-no-launch', ['ID 12', 'ID 325', 'ID 326']],
        ['multiple', ['IDS 3551, 3552, 3553, 3554, 3555, 3556', 'IDS 390, 391', 'ID 9007199254740993', 'R$ 1.234.567,89']],
        ['provision', ['IDS 501, 502', 'IDS 101, 102']],
        ['registration', ['ID 201']],
        ['technical', ['ID 901']],
        ['recurring', ['ID 37']],
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
        if (sample === 'settlement' || sample === 'diary' || sample.startsWith('description-') || sample.startsWith('order-attachments') || sample.startsWith('provision-attachments')) {
          assert.equal(layout.senderInsideCard, true);
          assert.deepEqual(layout.sender.slice(0, 2).map(field => field.text), ['Energético', sample.startsWith('provision-attachments') ? '15:09' : sample.startsWith('order-attachments') ? '00:13' : sample === 'settlement' ? '06:18' : sample === 'diary' ? '23:29' : '00:09']);
          for (const field of layout.sender) assert.ok(field.left >= 0 && field.right <= width && field.width > 0 && field.height > 0, JSON.stringify({ width, sample, field }));
          assert.ok(layout.sender[0].right < layout.sender[2].left, 'sender and mascot must not overlap');
        }
        if (sample === 'description-multiple') assert.equal(layout.details, '📎 Comprovante: recibo-ficticio.pdf');
        if (sample === 'order-attachments-multiple') assert.equal(layout.details, '📎 Comprovante: comprovante-pendente.pdf');
        if (sample === 'provision-attachments-multiple') assert.equal(layout.details, '📎 Comprovante: provisao-pendente.pdf');
        if (width >= 1024) assert.ok(layout.cardWidth >= width * .65, JSON.stringify(layout));
      }
    }
  } finally { await server.close(); }
});
