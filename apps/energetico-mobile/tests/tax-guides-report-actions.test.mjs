import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaxGuidesReportView } from '../src/ui/tax-guides-report-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<80;i++){if(check())return;await tick();}assert.ok(check(),'UI did not settle');}
function setup(t,options={}){
  const dom=new JSDOM('<body><main id="app"></main></body>',{pretendToBeVisual:true});
  const doc=dom.window.document;
  const item={id:'7',eTag:'"v1"',fields:{TIPO:'INSS',FILIAL:'004 - EDIFÍCIO XAVANTE',COMPETENCIA:'2026-10-20',VENCIMENTO:'2026-11-20',VALOR:null,STATUS:'PENDENTE'}};
  const files=[],writes=[];
  const columns=[{name:'TIPO',choice:{choices:['INSS','FGTS']},required:true},{name:'FILIAL',text:{},required:true},
    {name:'COMPETENCIA',dateTime:{format:'dateOnly'},required:true},{name:'VENCIMENTO',dateTime:{format:'dateOnly'}},{name:'VALOR',currency:{locale:'pt-BR'}},{name:'STATUS',text:{},required:true}];
  const repository={resolveList:async()=>({status:'resolved',id:'guides'}),getColumns:async()=>columns,
    getItem:async()=>structuredClone(item),listAttachments:async()=>{if(options.list)await options.list();return files.map(file=>({name:file.name}));},deleteAttachment:async()=>{},
    uploadAttachment:async(site,list,id,file,name)=>{assert.equal(list,'guides');assert.equal(id,'7');if(options.upload)await options.upload();files.push({name,blob:file});item.eTag=`"v${files.length+1}"`;},
    updateItem:async(site,list,id,fields,{eTag})=>{assert.equal(id,'7');assert.equal(eTag,item.eTag);if(options.update)await options.update(fields);writes.push(fields);Object.assign(item.fields,fields);return structuredClone(item);}};
  const source=createRegistrationGalleryData({kind:'taxGuides',repository});
  const data={...source,loadSnapshot:async()=>({rows:[{...structuredClone(item),hasAttachments:files.length>0}]})};
  if(options.loadEditor)data.loadEditor=options.loadEditor;
  const picks=[];
  const report=createTaxGuidesReportView({document:doc,data,pickAttachments:async(source,{signal})=>{
    picks.push(source);if(options.pick)return options.pick(source,{signal});return [new dom.window.File(['original'],`${source}.pdf`,{type:'application/pdf'})];}});
  t.after(()=>{report.destroy();dom.window.close();});
  return {doc,dom,report,item,files,writes,picks,data};
}
function action(report,name){const node=report.element.querySelector(`[data-guide-action="${name}"]`);assert.ok(node,`missing ${name} action`);node.click();}

async function confirm(h,answer){
  const confirmation=h.doc.querySelector('[data-guide-confirm]');
  await until(()=>confirmation&&!confirmation.hidden);
  assert.match(confirmation.textContent,/considerar a guia preenchida/i);
  assert.deepEqual([...confirmation.querySelectorAll('button')].map(button=>button.textContent),['SIM','NÃO']);
  [...confirmation.querySelectorAll('button')].find(button=>button.textContent===answer).click();
}

for(const source of ['camera','scan','files','photos'])test(`pending guide saves original ${source} file to its own SharePoint row`,async t=>{
  const h=setup(t);await h.report.open();action(h.report,'attach');
  const overlay=h.doc.querySelector('.tgr-editor-overlay');assert.ok(overlay);
  assert.deepEqual([...overlay.querySelectorAll('[data-source]')].map(b=>b.dataset.source).sort(),['camera','files','photos','scan']);
  overlay.querySelector(`[data-source="${source}"]`).click();
  await until(()=>h.doc.querySelector('[data-guide-confirm]:not([hidden])'));
  assert.deepEqual(h.files,[]);
  await confirm(h,'NÃO');
  await until(()=>h.files.length===1&&!h.doc.querySelector('.tgr-editor-overlay'));
  assert.equal(h.files[0].name,`${source}.pdf`);assert.deepEqual(h.writes,[]);
  assert.ok(h.report.element.querySelector('.tgr-attachment'));assert.ok(h.report.element.querySelector('[data-guide-action="attach"]'));
});

