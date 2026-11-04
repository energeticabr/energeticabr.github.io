import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView, renderChatMarkup} from '../src/ui/chat-view.js';

const table={kind:'presence',variant:'supplier_defaults_comparison',rows:[
  {supplier:'FORNECEDOR FICTÍCIO ALFA',branch:'FILIAL ALFA',descriptor:{before:'119',after:'405'},activity:{before:'MONTAGEM DE FORMAS',after:'CONCRETAGEM DE VIGAS'}},
  {supplier:'FORNECEDOR FICTÍCIO BETA COM NOME EXTREMAMENTE LONGO',descriptor:{before:'',after:'127'},activity:{before:'ATIVIDADE ANTIGA',after:'ATIVIDADE NOVA'}}]};
const poll={id:'compare',role:'assistant',type:'poll',question:'ALTERAR PADRÕES?\nANTES E DEPOIS: DADOS DO TEXTO ALTERNATIVO',detail_table:table,
  options:[{id:'attendance_supplier_defaults_yes',reply:'attendance_supplier_defaults_yes',label:'SIM'},
    {id:'attendance_supplier_defaults_no',reply:'attendance_supplier_defaults_no',label:'NÃO'}]};
const state={sessionStatus:'authenticated',account:{name:'Teste'},messages:[poll],draft:'',pendingFiles:[]};

test('supplier comparison has two rows per supplier, old/new values and escaped data',t=>{
  const dom=new JSDOM(renderChatMarkup(state));t.after(()=>dom.window.close());
  const element=dom.window.document.querySelector('.chat-supplier-defaults-table');assert.ok(element);
  assert.equal(element.querySelectorAll('tbody').length,2);assert.equal(element.querySelectorAll('tbody tr').length,4);
  const first=element.querySelector('tbody');assert.match(first.querySelector('th[rowspan="2"]').textContent,/FORNECEDOR FICTÍCIO ALFA/);assert.match(first.textContent,/FILIAL ALFA/);
  assert.match(first.textContent,/119/);assert.match(first.textContent,/405/);assert.match(first.textContent,/MONTAGEM DE FORMAS/);assert.match(first.textContent,/CONCRETAGEM DE VIGAS/);
  assert.match(element.querySelectorAll('tbody')[1].textContent,/EM BRANCO/);
  assert.doesNotMatch(dom.window.document.body.textContent,/DADOS DO TEXTO ALTERNATIVO/);
  const injected=new JSDOM(renderChatMarkup({...state,messages:[{...poll,detail_table:{...table,rows:[{...table.rows[0],supplier:'<img src=x>'}]}}]}));
  assert.equal(injected.window.document.querySelector('.chat-supplier-defaults-table img'),null);injected.window.close();
});

test('a failed lookup displays a visible warning without hiding the choices', t=>{
  const dom=new JSDOM(renderChatMarkup({...state,messages:[{...poll,detail_table:{...table,available:false}}]}));t.after(()=>dom.window.close());
  assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/Não foi possível consultar/);
  assert.ok(dom.window.document.querySelector('[data-reply-id="attendance_supplier_defaults_no"]'));
});

for(const choice of ['attendance_supplier_defaults_yes','attendance_supplier_defaults_no']) test('comparison retains action '+choice,t=>{
  const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];t.after(()=>{view.destroy();dom.window.close();});
  view.on('select-reply',event=>events.push(event));view.render(state);
  const button=[...root.querySelectorAll('[data-action="select-reply"]')].find(x=>x.dataset.replyId===choice);assert.ok(button);button.click();assert.equal(events[0].replyId,choice);
});
