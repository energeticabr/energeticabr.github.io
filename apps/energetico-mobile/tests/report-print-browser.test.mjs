import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('all fifteen custom mascot reports generate real PDFs and preserve phone filters and PDF return', {timeout:150000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(value=>value&&existsSync(value));
 if(!browser)return t.skip('Chrome unavailable');
 const app=resolve(fileURLToPath(new URL('..',import.meta.url))),server=await createServer({root:app,server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try{
  await server.listen();
  for(const [width,height]of [[740,360],[844,390]]){
   const {stdout}=await runBrowserLayout(browser,{width,height,readyTimeoutMs:90000,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?print=1&verify=1`});
   const dom=new JSDOM(stdout);try{
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);assert.equal(result.error,undefined,result.error);assert.equal(result.results.length,15);
    for(const report of result.results){assert.ok(report.printer,report.action);assert.ok(report.bytes>1000&&report.pages>0&&report.text.length>50,JSON.stringify(report));assert.ok(report.fits,report.action);if(report.filterWidth)assert.ok(report.filterWidth<=report.filterClient+1,'filters overflow '+JSON.stringify(report));if(report.action==='open-payment-ledger')assert.ok(report.filterHeight<=50,'printer must keep the compact single filter row '+report.filterHeight);}
    assert.deepEqual(result.viewer,{open:true,canvas:true,forward:true,back:'Voltar ao relatório',automaticShare:false,returned:true});
    assert.match(result.results.find(report=>report.action==='open-payment-ledger').text,/SERVENTE DE PEDREIRO/);
    assert.match(result.results.find(report=>report.action==='open-depreciation-report').text,/VIBRADOR DE CONCRETO/);
    if(process.env.REPORT_PDF_QA_DIR){mkdirSync(process.env.REPORT_PDF_QA_DIR,{recursive:true});for(const sample of dom.window.document.querySelectorAll('[data-pdf-sample]'))writeFileSync(resolve(process.env.REPORT_PDF_QA_DIR,`${sample.dataset.pdfSample}-${width}.pdf`),Buffer.from(sample.textContent,'base64'));}
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
