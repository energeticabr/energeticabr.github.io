import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('RHID monthly header button stays readable between navigation and actions and opens the existing form', {timeout:120_000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome/Edge unavailable');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height] of [[320,740],[390,844],[844,390],[1024,768],[1365,900]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-monthly-header-responsive.html?open`});
      const dom=new JSDOM(stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout),button=layout.button;
      dom.window.close();
      assert.ok(button,`monthly shortcut missing at ${width}`);
      assert.equal(button.label,'GERAR RELATÓRIO MENSAL RHID');
      assert.ok(button.height>=44&&button.width>=44&&button.font>=12&&!button.overflow,JSON.stringify(layout));
      assert.ok(layout.nav.right<=button.left&&button.right<=layout.actions.left,JSON.stringify(layout));
      assert.ok(layout.pageWidth<=width&&layout.actions.right<=width,JSON.stringify(layout));
      assert.deepEqual(layout.form,{month:'09',year:'2026',supplier:'',options:10});
      assert.equal(layout.dailyDate,'2026-09-28');assert.equal(layout.draft,'Observação preservada');
    }
  }finally{await server.close();}
});
