import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('pending provision X and confirmation fit phone/Windows; No preserves and Yes removes the synthetic row', {timeout:180000}, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!chrome) return t.skip('Chrome unavailable');
  const cache = await mkdtemp(join(tmpdir(), 'pending-delete-vite-'));
  const server = await createServer({root:resolve(fileURLToPath(new URL('..', import.meta.url))), cacheDir:join(cache,'cache'),
    optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try {
    await server.listen();
    for (const width of [320, 390, 1365]) {
      for (const mode of ['list','confirm']) {
        const result = await runBrowserLayout(chrome, {width,height:844,
          url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-provision-delete.html?view=${mode}`,
          captureScreenshot:Boolean(process.env.PROVISION_DELETE_SCREENSHOT_DIR) && width === 390});
        const dom = new JSDOM(result.stdout);
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(layout.underCheck,true); assert.equal(layout.redFill,'rgb(180, 35, 24)');
        assert.deepEqual(layout.children,['332','333','334']);
        assert.equal(layout.afterNoRows,1); assert.equal(layout.noWrites,0);
        assert.equal(layout.afterYesRows,0); assert.equal(layout.yesWrites,1);
        assert.equal(layout.fits,true,`${width} ${mode}`); assert.equal(layout.horizontalOverflow,false,`${width} ${mode}`);
        if (result.screenshot) {
          await mkdir(process.env.PROVISION_DELETE_SCREENSHOT_DIR,{recursive:true});
          await writeFile(join(process.env.PROVISION_DELETE_SCREENSHOT_DIR,`${mode}-390.png`),result.screenshot);
        }
      }
    }
  } finally { await server.close(); await rm(cache,{recursive:true,force:true,maxRetries:5,retryDelay:250}); }
});
