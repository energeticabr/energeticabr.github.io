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

// Break: month columns compress dates to isolated digits; status dots disappear,
// the enlarged table spills outside the dialog, or its last months cannot be reached.
test('provision report keeps whole dates and amounts in wider columns with colored status dots',{timeout:180000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const temporaryRoot=resolve(tmpdir()),cacheRoot=await mkdtemp(join(temporaryRoot,'provision-report-vite-'));let server;
  try{
    server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cacheRoot,'cache'),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});await server.listen();
    for(const [width,height,safeAreaInsets] of [[844,390],[844,390,{left:47,right:47,bottom:21}],[667,375],[568,320],[1024,768],[1280,589],[1920,1080],[390,844]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-report-browser.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      if(height>width){assert.equal(result.loads,0);assert.equal(result.warning,true);assert.equal(result.rows,0);continue;}
      assert.equal(result.loads,1);assert.equal(result.logoLoaded,true);assert.equal(result.documentOverflow,0);assert.ok(result.toolbarOverflow<=1);assert.ok(result.contentOverflow<=1);assert.ok(result.contentHeight>80);
      assert.equal(result.rows,4);assert.equal(result.pendingCount,'4 pendência(s)');assert.match(result.pendingTotal,/1\.358,48/);
      assert.ok(parseFloat(result.fontSize)>=10.5);assert.ok(result.columns.every(value=>value>=88),`${width}px: cramped monthly columns ${result.columns}`);
      assert.ok(result.atomic.length>=30,`${width}px: whole date/amount tokens missing`);
      for(const token of result.atomic){
        assert.ok(token.lines<=1,`${width}px: ${token.text} broke into ${token.lines} lines`);assert.equal(token.whiteSpace,'nowrap');
        if(token.cell){assert.ok(token.rect.left>=token.cell.left-1);assert.ok(token.rect.right<=token.cell.right+1,`${width}px: ${token.text} spills past its cell`);}
      }
      const colors={green:'rgb(46, 125, 50)',yellow:'rgb(183, 128, 0)',red:'rgb(176, 0, 32)',orange:'rgb(245, 124, 0)',purple:'rgb(106, 27, 154)',blue:'rgb(21, 101, 192)'};
      for(const [tone,color] of Object.entries(colors)){const dots=result.dots.filter(dot=>dot.tone===tone);assert.ok(dots.length,`${width}px: ${tone} indicator missing`);for(const dot of dots){assert.equal(dot.color,color);assert.ok(dot.width>=9&&dot.height>=9);}}
      assert.equal(result.wrappers.length,3);assert.ok(result.wrappers.every(wrapper=>wrapper.keyboard===0));assert.ok(result.reachTotal);
      assert.ok(result.reachTotal.total.right<=result.reachTotal.wrapper.right+1,`${width}px: total column cannot be reached`);
      for(const wrapper of result.wrappers){assert.ok(wrapper.left>=result.arrows[0].right+2);assert.ok(wrapper.right<=result.arrows[1].left-2);}
      assert.equal(result.filters.length,5);assert.deepEqual(result.capturedTables.map(table=>table.columns),[7,14,8]);
      assert.match(result.annualText,/1\.234\.567,89/);assert.match(result.annualText,/02\/01\/2026/);assert.match(result.annualText,/02\/12\/2026/);
      t.diagnostic(`${width}x${height}: whole dates/amounts, six status colors, reachable 12 months and totals`);
    }
  }finally{
    await server?.close();if(dirname(resolve(cacheRoot))!==temporaryRoot||!basename(cacheRoot).startsWith('provision-report-vite-'))throw new Error('Cache fora do diretório temporário autorizado.');
    await rm(cacheRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
