import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('NFS-e with XML pending binds the original DANFSe national identity before showing and filtering CNO', { timeout:90000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, cacheDir:'node_modules/.vite-nfse-cno-pdf',
    optimizeDeps:{ noDiscovery:true, force:true, include:['decimal.js','pdf-lib','pdfjs-dist'] },
    server:{ host:'127.0.0.1', port:0, hmr:false, watch:null, fs:{ allow:[resolve(root,'../..')] } }, logLevel:'silent' });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-nfse-cno-pdf.html`;
    for (const [width,height] of [[390,844],[1365,900]]) {
      const { stdout } = await runBrowserLayout(browser, { width,height,url });
      const dom = new JSDOM(stdout);
      try {
        const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(state.error, undefined);
        assert.deepEqual(state.notes, {
          '1':'CNO consta90.025.44060/72', '2':null, '3':'CNO não consta',
          '4':'CNO inválido90.025.4406/72 · CNO correto da obra: 90.025.44060/72',
          '5':'CNO divergente90.025.44069/72', '6':null, '7':null, '8':null,
          '9':'CNO consta90.025.44060/72', '10':null,
        });
        assert.deepEqual(state.reads, ['1','10','2','3','4','5','6','8','9']);
        assert.deepEqual(state.filters, { valid:['1','9'], missing:['3'], conflict:['4','5'] });
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
