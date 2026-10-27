import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('ID grande à esquerda e cluster selecionável cabem no celular e desktop, com detalhe completo', {timeout:180000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  await server.listen();
  try {
    for(const [width,height] of [[320,740],[390,844],[1365,900]]) for(const detail of [false,true]) {
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/description-gallery-linked-clusters.html${detail?'?detail=1':''}`});
      const dom=new JSDOM(stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
      assert.deepEqual(layout.overflow,[],`${width}px detail=${detail}`);
      assert.equal(layout.pageOverflow,false,`${width}px detail=${detail}: page width`);
      assert.equal(layout.clusters.length,3);
      for(const cluster of layout.clusters) {
        assert.equal(cluster.text,cluster.id);
        assert.ok(cluster.width>=64&&cluster.height>=64&&cluster.beforeName&&cluster.editClear,JSON.stringify(cluster));
        assert.ok(cluster.touchHeight>=64&&cluster.fullWidth,JSON.stringify(cluster));
      }
      assert.equal(layout.count,detail?2:0);assert.equal(layout.wrongGroup,false);assert.equal(layout.dialogFits,true);
      if(detail){
        assert.match(layout.total.replace(/\s/g,''),/R\$45,00/);assert.deepEqual(layout.colors,['rgb(255, 255, 255)','rgb(220, 238, 249)']);
        assert.deepEqual(layout.compactText.map(value=>value.text),['FORNECEDOR FICTÍCIO','Material de exemplo']);
        assert.ok(layout.compactText.every(value=>value.title.includes(value.text)&&value.ellipsis&&value.overflowHidden&&value.nowrap),'collapsed text keeps its full accessible value');
        assert.deepEqual(layout.statusLabel,{text:'Status',clipped:true,accessible:true});
      }
    }
  } finally {await server.close();}
});