for(const [input,value] of [['1.234,56',1234.56],['0',0],['1234.56',1234.56]])test(`missing amount accepts ${input} and persists only VALOR`,async t=>{
  const h=setup(t);await h.report.open();action(h.report,'amount');
  await until(()=>h.doc.querySelector('input[name="guideAmount"]')&&!h.doc.querySelector('[data-guide-save]').disabled);
  h.doc.querySelector('input[name="guideAmount"]').value=input;h.doc.querySelector('[data-guide-save]').click();
  await until(()=>h.writes.length===1&&!h.doc.querySelector('.tgr-editor-overlay'));
  assert.deepEqual(h.writes,[{VALOR:value}]);assert.equal(h.item.fields.VENCIMENTO,'2026-11-20');
  assert.equal(h.report.element.querySelector('[data-guide-action="amount"]'),null);
});

test('invalid amounts do not write and can be corrected in the same dialog',async t=>{
  const h=setup(t);await h.report.open();action(h.report,'amount');
  await until(()=>h.doc.querySelector('[data-guide-save]')&&!h.doc.querySelector('[data-guide-save]').disabled);
  for(const value of ['','-5','abc','12,345']){h.doc.querySelector('input').value=value;h.doc.querySelector('[data-guide-save]').click();await tick();assert.deepEqual(h.writes,[]);assert.ok(h.doc.querySelector('.tgr-editor-overlay'));}
});

test('cancelled picker leaves the guide pending and allows selecting another source',async t=>{
  const h=setup(t,{pick:()=>[]});await h.report.open();action(h.report,'attach');h.doc.querySelector('[data-source="files"]').click();await tick();
  assert.equal(h.files.length,0);assert.ok(h.report.element.querySelector('[data-guide-action="attach"]'));
  assert.equal(h.doc.querySelector('[data-source="camera"]').disabled,false);
});

test('failed upload keeps the selected original for retry without capturing again',async t=>{
  let fail=true;const h=setup(t,{upload:()=>{if(fail)throw new Error('offline');}});await h.report.open();action(h.report,'attach');
  h.doc.querySelector('[data-source="scan"]').click();await confirm(h,'SIM');await until(()=>h.doc.querySelector('[data-guide-retry]:not([hidden])'));
  assert.equal(h.files.length,0);assert.deepEqual(h.writes,[]);
  fail=false;h.doc.querySelector('[data-guide-retry]').click();await until(()=>h.writes.length===1);
  assert.deepEqual(h.picks,['scan']);assert.equal(h.files[0].name,'scan.pdf');assert.deepEqual(h.writes,[{STATUS:'SUBMETIDO'}]);
});

test('closing aborts capture and a late camera response never uploads',async t=>{
  let resolveCapture,signal;const h=setup(t,{pick:(_source,options)=>{signal=options.signal;return new Promise(resolve=>resolveCapture=resolve);}});
  await h.report.open();action(h.report,'attach');h.doc.querySelector('[data-source="camera"]').click();h.report.close();
  assert.equal(signal.aborted,true);assert.equal(h.doc.querySelector('.tgr-editor-overlay'),null);
  resolveCapture([new h.dom.window.File(['photo'],'late.jpg',{type:'image/jpeg'})]);await tick();assert.equal(h.files.length,0);
});

test('another session filling the amount before editor load cannot be overwritten',async t=>{
  const h=setup(t);await h.report.open();h.item.fields.VALOR=999;action(h.report,'amount');
  await until(()=>h.report.element.textContent.includes('999,00'));
  assert.deepEqual(h.writes,[]);assert.equal(h.doc.querySelector('[data-guide-save]:not(:disabled)'),null);
});

test('printed pending cells retain their status after becoming clickable',async t=>{
  const h=setup(t);await h.report.open();
  const snapshot=captureFilteredReport(h.report.element);
  const output=JSON.stringify(snapshot);
  assert.match(output,/A informar/);assert.match(output,/Guia pendente/);
});

test('PDF selection asks again when the row already has an attachment and updates only its status on SIM',async t=>{
  let selected=0;
  const h=setup(t,{pick:()=>[new h.dom.window.File(['original'],`guia-${++selected}.PDF`)]});await h.report.open();
  const row=()=>h.report.element.querySelector('[data-guide-id="7"]');
  assert.equal(row().dataset.guideStatus,'PENDENTE');
  for(const [answer,expectedStatus,count] of [['NÃO','PENDENTE',1],['SIM','SUBMETIDO',2],['SIM','SUBMETIDO',3]]){
    action(h.report,'attach');h.doc.querySelector('[data-source="files"]').click();
    await confirm(h,answer);await until(()=>h.files.length===count&&row()&&!h.doc.querySelector('.tgr-editor-overlay'));
    assert.equal(row().dataset.guideStatus,expectedStatus);
    assert.equal(row().cells[5].textContent,expectedStatus);
    assert.ok(row().querySelector('.tgr-attachment'));
  }
  assert.deepEqual(h.writes,[{STATUS:'SUBMETIDO'}]);
  assert.deepEqual(h.files.map(file=>file.name),['guia-1.PDF','guia-2.PDF','guia-3.PDF']);
});

