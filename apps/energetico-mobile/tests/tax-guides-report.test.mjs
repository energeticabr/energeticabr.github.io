import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaxGuidesReportView } from '../src/ui/tax-guides-report-view.js';
import { decorateReportPrint, captureFilteredReport } from '../src/ui/report-print.js';

const rows = [
  { id:'7', hasAttachments:false, fields:{TIPO:'INSS',FILIAL:'004 - EDIFÍCIO XAVANTE',COMPETENCIA:'2026-10-20T12:00:00Z',VENCIMENTO:'2026-11-20T12:00:00Z',VALOR:null} },
  { id:'8', hasAttachments:true, fields:{TIPO:'FGTS',FILIAL:'004 - EDIFÍCIO XAVANTE',COMPETENCIA:'2026-10-20T12:00:00Z',VENCIMENTO:'2026-11-20T12:00:00Z',VALOR:1407.4} },
  { id:'9', hasAttachments:false, fields:{TIPO:'INSS',FILIAL:'004 - EDIFÍCIO XAVANTE',COMPETENCIA:'2026-11-20T12:00:00Z',VENCIMENTO:'2026-12-20T12:00:00Z',VALOR:0} },
];
function setup(t, data, options={}) {
  const dom=new JSDOM('<!doctype html><body><main id="app"><button data-action="open-tax-guides-report">INSS</button></main></body>',{pretendToBeVisual:true});
  const doc=dom.window.document, trigger=doc.querySelector('button');trigger.focus();
  const report=createTaxGuidesReportView({document:doc,data,...options});
  t.after(()=>{report.destroy();dom.window.close();});
  return {dom,doc,trigger,report};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('INSS report reads the shared rows, distinguishes missing amounts from zero, and filters both taxes',async t=>{
  let reads=0;
  const {doc,report,trigger}=setup(t,{loadSnapshot:async()=>{reads++;return {rows};}});
  await report.open();
  assert.equal(reads,1);assert.equal(doc.querySelector('#app').hasAttribute('inert'),true);
  assert.deepEqual([...report.element.querySelectorAll('th')].map(n=>n.textContent),['Data vencimento','Data competência','Filial','Valor','Tipo','Guia']);
  assert.match(report.element.querySelector('[data-guide-id="7"]').textContent,/20\/11\/2026.*20\/10\/2026.*A informar.*INSS/);
  assert.match(report.element.querySelector('[data-guide-id="9"]').textContent,/0,00/);
  const type=report.element.querySelector('[name="TIPO"]');type.value='FGTS';type.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
  assert.equal(report.element.querySelectorAll('tbody tr').length,1);
  assert.match(report.element.querySelector('tbody').textContent,/1\.407,40/);
  report.close();assert.equal(report.element.hidden,true);assert.equal(doc.querySelector('#app').hasAttribute('inert'),false);assert.equal(doc.activeElement,trigger);
  await report.open();doc.activeElement.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(report.element.hidden,true);assert.equal(reads,2);
});

test('one PDF button opens every actual attachment from only the selected guide',async t=>{
  const listed=[],downloads=[],opened=[];
  const {report}=setup(t,{loadSnapshot:async()=>({rows}),listAttachments:async id=>{listed.push(id);return [{fileName:'INSS-original.pdf'},{name:'segunda-guia.pdf'}];},downloadAttachment:async(id,name)=>{downloads.push([id,name]);return name;}},{openMediaCollection:async items=>opened.push(items)});
  await report.open();report.element.querySelector('[data-guide-id="8"] button').click();await tick();
  assert.deepEqual(listed,['8']);assert.equal(opened[0].length,2);
  await opened[0][0].source({});await opened[0][1].source({});
  assert.deepEqual(downloads,[['8','INSS-original.pdf'],['8','segunda-guia.pdf']]);
  assert.equal(report.element.querySelector('[data-guide-id="7"] button'),null);
});

test('closing cancels a pending read and rejects its late result without restoring the panel',async t=>{
  let release,signal;
  const {report}=setup(t,{loadSnapshot:options=>{signal=options.signal;return new Promise(resolve=>release=resolve);}});
  const opening=report.open();report.close();assert.equal(signal.aborted,true);
  release({rows});await opening;
  assert.equal(report.element.hidden,true);assert.equal(report.element.querySelectorAll('tbody tr').length,0);
});

test('load failures expose retry without treating unread data as an empty report',async t=>{
  let fail=true;
  const {report}=setup(t,{loadSnapshot:async()=>{if(fail)throw new Error('offline');return {rows};}});
  await report.open();assert.match(report.element.textContent,/Não foi possível consultar/);
  fail=false;report.element.querySelector('[aria-label^="Atualizar"]').click();await tick();
  assert.equal(report.element.querySelectorAll('tbody tr').length,3);
});

test('a failed refresh cannot redisplay old guides when the user changes a filter',async t=>{
  let fail=false;
  const {report,doc}=setup(t,{loadSnapshot:async()=>{if(fail)throw new Error('offline');return {rows};}});
  await report.open();fail=true;report.element.querySelector('[aria-label^="Atualizar"]').click();await tick();
  const type=report.element.querySelector('[name="TIPO"]');type.value='INSS';type.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
  assert.equal(report.element.querySelectorAll('tbody tr').length,0);
  assert.match(report.element.textContent,/Não foi possível consultar/);
});

test('printing waits for the active SharePoint read instead of exporting loading placeholders',async t=>{
  let release;
  const {report}=setup(t,{loadSnapshot:()=>new Promise(resolve=>release=resolve)});
  const printed=decorateReportPrint(report,{action:'open-tax-guides-report'});t.after(()=>printed.destroy());
  const opening=printed.open();await tick();
  assert.equal(printed.element.querySelector('[data-action="print-report-pdf"]').disabled,true);
  assert.throws(()=>captureFilteredReport(printed.element),/Aguarde o carregamento/);
  release({rows});await opening;await tick();
  assert.equal(printed.element.querySelector('[data-action="print-report-pdf"]').disabled,false);
});

test('reopening the report reads attachments replaced in the separate HR gallery',async t=>{
  let current='primeira-guia.pdf',cached;
  const opened=[];
  const {report}=setup(t,{loadSnapshot:async()=>({rows}),listAttachments:async(_id,options)=>{if(!cached||options.refresh)cached=[{fileName:current}];return cached;}},{openMediaCollection:async items=>opened.push(items.map(item=>item.fileName))});
  await report.open();report.element.querySelector('[data-guide-id="8"] button').click();await tick();
  report.close();current='guia-substituida.pdf';await report.open();report.element.querySelector('[data-guide-id="8"] button').click();await tick();
  assert.deepEqual(opened,[['primeira-guia.pdf'],['guia-substituida.pdf']]);
});
