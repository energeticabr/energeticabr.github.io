import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import sharp from 'sharp';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('payment column titles keep an opaque, unbroken top border while the rows scroll underneath',{timeout:120000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try{
    await server.listen();
    const {stdout,screenshot}=await runBrowserLayout(browser,{width:844,height:390,captureScreenshot:true,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payment-ledger-continuous.html?header`});
    const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
    assert.equal(result.error,undefined,result.error);
    const header=result.header;
    assert.ok(Math.abs(header.top-header.scrollTop)<=2,`Cabeçalho não ficou fixo: ${JSON.stringify(header)}`);
    assert.equal(header.background,'rgb(255, 255, 255)');
    assert.equal(header.covered,true,'os dados não devem receber toques através do título');
    const {data,info}=await sharp(screenshot).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const isDark=(x,y)=>{const i=(y*info.width+x)*info.channels;return data[i]<70&&data[i+1]<70&&data[i+2]<70;};
    const x0=Math.ceil(header.left)+4,x1=Math.floor(header.left+header.width)-4;
    const topRows=[Math.floor(header.top),Math.ceil(header.top)].map(y=>({y,dark:Array.from({length:x1-x0},(_,n)=>isDark(x0+n,y)).filter(Boolean).length}));
    assert.ok(topRows.some(row=>row.dark/(x1-x0)>0.8),`Borda superior do título sumiu ao rolar: ${JSON.stringify({header,topRows})}`);
    const y0=Math.ceil(header.top)+4,y1=Math.floor(header.top+header.height)-4;
    const leftColumns=[Math.floor(header.left),Math.ceil(header.left)].map(x=>({x,dark:Array.from({length:y1-y0},(_,n)=>isDark(x,y0+n)).filter(Boolean).length}));
    assert.ok(leftColumns.some(column=>column.dark/(y1-y0)>0.8),`Borda lateral do título sumiu ao rolar: ${JSON.stringify({header,leftColumns})}`);
    const portrait=await runBrowserLayout(browser,{width:390,height:844,captureScreenshot:true,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payment-ledger-continuous.html?header`});
    const portraitDom=new JSDOM(portrait.stdout);let portraitResult;try{portraitResult=JSON.parse(portraitDom.window.document.documentElement.dataset.layout);}finally{portraitDom.window.close();}
    assert.equal(portraitResult.error,undefined,portraitResult.error);
    const pr=portraitResult.header,{data:pd,info:pi}=await sharp(portrait.screenshot).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(pr.background,'rgb(255, 255, 255)');
    assert.equal(pr.covered,true,'o título girado deve cobrir os dados durante o arraste');
    const pDark=(x,y)=>{const i=(y*pi.width+x)*pi.channels;return pd[i]<70&&pd[i+1]<70&&pd[i+2]<70;};
    const py0=Math.ceil(pr.top)+4,py1=Math.floor(pr.top+pr.height)-4;
    const edges=[Math.floor(pr.left),Math.ceil(pr.left+pr.width)-1].map(x=>({x,dark:Array.from({length:py1-py0},(_,n)=>pDark(x,py0+n)).filter(Boolean).length}));
    assert.ok(edges.every(edge=>edge.dark/(py1-py0)>0.8),`Bordas do título girado sumiram ao arrastar: ${JSON.stringify({header:pr,edges})}`);
  }finally{await server.close();}
});

test('payments scroll in batches of 200, reset after filtering, keep PDF complete and use a blue logo background',{timeout:120000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),optimizeDeps:{noDiscovery:true,include:['decimal.js']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'silent'});
  try{
    await server.listen();
    for(const [width,height,safeAreaInsets] of [[844,390],[844,390,{left:47,right:47,bottom:21}],[1280,589]]){
      const {stdout}=await runBrowserLayout(browser,{width,height,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payment-ledger-continuous.html`});
      const dom=new JSDOM(stdout);let result;try{result=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
      assert.equal(result.error,undefined,result.error);
      assert.deepEqual(result.counts,[200,400,451,451]);assert.equal(result.anchored,true);
      assert.deepEqual(result.printer,{rows:452,visible:200,top:70});
      assert.equal(result.filteredInitial,200);assert.equal(result.filteredEnd,201);assert.equal(result.filterScroll,0);
      assert.equal(new Set(result.ids).size,201);assert.ok(result.ids.every(id=>Number(id)>=251));
      assert.equal(result.printRows,202);assert.equal(result.restoredScroll,true);assert.equal(result.pager,false);
      assert.equal(result.logoBackground,'rgb(230, 240, 255)');assert.equal(result.logoLoaded,true);
      assert.equal(result.documentOverflow,0);assert.ok(result.overflow<=1);assert.ok(result.tableHeight>150);
    }
  }finally{await server.close();}
});
