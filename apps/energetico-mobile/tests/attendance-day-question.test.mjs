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

test('HORÁRIO sits beside Energético and emits the current dated poll identity', t => {
  const {view,dom}=render(t,[row(1,'2026-10-12')]);
  const button=dom.window.document.querySelector('[data-action="attendance-validation-hours"]');
  assert.ok(button);
  assert.equal(button.textContent,'HORÁRIO');
  assert.equal(button.parentElement.querySelector('strong')?.textContent,'Energético');
  assert.equal(button.parentElement.nextElementSibling.classList.contains('chat-choice-card'),true);
  const commands=[];
  view.on('attendance-validation-hours',command=>commands.push(command));
  button.click();
  assert.deepEqual(commands,[{type:'attendance-validation-hours',messageId:'day'}]);
});

test('HORÁRIO is unavailable for ambiguous days and unrelated polls', t => {
  for (const [options,extra] of [
    [[row(1,'2026-10-12'),row(2,'2026-10-13')],{}],
    [[row(1,'2026-02-30')],{}],
    [[row(1,undefined)],{}],
    [[row(1,'2026-10-12')],{presentation:'attendance_supplier_sync'}],
    [[row(1,'2026-10-12')],{presentation:'list'}],
  ]) {
    const {dom}=render(t,options,extra);
    assert.equal(dom.window.document.querySelector('[data-action="attendance-validation-hours"]'),null);
  }
});

test('HORÁRIO is hidden when a later assistant text supersedes the poll', t => {
  const {view,dom}=render(t,[row(1,'2026-10-12')]);
  view.render({sessionStatus:'authenticated',account:{name:'Teste'},draft:'',pendingFiles:[],messages:[
    {id:'day',role:'assistant',type:'poll',presentation:'attendance_multi_select',question,options:[row(1,'2026-10-12')]},
    {id:'later',role:'assistant',type:'text',text:'Etapa encerrada'},
  ]});
  assert.equal(dom.window.document.querySelector('[data-action="attendance-validation-hours"]'),null);
});

test('RHID retry after HORÁRIO retains the historical date and does not claim today', t => {
  const {view,dom}=render(t,[row(1,'2026-09-25')]);
  view.openRhidAttendanceToday({date:'2026-09-25'});
  view.setRhidAttendanceReportStatus({busy:false,error:'Falha temporária'});
  const dialog=dom.window.document.querySelector('[data-rhid-attendance-report-dialog]');
  assert.doesNotMatch(dialog.textContent,/Presenças de hoje/);
  const commands=[];
  view.on('rhid-attendance-report-generate',command=>commands.push(command));
  [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Tentar novamente').click();
  assert.deepEqual(commands,[{type:'rhid-attendance-report-generate',value:'2026-09-25'}]);
});

test('canceling a failed HORÁRIO visit does not restore abandoned selections later', t => {
  const {view,dom}=render(t,[row(1,'2026-09-25'),row(2,'2026-09-25')]);
  const doc=dom.window.document;
  doc.querySelector('[data-action="attendance-select-toggle"][data-reply-id="1"]').click();
  view.on('attendance-validation-hours',()=>view.openRhidAttendanceToday({date:'2026-09-25'}));
  doc.querySelector('[data-action="attendance-validation-hours"]').click();
  view.setRhidAttendanceReportStatus({busy:false,error:'Falha temporária'});
  doc.querySelector('[data-action="cancel-rhid-attendance-report"]').click();
  doc.querySelector('[data-action="attendance-select-toggle"][data-reply-id="1"]').click();
  doc.querySelector('[data-action="attendance-select-toggle"][data-reply-id="2"]').click();
  const state={sessionStatus:'authenticated',account:{name:'Teste'},draft:'',pendingFiles:[]};
  view.render({...state,messages:[{id:'report',role:'assistant',type:'poll',options:[],
    detail_table:{kind:'rhid_attendance',reportDate:'2026-09-25',rows:[],people:[]}}]});
  view.render({...state,messages:[{id:'day',role:'assistant',type:'poll',presentation:'attendance_multi_select',
    question,options:[row(1,'2026-09-25'),row(2,'2026-09-25')]}]});
  assert.equal(doc.querySelector('[data-action="attendance-select-toggle"][data-reply-id="1"]').checked,false,
    'abandoned A snapshot must not overwrite newer choices');
});

test('supplier synchronization and date selection keep their own questions', t => {
  for (const presentation of ['attendance_supplier_sync','list']) {
    const {heading}=render(t,[row(1,'2026-10-12')],{presentation,question:'ESCOLHA UMA OPÇÃO'});
    assert.equal(heading.textContent,'ESCOLHA UMA OPÇÃO');
  }
});
