import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('date-day clusters are compact and centered in their columns on phones, desktop and print',{timeout:90000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=await createServer({root,server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height,mediaType] of [[320,740,'screen'],[390,844,'screen'],[844,390,'screen'],[1365,900,'screen'],[1365,900,'print']]){
   const capture=process.env.DDA_DUE_DAYS_CAPTURE_DIR;
   const result=await runBrowserLayout(browser,{width,height,mediaType,captureScreenshot:Boolean(capture),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report-due-days.html`});
   const dom=new JSDOM(result.stdout);
   try{
    const state=JSON.parse(dom.window.document.documentElement.dataset.dueDays);
    assert.equal(state.overflow,false,JSON.stringify({width,state}));
    assert.deepEqual([...new Set(state.schedules.map(badge=>badge.text))].sort(),['AGENDADO','AGENDAMENTO NÃO CONFIRMADO','NÃO AGENDADO']);
    for(const badge of state.schedules){
     assert.ok(badge.above&&badge.sameWidth&&badge.fits,JSON.stringify({width,badge}));
     assert.equal(badge.printColorAdjust,'exact');
     if(badge.state==='scheduled'){
      assert.equal(badge.color,'rgb(23, 100, 63)');
      assert.equal(badge.background,'rgb(234, 248, 238)');
     }
    }
    assert.equal(state.metrics.length,7);
    assert.deepEqual(state.metrics.slice(4).map(({label,value})=>({label,value})),[
     {label:'Qtd DDA vencendo em 7d',value:'3'},
     {label:'Valor DDA vencendo em 7d',value:'R$ 7.500,00'},
     {label:'Valor DDA vencendo hoje',value:'R$ 2.500,00'}
    ]);
    for(const metric of state.metrics)assert.ok(metric.fits,JSON.stringify({width,metric}));
    assert.ok(state.metrics[4].top>state.metrics[0].top,'new metrics use a second row');
    assert.equal(state.missing,'Não informado');
    assert.deepEqual(state.rows.map(row=>row.text),['-1 d','0 d','1 d','5 d']);
    for(const row of state.rows){
     assert.ok(row.below&&row.fits&&row.centered,JSON.stringify({width,row}));
     assert.equal(row.background,row.dateColor);
     assert.equal(row.color,'rgb(255, 255, 255)');
     assert.equal(row.border,'rgb(255, 255, 255)');
     assert.ok(row.fontSize>10&&row.fontSize<12,'vencimento must be slightly smaller');
     assert.ok(row.height>=20&&row.height<24,'vencimento cluster must be slightly more compact');
     assert.equal(row.printColorAdjust,'exact');
    }
    assert.equal(state.rows[1].background,'rgb(183, 24, 42)');
    assert.equal(state.rows[2].background,'rgb(169, 75, 0)');
    assert.equal(state.rows[3].background,'rgb(23, 100, 63)');
    assert.equal(state.missingIssued,'Não informada');
    assert.equal(state.issued.length,4);
    for(const row of state.issued){
     assert.equal(row.text,'12 d');
     assert.ok(row.below&&row.fits&&row.centered,JSON.stringify({width,row}));
     assert.ok(row.fontSize>10&&row.fontSize<12,'emissão must be slightly larger than before');
     assert.ok(row.height>=20&&row.height<24);
     assert.equal(row.background,'rgb(237, 241, 244)');
     assert.equal(row.color,'rgb(69, 99, 117)');
     assert.equal(row.printColorAdjust,'exact');
    }
    if(capture){mkdirSync(capture,{recursive:true});writeFileSync(join(capture,`dda-due-days-${width}-${mediaType}.png`),result.screenshot);}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
