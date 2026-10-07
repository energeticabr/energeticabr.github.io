import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));

test('tablet e PC usam a largura disponível e mantêm compositor compacto com anexos', {timeout:120000}, async t=>{
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height,attachments,long] of [[1024,600,false],[1280,800,true],[1536,864,false],[900,1200,false],[390,844,false],[844,390,false],[1024,600,false,true]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?space=1${attachments?'&attachments=1':''}${long?'&long=1':''}`});
   const layout=JSON.parse(/data-layout="([^"]+)"/.exec(stdout)[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
   assert.equal(layout.overflow,false,`sem transbordamento: ${JSON.stringify(layout)}`);
   assert.ok(layout.buttons.every(b=>b.width>=44&&b.height>=44),'alvos de toque preservados');
   if(long){
    assert.equal(layout.draftHeight,176,'mensagem longa pode crescer até o limite original');
    assert.equal(layout.draftOverflow,'auto','mensagem longa continua rolável');
   }else if(width>=900){
    assert.ok(layout.shell.width>=width*.94,`shell aproveita a tela: ${JSON.stringify(layout)}`);
    assert.ok(layout.menu.width>=layout.transcript.width*.8,`menu usa pelo menos 80% da área: ${JSON.stringify(layout)}`);
    assert.ok(layout.composer.height<=90,`compositor não ocupa duas linhas de botões: ${JSON.stringify(layout)}`);
    assert.ok(layout.transcript.height>=height*(attachments?.64:.68),`conversa ocupa a maior parte da altura: ${JSON.stringify(layout)}`);
    if(attachments){assert.equal(layout.attachmentCount,4);assert.ok(layout.attachmentHeight<=60,'anexos recolhidos compactos');}
   }else{
    assert.equal(layout.draftMinHeight,'76px','campo de celular preservado');
    assert.ok(layout.composer.height>=96,'celular mantém controles em coluna');
   }
  }
 }finally{await server.close();}
});
