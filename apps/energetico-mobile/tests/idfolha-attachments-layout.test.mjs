import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('IDFOLHA receipt tray fits phone, landscape tablet and Windows with actions below files',{timeout:120000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height] of [[320,740],[390,844],[1024,600],[1365,900]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,url:'http://127.0.0.1:'+server.httpServer.address().port+'/tests/fixtures/idfolha-attachments.html?saved=1&measure=1'});
      const dom=new JSDOM(stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
      assert.deepEqual(layout,{fullScreen:true,fits:true,fileNames:['Recibo_contabilidade_assinado_setembro_2026.pdf','Novo_recibo_contabilidade_assinado_com_nome_longo_setembro_2026.pdf'],beforeActions:true,buttonsUsable:true,selectUsable:true},JSON.stringify({width,height,layout}));
    }
  }finally{await server.close();}
});
