import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderChatMarkup} from '../src/ui/chat-view.js';
import {createConversationStore} from '../src/chat/conversation-store.js';

function render(rows, kind='payroll_assignment', question='QUAL MÊS?\n\nID | FORNECEDOR | VALOR TOTAL\nFALLBACK-ONLY') {
  const store=createConversationStore({historyMode:'current-step'});
  store.ingestRemoteMessages([{type:'poll', question,
    detail_table:{kind,rows}, options:[{id:'month',reply:'month',label:'MÊS VIGENTE'}]}],
    {activeFlow:{id:'payment_settlement',title:'BAIXAR PAGAMENTO AGENDADO'}});
  return new JSDOM(renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste'},draft:'',pendingFiles:[],...store.getState()})).window.document;
}
const row={id:'389',supplier:'FORNECEDOR <TESTE> & OUTRO',totalDisplay:'R$ 180,00'};
test('individual poll shows one semantic payment row and original commands',()=>{
  const doc=render([row]);
  const table=doc.querySelector('[data-payroll-assignment-table] table');
  assert.ok(table);
  assert.deepEqual([...table.querySelectorAll('thead th')].map(n=>n.textContent),['ID','FORNECEDOR','VALOR TOTAL']);
  assert.equal(table.querySelectorAll('tbody tr').length,1);
  assert.deepEqual([...table.querySelectorAll('tbody td')].map(n=>n.textContent),['389',row.supplier,'R$ 180,00']);
  assert.ok(doc.querySelector('[data-reply-id="month"]'));
  assert.ok(!doc.body.textContent.includes('FALLBACK-ONLY'));
  assert.equal(table.querySelector('script'),null);
});
test('collective poll shows every affected payment including repeated suppliers',()=>{
  const doc=render([row,{...row,id:'390',totalDisplay:'R$ 200,50'},{id:'391',supplier:'OUTRO',totalDisplay:'R$ 0,00'}]);
  assert.equal(doc.querySelectorAll('[data-payroll-assignment-table] tbody tr').length,3);
  assert.match(doc.body.textContent,/R\$ 200,50/);
});
test('invalid or foreign table preserves text fallback and never renders payroll table',()=>{
  for(const [rows,kind] of [[[], 'payroll_assignment'],[[{id:'1'}],'payroll_assignment'],[[row],'foreign']]) {
    const doc=render(rows,kind);
    assert.equal(doc.querySelector('[data-payroll-assignment-table]'),null);
    assert.match(doc.body.textContent,/FALLBACK-ONLY/);
  }
});
test('structured table preserves the instruction following the old-client fallback',()=>{
  const doc=render([row],'payroll_assignment','QUAL FOLHA?\n\nID | FORNECEDOR | VALOR TOTAL\n389 | FORNECEDOR | R$ 180,00\n\nCASO DESEJE FILTRAR, DIGITE UM TEXTO.');
  assert.match(doc.body.textContent,/CASO DESEJE FILTRAR, DIGITE UM TEXTO\./);
  assert.ok(!doc.body.textContent.includes('389 | FORNECEDOR'));
});
