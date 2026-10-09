import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('monthly report fits phone, tablet and desktop with readable period and isolated table scroll',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 await server.listen();
 try{for(const [width,height] of [[390,844],[1024,768],[1365,900]]){
  const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-monthly-responsive.html`});
  const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.querySelector('#layout-result').textContent);dom.window.close();
  assert.ok(layout.pageWidth<=width,JSON.stringify(layout));assert.equal(layout.dialogOverflow,false,JSON.stringify(layout));assert.equal(layout.rows,31);
  for(const control of layout.controls)assert.ok(control.left>=0&&control.right<=width&&control.height>=44&&control.font>=16,JSON.stringify({width,control}));
  if(width===390)assert.equal(layout.tableOverflow,true);else assert.ok(layout.dialogWidth>=width*.75,JSON.stringify(layout));
 }}finally{await server.close();}
});
