import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNfeProposalView } from '../src/ui/nfe-proposal-view.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,provision=false,{reserved=false,save}={}) {
  const dom=new JSDOM('<main></main>'),doc=dom.window.document,host=doc.querySelector('main');
  const fiscal={total:'10',issueDate:'2026-11-19',dueDate:'2026-11-24',lines:[{number:'1',description:'PISO METÁLICO',unit:'PC',quantity:'1',unitPrice:'10'}]};
  const draft={supplierId:'1',branchId:'2',accountId:'3',date:fiscal.issueDate,paymentDate:fiscal.issueDate,lines:[{...fiscal.lines[0],productId:'4',stageId:'5',date:fiscal.issueDate,dueDate:fiscal.dueDate,discount:'0',adjustment:'0'}]};
  const catalog={suppliers:[{id:'1',label:'Fornecedor'}],branches:[{id:'2',label:'Obra'}],accounts:[{id:'3',label:'Conta'}],products:[{id:'4',label:'Antigo',unit:'UN'}],stages:[{id:'5',label:'Etapa',branch:'Obra'}]};
  let writes=0;
  const view=createNfeProposalView({document:doc,host,provision,onPosted:()=>{},service:{
    load:async()=>({fiscal,catalog,draft,reserved}),submit:async()=>{writes++;},
    productRegistration:{load:async()=>({subfamilies:[{id:'8',label:'METAL'}],expenseTypes:['MATERIAL'],disburses:['SIM','NÃO']}),
      save:save|| (async(_context,values)=>({id:'99',label:values.name,unit:values.unit,expenseType:'MATERIAL',disburses:values.disburses}))},
  }});
  t.after(()=>{view.close();dom.window.close();});
  async function open(){await view.show({id:'7',pdfName:'nota.pdf'}); const details=host.querySelector('details'); details.open=true; details.dispatchEvent(new dom.window.Event('toggle'));}
  function change(name,value,event='change'){const el=host.querySelector(`[name="${name}"]`);el.value=value;el.dispatchEvent(new dom.window.Event(event));return el;}
  return {view,host,doc,open,change,draft,catalog,get writes(){return writes;}};
}
for(const provision of [false,true]) test(`register and select product while preserving ${provision?'provision':'launch'} edits`,async t=>{
  const h=fixture(t,provision);await h.open();
  h.change('quantity','2','input'); h.change('dueDate','2026-12-01');
  const button=h.host.querySelector('[data-nfe-register-product]');assert.ok(button);
  assert.equal(button.textContent,'CADASTRAR');assert.equal(button.previousElementSibling.textContent,'Produto');
  button.click(); await tick();
  const form=h.host.querySelector('[data-nfe-product-form]');assert.ok(form);
  assert.equal(form.querySelector('[name="name"]').value,'PISO METÁLICO');
  assert.equal(form.querySelector('[name="unit"]').value,'PC');
  h.change('subfamilyId','8');h.change('expenseType','MATERIAL');h.change('disburses','SIM');
  form.dispatchEvent(new h.doc.defaultView.Event('submit',{cancelable:true}));await tick();
  assert.equal(h.host.querySelector('[data-nfe-product-form]'),null);
  assert.equal(h.host.querySelector('[name="productId"]').value,'99');
  assert.equal(h.host.querySelector('[name="quantity"]').value,'2');
  assert.equal(h.host.querySelector('[name="dueDate"]').value,'2026-12-01');
  assert.equal(h.writes,0);
  assert.match(h.host.querySelector('summary').textContent,/PISO METÁLICO/);
});
for(const manual of [false,true])test(`registration ${manual?'preserves manual':'recalculates automatic'} stage`,async t=>{
  const h=fixture(t);
  h.catalog.stages.push({id:'6',label:'Nova etapa',branch:'Obra'});
  h.catalog.history=[{product:'PISO METÁLICO',stage:'Nova etapa',branch:'Obra'}];
  await h.open();if(manual)h.change('stageId','5');
  h.host.querySelector('[data-nfe-register-product]').click();await tick();
  h.change('subfamilyId','8');h.change('expenseType','MATERIAL');h.change('disburses','SIM');
  h.host.querySelector('[data-nfe-product-form]').dispatchEvent(new h.doc.defaultView.Event('submit',{cancelable:true}));await tick();
  assert.equal(h.host.querySelector('[name="stageId"]').value,manual?'5':'6');
});
test('missing selection reports and focuses the visible subfamily control',async t=>{
  const h=fixture(t);await h.open();h.host.querySelector('[data-nfe-register-product]').click();await tick();
  h.host.querySelector('[data-nfe-product-form]').dispatchEvent(new h.doc.defaultView.Event('submit',{cancelable:true}));await tick();
  assert.match(h.host.querySelector('[role="alert"]')?.textContent||'',/subfamília/i);
  assert.match(h.doc.activeElement.getAttribute('aria-label')||'',/subfamília/i);
});
test('cancel and errors keep the proposal open and reserved submissions disable registration',async t=>{
  const h=fixture(t,false,{save:async()=>{throw new Error('Sem conexão');}}); await h.open();
  const button=h.host.querySelector('[data-nfe-register-product]');assert.ok(button);button.click();await tick();
  h.change('subfamilyId','8');h.change('expenseType','MATERIAL');h.change('disburses','SIM');
  h.host.querySelector('[data-nfe-product-form]').dispatchEvent(new h.doc.defaultView.Event('submit',{cancelable:true}));await tick();
  assert.match(h.host.querySelector('[role="alert"]').textContent,/Sem conexão/);
  h.host.querySelector('[data-nfe-product-cancel]').click();
  assert.equal(h.view.isOpen,true);assert.equal(h.host.querySelector('[name="productId"]').value,'4');
  const r=fixture(t,true,{reserved:true});await r.open();
  assert.equal(r.host.querySelector('[data-nfe-register-product]').disabled,true);
});
