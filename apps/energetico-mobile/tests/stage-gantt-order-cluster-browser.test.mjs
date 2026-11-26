import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('GANTT mostra Fundação de maio acima de Alvenaria de agosto e destaca cada descritivo em cluster negrito', {timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[844,390],[1365,900]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gantt-order-cluster.html`});
   const dom=new JSDOM(stdout);
   try{
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.deepEqual(result.initial,['EXECUÇÃO FUNDAÇÃO','ALVENARIA E ESTRUTURAS','ACABAMENTO SEM INÍCIO']);
    assert.deepEqual(result.children,['EXECUÇÃO PAREDES ARRIMO','ARMAÇÃO FERRAGEM ARRIMO','VERIFICAÇÃO GABARITO OBRA']);
    assert.deepEqual(result.refreshed,result.initial);
    assert.deepEqual(result.allDates,['2026-05-26','2026-08-10','']);
    assert.ok(result.names.every(name=>name.cluster&&name.tag==='STRONG'&&name.weight>=700&&name.fits),JSON.stringify(result));
    assert.deepEqual(result.names.map(name=>name.background),[
     'rgb(36, 114, 58)', // Fundação finalizada.
     'rgb(13, 77, 97)', // Alvenaria em andamento.
     'rgb(36, 114, 58)', 'rgb(36, 114, 58)', 'rgb(36, 114, 58)', // Descritivos finalizados.
     'rgb(13, 77, 97)', // Acabamento não iniciado.
    ]);
    assert.ok(result.names.every(name=>name.color==='rgb(255, 255, 255)'),JSON.stringify(result));
    assert.deepEqual(result.createButton,{color:'rgb(255, 255, 255)',background:'rgb(36, 114, 58)',fits:true});
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
