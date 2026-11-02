import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => path && existsSync(path));
const trigger = '[data-asset-report-trigger]';
const close = '[data-action="close-asset-report"]';
async function key(api, value, code, number) {
  await api.command('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: number });
  await api.command('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: number });
}
async function shot(api, name) {
  if (!process.env.ASSET_REPORT_ARTIFACT_DIR) return;
  const directory = resolve(process.env.ASSET_REPORT_ARTIFACT_DIR); await mkdir(directory, { recursive: true });
  await api.evaluate('new Promise(resolve => setTimeout(resolve, 350))');
  const { data } = await api.command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}
test('toque, teclado, cadastro e 31 depreciações cabem em 320/390/1365px sem perder o contexto', { timeout: 180_000, skip: !browser && 'Chrome unavailable' }, async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'asset-report-vite-'));
  const server = await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..'), cacheDir] } } });
  t.after(async () => { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }); await server.listen();
  for (const width of [320, 390, 1365]) for (const kind of ['assetLaunches', 'asset']) {
    await withAttachmentBrowser(browser, { width, height: 900 }, async api => {
      await api.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/asset-report.html?kind=${kind}`);
      await api.wait('window.assetReportFixture?.ready');
      await api.evaluate(`(() => { const input = document.querySelector('input[type="search"]'); input.value='GUINCHO'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      const before = await api.evaluate(`({page:document.querySelector('.rg-pagination').textContent, search:document.querySelector('input[type="search"]').value, scroll:document.querySelector('.rg-overlay').scrollTop})`);
      await api.tap(`${trigger} .rg-row-title`); await api.wait('document.querySelector("[data-asset-history-row]")');
      const layout = await api.evaluate(`(() => {
        const dialog = document.querySelector('[data-asset-report]'), button = document.querySelector('${close}'), bounds = button.getBoundingClientRect();
        return { id:dialog.dataset.assetReport, cards:dialog.querySelectorAll('[data-asset-history-row]').length,
          overflow:dialog.scrollWidth>dialog.clientWidth+1, documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
          fieldOverflow:[...dialog.querySelectorAll('.asset-report-field')].some(n=>n.scrollWidth>n.clientWidth+1),
          width:dialog.getBoundingClientRect().width, buttonHeight:bounds.height,
          order:dialog.querySelector('[data-asset-registration]').getBoundingClientRect().top < dialog.querySelector('.asset-report-history').getBoundingClientRect().top,
          text:dialog.textContent, calls:window.assetReportFixture.calls, minFont:Math.min(...[...dialog.querySelectorAll('dt,dd')].map(n=>parseFloat(getComputedStyle(n).fontSize))) };
      })()`);
      assert.equal(layout.id, '96'); assert.equal(layout.cards, 31); assert.deepEqual(layout.calls, ['96']);
      assert.equal(layout.overflow, false); assert.equal(layout.documentOverflow, false); assert.equal(layout.fieldOverflow, false);
      assert.equal(layout.order, true); assert.ok(layout.buttonHeight >= 44); assert.ok(layout.width <= width); assert.ok(layout.minFont >= 12);
      assert.match(layout.text, /4\.723,90/); assert.match(layout.text, /3%/); assert.doesNotMatch(layout.text, /300%/);
      assert.match(layout.text, /123456789012345/);
      if (width === 390) await shot(api, `${kind}-cadastro-390`);
      await api.evaluate(`(() => { const dialog = document.querySelector('[data-asset-report]'); dialog.scrollTop += dialog.querySelector('.asset-report-history').getBoundingClientRect().top-dialog.getBoundingClientRect().top-95; })()`);
      if (width === 390) await shot(api, `${kind}-historico-390`);
      await api.tap(close); await api.wait('!document.querySelector("[data-asset-report]")');
      assert.deepEqual(await api.evaluate(`({page:document.querySelector('.rg-pagination').textContent, search:document.querySelector('input[type="search"]').value, scroll:document.querySelector('.rg-overlay').scrollTop})`), before);
      assert.equal(await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`), true);
      await api.evaluate(`document.querySelector('.rg-overlay summary').focus()`);
      for (let tabs = 0; tabs < 20 && !await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`); tabs++) await key(api, 'Tab', 'Tab', 9);
      assert.equal(await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`), true, 'Tab deve alcançar o cartão');
      await key(api, 'Enter', 'Enter', 13); await api.wait('document.querySelector("[data-asset-history-row]")');
      await key(api, 'Escape', 'Escape', 27); await api.wait('!document.querySelector("[data-asset-report]")');
      assert.deepEqual(await api.evaluate('window.assetReportFixture.calls'), ['96', '96']);
      t.diagnostic(JSON.stringify({ width, kind, id: layout.id, cards: layout.cards, overflow: layout.overflow, fieldOverflow: layout.fieldOverflow, buttonHeight: layout.buttonHeight }));
    });
  }
});
