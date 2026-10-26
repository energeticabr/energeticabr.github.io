import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const chrome = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
  .find(path=>path&&existsSync(path));
const start = async t => {
  const server=await createIsolatedViteServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{host:'127.0.0.1',port:0}});
  await server.listen();t.after(()=>server.close());
  return `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-provision-location-summary.html`;
};

test('pending report supplier/location and attachment-only disclosure fit320/390px and Windows', {timeout:120000},async t=>{
  if(!chrome)return t.skip('Chrome unavailable');
  const url=await start(t);
  for(const width of [320,390,1365]){
    const result=await runBrowserLayout(chrome,{width,height:844,url,captureScreenshot:!!process.env.PENDING_LOCATION_SCREENSHOT_DIR&&width===390});
    const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.geometry.length,4);
    assert.deepEqual(layout.geometry.map(row=>row.arrowDisabled),[false,true,true,true]);
    for(const row of layout.geometry){assert.equal(row.supplierAbove,true,`${width}px ${row.id}`);assert.equal(row.locationInBlue,true);assert.equal(row.locationVisible,true);assert.equal(row.horizontalOverflow,false);}
    assert.equal(layout.geometry[0].location,'004 - EDIFÍCIO DE TESTE (TORRE A / APARTAMENTO 101)');
    assert.equal(layout.disabledInvocations,0);assert.equal(layout.expanded,true);
    assert.equal(layout.controls,'pending-provision-attachments-306');assert.equal(layout.retryEnables,true);
    assert.equal(layout.fits,true);assert.equal(layout.horizontalOverflow,false);
    if(result.screenshot){await mkdir(process.env.PENDING_LOCATION_SCREENSHOT_DIR,{recursive:true});await writeFile(join(process.env.PENDING_LOCATION_SCREENSHOT_DIR,'preview-fictitious-390.png'),result.screenshot);}
    t.diagnostic(`${width}px: supplier first, location visible, only confirmed attachments selectable`);
  }
});

test('native touch expands only attachments and retry enables an independently failed row', {timeout:60000},async t=>{
  if(!chrome)return t.skip('Chrome unavailable');
  const url=await start(t);
  await withAttachmentBrowser(chrome,{width:390,height:844},async({navigate,wait,evaluate,tap})=>{
    await navigate(url);await wait('document.documentElement.dataset.ready === "true"');
    await tap('[data-payment-id="306"] .chat-pending-provision__arrow');
    assert.equal(await evaluate('document.querySelector(".chat-pending-provision__attachments").hidden'),false);
    assert.equal(await evaluate('document.querySelector("[data-field=branch]").checkVisibility()'),true);
    await evaluate('document.querySelector("[data-action=retry-pending-provision-attachments]").scrollIntoView({block:"center"})');
    await tap('[data-action="retry-pending-provision-attachments"]');
    assert.equal(await evaluate('document.querySelector("[data-payment-id=\\"309\\"] .chat-pending-provision__arrow").disabled'),false);
    assert.equal(await evaluate('JSON.parse(document.documentElement.dataset.actions).toggles.every(id=>id==="306")'),true);
  });
});
