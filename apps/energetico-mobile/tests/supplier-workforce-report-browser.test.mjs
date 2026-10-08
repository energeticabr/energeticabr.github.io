import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

// Break caught: CSS clips seven columns/filter controls, arrows cover cells, or PDF drops offscreen sections.
test('workforce hierarchy fits landscape phone tablet Windows and exports all colored sections',{timeout:180000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  assert.ok(existsSync(fileURLToPath(new URL('../src/ui/supplier-workforce-report.css',import.meta.url))),'workforce report styling must exist');
  // Other agents/suite fixtures run Vite simultaneously: never share their dependency cache.
  const temporaryRoot=resolve(tmpdir()),cacheRoot=await mkdtemp(join(temporaryRoot,'supplier-workforce-vite-'));
  let server;
  try {
    server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cacheRoot,'cache'),
      optimizeDeps:{noDiscovery:true,include:['decimal.js','pdf-lib']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
    await server.listen();
    for(const [width,height,safeAreaInsets] of [[844,390],[844,390,{left:47,right:47,top:0,bottom:21}],[844,390,{left:47,right:0,top:0,bottom:21}],[667,375],[1024,768],[1280,800],[1920,1080],[390,844]]) {
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/supplier-workforce-report-browser.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      if(height>width){assert.equal(result.loads,0);assert.equal(result.warning,true);assert.equal(result.closeVisible,true);assert.equal(result.tables,0);assert.equal(result.busy,'true');continue;}
      assert.equal(result.loads,1);assert.equal(result.logoLoaded,true);assert.equal(result.documentOverflow,0);
      const safeLeft=safeAreaInsets?.left||0,safeRight=safeAreaInsets?.right||0;
      assert.ok(Math.abs(result.dialog.left-Math.max(8,safeLeft))<=1,`${width}px safe-area left edge was not applied`);
      assert.ok(Math.abs(result.dialog.right-(width-Math.max(8,safeRight)))<=1,`${width}px safe-area right edge was not applied`);
      assert.ok(result.content.left-result.dialog.left<=(height<=500?51:61),`${width}px excessive left whitespace`);
      assert.ok(result.dialog.right-result.content.right<=(height<=500?51:61),`${width}px excessive right whitespace`);
      assert.ok(result.brand.left>=result.arrows[0].right+2,`${width}px previous arrow overlaps the logo`);
      assert.ok(result.brand.right<=result.arrows[1].left-2,`${width}px next arrow overlaps the logo`);
      assert.ok(result.brand.left-result.arrows[0].right<=8,`${width}px unused left strip`);
      assert.ok(result.arrows[1].left-result.brand.right<=26,`${width}px unused right strip including scrollbar`);
      assert.ok(result.toolbarOverflow<=1,`${width}px toolbar overflow ${result.toolbarOverflow}`);
      assert.ok(result.contentOverflow<=1,`${width}px content overflow ${result.contentOverflow}`);
      assert.ok(result.contentHeight>100);assert.ok(result.contentScrollHeight>result.contentHeight);assert.ok(parseFloat(result.fontSize)>=11);
      assert.deepEqual(result.tables.map(table=>[table.columns,table.rows]),[[7,4],[7,4],[7,4],[7,4],[7,4],[7,4]]);
      assert.equal(result.arrows.length,2);
      for(const table of result.tables){assert.ok(table.left>=result.arrows[0].right+2,`${width}px previous arrow overlaps`);assert.ok(table.right<=result.arrows[1].left-2,`${width}px next arrow overlaps`);}
      assert.deepEqual(result.capturedTables,[{columns:7,rows:5},{columns:7,rows:5},{columns:7,rows:5},{columns:7,rows:5},{columns:7,rows:5},{columns:7,rows:5}]);
      assert.equal(result.capturedColors.length,6);assert.ok(result.capturedColors.every(color=>Array.isArray(color)&&color.some(channel=>channel<1)));
      assert.ok(new Set(result.capturedColors.map(color=>JSON.stringify(color))).size>=4);
      assert.equal(result.pdfHeader,'%PDF-');assert.ok(result.pdfPages>=3);
      assert.ok(result.filterCaptions.some(filter=>filter.label==='DATA FINAL'&&filter.value==='07/10/2026'));
      assert.deepEqual(result.actions.map(action=>action.label),['Abrir PDF do relatório','Atualizar fornecedores e frequência']);
      for(const action of result.actions){assert.ok(action.height>=40&&action.height<=48);assert.ok(action.width>=36&&action.width<=48);}
      assert.ok(Math.abs(result.actions[0].top-result.actions[1].top)<1);assert.ok(result.actions[1].right<=result.firstDate.left-2);
      assert.equal(result.popup.placement,'expanded');assert.equal(result.popup.searchFocused,false);assert.equal(result.popup.color,'rgb(0, 0, 0)');assert.equal(result.popup.fontWeight,'400');
      assert.ok(result.popup.left>=0&&result.popup.right<=width);assert.ok(result.popup.height>150&&result.popup.height<=height);
      assert.equal(result.keyboard.focused,true);assert.equal(result.keyboard.height,result.popup.height);assert.equal(result.keyboard.width,result.popup.width);
      assert.equal(result.keyboard.report.height,height);assert.ok(result.keyboard.toolbarOverflow<=1);assert.equal(result.keyboard.fontSize,result.fontSize);
      t.diagnostic(`${width}x${height}: six complete tables, 24 suppliers, ${result.pdfPages} actual PDF pages`);
    }
  }finally{
    await server?.close();
    if(dirname(resolve(cacheRoot))!==temporaryRoot||!basename(cacheRoot).startsWith('supplier-workforce-vite-'))throw new Error('Cache de testes fora do diretório temporário autorizado.');
    await rm(cacheRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
