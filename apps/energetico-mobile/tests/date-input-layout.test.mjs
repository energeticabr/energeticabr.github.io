import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const expectedTypes = { task: ['date'], editor: ['date', 'datetime-local'], month: ['month'], payroll: ['date'], filters: ['date', 'date'], provision: ['date'] };
const expectedValues = { date: '2026-10-10', month: '2026-10', 'datetime-local': '2026-10-10T06:26' };

// Removing the shared native-input padding workaround must fail this test:
// iOS WebKit adds exterior horizontal padding to date/time controls at width 100%.
test('native date controls retain inner margins, empty/filled height and values across app forms', { timeout: 240_000 }, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(p => p && existsSync(p));
  if (!chrome) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({ configFile: false, root: resolve(root, 'pwa'), base: '/energetico/', logLevel: 'silent', build: { write: false } });
  const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  const server = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } }, plugins: [{
    name: 'date-input-built-styles', configureServer(vite) { vite.middlewares.use('/tests/date-input-built.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(css); }); },
  }] });
  let webkit;
  try {
    await server.listen();
    if (process.env.DATE_LAYOUT_PLAYWRIGHT) {
      const module = await import(pathToFileURL(process.env.DATE_LAYOUT_PLAYWRIGHT).href);
      webkit = await module.webkit.launch();
    }
    for (const engine of webkit ? ['Chrome', 'WebKit'] : ['Chrome']) {
      for (const kind of ['task', 'editor', 'month', 'payroll', 'filters', 'provision']) {
        for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1024, 768]]) {
          for (const pwa of [false, true]) {
            const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/date-input-layout.html?kind=${kind}${pwa ? '&pwa=1' : ''}`;
            let layout;
            if (engine === 'WebKit') {
              const page = await webkit.newPage({ viewport: { width, height }, locale: 'pt-BR' });
              try { await page.goto(url); await page.waitForSelector('html[data-ready=true]'); layout = await page.evaluate(() => JSON.parse(document.documentElement.dataset.layout)); }
              finally { await page.close(); }
            } else {
              const { stdout } = await runBrowserLayout(chrome, { width, height, url, mobile: width < 900 });
              const dom = new JSDOM(stdout); layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
            }
            const context = `${engine} ${kind} ${width}x${height} PWA=${pwa}`;
            assert.deepEqual(layout.empty.map(field => field.requestedType), expectedTypes[kind], `real date controls missing or changed: ${context}`);
            for (const state of [layout.empty, layout.filled, layout.focused]) for (const field of state) {
              assert.ok(field.type === field.requestedType || engine === 'WebKit' && field.type === 'text', `unexpected native type: ${context}`);
              assert.equal(field.padding, 0, `native iOS exterior padding can escape the field: ${context}`);
              assert.ok(field.input.left >= field.field.left + field.insetLeft - 1 && field.input.right <= field.field.right - field.insetRight + 1, `date consumes field margins: ${context}: ${JSON.stringify(field)}`);
              assert.ok(field.input.left >= 0 && field.input.right <= width + 1, `horizontal viewport overflow: ${context}`);
              assert.ok(field.input.width > 100 && field.input.height >= 42, `date is unreadable or collapsed: ${context}`);
              assert.ok(field.fontSize >= 16, `date text too small: ${context}`);
            }
            assert.ok(layout.empty.every(field => field.value === ''), `empty values: ${context}`);
            for (let index = 0; index < expectedTypes[kind].length; index++) {
              assert.equal(layout.filled[index].value, expectedValues[expectedTypes[kind][index]], `requested date/month/time value changed: ${context}`);
              assert.equal(layout.focused[index].focused, true, `field not measured while focused: ${context}`);
              assert.ok(Math.abs(layout.empty[index].input.height - layout.filled[index].input.height) <= 1, `empty date height collapsed: ${context}`);
              assert.ok(Math.abs(layout.filled[index].input.height - layout.focused[index].input.height) <= 1, `focused date height changed: ${context}`);
            }
            assert.deepEqual(layout.focused.map(field => field.value), layout.filled.map(field => field.value), `focus lost the selected date: ${context}`);
            const fallback = layout.filled.filter(field => field.type !== field.requestedType).map(field => field.requestedType);
            t.diagnostic(`${context}: margins, heights and values preserved${fallback.length ? `; NO native ${fallback.join('/')} support in this desktop WebKit (text fallback only, not iOS picker coverage)` : '; native control types retained'}`);
          }
        }
      }
    }
  } finally { await webkit?.close(); await server.close(); }
});
