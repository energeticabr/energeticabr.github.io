import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('campos gerais de alimentação alteram toda a lista filtrada, recalculam e preservam edições ao voltar', async t => {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const suppliers = ['Ana', 'Bruno', 'Empresa'].map((label, index) => ({ id:String(index + 1), label, branch:'OBRA A', profession:'PEDREIRO', cargo:'PEDREIRO I' }));
  let posts = 0;
  const view = createMealVoucherView({ documentRef:doc, data:{
    loadOptions:async () => ({ suppliers, accounts:[], stages:[] }), loadOrders:async () => [], post:async () => { posts++; },
  } });
  t.after(() => { view.destroy(); dom.window.close(); });
  const type = (selector, value) => { const input = doc.querySelector(selector); assert.ok(input, selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles:true })); };
  const values = name => [...doc.querySelectorAll(`[data-meal-${name}]`)].map(input => input.value);
  await view.open();
  const search = doc.querySelector('.meal-voucher-search'), bulk = doc.querySelector('[data-meal-bulk]');
  assert.ok(bulk, 'os campos gerais ficam entre o filtro e a tabela');
  assert.equal(search.nextElementSibling, bulk);
  assert.equal(bulk.nextElementSibling, doc.querySelector('.meal-voucher-table'));
  type('[data-meal-quantity="3"]', '0'); type('[data-meal-value="3"]', '0');
  type('.meal-voucher-search', 'Ana');
  assert.equal(doc.querySelector('[data-meal-supplier="2"]').hidden, true);
  type('[data-meal-bulk-quantity]', '4');
  type('[data-meal-bulk-value]', '12,50');
  assert.deepEqual(values('quantity'), ['4','4','4']);
  assert.deepEqual(values('value'), ['12,50','12,50','12,50']);
  assert.match(doc.querySelector('[data-meal-total]').textContent, /150,00/);
  assert.equal(doc.querySelectorAll('.meal-voucher-selected-row').length, 3);
  assert.equal(search.value, 'Ana', 'editar mantém o filtro e o foco do controle');
  type('[data-meal-quantity="1"]', '2');
  assert.deepEqual(values('quantity'), ['2','4','4']);
  assert.match(doc.querySelector('[data-meal-total]').textContent, /125,00/);
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[aria-label="Voltar"]').click();
  assert.deepEqual(values('quantity'), ['2','4','4']);
  assert.deepEqual(values('value'), ['12,50','12,50','12,50']);
  assert.equal(doc.querySelector('[data-meal-bulk-quantity]').value, '4');
  assert.equal(doc.querySelector('[data-meal-bulk-value]').value, '12,50');
  type('[data-meal-bulk-value]', '0');
  assert.deepEqual(values('quantity'), ['2','4','4'], 'editar valor não altera quantidade');
  assert.deepEqual(values('value'), ['0','0','0']);
  assert.match(doc.querySelector('[data-meal-total]').textContent, /0,00/);
  assert.equal(doc.querySelectorAll('.meal-voucher-selected-row').length, 0);
  assert.equal(posts, 0);
  view.close(); await view.open();
  assert.equal(doc.querySelector('[data-meal-bulk-quantity]').value, '5');
  assert.equal(doc.querySelector('[data-meal-bulk-value]').value, '45');
});

test('vale transporte inicia os valores e sugere OBS com a data de Brasília', async t => {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const suppliers = ['Ana Silva', 'ISRAEL ESCORAMENTO E ARMAÇÕES', 'Rafael Souza', 'Mauro Lima', 'Cleiton Cesar Nonato',
    'EDGAR NELSON DA SILVA', 'Feliciano Rogério da Silva']
    .map((label, index) => ({ id:String(index + 1), label, branch:'OBRA A', profession:'PEDREIRO', cargo:'PEDREIRO I' }));
  const view = createMealVoucherView({ documentRef:doc, voucherType:'transport', now:() => new Date('2026-11-16T01:00:00Z'), data:{
    loadOptions:async () => ({ suppliers, accounts:[{id:'8',label:'CAIXA'}], stages:[{id:'7',label:'FUNDAÇÃO',branch:'OBRA A'}] }),
    loadOrders:async () => [], loadSheetAssignments:async () => ({'1':{id:'11'}}),
  } });
  t.after(() => { view.destroy(); dom.window.close(); });
  const value = (name, val) => {
    const field = doc.querySelector(`[name="${name}"]`);
    field.value = val;
    field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input'));
  };
  const click = selector => doc.querySelector(selector).click();
  await view.open();
  assert.equal(doc.querySelector('h2').textContent, 'Vale transporte dos fornecedores');
  assert.deepEqual([...doc.querySelectorAll('[data-meal-quantity]')].map(node => node.value), ['5','0','0','0','0','0','0']);
  assert.deepEqual([...doc.querySelectorAll('[data-meal-value]')].map(node => node.value), ['11,11','0','0','0','0','0','0']);
  click('[data-meal-next]'); await tick(); click('[data-meal-order-new]');
  for (const [name,val] of [['meal-date','2026-11-13'],['meal-due-date','2026-11-20'],['meal-reference-month','2026-11'],['meal-account','8'],['meal-stage','7']]) value(name,val);
  click('[data-meal-next]'); await tick();
  assert.equal(doc.querySelector('[name="meal-obs"]').value, 'VALE TRANSPORTE (15/11/2026)');
  click('[data-meal-next]');
  assert.match(doc.querySelector('h2').textContent, /lançamentos de vale transporte/);
  assert.equal(doc.querySelectorAll('[data-meal-person-card]').length, 1);
  assert.match(doc.querySelector('[data-meal-review-total]').textContent, /55,55/);
});

