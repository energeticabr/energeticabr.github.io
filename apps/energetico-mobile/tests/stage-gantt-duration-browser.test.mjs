import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('GANTT mostra durações curtas à direita, mantém longas dentro e recalcula ao redimensionar', {timeout:90000}, async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[844,390],[1365,900]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gantt-duration.html`});
   const dom=new JSDOM(stdout);
   try {
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    const row=(rows,name)=>rows.find(row=>row.name===name);
    assert.deepEqual(result.initial.map(row=>row.name),['Longa','Curta','Curta no final']);
    for(const rows of [result.initial,result.resized]) {
     assert.ok(row(rows,'Longa').fits,JSON.stringify(result));
     assert.ok(row(rows,'Curta no final').outside,JSON.stringify(result));
     assert.equal(row(rows,'Curta no final').text,'1 dia');
    }
    assert.ok(row(result.initial,'Curta').outside,JSON.stringify(result));
    assert.ok(row(result.resized,'Curta').fits,JSON.stringify(result));
    assert.ok(result.endVisible&&result.detailOpen,JSON.stringify(result));
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
