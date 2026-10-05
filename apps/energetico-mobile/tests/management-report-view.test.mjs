import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const { createManagementReportView } = await import('../src/ui/management-report-view.js').catch(()=>({}));
const row={id:'1',date:'2026-10-02',paymentDate:'2025-01-01',branch:'004 - EDIFÍCIO XAVANTE',supplier:'Alfa',product:'Cimento',stage:'Fundação',account:'Caixa',disbursement:'SIM',unit:10,quantity:2,freight:5,total:25};
function setup(t,loadSnapshot=async()=>({launches:[row],productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]}),portrait=false){
  assert.equal(typeof createManagementReportView,'function');
  const dom=new JSDOM('<main id="app"><button>Resumo</button></main>');let vertical=portrait;
  dom.window.matchMedia=()=>({get matches(){return vertical;}});
  const view=createManagementReportView({document:dom.window.document,data:{loadSnapshot},now:()=>new Date('2026-10-05T12:00:00Z')});
  t.after(()=>{view.destroy();dom.window.close();});
  return {view,root:view.element,dom,rotate(v){vertical=v;dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
test('management shortcut popup guards portrait, rotates, closes outside and restores focus',async t=>{
  let calls=0;const {view,root,dom,rotate}=setup(t,async options=>{calls++;assert.equal(options.reportNumber,9);return {launches:[row],productTypes:[]};},true);
  const trigger=dom.window.document.querySelector('#app button');trigger.focus();
  await view.open();assert.equal(calls,0);assert.match(root.textContent,/POSICIONAR O TELEFONE NA HORIZONTAL/);
  rotate(false);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  assert.equal(root.querySelectorAll('.gm-table').length,7);
  root.querySelector('td').click();assert.equal(root.hidden,false);
  root.click();assert.equal(root.hidden,true);assert.equal(dom.window.document.activeElement,trigger);assert.equal(dom.window.document.body.style.overflow,'');
});
test('management tables match reference sections with totals, rowspans, safe labels and DATA period',async t=>{
  const {view,root,dom}=setup(t,async()=>({launches:[row,{...row,id:'2',branch:'Central',quantity:1,total:10,product:'<img src=x onerror=alert(1)>'},{...row,id:'3',date:'2026-09-02',total:900}],productTypes:[{product:'Cimento',expenseType:'MATERIAL'}]}));
  await view.open();
  assert.equal(root.querySelector('[name=year]').value,'2026');assert.equal(root.querySelector('[name=month]').value,'10');
  assert.deepEqual([...root.querySelectorAll('.gm-section-title')].map(n=>n.textContent),['RESUMO GERENCIAL DE GASTOS','TOTAL GASTO ACUMULADO POR FILIAL','PERCENTUAL POR TIPO DE DESPESA POR FILIAL','PRODUTOS COM MAIOR GASTO POR FILIAL','ETAPAS COM MAIOR GASTO POR FILIAL','PRINCIPAIS FORNECEDORES POR FILIAL','MAIORES GASTOS POR CONTA POR FILIAL']);
  assert.match(root.querySelector('[data-metric=total]').textContent,/35,00/);assert.equal(root.querySelector('[data-metric=count]').textContent,'2');
  assert.equal(root.querySelector('[data-metric=period]').textContent,'outubro/2026');
  assert.equal(root.querySelector('[data-section=expense] [data-column=branch]').rowSpan,2);
  assert.match(root.querySelector('[data-section=expense] .gm-total td').textContent,/TOTAL DA FILIAL/);
  assert.equal(root.querySelectorAll('tbody img').length,0);
  assert.equal(root.querySelectorAll('.gm-logo img').length,1);
  assert.equal(root.querySelector('.pl-close'),null);
  const stage=root.querySelector('[name=stage]');stage.value='Fundação';stage.dispatchEvent(new dom.window.Event('change'));
  const month=root.querySelector('[name=month]');month.value='';month.dispatchEvent(new dom.window.Event('change'));
  assert.match(root.querySelector('[data-metric=total]').textContent,/935,00/);
  const year=root.querySelector('[name=year]');year.value='';year.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelector('[data-metric=period]').textContent,'Todos os períodos');
});
test('management cancellation and partial data never expose stale definitive totals',async t=>{
  let finish,signal;const {view,root}=setup(t,options=>{signal=options.signal;return new Promise(r=>finish=r);});
  const opening=view.open();view.close();assert.equal(signal.aborted,true);finish({launches:[row],productTypes:[]});await opening;
  assert.equal(root.querySelectorAll('.gm-table').length,0);
  const incomplete=setup(t,async()=>({launches:[{...row,total:null}],productTypes:[]}));await incomplete.view.open();
  assert.equal(incomplete.root.querySelector('[data-metric=total]').textContent,'INCOMPLETO');
  const error=setup(t,async()=>{throw new Error('Falha SharePoint');});await error.view.open();
  assert.equal(error.root.querySelectorAll('.gm-table').length,0);assert.match(error.root.querySelector('.pl-notice').textContent,/Atualizar/);
  const invalid=setup(t,async()=>({launches:[row]}));await invalid.view.open();assert.equal(invalid.root.querySelectorAll('.gm-table').length,0);
});