function testTray(initial = []) {
  let files=initial;const listeners=new Set(),actions=[];let consumed=0;
  const snapshot=()=>files.map(file=>({id:file.name,fileName:file.name,size:file.size,mimeType:file.type,source:file,status:'ready'}));
  return {snapshot,actions,get consumed(){return consumed;},
    set(value){files=value;for(const listener of listeners)listener();},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    read:async()=>files,
    consume:async()=>{consumed++;files=[];for(const listener of listeners)listener();},
    pickFiles:async()=>{actions.push('files');},capture:async()=>{actions.push('camera');},open:async id=>{actions.push(`open:${id}`);},remove:async id=>{actions.push(`remove:${id}`);},
  };
}
async function extrasPanel(t,{files=[],post=async()=>({orderId:'5',lines:[],total:50}),onSwileRecharge,onHome,voucherType='meal',sessionKey=''}={}) {
  const dom=new JSDOM('<body></body>',{url:'https://example.invalid'}),doc=dom.window.document,tray=testTray(files);
  const panel=createMealVoucherView({documentRef:doc,attachmentTray:tray,onSwileRecharge,onHome,voucherType,sessionKey,storage:dom.window.localStorage,data:{
    loadOptions:async()=>({suppliers:[{id:'1',label:'Ana',branch:'OBRA A',profession:'PEDREIRO', cargo:'PEDREIRO I'}],accounts:[{id:'8',label:'CAIXA'}],stages:[{id:'7',label:'FUNDAÇÃO',branch:'OBRA A'}]}),
    loadOrders:async()=>[],loadSheetAssignments:async()=>({'1':{id:'11'}}),post,
  }});t.after(()=>{panel.destroy();dom.window.close();});
  const type=(selector,value)=>{const input=doc.querySelector(selector);input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  await panel.open();type('[data-meal-value="1"]','10');doc.querySelector('[data-meal-next]').click();await tick();doc.querySelector('[data-meal-order-new]').click();
  for(const [name,value] of [['meal-date','2026-10-15'],['meal-due-date','2026-10-30'],['meal-reference-month','2026-10']])type(`[name="${name}"]`,value);
  for(const [name,value] of [['meal-account','8'],['meal-stage','7']]){const select=doc.querySelector(`[name="${name}"]`);select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
  doc.querySelector('[data-meal-next]').click();await tick();return {dom,doc,tray,panel,type};
}

test('vale transporte mostra o popup por 1,5 s e abre o menu sem repetir a postagem', async t => {
  let homeCalls = 0, posts = 0;
  const h = await extrasPanel(t, { voucherType:'transport', sessionKey:'test', onHome:() => { homeCalls++; }, post:async (draft, progress, save) => {
    posts++;
    progress.signature = JSON.stringify(draft);
    save();
    return {orderId:'554',lines:[],total:50};
  } });
  h.doc.querySelector('[data-meal-next]').click();
  t.mock.timers.enable({ apis:['setTimeout'] });
  h.doc.querySelector('[data-meal-confirm]').click(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.doc.querySelector('[data-transport-success] .launch-completion'));
  assert.match(h.doc.querySelector('[data-transport-success]').textContent, /554/);
  assert.equal(h.doc.querySelector('[data-meal-value="1"]'), null);
  assert.equal(h.dom.window.localStorage.length, 0);
  assert.equal(h.doc.querySelector('[data-meal-confirm]'), null);
  assert.equal(h.doc.querySelector('[data-meal-done]'), null);
  assert.equal(homeCalls, 0);
  t.mock.timers.tick(1499);
  assert.equal(homeCalls, 0);
  assert.equal(h.doc.querySelector('.meal-voucher-page').hidden, false);
  t.mock.timers.tick(1);
  assert.equal(homeCalls, 1);
  assert.equal(h.doc.querySelector('.meal-voucher-page').hidden, true);
  t.mock.timers.tick(1500);
  assert.equal(homeCalls, 1);
  assert.equal(posts, 1);
  t.mock.timers.reset();
  await h.panel.open();
  assert.equal(h.doc.querySelector('[data-meal-value="1"]').value, '11,11');
  assert.equal(h.doc.querySelector('[data-transport-success]'), null);
});

test('destruir a tela do popup cancela a navegação agendada', async t => {
  let homeCalls = 0;
  const h = await extrasPanel(t, { voucherType:'transport', onHome:() => { homeCalls++; } });
  h.doc.querySelector('[data-meal-next]').click();
  h.doc.querySelector('[data-meal-confirm]').click(); await tick();
  h.panel.destroy();
  await new Promise(resolve => setTimeout(resolve, 1550));
  assert.equal(homeCalls, 0);
});

test('falha na postagem de transporte mantém a revisão sem navegar ao menu', async t => {
  let homeCalls = 0;
  const h = await extrasPanel(t, { voucherType:'transport', onHome:() => { homeCalls++; }, post:async () => { throw new Error('Falha de envio'); } });
  h.doc.querySelector('[data-meal-next]').click();
  h.doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(h.doc.querySelector('[data-transport-success]'), null);
  assert.match(h.doc.querySelector('[role="alert"]').textContent, /Falha de envio/);
  assert.equal(homeCalls, 0);
  assert.equal(h.doc.querySelector('.meal-voucher-page').hidden, false);
});

for (const sameSource of [true, false]) test(`reabertura limpa apenas a cópia identificada da postagem anterior (${sameSource})`, async t => {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' });
  const doc = dom.window.document, storage = dom.window.localStorage;
  const file = new File(['pdf'], 'recibo.pdf', { type:'application/pdf', lastModified:0 });
  const tray = testTray([file]);
  const key = 'energetico:transport-voucher:pending:recover';
  storage.setItem(key, JSON.stringify({ draft:{ lines:[] }, files:[{ name:file.name, size:file.size, lastModified:0 }],
    progress:{ signature:'{}', operationId:'recover', traySourceIds:[sameSource ? file.name : 'previous-source'] } }));
  let homeCalls = 0;
  const panel = createMealVoucherView({ documentRef:doc, attachmentTray:tray, sessionKey:'recover', storage, voucherType:'transport', onHome:() => { homeCalls++; },
    data:{ loadOptions:async () => ({ suppliers:[], accounts:[], stages:[] }), recoverCompleted:async () => ({
      result:{ orderId:'554', lines:[], total:50 }, files:[file], matchesFiles:async files => assert.deepEqual(files,[file]),
    }) },
  });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  assert.match(doc.querySelector('[data-transport-success]').textContent, /554/);
  assert.equal(storage.getItem(key), null);
  assert.equal(tray.consumed, sameSource ? 1 : 0);
  assert.equal(doc.querySelector('[role="alert"]').hidden, sameSource);
  assert.equal(Boolean(doc.querySelector('[data-transport-success] [role="alert"]')), !sameSource);
  doc.querySelector('[aria-label="Voltar"]').click();
  assert.equal(homeCalls, 1);
  assert.equal(doc.querySelector('.meal-voucher-page').hidden, true);
});

for (const accept of [true, false]) test(`fim do vale pergunta pela Swile e só abre a recarga na opção Sim (resposta: ${accept})`, async t => {
  let opened = 0;
  const h = await extrasPanel(t, {
    post: async value => ({ orderId:'5', lines:value.lines.map(line => ({supplier:line.supplier.label,total:line.total})), total:value.total }),
    onSwileRecharge: async (items, onClose) => {
      assert.deepEqual(items, [{name:'Ana', subtotal:50}]);
      opened++;
      onClose(true);
      return true;
    },
  });
  assert.equal(h.doc.querySelector('[data-meal-swile]'), null);
  h.doc.querySelector('[data-meal-next]').click();
  h.doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.match(h.doc.querySelector('.meal-voucher-content').textContent, /Deseja recarregar.*Swile/);
  assert.equal(opened, 0);
  h.doc.querySelector(accept ? '[data-meal-swile]' : '[data-meal-done]').click(); await tick();
  assert.equal(opened, accept ? 1 : 0);
  if (accept) {
    assert.equal(h.doc.querySelector('[data-meal-swile]'), null);
    assert.match(h.doc.querySelector('.meal-voucher-content').textContent, /sucesso/);
  } else {
    assert.equal(h.doc.querySelector('.meal-voucher-page').hidden, true);
  }
});

test('confirmed meal posting reserves progress until tray cleanup and the receipt are accepted', async t => {
  const h = await extrasPanel(t, { post: async (_draft, _journal, onProgress) => {
    onProgress({ stage: 'launch:1', percent: 50 });
    onProgress({ stage: 'verified:1', percent: 100 }); return { orderId: '5', lines: [], total: 50 };
  } });
  let finish; h.tray.consume = () => new Promise(resolve => { finish = resolve; });
  h.doc.querySelector('[data-meal-next]').click(); await tick();
  h.doc.querySelector('[data-meal-confirm]').click(); await tick();
  const loader = h.doc.querySelector('.app-loading'), progress = () => Number(loader.querySelector('[role=progressbar]').getAttribute('aria-valuenow'));
  assert.equal(progress(), 50, 'cleanup is still pending after the server confirms the batch');
  assert.equal(h.doc.querySelector('[data-meal-done]'), null);
  finish(); await tick(); assert.equal(progress(), 100); assert.ok(h.doc.querySelector('[data-meal-done]'));
});

test('OBS não tem seletor próprio: a barra inclui os arquivos automaticamente e só os consome após confirmar',async t=>{
  const file=new File(['abc'],'comprovante.pdf',{type:'application/pdf',lastModified:0});let posted;
  const h=await extrasPanel(t,{files:[file],post:async value=>{posted=value;return {orderId:'5',lines:[],total:50};}});
  assert.equal(h.doc.querySelector('input[type="file"]'),null);
  assert.match(h.doc.querySelector('[data-meal-tray]').textContent,/comprovante.pdf/);
  h.type('[name="meal-obs"]','Minha observação');h.doc.querySelector('[data-meal-next]').click();await tick();
  assert.equal(posted,undefined);assert.match(h.doc.querySelector('[data-meal-review-files]').textContent,/comprovante.pdf/);
  h.doc.querySelector('[data-meal-confirm]').click();await tick();
  assert.equal(posted.obs,'Minha observação');assert.deepEqual(posted.files,[file]);assert.equal(h.tray.consumed,1);
  assert.match(h.doc.querySelector('.meal-voucher-content h2').textContent,/sucesso/);
});
test('clipe, câmera, visualizar e remover da barra funcionam sem apagar a OBS digitada',async t=>{
  const file=new File(['abc'],'nota.pdf',{type:'application/pdf'}),h=await extrasPanel(t,{files:[file]});
  h.type('[name="meal-obs"]','Não perder este texto');
  for(const selector of ['[data-meal-tray-pick]','[data-meal-tray-capture]','[data-meal-tray-open]','[data-meal-tray-remove]']){h.doc.querySelector(selector).click();await tick();}
  assert.deepEqual(h.tray.actions,['files','camera','open:nota.pdf','remove:nota.pdf']);
  h.tray.set([file,new File(['outro'],'novo.pdf',{type:'application/pdf'})]);
  assert.equal(h.doc.querySelector('[name="meal-obs"]').value,'Não perder este texto');assert.match(h.doc.querySelector('[data-meal-tray]').textContent,/novo.pdf/);
});
test('alteração da bandeja depois da revisão exige revisar novamente e não posta arquivos antigos',async t=>{
  let posts=0;const h=await extrasPanel(t,{files:[new File(['abc'],'nota.pdf',{type:'application/pdf'})],post:async()=>{posts++;}});
  h.doc.querySelector('[data-meal-next]').click();await tick();
  h.tray.set([new File(['xyz'],'nota.pdf',{type:'application/pdf'})]);
  assert.ok(h.doc.querySelector('[name="meal-obs"]'));assert.equal(h.doc.querySelector('[data-meal-confirm]'),null);assert.equal(posts,0);
  assert.match(h.doc.querySelector('[role="alert"]').textContent,/bandeja|revis/i);
});
test('falha na postagem mantém a bandeja intacta e falha de limpeza não apaga o recibo de sucesso',async t=>{
  let fail=true;const h=await extrasPanel(t,{files:[new File(['abc'],'nota.pdf',{type:'application/pdf'})],post:async()=>{if(fail)throw new Error('rede caiu');return {orderId:'5',lines:[],total:50};}});
  h.doc.querySelector('[data-meal-next]').click();await tick();h.doc.querySelector('[data-meal-confirm]').click();await tick();
  assert.equal(h.tray.consumed,0);assert.equal(h.tray.snapshot().length,1);
  fail=false;h.tray.consume=async()=>{throw new Error('Não foi possível limpar cópia temporária; não repita o lançamento.');};
  h.doc.querySelector('[data-meal-confirm]').click();await tick();
  assert.match(h.doc.querySelector('.meal-voucher-content h2').textContent,/sucesso/);assert.ok(h.doc.querySelector('[data-meal-done]'));
  assert.match(h.doc.querySelector('[role="alert"]').textContent,/não repita/);
});

test('fechar durante a leitura dos anexos permite reabrir sem a resposta antiga avançar a tela',async t=>{
  const file=new File(['abc'],'nota.pdf',{type:'application/pdf'}),h=await extrasPanel(t,{files:[file]});
  let finish;h.tray.read=()=>new Promise(resolve=>{finish=resolve;});
  h.doc.querySelector('[data-meal-next]').click();assert.ok(finish);
  assert.equal(h.panel.close(),true);await h.panel.open();
  assert.ok(h.doc.querySelector('[name="meal-obs"]'),'a nova abertura não deve ficar presa no carregamento anterior');
  h.type('[name="meal-obs"]','Texto da nova abertura');finish([file]);await tick();
  assert.equal(h.doc.querySelector('[name="meal-obs"]').value,'Texto da nova abertura');assert.equal(h.doc.querySelector('[data-meal-confirm]'),null);
});

for(const phase of ['extras','review'])test(`seleção de anexo ainda aberta bloqueia avanço e confirmação no passo ${phase}`,async t=>{
  const first=new File(['abc'],'primeiro.pdf',{type:'application/pdf'}),second=new File(['xyz'],'segundo.pdf',{type:'application/pdf'});let posts=0,posted;
  const h=await extrasPanel(t,{files:[first],post:async value=>{posts++;posted=value;return {orderId:'5',lines:[],total:50};}});
  if(phase==='review'){h.doc.querySelector('[data-meal-next]').click();await tick();}
  let release;h.tray.pickFiles=()=>new Promise(resolve=>{release=()=>{h.tray.set([first,second]);resolve();};});h.tray.set([first]);
  h.doc.querySelector('[data-meal-tray-pick]').click();
  const advance=h.doc.querySelector(phase==='extras'?'[data-meal-next]':'[data-meal-confirm]');advance.click();await tick();
  h.doc.querySelector('[data-meal-confirm]')?.click();await tick();const earlyPosts=posts;
  release();await tick();assert.equal(earlyPosts,0,'não grava enquanto o seletor ainda está preparando o arquivo');
  h.doc.querySelector('[data-meal-next]').click();await tick();h.doc.querySelector('[data-meal-confirm]').click();await tick();
  assert.deepEqual(posted.files,[first,second]);assert.equal(posts,1);
});

for(const outcome of ['cancel','error','success'])test(`voltar à escolha do pedido durante seleção permite navegar após ${outcome}`,async t=>{
  const file=new File(['abc'],'nota.pdf',{type:'application/pdf'}),h=await extrasPanel(t,{files:[file]});
  let release;h.tray.pickFiles=()=>new Promise((resolve,reject)=>{release=()=>{if(outcome==='error')reject(new Error('Falha na seleção'));else{if(outcome==='success')h.tray.set([file,new File(['xyz'],'novo.pdf',{type:'application/pdf'})]);resolve();}};});h.tray.set([file]);
  h.doc.querySelector('[data-meal-tray-pick]').click();
  h.doc.querySelector('[aria-label="Voltar"]').click();h.doc.querySelector('[aria-label="Voltar"]').click();
  assert.ok(h.doc.querySelector('[data-meal-order-new]'));
  release();await tick();h.doc.querySelector('[data-meal-order-new]').click();
  assert.ok(h.doc.querySelector('[name="meal-date"]'),'as escolhas voltam a responder quando a seleção termina');
});

function recoveryPanel(t, { change = () => {}, canEdit = async () => true, files = [], extraSuppliers = [], post } = {}) {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const supplier = { id:'1', label:'Ana', branch:'OBRA A', profession:'PEDREIRO', cargo:'PEDREIRO I' };
  const original = { lines:[{ supplier, quantity:'5', unitValue:'10' }], orderMode:'new', orderId:'', date:'2026-10-15', dueDate:'2026-10-30', paymentDate:'', referenceMonth:'2026-10', account:{ id:'8', label:'CAIXA' }, stage:{ id:'7', label:'FUNDAÇÃO', branch:'OBRA A' }, obs:'', files };
  const draft = structuredClone({ ...original, files:[] }); change(draft);
  const storage = dom.window.localStorage, key = 'energetico:meal-voucher:pending:recover-case';
  storage.setItem(key, JSON.stringify({ draft, progress:{ operationId:'recover-case', signature:JSON.stringify(original), editable:true }, files }));
  let sheetReads = 0;
  const panel = createMealVoucherView({ documentRef:doc, storage, sessionKey:'recover-case', data:{
    loadOptions:async () => ({ suppliers:[supplier,...extraSuppliers], accounts:[original.account], stages:[original.stage] }), post,
    loadOrders:async () => [], canEditPending:canEdit,
    loadSheetAssignments:async () => { sheetReads++; return { '1':{ id:'11' } }; },
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  return { panel, doc, dom, storage, key, get sheetReads() { return sheetReads; } };
}

test('voltar aos fornecedores de uma tentativa protegida não inclui novos elegíveis nem muda sua assinatura', async t => {
  let posted;
  const h = recoveryPanel(t, { canEdit:async () => false,
    extraSuppliers:[{ id:'2', label:'Novo elegível', branch:'OBRA A', profession:'PEDREIRO', cargo:'PEDREIRO I' }],
    post:async draft => { posted = draft; return { orderId:'5', lines:[], total:50 }; },
  });
  await h.panel.open();
  for (let n = 0; n < 4; n++) h.doc.querySelector('[aria-label="Voltar"]').click();
  assert.equal(h.doc.querySelector('[data-meal-quantity="2"]').value, '0');
  assert.equal(h.doc.querySelector('[data-meal-value="2"]').value, '0');
  assert.equal(h.doc.querySelector('[data-meal-bulk-value]').disabled, true);
  for (let n = 0; n < 4; n++) h.doc.querySelector('[data-meal-next]').click();
  assert.equal(h.doc.querySelectorAll('[data-meal-person-card]').length, 1);
  h.doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.deepEqual(posted.lines.map(line => line.supplier.id), ['1']);
  assert.equal(Object.hasOwn(posted, 'bulkValues'), false, 'metadados dos controles não mudam a assinatura financeira legada');
});

test('recuperação editável aceita campos incompletos antes de consultar a folha', async t => {
  const h = recoveryPanel(t, { change:draft => { draft.referenceMonth = ''; draft.paymentDate = ''; } });
  await h.panel.open();
  assert.equal(h.doc.querySelector('[name="meal-reference-month"]').disabled, false);
  assert.equal(h.sheetReads, 0, 'a folha será conferida depois de corrigir e seguir');
  assert.equal(h.doc.querySelector('[role="alert"]').hidden, true);
});

test('rascunho editável com valores apagados retorna aos fornecedores sem travar a abertura', async t => {
  const h = recoveryPanel(t, { change:draft => { draft.lines[0].unitValue = ''; } });
  await h.panel.open();
  assert.ok(h.doc.querySelector('[data-meal-value="1"]'));
  assert.equal(h.doc.querySelector('[data-meal-value="1"]').disabled, false);
});

test('registros encontrados restauram o lote original e preservam os anexos pendentes', async t => {
  const file = { name:'comprovante.pdf', size:11, lastModified:123 };
  const h = recoveryPanel(t, { canEdit:async () => false, files:[file], change:draft => { draft.date = '2026-11-02'; } });
  await h.panel.open();
  assert.ok(h.doc.querySelector('[data-meal-tray]'));
  h.doc.querySelector('[aria-label="Voltar"]').click();
  assert.equal(h.doc.querySelector('[name="meal-date"]').value, '2026-10-15');
  assert.equal(h.doc.querySelector('[name="meal-date"]').disabled, true);
  h.panel.close();
  assert.deepEqual(JSON.parse(h.storage.getItem(h.key)).files, [file]);
});

test('abandona lote legado com comprovante ausente e volta ao formulário limpo nas próximas aberturas', async t => {
  const file = { name:'Comprovante_20261022_221430.pdf', size:11, lastModified:123 };
  const h = recoveryPanel(t, { canEdit:async () => false, files:[file] });
  await h.panel.open();
  h.doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(h.doc.querySelector('[role="alert"]').textContent, /mesmos anexos/);

  h.doc.querySelector('[data-meal-abandon]').click();
  h.doc.querySelector('[data-meal-keep-pending]').click();
  assert.ok(h.storage.getItem(h.key));
  assert.equal(h.doc.querySelector('[name="meal-obs"]').disabled, true);

  h.doc.querySelector('[data-meal-abandon]').click();
  h.doc.querySelector('[data-meal-confirm-abandon]').click(); await tick();
  assert.equal(h.storage.getItem(h.key), null);
  assert.doesNotMatch(h.doc.querySelector('.meal-voucher-content').textContent, /Comprovante_20261022/);
  assert.equal(h.doc.querySelector('[data-meal-value="1"]').value, '45');
  assert.equal(h.doc.querySelector('[data-meal-value="1"]').disabled, false);

  h.panel.close(); await h.panel.open();
  assert.ok(h.doc.querySelector('[data-meal-value="1"]'));
  assert.equal(h.doc.querySelector('[data-meal-abandon]'), null);
});

test('abandonar não apaga uma tentativa atualizada por outra tela', async t => {
  const h = recoveryPanel(t, { canEdit:async () => false });
  await h.panel.open();
  h.doc.querySelector('[data-meal-abandon]').click();
  const current = JSON.parse(h.storage.getItem(h.key));
  current.progress.lines = { '1':'56' };
  h.storage.setItem(h.key, JSON.stringify(current));
  h.doc.querySelector('[data-meal-confirm-abandon]').click(); await tick();
  assert.deepEqual(JSON.parse(h.storage.getItem(h.key)).progress.lines, { '1':'56' });
  assert.match(h.doc.querySelector('[role="alert"]').textContent, /outra tela/);
});

test('permissão de edição salva não é reutilizada quando a consulta ao servidor falha', async t => {
  let offline = true;
  const h = recoveryPanel(t, { canEdit:async () => { if (offline) throw new Error('offline'); return true; } });
  await h.panel.open();
  assert.match(h.doc.querySelector('[role="alert"]').textContent, /offline/);
  h.doc.querySelector('[aria-label="Voltar"]').click();
  h.doc.querySelector('[aria-label="Voltar"]').click();
  assert.equal(h.doc.querySelector('[name="meal-date"]').disabled, true);
  h.panel.close(); offline = false; await h.panel.open();
  assert.equal(h.doc.querySelector('[name="meal-date"]').disabled, false);
});

test('consulta indisponível recupera o original mesmo se o rascunho editável ficou incompleto', async t => {
  const h = recoveryPanel(t, { change:draft => { draft.referenceMonth = ''; draft.lines[0].unitValue = ''; }, canEdit:async () => { throw new Error('offline'); } });
  await h.panel.open();
  assert.match(h.doc.querySelector('[role="alert"]').textContent, /offline/);
  h.doc.querySelector('[aria-label="Voltar"]').click();
  h.doc.querySelector('[aria-label="Voltar"]').click();
  assert.equal(h.doc.querySelector('[name="meal-reference-month"]').value, '2026-10');
  assert.equal(h.doc.querySelector('[name="meal-reference-month"]').disabled, true);
});

test('rascunho restaurado sem gravações libera os campos e posta os dados corrigidos', async t => {
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const supplier = { id:'1', label:'Ana', branch:'OBRA A', profession:'PEDREIRO', cargo:'PEDREIRO I' };
  const draft = { lines:[{ supplier, quantity:'5', unitValue:'10' }], orderMode:'new', orderId:'', date:'2026-10-15', dueDate:'2026-10-30', paymentDate:'', referenceMonth:'2026-10', account:{ id:'8', label:'CAIXA' }, stage:{ id:'7', label:'FUNDAÇÃO', branch:'OBRA A' }, obs:'', files:[] };
  const storage = dom.window.localStorage, key = 'energetico:meal-voucher:pending:edit-account';
  storage.setItem(key, JSON.stringify({ draft, progress:{ operationId:'edit-view-1', signature:JSON.stringify(draft) }, files:[] }));
  let inspected = 0, posted;
  const panel = createMealVoucherView({ documentRef:doc, storage, sessionKey:'edit-account', data:{
    loadOptions:async () => ({ suppliers:[supplier], accounts:[draft.account,{ id:'9', label:'BANCO' }], stages:[draft.stage,{ id:'6', label:'ALVENARIA', branch:'OBRA A' }] }),
    loadOrders:async () => [], loadSheetAssignments:async () => ({ '1':{ id:'12' } }),
    canEditPending:async () => { inspected++; return true; },
    post:async (value, progress) => { posted = { ...value, operationId:progress.operationId }; return { orderId:'5', lines:[], total:50 }; },
  } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  assert.equal(inspected, 1);
  assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Informe os dados/);
  const type = (name, value) => { const input = doc.querySelector(`[name="${name}"]`); assert.equal(input.disabled, false); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles:true })); };
  for (const [name,value] of [['meal-date','2026-11-02'],['meal-due-date','2026-11-10'],['meal-payment-date','2026-11-03'],['meal-reference-month','2026-11']]) type(name, value);
  for (const [name,value] of [['meal-account','9'],['meal-stage','6']]) {
    const input = doc.querySelector(`[name="${name}"]`); assert.equal(input.disabled, false); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
  }
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-next]').click();
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(posted.date, '2026-11-02'); assert.equal(posted.dueDate, '2026-11-10'); assert.equal(posted.paymentDate, '2026-11-03');
  assert.equal(posted.referenceMonth, '2026-11'); assert.equal(posted.account.id, '9'); assert.equal(posted.stage.id, '6');
  assert.equal(posted.operationId, 'edit-view-1'); assert.equal(storage.getItem(key), null);
});

test('revisão do vale mostra cartões por colaborador, total, OBS e anexos sem postar antes da confirmação', async () => {
  const css = readFileSync(new URL('../src/ui/meal-voucher.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><body></body>`, { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana Silva', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' },
    { id: '2', label: 'Bruno Souza', branch: 'OBRA A', profession: 'MESTRE DE OBRAS' },
  ];
  let posts = 0; const tray=testTray();
  const panel = createMealVoucherView({ documentRef: doc, attachmentTray:tray, data: {
    loadOptions: async () => ({ suppliers, accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' }, '2': { id: '12' } }),
    post: async () => { posts++; return { orderId: '5', lines: [], total: 100 }; },
  } });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type('[data-meal-value="1"]', '20');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    type('[name="meal-obs"]', 'Semana com feriado');
    const file = new dom.window.File(['arquivo'], 'comprovante.pdf', { type: 'application/pdf' });
    tray.set([file]);
    doc.querySelector('[data-meal-next]').click(); await tick();

    const review = doc.querySelector('[data-meal-review]');
    assert.ok(review, 'a revisão deve usar o layout em cartões');
    assert.match(review.querySelector('[data-meal-order-card]').textContent, /Pedido novo/);
    assert.match(review.querySelector('[data-meal-order-card]').textContent, /Pagamento efetuado não informado/);
    assert.equal(review.querySelectorAll('[data-meal-person-card]').length, 1, 'só exibe fornecedores selecionados');
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /Ana Silva/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /IDFOLHA 11/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /5/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /R\$\s*20,00/);
    assert.match(review.querySelector('[data-meal-review-total]').textContent, /R\$\s*100,00/);
    assert.match(review.querySelector('[data-meal-review-total]').textContent, /5 dias/);
    assert.match(review.querySelector('[data-meal-review-notes]').textContent, /Semana com feriado/);
    assert.match(review.querySelector('[data-meal-review-files]').textContent, /comprovante\.pdf/);
    assert.ok(doc.querySelector('[data-meal-review-back]'), 'há Voltar no rodapé da revisão');
    assert.equal(posts, 0);
    doc.querySelector('[data-meal-review-back]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS/);
    doc.querySelector('[data-meal-next]').click();
    assert.equal(posts, 0);
  } finally { panel.destroy(); dom.window.close(); }
});

test('dados do vale alimentação permitem filtrar conta e etapa digitando sem mudar a escolha até selecionar', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({
      suppliers: [{ id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' }],
      accounts: [{ id: '8', label: 'ENERGÉTICA CAIXA' }, { id: '9', label: 'BANCO OBRA' }],
      stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }, { id: '6', label: 'ALVENARIA', branch: 'OBRA A' }],
    }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
  } });
  const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type(doc.querySelector('[data-meal-value="1"]'), '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();

    const account = doc.querySelector('[name="meal-account"]');
    const stage = doc.querySelector('[name="meal-stage"]');
    assert.equal(account.hidden, true);
    assert.equal(stage.hidden, true);
    const accountSearch = account.nextElementSibling.querySelector('[role="combobox"]');
    accountSearch.focus(); type(accountSearch, 'banco');
    assert.equal(account.value, '', 'digitar não confirma uma opção');
    assert.deepEqual([...account.nextElementSibling.querySelectorAll('[role="option"]')].map(option => option.textContent), ['BANCO OBRA']);
    account.nextElementSibling.querySelector('[role="option"]').click();
    assert.equal(account.value, '9');

    const stageSearch = stage.nextElementSibling.querySelector('[role="combobox"]');
    stageSearch.focus(); type(stageSearch, 'fundacao');
    assert.equal(stage.value, '');
    assert.deepEqual([...stage.nextElementSibling.querySelectorAll('[role="option"]')].map(option => option.textContent), ['FUNDAÇÃO']);
    stage.nextElementSibling.querySelector('[role="option"]').click();
    assert.equal(stage.value, '7');

    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) {
      type(doc.querySelector(`[name="${name}"]`), value);
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS/);
    doc.querySelector('.meal-voucher-navigation').click();
    assert.equal(doc.querySelector('[name="meal-account"]').value, '9');
    assert.equal(doc.querySelector('[name="meal-stage"]').value, '7');
  } finally { panel.destroy(); dom.window.close(); }
});

