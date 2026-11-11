import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView, renderChatMarkup} from '../src/ui/chat-view.js';

const table = {kind:'provision_variation_changes',rows:[
  {field:'FORNECEDOR',before:'FORNECEDOR FICTÍCIO ALFA',after:'FORNECEDOR FICTÍCIO BETA'},
  {field:'DATA DE VENCIMENTO',before:'06/11/2026',after:'20/11/2026'},
  {field:'OBSERVAÇÃO',before:'',after:'<img src=x onerror=alert(1)>'},
]};
const poll = {id:'variation',role:'assistant',type:'poll',question:'HÁ ALGUMA VARIAÇÃO EM RELAÇÃO À LINHA ANTERIOR? Escolha um campo para alterar.',change_table:table,
  options:[{id:'1',reply:'1',label:'✅ PROSSEGUIR SEM OUTRA ALTERAÇÃO'}, {id:'3',reply:'3',label:'👤 FORNECEDOR'}]};
const state = {sessionStatus:'authenticated',account:{name:'Teste'},messages:[poll],draft:'',pendingFiles:[],activeFlow:{id:'payment'}};

test('provision changes have three columns and one row per field before buttons', t=>{
  const dom = new JSDOM(renderChatMarkup(state)); t.after(()=>dom.window.close());
  const doc=dom.window.document, element=doc.querySelector('.chat-provision-changes');
  assert.ok(element);
  assert.deepEqual([...element.querySelectorAll('thead th')].map(x=>x.textContent),['Dado alterado','Antes','Depois']);
  const rows=[...element.querySelectorAll('tbody tr')]; assert.equal(rows.length,3);
  assert.ok(rows.every(row=>row.children.length===3));
  assert.match(rows[0].textContent,/FORNECEDOR FICTÍCIO ALFA/); assert.match(rows[0].textContent,/FORNECEDOR FICTÍCIO BETA/);
  assert.match(rows[2].textContent,/EM BRANCO/); assert.equal(element.querySelector('img'),null);
  const button=doc.querySelector('[data-reply-id="1"]'); assert.ok(button);
  assert.ok(element.compareDocumentPosition(button)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
});

for(const message of [{...poll,change_table:{...table,rows:[]}}, {...poll,question:'QUAL É O FORNECEDOR?'},
  {...poll,question:'MENU PRINCIPAL'}, {...poll,change_table:undefined}]) test('empty or unrelated polls omit the provision table: '+message.question, t=>{
  const dom=new JSDOM(renderChatMarkup({...state,messages:[message]})); t.after(()=>dom.window.close());
  assert.equal(dom.window.document.querySelector('.chat-provision-changes'),null);
});

test('the provision comparison preserves the continue action',t=>{
  const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];
  t.after(()=>{view.destroy();dom.window.close();});
  view.on('select-reply',event=>events.push(event)); view.render(state);
  root.querySelector('[data-reply-id="1"]').click(); assert.equal(events[0].replyId,'1');
});

test('document changes appear above the options and only edited fields get a star', t => {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const view = createChatView(root);
  const events = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('select-reply', event => events.push(event));
  view.render({...state, activeFlow: {id: 'document'}, messages: [{
    ...poll, question: 'DESEJA EDITAR ALGUM DADO PARA O NOVO DOCUMENTO?',
    change_table: {kind: 'document_default_changes', rows: [{
      optionId: '4', field: 'FORNECEDOR / PESSOA RELACIONADA',
      before: 'PESSOA A QA', after: 'PESSOA B QA <QA>',
    }]},
    options: [
      {id: 'choice:edit_field:document_defaults_proceed', reply: 'document_defaults_proceed', label: '✅ PROSSEGUIR SEM EDITAR'},
      {id: 'choice:edit_field:1', reply: 'choice:edit_field:1', label: '1 - FILIAL'},
      {id: 'choice:edit_field:4', reply: 'choice:edit_field:4', label: '4 - FORNECEDOR / PESSOA RELACIONADA'},
    ],
  }]});
  const table = root.querySelector('table[aria-label="Alterações no novo documento"]');
  assert.ok(table);
  assert.deepEqual([...table.querySelectorAll('thead th')].map(cell => cell.textContent), ['Coluna', 'Antes', 'Depois']);
  assert.deepEqual([...table.tBodies[0].rows[0].cells].map(cell => cell.textContent),
    ['FORNECEDOR / PESSOA RELACIONADA', 'PESSOA A QA', 'PESSOA B QA <QA>']);
  const proceed = root.querySelector('[data-reply-id="document_defaults_proceed"]');
  const branch = root.querySelector('[data-reply-id="choice:edit_field:1"]');
  const supplier = root.querySelector('[data-reply-id="choice:edit_field:4"]');
  assert.ok(table.compareDocumentPosition(proceed) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.doesNotMatch(proceed.textContent, /⭐/);
  assert.doesNotMatch(branch.textContent, /⭐/);
  assert.match(supplier.textContent, /^⭐ 4 - FORNECEDOR/);
  supplier.click();
  assert.equal(events[0].replyId, 'choice:edit_field:4');
});
