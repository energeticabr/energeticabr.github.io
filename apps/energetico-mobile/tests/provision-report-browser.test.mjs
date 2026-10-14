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

// Break: responsive CSS hides the column headers and turns compact table rows
// into tall cards, including inside the portrait phone's landscape canvas.
test('provision report keeps the original compact tables in landscape and portrait without horizontal drag',{timeout:180000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const temporaryRoot=resolve(tmpdir()),cacheRoot=await mkdtemp(join(temporaryRoot,'provision-report-vite-'));let server;
  try{
    server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cacheRoot,'cache'),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});await server.listen();
    for(const [width,height,safeAreaInsets] of [[844,390],[844,390,{left:47,right:47,bottom:21}],[667,375],[568,320],[1024,768],[1060,600],[1280,589],[1792,1000],[1920,1080],[390,844]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-report-browser.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      assert.equal(result.warning,false);
      for(const [index,layout] of result.tableLayouts.entries()){
        assert.equal(layout.display,'table',`${width}x${height}: ${layout.section} turned into cards`);
        assert.equal(layout.headerDisplay,'table-row');assert.notEqual(layout.headerPosition,'absolute');
        assert.equal(layout.rowDisplay,'table-row');assert.equal(layout.headers.length,[7,14,8][index]);
        assert.equal(layout.cells.length,[7,14,8][index]);assert.ok(layout.cells.every(cell=>cell.display==='table-cell'));
        for(const [column,cell] of layout.cells.entries()){
          assert.ok(Math.abs(cell.top-layout.cells[0].top)<=1,`${width}px: fields stacked vertically`);
          assert.ok(Math.abs(cell.left-layout.headers[column].left)<=1,`${width}px: header and cell misaligned`);
          assert.ok(Math.abs(cell.width-layout.headers[column].width)<=1);
        }
      }
      assert.deepEqual(result.tableLayouts[0].headers.map(header=>header.text),['FILIAL','FORNECEDOR','PRODUTO','DATA VENCIMENTO','AGENDAMENTO','VALOR','STATUS']);
      assert.equal(result.loads,1);assert.equal(result.logoLoaded,true);assert.equal(result.documentOverflow,0);assert.ok(result.toolbarOverflow<=1);assert.ok(result.contentOverflow<=1);assert.ok(result.contentHeight>80);
      assert.equal(result.rows,4);assert.equal(result.pendingCount,'4 pendência(s)');assert.match(result.pendingTotal,/123\.457\.161,68/);
      assert.equal(result.inactiveRows,1,`${width}px: inactive section must exercise actual records`);
      for(const wrapper of result.wrappers)assert.ok(wrapper.overflow<=1,`${width}px: ${wrapper.section} requires horizontal drag (${wrapper.overflow}px)`);
      assert.ok(result.columns.every(value=>value>20),`${width}px: monthly columns missing ${result.columns}`);
      assert.equal(result.zoomProbe.tableDisplay,'table');assert.equal(result.zoomProbe.fontReadable,true);
      assert.equal(result.zoomProbe.viewportGuard,true);assert.equal(result.zoomProbe.resetOverflow,0);
      assert.ok(parseFloat(result.fontSize)>=7,`${width}px: annual text must be larger at its fitted scale`);
      assert.ok(result.annualTypography.dates.every(date=>date.weight==='600'&&date.size>=4.5),`${width}px: annual dates need semibold, whole readable tokens`);
      assert.ok(result.annualTypography.totals.every(total=>total.align==='center'&&total.weight==='600'),`${width}px: annual totals need centered semibold text`);
      assert.ok(result.annualTypography.ordinaryAmounts.every(size=>size>=5),`${width}px: ordinary annual values must be larger`);
      assert.ok(result.atomic.length>=30,`${width}px: whole date/amount tokens missing`);
      for(const token of result.atomic){
        assert.ok(token.lines<=1,`${width}px: ${token.text} broke into ${token.lines} lines`);assert.equal(token.whiteSpace,'nowrap');
        if(token.cell){assert.ok(token.rect.left>=token.cell.left-1);assert.ok(token.rect.right<=token.cell.right+1,`${width}px: ${token.text} spills past its cell`);}
      }
      const colors={green:'rgb(46, 125, 50)',yellow:'rgb(183, 128, 0)',red:'rgb(176, 0, 32)',orange:'rgb(245, 124, 0)',purple:'rgb(106, 27, 154)',blue:'rgb(21, 101, 192)'};
      for(const [tone,color] of Object.entries(colors)){const dots=result.dots.filter(dot=>dot.tone===tone);assert.ok(dots.length,`${width}px: ${tone} indicator missing`);for(const dot of dots){assert.equal(dot.color,color);assert.ok(dot.width>=3&&dot.height>=3);}}
      assert.equal(result.wrappers.length,3);assert.ok(result.wrappers.every(wrapper=>wrapper.keyboard===0));assert.ok(result.reachTotal);
      assert.equal(result.reachTotal.scroll,0,`${width}px: annual report must fit before scrolling`);
      assert.ok(result.reachTotal.total.right<=result.reachTotal.wrapper.right+1,`${width}px: total column cannot be reached`);
      assert.ok(result.tableWidth>=result.availableWidth-2,`${width}px: unnecessary unused report width`);
      assert.equal(result.hiddenCells.length,0,`${width}px: fields/months hidden by responsive layout`);
      assert.deepEqual(result.cellOverflows,[],`${width}px: cell contents overflow their visible bounds`);
      assert.ok(result.labelledCells.every(cell=>cell.label),`${width}px: responsive field lost its label`);
      assert.equal(result.headerColumns[1],14,`${width}px: annual headers must remain in PDF capture`);
      if(!result.portrait)for(const wrapper of result.wrappers){assert.ok(wrapper.left>=result.arrows[0].right+2);assert.ok(wrapper.right<=result.arrows[1].left-2);}
      assert.equal(result.filters.length,5);assert.deepEqual(result.capturedTables.map(table=>table.columns),[7,14,8]);
      assert.match(result.annualText,/1\.234\.567,89/);assert.match(result.annualText,/02\/01\/2026/);assert.match(result.annualText,/02\/12\/2026/);
      t.diagnostic(`${width}x${height}: compact table rows, visible column headers, no horizontal overflow, whole dates/amounts and six status colors`);
    }
  }finally{
    await server?.close();if(dirname(resolve(cacheRoot))!==temporaryRoot||!basename(cacheRoot).startsWith('provision-report-vite-'))throw new Error('Cache fora do diretório temporário autorizado.');
    await rm(cacheRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});

