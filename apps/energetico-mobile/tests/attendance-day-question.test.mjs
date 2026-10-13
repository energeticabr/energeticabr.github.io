import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

const question = '👉 👷 QUAL PRESENÇA DESEJA VALIDAR?\nCASO DESEJE FILTRAR, DIGITE UM TEXTO.';
const row = (id, date) => ({id:`choice:registro_presenca_pendente:${id}`, label:`${id} - EXEMPLO`, date});
function render(t, options, extra = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(() => dom.window.close());
  const view = createChatView(dom.window.document.querySelector('#app'));
  view.render({sessionStatus:'authenticated', account:{name:'Teste'}, draft:'', pendingFiles:[], messages:[{
    id:'day', role:'assistant', type:'poll', presentation:'attendance_multi_select', question, options, ...extra,
  }]});
  return {view, dom, heading:dom.window.document.querySelector('.chat-choice-card > p')};
}

for (const [date, display, weekday] of [
  ['2026-10-12','12/10/2026','segunda'], ['2026-10-13','13/10/2026','terça'],
  ['2026-10-14','14/10/2026','quarta'], ['2026-10-15','15/10/2026','quinta'],
  ['2026-10-16','16/10/2026','sexta'], ['2026-10-17','17/10/2026','sábado'],
  ['2026-10-18','18/10/2026','domingo'], ['2024-02-29T03:00:00Z','29/02/2024','quinta'],
]) test(`selected day ${date} has the correct weekday and emphasized date only`, t => {
  const {heading} = render(t, [row(1,date), row(2,date), {id:'endstage',label:'ENCERRAR ETAPA'}]);
  assert.equal(heading.textContent, `QUAL PRESENÇA DESEJA VALIDAR DO DIA ${display} (${weekday})?`);
  assert.equal(heading.querySelector('strong.chat-question-field')?.textContent, display);
  assert.equal(heading.querySelectorAll('strong').length, 1);
});

test('legacy detail date works independently of RHID availability and keeps the record action', t => {
  const option = row(2249, undefined);
  option.detail_table = {rows:[[{label:'DATA',value:'12/10/2026'}]]};
  option.rhidBadge = {status:'unavailable',label:'RHID INDISPONÍVEL'};
  const {heading,view,dom} = render(t,[option]);
  assert.equal(heading.textContent,'QUAL PRESENÇA DESEJA VALIDAR DO DIA 12/10/2026 (segunda)?');
  const replies=[];
  view.on('select-reply', value=>replies.push(value.replyId));
  dom.window.document.querySelector('button[data-reply-id="choice:registro_presenca_pendente:2249"]').click();
  assert.deepEqual(replies,['choice:registro_presenca_pendente:2249']);
});

test('mixed or invalid dates never label the whole list as today or one arbitrary day', t => {
  for (const options of [[row(1,'2026-10-12'),row(2,'2026-10-13')], [row(1,'2026-02-30')], [row(1,undefined)]]) {
    const {heading} = render(t,options);
    assert.equal(heading.textContent,'QUAL PRESENÇA DESEJA VALIDAR?');
    assert.equal(heading.querySelector('strong'),null);
  }
});

test('empty scoped day keeps its explicit date without inventing attendance records', t => {
  const {heading,dom}=render(t,[],{presenceDateKey:'2026-10-12'});
  assert.equal(heading.textContent,'QUAL PRESENÇA DESEJA VALIDAR DO DIA 12/10/2026 (segunda)?');
  assert.equal(dom.window.document.querySelector('.chat-attendance-select__row'),null);
});

test('supplier synchronization and date selection keep their own questions', t => {
  for (const presentation of ['attendance_supplier_sync','list']) {
    const {heading}=render(t,[row(1,'2026-10-12')],{presentation,question:'ESCOLHA UMA OPÇÃO'});
    assert.equal(heading.textContent,'ESCOLHA UMA OPÇÃO');
  }
});