test('destaca em verde somente linhas que serão incluídas no lançamento', async () => {
  const css = readFileSync(new URL('../src/ui/meal-voucher.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><body></body>`, { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' },
    { id: '2', label: 'Bruno', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' },
  ];
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers, accounts: [], stages: [] }),
  } });
  await panel.open();
  const row = doc.querySelector('[data-meal-supplier="2"]');
  const value = row.querySelector('[data-meal-value]');
  const quantity = row.querySelector('[data-meal-quantity]');
  const background = () => dom.window.getComputedStyle(row).backgroundColor;
  const type = (input, text) => { input.value = text; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type(doc.querySelector('[data-meal-value="1"]'), '0');
  type(value, '0');
  const plain = background();

  type(value, '10');
  const green = background().match(/\d+/g)?.map(Number);
  assert.ok(green && green[1] > green[0] && green[1] > green[2], 'a linha com valor deve ter fill verde');
  assert.notEqual(background(), plain, 'o verde deve vencer o preenchimento alternado da tabela');
  assert.notEqual(dom.window.getComputedStyle(doc.querySelector('[data-meal-supplier="1"]')).backgroundColor, background(), 'outras linhas não recebem o fill verde');

  type(quantity, '');
  assert.equal(background(), plain, 'quantidade vazia não será submetida');
  type(quantity, '5');
  assert.notEqual(background(), plain);
  type(value, '0');
  assert.equal(background(), plain, 'valor zero não será submetido');
  type(value, '');
  assert.equal(background(), plain, 'limpar o valor remove o destaque');
  panel.destroy(); dom.window.close();
});

