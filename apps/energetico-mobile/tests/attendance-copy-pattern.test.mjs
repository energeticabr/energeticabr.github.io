import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView} from '../src/ui/chat-view.js';
const offer={token:'123456abcdef',targets:[{id:'42',name:'FORNECEDOR COM NOME LONGO',branch:'FILIAL 001'},{id:'43',name:'SEGUNDO FORNECEDOR'}]};
const row=[{label:'FORNECEDOR',value:'ORIGEM'},{label:'IDDESCRITIVO',value:'130'},{label:'ATIVIDADEEXECUTADA',value:'ALVENARIA'},{label:'PRESENÇA',value:'PRESENTE'}];
const state={sessionStatus:'authenticated',account:{name:'Teste'},activeFlow:{id:'attendance_validation'},messages:[{id:'current',role:'assistant',type:'poll',question:'CONFIRMA?',detail_table:{kind:'presence',rows:[row],copy_offer:offer},options:[{id:'attendance_batch_confirm',reply:'attendance_batch_confirm',label:'SUBMETER TODOS'}]}],draft:'',pendingFiles:[]};
test('offer opens question, lets user select suppliers and submits only checked IDs',t=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];t.after(()=>{view.destroy();dom.window.close()});view.on('select-reply',event=>events.push(event));view.render(state);
 assert.ok(root.querySelector('[role="dialog"][aria-modal="true"]'));
 root.querySelector('[data-action="attendance-copy-yes"]').click();
 const inputs=[...root.querySelectorAll('[data-attendance-copy-id]')];assert.equal(inputs.length,2);inputs[1].checked=true;
 root.querySelector('[data-action="attendance-copy-submit"]').click();
 assert.equal(events[0].replyId,'attendance_copy:123456abcdef:43');assert.equal(events[0].messageId,'current');
});
test('no closes through a server command without selecting anyone',t=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];t.after(()=>{view.destroy();dom.window.close()});view.on('select-reply',event=>events.push(event));view.render(state);
 root.querySelector('[data-action="attendance-copy-no"]').click();assert.equal(events[0].replyId,'attendance_copy_skip:123456abcdef');
});
