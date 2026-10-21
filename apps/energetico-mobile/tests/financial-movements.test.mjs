import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { renderDynamicForm } from '../../../portal/ui/dynamic-form.js';

test('financial first menu pairs movement creation and gallery while keeping registrations',()=>{
  const dom=new JSDOM(renderChatMarkup({sessionStatus:'authenticated',messages:[{role:'assistant',type:'poll',question:'💵 FINANCEIRO\nQUAL FLUXO VOCÊ DESEJA INICIAR?',options:[
    {id:'action_financial_registrations',label:'🗂️ CADASTROS'},
    {id:'action_financial_movement',label:'APONTAR MOVIMENTAÇÃO'},
  ]}],pendingFiles:[],draft:''}));
  const pair=dom.window.document.querySelector('[data-reply-id="action_financial_movement"]')?.closest('.chat-menu-gallery-pair');
  assert.ok(pair);
  assert.deepEqual([...pair.querySelectorAll('[data-reply-id]')].map(b=>b.dataset.replyId),['action_financial_movement','action_financial_movement_gallery']);
  assert.ok(dom.window.document.querySelector('[data-reply-id="action_financial_registrations"]'));
  dom.window.close();
});

test('movement gallery reads MOVIMENTACOESFINANCEIRAS and all its pages',async()=>{
  const calls=[];
  const repository={
    async resolveList(site,aliases){calls.push([site,aliases]);return {status:'resolved',id:aliases[0]};},
    async getColumns(){return ['INSTITUICAO','DESCRICAO','OPERACAO','VALOR'].map(name=>({name,displayName:name,text:{}}));},
    async getItemsPage(_site,_list,_query,options){return options?.cursor?{items:[{id:'2',fields:{INSTITUICAO:'B',VALOR:'20.5'}}],hasMore:false}:{items:[{id:'1',fields:{INSTITUICAO:'A',VALOR:'10.5'}}],hasMore:true,nextLink:'page2'};},
  };
  const service=createRegistrationGalleryData({kind:'financial_movement',repository});
  const result=await service.loadSnapshot();
  assert.equal(calls[0][0],'personal');
  assert.deepEqual(calls[0][1],['MOVIMENTACOESFINANCEIRAS']);
  assert.equal(result.rows.length,2);
});

test('movement editor uses dependent closed choices and rejects foreign descriptions before writing',async(t)=>{
  const writes=[];
  const item={id:'1',eTag:'"v1"',fields:{INSTITUICAO:'BANCO A',DESCRICAO:'CDB A',OPERACAO:'APLICAÇÃO',VALOR:'1234,56'}};
  const repository={
    async resolveList(_site,aliases){return {id:aliases[0],status:'resolved'};},
    async getItem(){return item;},
    async getColumns(_site,list){return (list==='INSTITUICAOEMISSORA'?['INSTITUICAOEMISSORA']:list==='CADASTRO INVESTIMENTO'?['INSTITUICAO','DESCRICAO']:['Title','INSTITUICAO','DESCRICAO','OPERACAO','VALOR']).map(name=>({name,displayName:name,text:{}}));},
    async getItemsPage(_site,list){return {hasMore:false,items:list==='INSTITUICAOEMISSORA'?[{id:'1',fields:{INSTITUICAOEMISSORA:'BANCO A'}},{id:'2',fields:{INSTITUICAOEMISSORA:'BANCO B'}}]:[{id:'10',fields:{INSTITUICAO:'BANCO A',DESCRICAO:'CDB A'}},{id:'20',fields:{INSTITUICAO:'BANCO B',DESCRICAO:'CDB B'}}]};},
    async updateItem(...args){writes.push(args); return item;},
  };
  const data=createRegistrationGalleryData({kind:'financial_movement',repository});
  const ctx=await data.loadEditor('1');
  assert.deepEqual(ctx.columns.map(c=>c.name),['INSTITUICAO','DESCRICAO','OPERACAO','VALOR']);
  assert.equal(ctx.columns[0].control,'select');
  assert.equal(ctx.columns[1].control,'select');
  const source=ctx.columns[1].powerApps.optionSources[0];
  assert.equal(source.dependsOn[0].fieldName,'INSTITUICAO');
  assert.deepEqual((await ctx.powerAppsOptionSearch(ctx.columns[1],source,'',{INSTITUICAO:'BANCO A'})).map(o=>o.value),['CDB A']);
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const form = renderDynamicForm(root, { entity: ctx.entity, columns: ctx.columns, mode: 'edit',
    values: ctx.item.fields, powerAppsOptionDebounceMs: 0, powerAppsOptionSearch: ctx.powerAppsOptionSearch });
  t.after(() => { form.cleanup(); dom.window.close(); });
  assert.equal(root.querySelector('[name="VALOR"]').value, '1234.56');
  const select = root.querySelector('select[name="INSTITUICAO"]');
  const combo = select.closest('.dynamic-field').querySelector('[role="combobox"]');
  assert.equal(combo.readOnly, false);
  combo.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const option = [...root.querySelectorAll('[role="option"]')].find(o => o.textContent === 'BANCO B');
  assert.ok(option, root.textContent); option.click();
  assert.equal(root.querySelector('select[name="DESCRICAO"]').value, '');
  root.querySelector('select[name="DESCRICAO"]').closest('.dynamic-field').querySelector('[role="combobox"]').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const descriptions = [...root.querySelector('select[name="DESCRICAO"]').closest('.dynamic-field').querySelectorAll('[role="option"]')].map(o => o.textContent);
  assert.deepEqual(descriptions, ['CDB B']);
  await assert.rejects(data.saveEditor(ctx,{INSTITUICAO:'BANCO B',DESCRICAO:'CDB A'}),/descrição|instituição/i);
  await assert.rejects(data.saveEditor(ctx,{VALOR:'-1'}),/valor/i);
  await assert.rejects(data.saveEditor(ctx,{VALOR:'0,00'}),/valor/i);
  await assert.rejects(data.saveEditor(ctx,{VALOR:'1.2,3'}),/valor/i);
  assert.equal(writes.length,0);
  await data.saveEditor(ctx,{INSTITUICAO:'BANCO B',DESCRICAO:'CDB B',VALOR:2000.5});
  assert.equal(writes.length,1);
  assert.equal(writes[0][3].VALOR,'2000,5');
  assert.equal(writes[0][4].eTag,'"v1"');
});
