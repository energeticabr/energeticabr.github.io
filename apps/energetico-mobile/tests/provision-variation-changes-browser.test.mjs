import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createIsolatedViteServer} from './helpers/isolated-vite-server.mjs';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

for (const flow of ['provision', 'document']) test(`${flow} changes retain three readable columns above buttons on phones and Windows`,{timeout:120000},async t=>{
  const chrome=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!chrome)return t.skip('Chrome unavailable');
  const server=await createIsolatedViteServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'silent',server:{host:'127.0.0.1',port:0}});
  await server.listen();t.after(()=>server.close());
  for(const width of [320,390,1365]){
    const result=await runBrowserLayout(chrome,{width,height:1100,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-variation-changes.html?${flow}`,captureScreenshot:!!process.env.PROVISION_CHANGES_SCREENSHOT_DIR});
    const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.columns,3);assert.equal(layout.rows,4);assert.equal(layout.sameLine,true);assert.equal(layout.ordered,true);
    assert.equal(layout.beforeButtons,true);assert.equal(layout.overflow,false,`${width}px overflow`);
    assert.deepEqual(layout.headers,[flow === 'document' ? 'Coluna' : 'Dado alterado','Antes','Depois']);assert.match(layout.text,/ESCRITÓRIO CENTRAL QA/);
    if (flow === 'document') assert.match(layout.starredButton, /^⭐ 4 - FORNECEDOR/);
    if(result.screenshot){await mkdir(process.env.PROVISION_CHANGES_SCREENSHOT_DIR,{recursive:true});await writeFile(join(process.env.PROVISION_CHANGES_SCREENSHOT_DIR,`${flow}-changes-${width}.png`),result.screenshot);}
  }
});
