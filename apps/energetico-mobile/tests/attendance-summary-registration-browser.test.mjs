import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('actual backend registration messages render above submit and open both choices at phone and PC widths',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),cacheDir:'node_modules/.vite-summary-registration',server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const width of [320,390,1280])for(const mode of ['summary','menu']){
   const result=await runBrowserLayout(browser,{width,height:1000,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-summary-registration.html?${mode}`,captureScreenshot:Boolean(process.env.ATTENDANCE_CAPTURE_DIR)});
   const dom=new JSDOM(result.stdout);
   try{
    const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
    assert.equal(layout.error,undefined);assert.equal(layout.order,true,JSON.stringify({width,mode,...layout}));assert.ok(layout.scrollWidth<=width);
    if(mode==='menu'){
     assert.equal(layout.selected,'attendance_batch_register');
     for(const label of ['DESCRITIVO ETAPA','ATIVIDADE EXECUTADA','VOLTAR AO RESUMO'])assert.ok(layout.labels.some(value=>value.includes(label)),label);
    }else assert.ok(layout.labels.some(value=>value.includes('CADASTRAR')));
    if(process.env.ATTENDANCE_CAPTURE_DIR){mkdirSync(process.env.ATTENDANCE_CAPTURE_DIR,{recursive:true});writeFileSync(`${process.env.ATTENDANCE_CAPTURE_DIR}/registration-${mode}-${width}.png`,result.screenshot);}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
