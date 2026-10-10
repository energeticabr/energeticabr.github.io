import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
test('generated RHID PDF pages fit fully without panning on portrait and landscape phone, tablet and PC',{timeout:180000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path=>path&&existsSync(path));if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'silent'});await server.listen();
 try{for(const [width,height] of [[390,844],[844,390],[1024,768],[1365,900]]){
  const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-report-pdf-fit.html`});
  const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.querySelector('#layout-result').textContent);dom.window.close();
  assert.equal(layout.signatureControls,2,"os dois controles de assinatura aparecem na prévia");
  for(const button of layout.buttons){assert.ok(button.left>=0&&button.right<=width&&button.top>=0&&button.bottom<=height,`botão fora da tela: ${JSON.stringify(button)}`);}
  assert.equal(layout.failedPages,'0');assert.ok(layout.canvases.length>0);assert.ok(layout.pageWidth<=width);
  assert.ok(layout.scrollWidth<=layout.viewport.width+1,JSON.stringify(layout));
  assert.equal(layout.canvases.length,2,"todas as páginas em uma sequência vertical");
  assert.equal(layout.nextButtons,0,"sem precisar clicar em Próxima");
  assert.ok(layout.scrollHeight>layout.viewport.height&&layout.scrollTop>0,"a rolagem alcança o segundo funcionário");
  assert.deepEqual(layout.signedPages,[2],"assinar após rolar deve escolher o segundo funcionário");
  if(height<450)assert.ok(layout.viewport.height>=150,JSON.stringify(layout));
  for(const canvas of layout.canvases){assert.deepEqual(canvas.corner,[255,255,255,255],JSON.stringify(layout));assert.ok(canvas.inkPixels>100,"PDF desenhado, não canvas vazio");assert.ok(canvas.height<=layout.viewport.height,JSON.stringify(layout));assert.ok(canvas.left>=layout.viewport.left&&canvas.right<=layout.viewport.right,JSON.stringify(layout));}
 }}finally{await server.close();}
});
