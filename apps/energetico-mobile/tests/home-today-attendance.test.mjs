import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

const attendance = {id:'start_today_pending_attendance', reply:'start_today_pending_attendance', label:'👷 PRESENÇAS (10)', tone:'danger'};
const diary = {id:'start_pending_construction_diary', reply:'start_pending_construction_diary', label:'📔 COMEÇAR DIÁRIO DE OBRAS (13/10/2026)'};
function render(t, extras) {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(()=>dom.window.close());
  const view = createChatView(dom.window.document.querySelector('#app'));
  view.render({sessionStatus:'authenticated', account:{name:'Teste'}, draft:'', pendingFiles:[], messages:[{
    id:'home',role:'assistant',type:'poll',question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',options:[
      {id:'group_pending',label:'⏳ PENDÊNCIAS (48)'}, ...extras,
      {id:'group_supplies',label:'📦 SUPRIMENTOS'},
      {id:'group_personal_expenses',label:'💰 GASTOS PESSOAIS'},
    ],
  }]});
  return {dom, view, buttons:[...dom.window.document.querySelectorAll('.chat-choice-list > button')]};
}
test('today shortcut is red immediately before diary and sends only its navigation reply', t=>{
  const {dom,view,buttons}=render(t,[diary,attendance]);
  const index=buttons.findIndex(b=>b.dataset.replyId===attendance.id);
  assert.equal(buttons[index+1]?.dataset.replyId,diary.id);
  assert.equal(buttons[index-1]?.dataset.replyId,'action_powerbi_dashboard');
  const button=dom.window.document.querySelector(`[data-reply-id="${attendance.id}"]`);
  assert.ok(button.classList.contains('chat-choice-button--danger'));
  assert.equal(button.textContent,'👷 PRESENÇAS (10)');
  const replies=[];
  view.on('select-reply',reply=>replies.push(reply));
  button.click();
  assert.equal(replies.length,1);
  assert.equal(replies[0].replyId,attendance.id);
});
test('no server shortcut means no synthetic attendance count or button',t=>{
  const {dom}=render(t,[diary]);
  assert.equal(dom.window.document.querySelector(`[data-reply-id="${attendance.id}"]`),null);
});
test('shortcut remains last when there is no diary today',t=>{
  const {buttons}=render(t,[attendance]);
  assert.equal(buttons.at(-1).dataset.replyId,attendance.id);
});
