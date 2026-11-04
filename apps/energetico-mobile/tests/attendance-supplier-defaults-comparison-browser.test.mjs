import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createIsolatedViteServer} from './helpers/isolated-vite-server.mjs';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('comparação de fornecedores cabe em celulares e Windows com nomes longos', {timeout:120000}, async t=>{
  const chrome=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!chrome)return t.skip('Chrome unavailable');
  const server=await createIsolatedViteServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{host:'127.0.0.1',port:0}});
  await server.listen();t.after(()=>server.close());
  for(const width of [320,390,1365]){
    const result=await runBrowserLayout(chrome,{width,height:844,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-supplier-defaults-comparison.html`,captureScreenshot:!!process.env.SUPPLIER_COMPARISON_SCREENSHOT_DIR});
    const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.deepEqual(layout.rows,[2,2]);assert.deepEqual(layout.supplierSpans,[2,2]);assert.notEqual(layout.colors[0],layout.colors[1]);
    assert.equal(layout.overflow,false,`${width}px`);assert.equal(layout.after,true);assert.equal(layout.fallback,false);
    assert.ok(layout.buttons.includes('attendance_supplier_defaults_yes'));assert.ok(layout.buttons.includes('attendance_supplier_defaults_no'));
    if(result.screenshot){await mkdir(process.env.SUPPLIER_COMPARISON_SCREENSHOT_DIR,{recursive:true});await writeFile(join(process.env.SUPPLIER_COMPARISON_SCREENSHOT_DIR,`comparison-${width}.png`),result.screenshot);}
  }
});
