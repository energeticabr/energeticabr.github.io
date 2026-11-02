import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChatView, renderChatMarkup} from '../src/ui/chat-view.js';

const option = (value,label) => ({value,label});
function row(name, descriptor='129 - CONCRETAGEM LAJE', activity='CONCRETAGEM LAJE', suffix=name) {
  return [
    {label:'DATA',value:'02/11/2026'}, {label:'FORNECEDOR',value:name},
    {label:'IDDESCRITIVO',value:descriptor,editor:{value:`attendance_inline:${suffix}:old`,options:[option(`attendance_inline:${suffix}:old`,descriptor),option(`attendance_inline:${suffix}:new`,'130 - ALVENARIA DE VEDAÇÃO COM DESCRIÇÃO MUITO LONGA')]}},
    {label:'ATIVIDADEEXECUTADA',value:activity||'EM BRANCO',editor:{value:activity?`attendance_inline:${suffix}:activity`:'',options:[option(`attendance_inline:${suffix}:activity`,'CONCRETAGEM LAJE'),option(`attendance_inline:${suffix}:other`,'ALVENARIA')]}},
    {label:'PRESENÇA',value:'AUSENTE',tone:'absent'}, {label:'MOTIVAÇÃO',value:'FERIADO'},
  ];
}
const poll=(rows,id='summary')=>({id,role:'assistant',type:'poll',question:'CONFIRMA A ATUALIZAÇÃO DESTAS PRESENÇAS?',detail_table:{kind:'presence',title:'RESUMO DAS PRESENÇAS SELECIONADAS',rows},options:[{id:'attendance_batch_confirm',reply:'attendance_batch_confirm',label:'SUBMETER TODOS'}]});
const state=(messages,overrides={})=>({sessionStatus:'authenticated',account:{name:'Teste'},messages,draft:'rascunho',pendingFiles:[],activeText:null,...overrides});

test('confirmation exposes two contextual selectors per supplier with the current selection',t=>{
 const dom=new JSDOM(renderChatMarkup(state([poll([row('ALFA'),row('BETA')])])));t.after(()=>dom.window.close());
 const selects=[...dom.window.document.querySelectorAll('select[data-action="attendance-inline-select"]')];
 assert.equal(selects.length,4);assert.equal(selects[0].value,'attendance_inline:ALFA:old');
 assert.match(selects[0].getAttribute('aria-label'),/IDDESCRITIVO.*ALFA/);assert.match(selects[1].getAttribute('aria-label'),/ATIVIDADE.*ALFA/);
 assert.equal(selects[2].value,'attendance_inline:BETA:old');
 assert.equal(dom.window.document.querySelectorAll('.chat-presence-table-cell--holiday').length,2);
});

test('a cleared activity remains empty awaiting an explicit choice',t=>{
 const dom=new JSDOM(renderChatMarkup(state([poll([row('ALFA','130 - ALVENARIA','')])])));t.after(()=>dom.window.close());
 const select=dom.window.document.querySelectorAll('select')[1];assert.ok(select);assert.equal(select.value,'');
 assert.match(select.selectedOptions[0].textContent,/Selecione a atividade/);assert.equal(select.selectedOptions[0].disabled,true);
 assert.match(select.parentElement.textContent,/Selecione a atividade/);
});

test('changing a selector sends the advertised reply for that row and preserves the source table',t=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];
 t.after(()=>{view.destroy();dom.window.close();});view.on('select-reply',e=>events.push(e));
 const rows=[row('ALFA'),row('BETA')];view.render(state([poll(rows)]));
 const select=root.querySelector('select');assert.ok(select);select.value='attendance_inline:ALFA:new';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(events.length,1);assert.equal(events[0].replyId,'attendance_inline:ALFA:new');assert.equal(events[0].messageId,'summary');
 assert.match(events[0].label,/130 - ALVENARIA/);assert.equal(rows[0][3].value,'CONCRETAGEM LAJE');assert.equal(rows[1][2].value,'129 - CONCRETAGEM LAJE');
});

test('busy and historical summaries cannot send dropdown edits',t=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root),events=[];
 t.after(()=>{view.destroy();dom.window.close();});view.on('select-reply',e=>events.push(e));
 view.render(state([poll([row('ALFA')],'old'),poll([row('BETA')],'new')],{activeText:{id:'sending'}}));
 const selects=[...root.querySelectorAll('select')];assert.equal(selects.length,4);assert.ok(selects.every(s=>s.disabled));
 for(const select of selects)select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(events.length,0);
 view.render(state([poll([row('ALFA')],'old'),poll([row('BETA')],'new')]));
 assert.ok([...root.querySelectorAll('select')].slice(0,2).every(s=>s.disabled));
});

test('server-confirmed row changes regroup fills for both the changed and matching suppliers',t=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main'),view=createChatView(root);t.after(()=>{view.destroy();dom.window.close();});
 const rows=[row('ALFA'),row('BETA'),row('GAMA','130 - ALVENARIA','ALVENARIA')];view.render(state([poll(rows)]));
 let rendered=[...root.querySelectorAll('.chat-presence-table-row')];assert.equal(rendered[0].style.backgroundColor,rendered[1].style.backgroundColor);
 view.render(state([poll([row('ALFA','130 - ALVENARIA','ALVENARIA'),rows[1],rows[2]],'changed')]));
 rendered=[...root.querySelectorAll('.chat-presence-table-row')];const byName=name=>rendered.find(r=>r.textContent.includes(name));
 assert.equal(byName('ALFA').style.backgroundColor,byName('GAMA').style.backgroundColor);assert.notEqual(byName('ALFA').style.backgroundColor,byName('BETA').style.backgroundColor);
});