test('vale alimentação inicia cada quantidade em 5 e preserva alterações manuais', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' },
    { id: '2', label: 'Bruno', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' },
  ];
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers, accounts: [], stages: [] }),
    loadOrders: async () => [],
  } });
  await panel.open();
  assert.equal(doc.querySelector('[data-meal-quantity="1"]').value, '5');
  assert.equal(doc.querySelector('[data-meal-quantity="2"]').value, '5');
  const quantity = doc.querySelector('[data-meal-quantity="1"]');
  quantity.value = '4';
  quantity.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const value = doc.querySelector('[data-meal-value="1"]');
  value.value = '10';
  value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click();
  await tick();
  doc.querySelector('.meal-voucher-navigation').click();
  assert.equal(doc.querySelector('[data-meal-quantity="1"]').value, '4');
  assert.equal(doc.querySelector('[data-meal-quantity="2"]').value, '5');
  panel.destroy(); dom.window.close();
});
test('vale alimentação: lista fornecedores, soma valores e só posta depois da confirmação', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' };
  let posts = 0, postedPaymentDate;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async draft => { posts++; postedPaymentDate = draft.paymentDate; return { orderId: '5', lines: [{ id: '9', supplier: 'Ana', sheetId: '11', payrollId: '31' }], total: Number(draft.lines[0].quantity) * Number(draft.lines[0].unitValue) }; },
  } });
  await panel.open(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Ana/);
  const value = doc.querySelector('[data-meal-value="1"]'); value.value = '10'; value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('[data-meal-total]').textContent, /50,00/);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /pedido novo/i);
  doc.querySelector('[data-meal-order-new]').click(); await tick();
  const date = doc.querySelector('[name="meal-date"]'); date.value = '2026-10-15'; date.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const due = doc.querySelector('[name="meal-due-date"]'); due.value = '2026-10-30'; due.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const paid = doc.querySelector('[name="meal-payment-date"]'); assert.ok(paid, 'a data de pagamento efetuado é perguntada antes da confirmação'); paid.value = '2026-10-16'; paid.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const month = doc.querySelector('[name="meal-reference-month"]'); month.value = '2026-10'; month.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[name="meal-account"]').value = '8'; doc.querySelector('[name="meal-account"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[name="meal-stage"]').value = '7'; doc.querySelector('[name="meal-stage"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /OBS/i);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.equal(posts, 0);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /PEDREIRO/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /2026-10/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /IDFOLHA 11/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pagamento efetuado 2026-10-16/);
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(posts, 1);
  assert.equal(postedPaymentDate, '2026-10-16');
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pedido 5/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /50,00/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Vínculo 31/);
  panel.destroy(); dom.window.close();
});