test('grouped provision rows fit phone and PC canvases when expanded without changing totals',{timeout:90000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const temporaryRoot=resolve(tmpdir()),cacheRoot=await mkdtemp(join(temporaryRoot,'provision-report-vite-'));let server;
  try{
    server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),cacheDir:join(cacheRoot,'cache'),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});await server.listen();
    for(const [width,height,safeAreaInsets] of [[568,320],[844,390,{left:47,right:47,bottom:21}],[1920,1080],[390,844]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-report-browser.html?grouped=1`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined);const probe=result.groupProbe;
      assert.ok(probe.collapsedHidden);assert.equal(probe.expanded,'true');assert.ok(probe.focusKept);
      assert.deepEqual(probe.originalIds,['301','302']);assert.deepEqual(probe.originalDates,['09/10/2026','11/10/2026']);
      assert.equal(probe.branch,'FILIAL DO PAI');assert.equal(probe.supplier,'FORNECEDOR DE REFERÊNCIA');assert.equal(probe.date,'25/10/2026');
      assert.ok(probe.toggleRect.left>=probe.branchTextRect.right-1,`${width}px: arrow must be right of branch text`);
      assert.equal(probe.branchDisplay,'table-cell',`${width}px: FILIAL must stay in the table grid`);
      assert.ok(Math.abs((probe.toggleRect.top+probe.toggleRect.height/2)-(probe.branchTextRect.top+probe.branchTextRect.height/2))<=3,`${width}px: arrow must share the branch line`);
      assert.ok(probe.toggleRect.right<=probe.branchRect.right+1,`${width}px: arrow escapes the branch cell`);
      assert.ok(probe.toggleRect.width>=28,`${width}px: arrow shrank below the existing control size`);
      assert.equal(probe.equalBranch,'');assert.equal(probe.equalSupplier,'');
      assert.match(probe.equalStatus,/VENCIDO HÁ 2 DIAS/,`${width}px: differing due status must remain visible`);
      assert.equal(probe.differentBranch,'004 - EDIFÍCIO XAVANTE');
      assert.notEqual(probe.childFill,probe.summaryFill,`${width}px: expanded child must have a distinct fill`);
      assert.equal(probe.total.replace(/\s/g,''),'R$123.456.911,68');assert.equal(probe.products.length,2);
      assert.equal(probe.singleHasToggle,false);assert.equal(probe.expandedRows,5);
      assert.ok(probe.expandedOverflow<=1,`${width}px: expanded items overflow the report`);assert.deepEqual(probe.cellOverflows,[]);
      assert.ok(probe.totalsUnchanged);assert.ok(probe.annualUnchanged);assert.equal(probe.collapsed,'false');assert.ok(probe.hiddenAgain);
      t.diagnostic(`${width}x${height}: collapsed parent, original item rows, stable totals and focus, no horizontal overflow`);
    }
  }finally{
    await server?.close();if(dirname(resolve(cacheRoot))!==temporaryRoot||!basename(cacheRoot).startsWith('provision-report-vite-'))throw new Error('Cache fora do diretório temporário autorizado.');
    await rm(cacheRoot,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