test('image-only attachments keep the original attachment flow',async t=>{
  const h=setup(t,{pick:()=>[new h.dom.window.File(['photo'],'guia.jpg',{type:'image/jpeg'})]});await h.report.open();action(h.report,'attach');
  h.doc.querySelector('[data-source="photos"]').click();await until(()=>h.files.length===1&&!h.doc.querySelector('.tgr-editor-overlay'));
  assert.equal(h.files[0].name,'guia.jpg');assert.deepEqual(h.writes,[]);
});

test('retry after status failure keeps the original PDF without uploading it again',async t=>{
  let fail=true;
  const h=setup(t,{update:()=>{assert.equal(h.files.length,1);if(fail)throw new Error('offline');}});
  await h.report.open();action(h.report,'attach');h.doc.querySelector('[data-source="files"]').click();await confirm(h,'SIM');
  await until(()=>h.doc.querySelector('[data-guide-retry]:not([hidden])'));
  assert.equal(h.item.fields.STATUS,'PENDENTE');
  fail=false;h.doc.querySelector('[data-guide-retry]').click();await until(()=>h.writes.length===1&&!h.doc.querySelector('.tgr-editor-overlay'));
  assert.deepEqual(h.files.map(f=>f.name),['files.pdf']);assert.deepEqual(h.writes,[{STATUS:'SUBMETIDO'}]);
});

test('a duplicate PDF from another session does not get uploaded or submit the guide',async t=>{
  const h=setup(t);await h.report.open();h.files.push({name:'files.pdf'});action(h.report,'attach');
  h.doc.querySelector('[data-source="files"]').click();await confirm(h,'SIM');
  await until(()=>h.doc.querySelector('.tgr-editor-status').textContent.includes('já existe'));
  assert.deepEqual(h.files.map(f=>f.name),['files.pdf']);assert.deepEqual(h.writes,[]);
});

test('a temporary attachment list failure can be retried with the selected PDF',async t=>{
  let fail=true;const h=setup(t,{list:()=>{if(fail)throw new Error('offline');}});
  await h.report.open();action(h.report,'attach');h.doc.querySelector('[data-source="files"]').click();await confirm(h,'SIM');
  await until(()=>h.doc.querySelector('[data-guide-retry]:not([hidden])'));
  fail=false;h.doc.querySelector('[data-guide-retry]').click();await until(()=>h.writes.length===1);
  assert.deepEqual(h.picks,['files']);assert.deepEqual(h.files.map(file=>file.name),['files.pdf']);
});

test('a rejected file can be replaced in the same editor and asks again',async t=>{
  let selected='invalid.exe';
  const h=setup(t,{pick:()=>[new h.dom.window.File(['original'],selected)]});
  await h.report.open();action(h.report,'attach');h.doc.querySelector('[data-source="files"]').click();
  await until(()=>h.doc.querySelector('[data-guide-retry]:not([hidden])'));
  assert.equal(h.doc.querySelector('.tgr-editor-sources').hidden,false);
  selected='válido.pdf';h.doc.querySelector('[data-source="files"]').click();await confirm(h,'SIM');
  await until(()=>h.writes.length===1);
  assert.deepEqual(h.files.map(file=>file.name),['válido.pdf']);
});

test('failed amount read can be retried without leaving the editor',async t=>{
  let fail=true;
  const h=setup(t,{loadEditor:async()=>{if(fail)throw new Error('offline');return {item:{fields:{VALOR:null}}};}});
  await h.report.open();action(h.report,'amount');
  await until(()=>h.doc.querySelector('[data-guide-load-retry]:not([hidden])'));
  fail=false;h.doc.querySelector('[data-guide-load-retry]').click();
  await until(()=>!h.doc.querySelector('[data-guide-save]').disabled);
  assert.equal(h.doc.querySelector('input[name="guideAmount"]').disabled,false);
});

test('tax guide partial edits reject status and other fields outside the amount scope',async t=>{
  const h=setup(t);const context=await h.data.loadEditor('7');
  await assert.rejects(()=>h.data.saveEditor(context,{STATUS:'PAGO'},{editedFields:['STATUS']}),/escopo/);
  await assert.rejects(()=>h.data.saveEditor(context,{VALOR:1,STATUS:'PAGO'},{editedFields:['VALOR']}),/escopo/);
  assert.deepEqual(h.writes,[]);assert.equal(h.item.fields.STATUS,'PENDENTE');
});
