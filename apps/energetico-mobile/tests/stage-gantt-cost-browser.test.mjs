import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('custo do Gantt mantém escolha, filtros e tabela acessíveis em telas estreitas e largas', {timeout:120000}, async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[844,390],[1365,900]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gantt-cost.html`});
   const dom=new JSDOM(stdout);
   try {
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.deepEqual(result.choice,{buttons:['Dias por profissão','Custo por período'],reads:0});
    assert.deepEqual(result.initialYears,['2026','2025']);
    assert.deepEqual(result.older.months,['','1']);assert.match(result.older.total,/100,00/);
    assert.equal(result.childDirect,true);assert.equal(result.professionReads,1);assert.equal(result.costReads,2);
    assert.match(result.product,/Concreto/);assert.match(result.total,/250,00/);
    for(const flag of ['controlsVisible','contained','tableAccessible'])assert.equal(result[flag],true,`${width}: ${flag} ${JSON.stringify(result)}`);
    assert.equal(result.paidColor,'rgb(7, 94, 48)');
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