test('envio interrompido retoma com o mesmo token após recriar a tela e mostra os IDs já salvos', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document, cache = new Map(), attempts = [];
  const storage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' };
  const data = {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [], loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (draft, progress, onProgress) => {
      attempts.push(progress.operationId);
      if (attempts.length === 1) { progress.signature = 'iniciada'; progress.orderId = '5'; progress.lines = { '1': '9' }; onProgress(); throw new Error('rede interrompida'); }
      return { orderId: '5', lines: [{ id: '9', supplier: 'Ana', sheetId: '11', payrollId: '31' }], total: Number(draft.lines[0].quantity) * Number(draft.lines[0].unitValue) };
    },
  };
  const panel = createMealVoucherView({ documentRef: doc, data, sessionKey: 'account-1', storage });
  await panel.open(); await tick();
  const value = doc.querySelector('[data-meal-value="1"]'); value.value = '10'; value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-order-new]').click(); await tick();
  for (const [name, value] of [['meal-date','2026-10-15'],['meal-due-date','2026-10-30'],['meal-reference-month','2026-10']]) {
    const input = doc.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  for (const [name, value] of [['meal-account','8'],['meal-stage','7']]) {
    const input = doc.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pedido 5|pedido 5/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Lançamento 9/);
  panel.destroy();
  const resumed = createMealVoucherView({ documentRef: doc, data, sessionKey: 'account-1', storage });
  await resumed.open(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Retomar envio/);
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(cache.size, 0);
  resumed.destroy(); dom.window.close();
});

