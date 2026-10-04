import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

function setup(t, overrides = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const state = { sessionStatus:'authenticated', account:{name:'Bernardo'},
    activeFlow:{id:'launch'}, draft:'Pago via pessoa física', pendingFiles:[],
    messages:[{role:'assistant', type:'poll', question:'💬 DESEJA FAZER ALGUMA OBSERVAÇÃO?\nDIGITE DIRETAMENTE A OBSERVAÇÃO OU DESCRIÇÃO, OU SELECIONE UMA DAS OPÇÕES ABAIXO.',
      options:[{id:'yes',label:'SIM'},{id:'no',label:'NÃO'}]}], ...overrides };
  const sent=[];
  view.on('send-text', event=>sent.push(event));
  view.render(state);
  t.after(()=>{view.destroy();dom.window.close();});
  const draft=()=>root.querySelector('[data-role="draft"]');
  function key(options={}) {
    const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options});
    draft().dispatchEvent(event);
    return event;
  }
  return {dom,root,view,state,sent,draft,key};
}

test('Enter envia a observação diretamente, sem inserir quebra de linha', t=>{
  const c=setup(t);
  assert.equal(c.key().defaultPrevented,true);
  assert.equal(c.sent.length,1);
  assert.equal(c.draft().value,c.state.draft);
});

test('Enter também envia após escolher SIM e abrir a pergunta de texto', t=>{
  const c=setup(t,{messages:[{role:'assistant',type:'text',text:'✍️ DIGITE A OBSERVAÇÃO:'}]});
  assert.equal(c.key().defaultPrevented,true);
  assert.equal(c.sent.length,1);
});

test('Shift + Enter mantém a quebra de linha nativa e não envia', t=>{
  const c=setup(t);
  assert.equal(c.key({shiftKey:true}).defaultPrevented,false);
  assert.equal(c.sent.length,0);
});

test('composição de texto e repetição da tecla não enviam acidentalmente', t=>{
  const c=setup(t);
  c.key({isComposing:true});
  c.key({keyCode:229});
  c.draft().dispatchEvent(new c.dom.window.CompositionEvent('compositionstart',{bubbles:true}));
  c.key();
  assert.equal(c.sent.length,0);
  c.draft().dispatchEvent(new c.dom.window.CompositionEvent('compositionend',{bubbles:true}));
  assert.equal(c.key({repeat:true}).defaultPrevented,true);
  assert.equal(c.sent.length,0);
});

test('Enter respeita campo vazio, envio ocupado, recuperação e anexos pendentes', t=>{
  for(const overrides of [{draft:' '},{activeText:true},{responseTransitionPending:true},
    {recoveryUncertain:true},{pendingFiles:[{id:'receipt',name:'recibo.pdf',status:'queued'}]}]) {
    const c=setup(t,overrides);
    assert.equal(c.key().defaultPrevented,true);
    assert.equal(c.sent.length,0,JSON.stringify(overrides));
  }
});

test('outras perguntas e diário de obras preservam Enter como quebra de linha', t=>{
  for(const overrides of [{activeFlow:{id:'construction_diary_fill'}},
    {messages:[{role:'assistant',type:'poll',question:'QUAL É O PRODUTO?'}]}]) {
    const c=setup(t,overrides);
    assert.equal(c.key().defaultPrevented,false);
    assert.equal(c.sent.length,0);
  }
});

test('o atalho acompanha a pergunta atual, sem ficar ativo na seguinte', t=>{
  const c=setup(t);
  c.state.messages.push({role:'assistant',type:'poll',question:'QUAL É O PRODUTO?'});
  c.view.render(c.state);
  assert.equal(c.key().defaultPrevented,false);
  assert.equal(c.sent.length,0);
});
