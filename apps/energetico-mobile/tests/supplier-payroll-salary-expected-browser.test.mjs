import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('salary paid/expected uses green whole currency amounts on portrait landscape and desktop with actual report styles', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const capture = process.env.PAYROLL_SALARY_EXPECTED_CAPTURE_DIR;
  if (capture) mkdirSync(capture, { recursive: true });
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [740, 320], [390, 844], [844, 390], [568, 320], [1365, 900]]) {
      await t.test(`${width}x${height}`, async () => {
        const result = await runBrowserLayout(browser, { width, height, captureScreenshot: Boolean(capture),
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplier-payroll-salary-expected.html` });
        if (capture) writeFileSync(join(capture, `salary-expected-${width}x${height}.png`), result.screenshot);
        const dom = new JSDOM(result.stdout);
        try {
          const layout = JSON.parse(dom.window.document.documentElement.dataset.layout), detail = JSON.stringify({ width, height, layout });
          assert.equal(layout.error, undefined, detail);
          assert.equal(layout.portrait, height > width, detail);
          for (const field of ['pageHorizontalOverflow', 'contentHorizontalOverflow']) assert.equal(layout[field], false, `${field}: ${detail}`);
          for (const field of ['noExpectedOn13Salary', 'allCardsFit', 'noExternalResources']) assert.equal(layout[field], true, `${field}: ${detail}`);
          assert.deepEqual(layout.salaryTexts, ['R$ 99.999.999,99 / R$ 123.456.789,00', 'R$ 527,00 / Não informado', 'R$ 627,00 / R$ 3.200,50'], detail);
          assert.equal(layout.paid13, 'R$ 1.200,00', detail); assert.equal(layout.otherRubricPaid, 'R$ 600,00', detail);
          assert.equal(layout.totalPaidUnchanged, 'R$ 100.000.599,99', detail);
          for (const row of layout.amounts) {
            assert.ok(row.scrollWidth <= row.width + 1, detail);
            for (const amount of row.atoms) {
              assert.equal(amount.oneLine, true, detail); assert.equal(amount.fitsValue, true, detail); assert.equal(amount.fitsRow, true, detail);
              assert.equal(amount.whiteSpace, 'nowrap', detail); assert.equal(amount.color, 'rgb(22, 121, 77)', detail);
            }
          }
        } finally { dom.window.close(); }
      });
    }
  } finally { await server.close(); }
});