test('seta volta à pergunta anterior após falha no envio sem fechar o vale-alimentação', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' };
  let homeCalls = 0;
  const panel = createMealVoucherView({ documentRef: doc, onHome: () => { homeCalls++; }, data: {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (_draft, progress, onProgress) => { progress.signature = 'envio-iniciado'; onProgress(); throw new Error('General exception while processing'); },
  } });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type('[data-meal-value="1"]', '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    type('[name="meal-obs"]', 'feriado');
    doc.querySelector('[data-meal-next]').click();
    doc.querySelector('[data-meal-confirm]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-error').textContent, /General exception/);

    doc.querySelector('[aria-label="Voltar"]').click();
    assert.equal(doc.querySelector('.meal-voucher-page').hidden, false);
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS/);
    assert.equal(doc.querySelector('[name="meal-obs"]').value, 'feriado');
    assert.equal(doc.querySelector('[name="meal-obs"]').disabled, true, 'lote iniciado é somente para revisão');
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Informe os dados/);
    assert.equal(doc.querySelector('[name="meal-date"]').value, '2026-10-15');
    assert.equal(doc.querySelector('[name="meal-date"]').disabled, true);
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content').textContent, /Pedido escolhido: novo/);
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Vale-alimentação dos fornecedores/);
    assert.equal(doc.querySelector('[data-meal-value="1"]').value, '10');
    assert.equal(doc.querySelector('[data-meal-value="1"]').disabled, true);
    for (let index = 0; index < 3; index++) doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS/);
    doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Confirme os lançamentos/);
    assert.match(doc.querySelector('[data-meal-confirm]').textContent, /Retomar envio/);
    doc.querySelector('[aria-label="Início"]').click();
    assert.equal(doc.querySelector('.meal-voucher-page').hidden, true);
    assert.equal(homeCalls, 1);
  } finally { panel.destroy(); dom.window.close(); }
});

