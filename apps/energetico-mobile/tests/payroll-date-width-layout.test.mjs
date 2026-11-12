import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('payroll date and batch cards fit native and shipped PWA styles', {timeout:120_000}, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({configFile:false, root:resolve(appRoot,'pwa'), base:'/energetico/', logLevel:'silent', build:{write:false}});
  const css = bundle.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css')).map(asset => asset.source).join('\n');
  const server = await createServer({root:appRoot, logLevel:'silent', server:{host:'127.0.0.1',port:0}, plugins:[{
    name:'payroll-date-built-styles', configureServer(vite) {
      vite.middlewares.use('/tests/payroll-date-built.css', (_req,res) => {
        res.setHeader('Content-Type','text/css'); res.end(css);
      });
    },
  }]});
  await server.listen();
  try {
    for (const [width,height,safeAreaInsets] of [
      [280,740], [320,740], [390,844],
      [844,390,{left:47,right:47,top:0,bottom:21}],
      [768,1024], [1024,768], [1365,900],
    ]) {
      for (const pwa of [false,true]) {
        const {stdout} = await runBrowserLayout(browser, {width,height,safeAreaInsets,mobile:width<900,
          url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-date-width.html${pwa?'?pwa=1':''}`});
        const dom = new JSDOM(stdout);
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        dom.window.close();
        const context = `${width}x${height}, PWA=${pwa}`;
        for (const state of [layout.empty,layout.filled,layout.restored]) {
          assert.ok(state.input.width <= 320.5, `date stretches beyond a compact width: ${context}: ${state.input.width}`);
          assert.ok(state.input.left >= state.content.left - .5 && state.input.right <= state.content.right + .5, `date escapes its content: ${context}`);
          assert.ok(state.input.left >= 15.5 && state.input.right <= width - 15.5, `date loses screen margins: ${context}`);
          assert.ok(state.bodyScrollWidth <= state.bodyWidth + 1, `horizontal overflow: ${context}`);
          assert.ok(state.input.width >= Math.min(240,state.content.width) - .5, `date is too narrow to read: ${context}`);
          assert.ok(state.input.height >= 44 && state.input.height <= 72, `date touch target: ${context}`);
          assert.ok(state.fontSize >= 16, `date text is too small: ${context}`);
          assert.equal(state.type,'date');
          assert.ok(state.continueButton.right <= width && state.continueButton.bottom <= height, `continue action clipped: ${context}`);
        }
        assert.equal(layout.empty.value,'');
        assert.equal(layout.filled.value,'2026-10-08');
        assert.equal(layout.restored.value,'2026-10-08');
        assert.match(layout.advanced,/Selecione os fornecedores/);
        const { batch } = layout;
        assert.equal(batch.initial, 'rgb(255, 255, 255)', context);
        assert.equal(batch.incomplete, 'rgb(255, 240, 218)', context);
        assert.equal(batch.ready, 'rgb(229, 245, 233)', context);
        assert.equal(batch.unchecked, batch.incomplete, context);
        assert.equal(batch.panelVisible, true, context);
        assert.deepEqual(batch.defaults, ['2', '4', '5'], context);
        for (const control of batch.defaultControls) {
          assert.ok(control.height >= 44 && control.left >= 0 && control.right <= width &&
            control.bottom <= batch.toggle.top, 'batch defaults clipped or below the list: ' + context);
        }
        assert.match(batch.amount, /101,25/);
        assert.ok(batch.overflow <= 1, 'batch horizontal overflow: ' + context);
        assert.ok(batch.checkbox.width >= 44 && batch.checkbox.height >= 44, 'checkbox touch target: ' + context);
        assert.ok(batch.checkbox.right <= batch.toggle.left && batch.post.right <= width, 'batch controls clipped: ' + context);
        assert.deepEqual(layout.calls,['suppliers']);
        t.diagnostic(`${context}: date=${layout.filled.input.width}px; no overflow; selected date survives navigation`);
      }
    }
  } finally { await server.close(); }
});
