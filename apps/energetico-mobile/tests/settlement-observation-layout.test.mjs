import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(path => path && existsSync(path));
let server;
let url;

before(async () => {
  if (!browser) return;
  const root = fileURLToPath(new URL('..', import.meta.url));
  server = await createIsolatedViteServer({
    root,
    optimizeDeps: { noDiscovery: true, include: ['decimal.js', 'pdf-lib', 'pako', '@capacitor/core'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [resolve(root, '../..')] } },
    logLevel: 'silent',
  });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/settlement-observation-layout.html`;
});
after(async () => { await server?.close(); });

for (const [width, height] of [[320, 700], [390, 844], [1280, 900]]) {
  test(`observação da baixa cabe no cartão a ${width}px`, { skip: !browser, timeout: 60000 }, async () => {
    const { stdout } = await runBrowserLayout(browser, { width, height, url });
    const { window } = new JSDOM(stdout);
    const layout = JSON.parse(window.document.documentElement.dataset.layout);
    window.close();
    assert.equal(layout.error, undefined);
    assert.equal(layout.long.fitsCard, true, JSON.stringify(layout));
    assert.equal(layout.long.lineClamp, '3');
    assert.ok(Math.abs(layout.long.lines - 3) < 0.1);
    assert.equal(layout.long.verticallyClipped, true);
    assert.equal(layout.short.verticallyClipped, false);
    for (const item of [layout.short, layout.long]) {
      assert.equal(item.fitsCard, true);
      assert.equal(item.fitsScreen, true);
      assert.equal(item.choicesOverflow, false);
      assert.equal(item.fullLabelPreserved, true);
      assert.equal(item.keepReply, 'description_observation_keep');
      assert.equal(item.blankReply, 'description_observation_blank');
      assert.equal(item.blankLabel, 'SEM OBSERVAÇÃO');
    }
  });
}
