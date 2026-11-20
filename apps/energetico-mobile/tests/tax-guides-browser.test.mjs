import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('INSS and FGTS requests and attachment editor fit phones and Windows', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const outDir = resolve(root, 'work/tax-guides-fixture');
  await build({ root, configFile: false, base: '/', logLevel: 'silent', build: { outDir, emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'tests/fixtures/tax-guides-gallery.html') } } });
  const server = await preview({ root, configFile: false, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
  try {
    const screenshots = resolve(root, 'work/tax-guides'); mkdirSync(screenshots, { recursive: true });
    for (const width of [320, 390, 1365]) for (const mode of ['menu', 'gallery', 'editor']) {
      const result = await runBrowserLayout(browser, { width, height: 900, captureScreenshot: true,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tax-guides-gallery.html?mode=${mode}` });
      const dom = new JSDOM(result.stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      writeFileSync(resolve(screenshots, `${mode}-${width}.png`), result.screenshot);
      if (mode === 'menu') {
        assert.equal(layout.taxCount, 1); assert.equal(layout.payslipCount, 1);
        assert.equal(layout.overflow, false);
        assert.ok(layout.tax.right <= layout.payslip.x, `INSS e FGTS fica à esquerda em ${width}px`);
        assert.ok(Math.abs(layout.tax.y - layout.payslip.y) < 2, 'os botões ficam na mesma linha');
        continue;
      }
      assert.equal(layout.overflows, false, `${mode}/${width}: no overflow`);
      assert.equal(layout.cards, 2); assert.equal(layout.pending, true); assert.equal(layout.uploaded, true);
      assert.equal(layout.pendingStatuses, 2);
      if (mode === 'editor') {
        assert.equal(layout.fileInput, true);
        for (const name of ['TIPO', 'FILIAL', 'COMPETENCIA']) assert.ok(layout.fields.some(field => field.name === name && (field.disabled || field.readOnly)), name);
        for (const name of ['VENCIMENTO', 'VALOR', 'STATUS']) assert.ok(layout.fields.some(field => field.name === name && !field.disabled && !field.readOnly), name);
        assert.equal(layout.fields.find(field => field.name === 'STATUS').value, 'PENDENTE');
        assert.equal(layout.fields.find(field => field.name === 'VENCIMENTO').value, '2026-11-20');
        assert.equal(layout.fields.find(field => field.name === 'COMPETENCIA').value, '2026-10-20');
      }
    }
  } finally { await new Promise(resolve => server.httpServer.close(resolve)); }
});