test('retomada com anexos usa a barra e aceita somente os arquivos da tentativa original', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document, cache = new Map();
  const storage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO', cargo: 'PEDREIRO I' };
  const tray=testTray(); const data = {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [], loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (_draft, progress, onProgress) => { progress.signature = JSON.stringify({..._draft,files:_draft.files.map(({name,size,lastModified})=>({name,size,lastModified}))}); onProgress(); throw new Error('rede interrompida'); },
  };
  const attachment = new dom.window.File(['comprovante'], 'comprovante.pdf', { type: 'application/pdf', lastModified: 1234 });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const original = createMealVoucherView({ documentRef: doc, data, attachmentTray:tray, storage, sessionKey: 'conta-anexo' });
  try {
    await original.open();
    type('[data-meal-value="1"]', '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    tray.set([attachment]);
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-confirm]').click(); await tick();
  } finally { original.destroy(); }

  tray.set([]);
  const resumed = createMealVoucherView({ documentRef: doc, data, attachmentTray:tray, storage, sessionKey: 'conta-anexo' });
  try {
    await resumed.open(); await tick();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS/);
    assert.equal(doc.querySelector('[name="meal-obs"]').disabled, true);
    assert.equal(doc.querySelector('[data-meal-tray-pick]').disabled, false, 'a barra permite repor os anexos pendentes');
    assert.equal(doc.querySelector('input[type="file"]'),null);
    doc.querySelector('[data-meal-next]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-error').textContent, /mesmos anexos/);
    tray.set([attachment]);
    doc.querySelector('[data-meal-next]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Confirme os lançamentos/);
  } finally { resumed.destroy(); dom.window.close(); }
});
