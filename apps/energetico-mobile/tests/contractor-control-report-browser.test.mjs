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

// Break: missing CSS, clipped table/toolbar on tablet/phone, inaccessible popup, or incomplete/uncolored PDF.
test('contractor report fits tablet and Windows with phone scroll and complete colored PDF',{timeout:180000},async t=>{
  assert.ok(existsSync(fileURLToPath(new URL('../src/ui/contractor-control-report.css',import.meta.url))),'standalone contractor control CSS must exist');
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const temporaryRoot=resolve(tmpdir()),cacheRoot=await mkdtemp(join(temporaryRoot,'contractor-control-vite-'));let server;
  try {
    server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cacheRoot,'cache'),
      optimizeDeps:{noDiscovery:true,include:['decimal.js','pdf-lib']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});await server.listen();
    for(const [width,height] of [[844,390],[667,375],[1024,768],[1280,800],[390,844]]) {
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/contractor-control-report-browser.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      if(height>width){assert.equal(result.loads,0);assert.equal(result.warning,true);assert.equal(result.closeVisible,true);assert.equal(result.rows,0);continue;}
      assert.equal(result.loads,1);assert.equal(result.logoLoaded,true);assert.equal(result.documentOverflow,0);
      assert.ok(result.toolbarOverflow<=1,`${width}px toolbar overflow: ${result.toolbarOverflow}`);assert.ok(result.contentOverflow<=1,`${width}px content overflow: ${result.contentOverflow}`);
      assert.ok(result.contentHeight>80);assert.equal(result.rows,25);assert.equal(result.columns,13);assert.ok(parseFloat(result.fontSize)>=10.5);
      if(width>=1024)assert.ok(result.mainOverflow<=1,`${width}px tablet should fit all 13 columns`);
      assert.equal(result.arrows.length,2);assert.ok(result.main.left>=result.arrows[0].right+2);assert.ok(result.main.right<=result.arrows[1].left-2);
      assert.equal(result.brandBackground,'rgb(252, 231, 243)');assert.equal(result.reportBackground,'rgb(255, 255, 255)');
      assert.deepEqual(result.tones,{pending:'rgb(244, 177, 131)',danger:'rgb(255, 199, 206)',success:'rgb(198, 239, 206)'});
      assert.deepEqual(result.capturedTables,[{columns:13,rows:62}]);assert.equal(result.firstCapturedId,'61');assert.equal(result.lastCapturedId,'1');
      assert.deepEqual(result.pdfColors.pending,[244/255,177/255,131/255]);assert.deepEqual(result.pdfColors.danger,[1,199/255,206/255]);assert.deepEqual(result.pdfColors.success,[198/255,239/255,206/255]);
      assert.equal(result.pdfHeader,'%PDF-');assert.ok(result.pdfPages>=2);assert.equal(result.restoredRows,25);assert.equal(result.restoredScroll,55);
      assert.equal(result.pdfTitle,'Controle de empreiteiros');assert.equal(result.reportAction,'open-contractor-control-report');
      assert.deepEqual(result.navigationActions,[{from:'open-contractor-control-report',direction:'previous'},{from:'open-contractor-control-report',direction:'next'}]);
      assert.ok(result.filterCaptions.some(f=>f.label==='STATUS'&&f.value==='ATIVO'));
      assert.deepEqual(result.actions.map(a=>a.label),['Abrir PDF do relatório','Atualizar controle de empreiteiros']);
      assert.ok(Math.abs(result.actions[0].top-result.actions[1].top)<1);for(const action of result.actions)assert.ok(action.width>=36&&action.height>=40);
      assert.equal(result.popup.placement,'expanded');assert.equal(result.popup.searchFocused,false);assert.equal(result.popup.color,'rgb(0, 0, 0)');assert.equal(result.popup.fontWeight,'400');
      assert.ok(result.popup.left>=0&&result.popup.right<=width);assert.ok(result.popup.height>150&&result.popup.height<=height);
      assert.equal(result.keyboard.focused,true);assert.equal(result.keyboard.height,result.popup.height);assert.equal(result.keyboard.width,result.popup.width);
      assert.equal(result.detailColumns.launches,6);assert.equal(result.detailColumns.measurements,4);assert.equal(result.unmatchedDetailHidden,true);assert.equal(result.unmatchedDetailTables,0);
      t.diagnostic(`${width}x${height}: 13 columns, 61 printed contracts, ${result.pdfPages} PDF pages; detail tables 6/4 columns`);
    }
  }finally {
    await server?.close();
    if(dirname(resolve(cacheRoot))!==temporaryRoot||!basename(cacheRoot).startsWith('contractor-control-vite-'))throw new Error('Cache fora do diretório temporário autorizado.');
    await rm(cacheRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
