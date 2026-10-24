import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealVoucherData } from '../src/chat/meal-voucher-data.js';
import { JSDOM } from 'jsdom';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';

function fixture() {
  const names = {
    FORNECEDORES: ['CADASTRO','STATUS','EMPREITEIRO','FILIAL','PROFISSAO'],
    CADASTROCONTA: ['CONTA'], LANCAMENTOOBRA: ['ETAPA','FILIAL'],
    IDFOLHA: ['MESREFERENCIA','FORNECEDOR'], FOLHAPGTO: ['Title','FORNECEDOR','TIPOPGTO','VALORUNITARIO','QTD','DATA','IDFOLHA','IDLANCAMENTO'],
    NOTASPENDENTES: ['Title','FILIAL','FORNECEDOR','VALORTOTAL','DATA PEDIDO','STATUS','OBS','FORMAPGTO','NOTA FISCAL','VALECONTROLE'],
    LANCAMENTOS: ['__PowerAppsId__','AGRUPAR','FILIAL','TIPO TRANSAÇÃO','DATA','DATA PGTO PREVISTO','DATA PGTO EFETUADO','FORNECEDOR','PRODUTO','ETAPA','QUANTIDADE','VALOR UNITÁRIO','CONTA','FRETE','OBS'],
  };
  const columns = Object.fromEntries(Object.entries(names).map(([list, labels]) => [list, labels.map(label => ({ name: label, displayName: label, ...(/DATA/.test(label) ? { dateTime: {} } : list === 'NOTASPENDENTES' && label === 'VALORTOTAL' ? { number: {} } : { text: {} }) }))]));
  Object.assign(columns.NOTASPENDENTES.find(c => c.name === 'VALECONTROLE'), { hidden:true, text:{ allowMultipleLines:true, textType:'plain', appendChangesToExistingText:false } });
  const rows = { FORNECEDORES: [
    { id: '1', fields: { CADASTRO: 'Ana', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PEDREIRO' } },
    { id: '2', fields: { CADASTRO: 'Beto', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'SERVENTE' } },
    { id: '3', fields: { CADASTRO: 'Caio', STATUS: 'INATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PINTOR' } },
  ], CADASTROCONTA: [{ id: '8', fields: { CONTA: 'CAIXA' } }], LANCAMENTOOBRA: [{ id: '7', fields: { ETAPA: 'FUNDAÇÃO', FILIAL: 'OBRA A' } }],
  IDFOLHA: [{ id: '11', fields: { MESREFERENCIA: '10/2026', FORNECEDOR: 'Ana' } }, { id: '12', fields: { MESREFERENCIA: '10/2026', FORNECEDOR: 'Beto' } }],
  FOLHAPGTO: [], NOTASPENDENTES: [], LANCAMENTOS: [] };
  const writes = [], uploads = [], deliveries = [], storedFiles = new Map();
  const seedAttachment = (list, id, name, bytes = new TextEncoder().encode('outro arquivo')) => storedFiles.set(`${list}:${id}:${name}`, bytes);
  let failSecond = false, changeSheetDuringLaunch = false, changeOrderDuringLaunch = false, loseOrderResponse = false, appendOrderObs = false;
  const repo = {
    resolveList: async (_site, aliases) => ({ status: 'resolved', id: aliases[0] }),
    getColumns: async (_site, list) => columns[list],
    getItemsPage: async (_site, list) => ({ items: rows[list], hasMore: false }),
    getItem: async (_site, list, id) => rows[list].find(row => row.id === String(id)),
    createItem: async (_site, list, fields) => { if (failSecond && list === 'LANCAMENTOS' && rows.LANCAMENTOS.length === 1) throw new Error('rede interrompida'); if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'Title')?.displayName === 'FILIAL' && fields.Title !== 'OBRA A') throw new Error('General exception while processing'); if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL')?.text && typeof fields.VALORTOTAL !== 'string') throw new Error('General exception while processing'); const row = { id: String(rows[list].length + (list === 'FORNECEDORES' ? 10 : 1)), fields: { ...fields }, eTag: '"1"' }; rows[list].push(row); writes.push({ list, fields }); if (appendOrderObs && list === 'NOTASPENDENTES') row.fields.OBS += '\nAuditado automaticamente'; if (loseOrderResponse && list === 'NOTASPENDENTES') { loseOrderResponse = false; throw new Error('General exception while processing'); } if (changeSheetDuringLaunch && list === 'LANCAMENTOS') rows.IDFOLHA[0].fields.MESREFERENCIA = '11/2026'; if (changeOrderDuringLaunch && list === 'LANCAMENTOS') { rows.NOTASPENDENTES[0].fields.VALORTOTAL = 45; changeOrderDuringLaunch = false; } return row; },
    updateItem: async (_site, list, id, fields) => { if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL')?.text && fields.VALORTOTAL !== undefined && typeof fields.VALORTOTAL !== 'string') throw new Error('General exception while processing'); const row = rows[list].find(item => item.id === String(id)); Object.assign(row.fields, fields); writes.push({ list, fields, update: true }); return row; },
    listAttachments: async (_site, list, id) => [...storedFiles].filter(([key]) => key.startsWith(`${list}:${id}:`)).map(([key, bytes]) => ({ name:key.slice(`${list}:${id}:`.length), size:bytes.byteLength })),
    downloadAttachment: async (_site, list, id, name) => storedFiles.get(`${list}:${id}:${name}`).slice().buffer,
    uploadAttachment: async (_site, list, id, file) => { const bytes = new Uint8Array(await file.arrayBuffer()); seedAttachment(list, id, file.name, bytes); uploads.push(file.name); deliveries.push({ list, id:String(id), name:file.name }); },
  };
  return { repo, columns, rows, writes, uploads, deliveries, seedAttachment, failSecond: () => { failSecond = true; }, recover: () => { failSecond = false; }, loseOrderResponse: () => { loseOrderResponse = true; }, appendOrderObs: () => { appendOrderObs = true; }, changeSheetDuringLaunch: () => { changeSheetDuringLaunch = true; }, changeOrderDuringLaunch: () => { changeOrderDuringLaunch = true; } };
}
const draft = suppliers => ({ date: '2026-10-15', dueDate: '2026-10-30', referenceMonth: '2026-10', stage: { id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }, account: { id: '8', label: 'CAIXA' }, orderMode: 'new', obs: 'outubro', files: [], lines: suppliers.map((supplier, index) => ({ supplier, quantity: '1', unitValue: index ? '20' : '10' })) });
async function waitForSubmission(doc) {
  for (let attempt=0; attempt<200; attempt++) {
    if (doc.querySelector('[data-meal-done]') || !doc.querySelector('[role="alert"]').hidden) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('O envio não terminou dentro do prazo de teste');
}

test('falha antes de gravar permite corrigir datas, referência, conta e etapa mantendo a operação', async () => {
  const f = fixture(), create = f.repo.createItem;
  let rejected = false;
  f.repo.createItem = async (...args) => { if (!rejected) { rejected = true; throw new Error('dados rejeitados'); } return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'editable-1' };
  await assert.rejects(data.post(original, progress), /rejeitados/);
  assert.ok(progress.signature); assert.equal(f.writes.length, 0);
  assert.equal(await data.canEditPending(original, progress), true);
  f.rows.CADASTROCONTA.push({ id:'9', fields:{ CONTA:'BANCO' } });
  f.rows.LANCAMENTOOBRA.push({ id:'6', fields:{ ETAPA:'ALVENARIA', FILIAL:'OBRA A' } });
  f.rows.IDFOLHA.push({ id:'33', fields:{ MESREFERENCIA:'11/2026', FORNECEDOR:'Ana' } });
  const corrected = { ...original, date:'2026-11-02', dueDate:'2026-11-10', paymentDate:'2026-11-03', referenceMonth:'2026-11',
    account:{ id:'9', label:'BANCO' }, stage:{ id:'6', label:'ALVENARIA', branch:'OBRA A' } };
  await data.post(corrected, progress);
  assert.equal(progress.operationId, 'editable-1'); assert.equal(f.rows.NOTASPENDENTES.length, 1);
  const fields = f.rows.LANCAMENTOS[0].fields;
  assert.equal(fields.DATA, '2026-11-02T12:00:00Z'); assert.equal(fields['DATA PGTO PREVISTO'], '2026-11-10T12:00:00Z');
  assert.equal(fields['DATA PGTO EFETUADO'], '2026-11-03T12:00:00Z'); assert.equal(fields.CONTA, 'BANCO'); assert.equal(fields.ETAPA, 'ALVENARIA');
  assert.equal(f.rows.FOLHAPGTO[0].fields.IDFOLHA, 33);
});

test('resposta perdida permite corrigir pedido vazio sem criar outro pedido', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'uncertain-1', editable:true };
  f.loseOrderResponse();
  await assert.rejects(data.post(original, progress), /General exception/);
  assert.equal(progress.orderId, undefined);
  assert.equal(await data.canEditPending(original, progress), true);
  await data.post({ ...original, paymentDate:'2026-10-16' }, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
  assert.equal(f.rows.LANCAMENTOS[0].fields['DATA PGTO EFETUADO'], '2026-10-16T12:00:00Z');
});

test('pedido vazio confirmado libera todos os dados e reaproveita o ID na confirmação corrigida', async () => {
  const f = fixture(), create = f.repo.createItem;
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('lançamento rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft(suppliers), progress = { operationId:'empty-order-edit' };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  assert.equal(progress.orderId, '1');
  assert.equal(await data.canEditPending(original, progress), true);
  f.rows.CADASTROCONTA.push({ id:'9', fields:{ CONTA:'BANCO' } });
  f.rows.LANCAMENTOOBRA.push({ id:'6', fields:{ ETAPA:'ALVENARIA', FILIAL:'OBRA A' } });
  f.rows.IDFOLHA.push(...['Ana','Beto'].map((FORNECEDOR, i) => ({ id:String(33+i), fields:{ MESREFERENCIA:'11/2026', FORNECEDOR } })));
  f.repo.createItem = create;
  const corrected = { ...original, date:'2026-11-02', dueDate:'2026-11-10', paymentDate:'2026-11-03', referenceMonth:'2026-11', obs:'corrigido',
    account:{ id:'9', label:'BANCO' }, stage:{ id:'6', label:'ALVENARIA', branch:'OBRA A' },
    lines:suppliers.map(supplier => ({ supplier, quantity:4, unitValue:45 })) };
  await data.post(corrected, progress);
  await data.post(corrected, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 360);
  assert.equal(f.rows.NOTASPENDENTES[0].fields['DATA PEDIDO'], '2026-11-02T12:00:00Z');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.FORMAPGTO, 'BANCO');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.OBS, 'corrigido');
  assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE, /VALE ALIMENTAÇÃO empty-order-edit/);
  assert.equal(f.rows.LANCAMENTOS.length, 2); assert.equal(f.rows.FOLHAPGTO.length, 2);
  assert.ok(f.rows.LANCAMENTOS.every(row => row.fields.AGRUPAR === '1' && row.fields.ETAPA === 'ALVENARIA' && row.fields.CONTA === 'BANCO'
    && row.fields.DATA === '2026-11-02T12:00:00Z' && row.fields['DATA PGTO PREVISTO'] === '2026-11-10T12:00:00Z' && row.fields['DATA PGTO EFETUADO'] === '2026-11-03T12:00:00Z'));
  assert.deepEqual(f.rows.FOLHAPGTO.map(row => row.fields.IDFOLHA), [33,34]);
});

test('a tela reaberta edita pedido já criado e só grava após nova confirmação', async t => {
  const f = fixture(), create = f.repo.createItem;
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'empty-order-view' };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const storage = dom.window.localStorage, key = 'energetico:meal-voucher:pending:empty-order';
  storage.setItem(key, JSON.stringify({ draft:original, progress, files:[] }));
  const view = createMealVoucherView({ data, documentRef:doc, storage, sessionKey:'empty-order' });
  t.after(() => { view.destroy(); dom.window.close(); });
  const count = f.writes.length;
  await view.open();
  for (const name of ['meal-date','meal-due-date','meal-payment-date','meal-reference-month','meal-account','meal-stage'])
    assert.equal(doc.querySelector(`[name="${name}"]`)?.disabled, false, `${name} deve permitir edição`);
  assert.equal(f.writes.length, count, 'abrir a edição não grava dados');
  const date = doc.querySelector('[name="meal-payment-date"]'); date.value = '2026-10-16'; date.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  view.close();
  assert.equal(JSON.parse(storage.getItem(key)).progress.orderId, '1', 'a recuperação mantém o pedido original');
  await view.open();
  assert.equal(doc.querySelector('[name="meal-payment-date"]').value, '2026-10-16');
  doc.querySelector('[data-meal-next]').click(); await new Promise(setImmediate);
  doc.querySelector('[data-meal-next]').click();
  assert.equal(f.writes.length, count);
  f.repo.createItem = create;
  doc.querySelector('[data-meal-confirm]').click(); await waitForSubmission(doc);
  assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /sucesso/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
});

for (const committed of [false, true]) test(`correção retoma PATCH com resposta perdida (${committed ? 'gravado' : 'não gravado'}) e aceita nova revisão`, async () => {
  const f = fixture(), create = f.repo.createItem, update = f.repo.updateItem;
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:`patch-${committed}` };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  f.rows.NOTASPENDENTES[0].fields.OBS += '\nConferido pela auditoria';
  let lost = true;
  f.repo.updateItem = async (...args) => {
    assert.deepEqual(args[4], { eTag:'"1"' }, 'atualiza somente a versão conferida');
    if (lost) { lost = false; if (committed) await update(...args); throw new Error('resposta perdida'); }
    return update(...args);
  };
  const correction = { ...original, obs:'corrigido', date:'2026-10-16', lines:[{ supplier:suppliers[0], quantity:4, unitValue:45 }] };
  await assert.rejects(data.post(correction, progress), /resposta perdida/);
  const restored = JSON.parse(JSON.stringify(progress));
  assert.equal(await data.canEditPending(correction, restored), true);
  f.repo.createItem = create;
  const final = { ...correction, obs:'revisado novamente', date:'2026-10-17' };
  await data.post(final, restored);
  await data.post(final, restored);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 180);
  assert.equal(f.rows.NOTASPENDENTES[0].fields['DATA PEDIDO'], '2026-10-17T12:00:00Z');
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /^revisado novamente\n/);
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /Conferido pela auditoria$/);
});

test('correção retoma o mesmo PATCH não gravado sem exigir outra edição', async () => {
  const f = fixture(), create = f.repo.createItem, update = f.repo.updateItem;
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'patch-exact-retry' };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  f.repo.updateItem = async () => { throw new Error('offline'); };
  const correction = { ...original, date:'2026-10-16' };
  await assert.rejects(data.post(correction, progress), /offline/);
  f.repo.updateItem = update; f.repo.createItem = create;
  await data.post(correction, JSON.parse(JSON.stringify(progress)));
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].fields['DATA PEDIDO'], '2026-10-16T12:00:00Z');
});

test('pedido vazio com Title como FILIAL e total texto continua editável', async () => {
  const f = fixture(), create = f.repo.createItem;
  f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'FILIAL');
  f.columns.NOTASPENDENTES.find(c => c.name === 'Title').displayName = 'FILIAL';
  const total = f.columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL'); total.number = undefined; total.text = {};
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'real-columns' };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  assert.equal(await data.canEditPending(original, progress), true);
  f.repo.createItem = create;
  await data.post({ ...original, lines:[{ supplier:suppliers[0], quantity:4, unitValue:45 }] }, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].fields.Title, 'OBRA A');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, '180');
});

for (const scenario of ['lançamento sem token','folha sem progresso','pedido auditado','anexo gravado','total alterado','sem versão','consulta incompleta'])
  test(`não libera pedido vazio com ${scenario}`, async () => {
    const f = fixture(), create = f.repo.createItem;
    f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
    const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
    const original = draft([suppliers[0]]), progress = { operationId:'protected-order', editable:true };
    await assert.rejects(data.post(original, progress), /rejeitado/);
    if (scenario === 'lançamento sem token') f.rows.LANCAMENTOS.push({ id:'9', fields:{ AGRUPAR:'1' } });
    if (scenario === 'folha sem progresso') f.rows.FOLHAPGTO.push({ id:'9', fields:{ Title:'APP-vale-alimentacao-protected-order-folha-1' } });
    if (scenario === 'pedido auditado') f.rows.NOTASPENDENTES[0].fields.STATUS = 'APROVADO';
    if (scenario === 'anexo gravado') f.seedAttachment('NOTASPENDENTES', '1', 'comprovante.pdf');
    if (scenario === 'total alterado') f.rows.NOTASPENDENTES[0].fields.VALORTOTAL = 999;
    if (scenario === 'sem versão') delete f.rows.NOTASPENDENTES[0].eTag;
    if (scenario === 'consulta incompleta') f.repo.getItemsPage = async () => ({ items:[] });
    const count = f.writes.length;
    if (scenario === 'consulta incompleta') await assert.rejects(data.canEditPending(original, progress), /incompleta/);
    else assert.equal(await data.canEditPending(original, progress), false);
    await assert.rejects(data.post({ ...original, date:'2026-10-16' }, progress));
    assert.equal(f.writes.length, count);
  });

test('pedido vazio não pode ser substituído por outro pedido durante a correção', async () => {
  const f = fixture(); f.loseOrderResponse();
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'same-order' };
  await assert.rejects(data.post(original, progress), /General exception/);
  const count = f.writes.length;
  await assert.rejects(data.post({ ...original, orderMode:'existing', orderId:'99' }, progress), /não troque/i);
  assert.equal(f.writes.length, count);
});

test('permissão anterior não permite editar um lote parcialmente gravado', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft(suppliers), progress = { operationId:'partial-edit', editable:true };
  f.failSecond(); await assert.rejects(data.post(original, progress), /interrompida/);
  assert.equal(await data.canEditPending(original, progress), false);
  const count = f.writes.length;
  await assert.rejects(data.post({ ...original, date:'2026-10-16' }, progress), /não pode ser alterado/);
  assert.equal(f.writes.length, count);
  f.recover(); await data.post(original, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 2); assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test('duas instâncias não podem retomar e corrigir simultaneamente a mesma operação', async () => {
  const f = fixture(); f.loseOrderResponse();
  const data = createMealVoucherData({ repository:f.repo }), other = createMealVoucherData({ repository:f.repo });
  const { suppliers } = await data.loadOptions(), original = draft([suppliers[0]]), progress = { operationId:'concurrent-resume' };
  await assert.rejects(data.post(original, progress), /General exception/);
  const previousProgress = structuredClone(progress), getPage = f.repo.getItemsPage;
  let concurrent, armed = true;
  f.repo.getItemsPage = async (...args) => {
    if (armed && args[1] === 'FORNECEDORES') {
      armed = false;
      concurrent = other.post(original, previousProgress).then(() => 'gravou', error => error.message);
      await concurrent;
    }
    return getPage(...args);
  };
  await data.post({ ...draft([suppliers[1]]), lines:[{ supplier:suppliers[1], quantity:1, unitValue:20 }] }, progress);
  assert.match(await concurrent, /sendo enviado|outra tela/i);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].fields.FORNECEDOR, 'Beto');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 20);
  assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.LANCAMENTOS[0].fields.FORNECEDOR, 'Beto');
  assert.equal(f.rows.FOLHAPGTO.length, 1);
});

test('falha de leitura antes do PATCH mantém a revisão anterior recuperável após recriar o serviço', async () => {
  const f = fixture(); f.loseOrderResponse();
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'journal-before-read' };
  await assert.rejects(data.post(original, progress), /General exception/);
  const getPage = f.repo.getItemsPage; let orderReads = 0, persisted;
  f.repo.getItemsPage = async (...args) => { if (args[1] === 'NOTASPENDENTES' && ++orderReads === 2) throw new Error('consulta indisponível'); return getPage(...args); };
  const correction = { ...original, date:'2026-10-16' };
  await assert.rejects(data.post(correction, progress, () => { persisted = JSON.parse(JSON.stringify(progress)); }), /consulta indisponível/);
  f.repo.getItemsPage = getPage;
  const restored = createMealVoucherData({ repository:f.repo });
  assert.equal(await restored.canEditPending(correction, persisted), true);
  await restored.post(correction, persisted);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].fields['DATA PEDIDO'], '2026-10-16T12:00:00Z');
  assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
});

test('resposta perdida recupera o ID para a tela não oferecer a troca do pedido já criado', async t => {
  const f = fixture(); f.loseOrderResponse();
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'recover-order-choice' };
  await assert.rejects(data.post(original, progress), /General exception/);
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  dom.window.localStorage.setItem('energetico:meal-voucher:pending:recover-choice', JSON.stringify({ draft:original, progress, files:[] }));
  const view = createMealVoucherView({ data, documentRef:doc, storage:dom.window.localStorage, sessionKey:'recover-choice' });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  doc.querySelector('[aria-label="Voltar"]').click();
  assert.match(doc.querySelector('.meal-voucher-content').textContent, /pedido 1 já foi criado/i);
  assert.equal(doc.querySelectorAll('[data-meal-order-existing]').length, 0);
  doc.querySelector('[data-meal-order-new]').click();
  assert.equal(doc.querySelector('[name="meal-date"]').disabled, false);
});

for (const finish of [false,true]) test(`aba antiga não pode enviar fornecedores substituídos mesmo com total idêntico (${finish ? 'concluído' : 'pedido vazio'})`, async () => {
  const f = fixture(), create = f.repo.createItem;
  f.rows.FORNECEDORES.push(...['Caio','Davi'].map((CADASTRO,i) => ({ id:String(i+4), fields:{ CADASTRO, STATUS:'ATIVO', EMPREITEIRO:'SIM', FILIAL:'OBRA A', PROFISSAO:'PEDREIRO' } })));
  f.rows.IDFOLHA.push(...['Caio','Davi'].map((FORNECEDOR,i) => ({ id:String(i+44), fields:{ MESREFERENCIA:'10/2026', FORNECEDOR } })));
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft(suppliers.filter(s => ['Ana','Beto'].includes(s.label))), progress = { operationId:`stale-${finish}` };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  const stale = structuredClone(progress), correction = draft(suppliers.filter(s => ['Caio','Davi'].includes(s.label)));
  if (finish) f.repo.createItem = create;
  if (finish) await data.post(correction, progress); else await assert.rejects(data.post(correction, progress), /rejeitado/);
  const count = f.writes.length;
  f.repo.createItem = create;
  await assert.rejects(createMealVoucherData({ repository:f.repo }).post(original, stale), /versão|revisão|desatualizad/i);
  assert.equal(f.writes.length, count);
  await data.post(correction, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 30);
  assert.deepEqual(f.rows.LANCAMENTOS.map(row => row.fields.FORNECEDOR), ['Caio','Davi']);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test('retomada confere todos os itens existentes antes de criar qualquer novo item', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft(suppliers), progress = { operationId:'preflight-all' };
  f.failSecond(); await assert.rejects(data.post(original, progress), /interrompida/);
  f.rows.LANCAMENTOS[0].fields.QUANTIDADE = 99;
  f.recover();
  const count = f.writes.length;
  const reversed = { ...original, lines:[...original.lines].reverse() };
  // The same logical revision may be submitted with a different display order.
  const unchangedProgress = { ...progress, signature:JSON.stringify((await import('../src/chat/meal-voucher.js')).validateMealVoucherDraft(reversed)) };
  await assert.rejects(data.post(reversed, unchangedProgress), /dados|alterad|revisão|versão/i);
  assert.equal(f.writes.length, count, 'não grava a linha faltante antes de descobrir a divergência');
});

for (const malformed of [false,true]) test(`retomada não cria itens se ${malformed ? 'há registro sem campos' : 'pagamento antes vazio foi alterado externamente'}`, async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft(suppliers), progress = { operationId:`preflight-safe-${malformed}` };
  f.failSecond(); await assert.rejects(data.post(original, progress), /interrompida/); f.recover();
  if (malformed) f.rows.LANCAMENTOS.push({ id:'99' }); else f.rows.LANCAMENTOS[0].fields['DATA PGTO EFETUADO'] = '2026-10-16T12:00:00Z';
  const count = f.writes.length;
  await assert.rejects(data.post(original, progress), /dados|alterad|incomplet|confirmar/i);
  assert.equal(f.writes.length, count);
});

for (const action of ['confirmar','fechar']) test(`aba antiga não sobrescreve o rascunho corrigido ao ${action}`, async t => {
  const f = fixture(), create = f.repo.createItem;
  f.repo.createItem = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rejeitado'); return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:`stale-storage-${action}` };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const storage = dom.window.localStorage, key = 'energetico:meal-voucher:pending:shared-tabs';
  storage.setItem(key, JSON.stringify({ draft:original, progress, files:[] }));
  const view = createMealVoucherView({ data, documentRef:doc, storage, sessionKey:'shared-tabs' });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  doc.querySelector('[data-meal-next]').click(); await new Promise(setImmediate);
  doc.querySelector('[data-meal-next]').click();
  const corrected = { ...draft([suppliers[1]]), date:'2026-10-17' }, otherProgress = structuredClone(progress);
  await assert.rejects(createMealVoucherData({ repository:f.repo }).post(corrected, otherProgress, () => {
    storage.setItem(key, JSON.stringify({ draft:corrected, progress:otherProgress, files:[] }));
  }), /rejeitado/);
  const count = f.writes.length;
  if (action === 'confirmar') { doc.querySelector('[data-meal-confirm]').click(); await waitForSubmission(doc); }
  else view.close();
  assert.equal(f.writes.length, count);
  assert.equal(JSON.parse(storage.getItem(key)).draft.lines[0].supplier.label, 'Beto');
  view.close(); await view.open();
  assert.equal(doc.querySelector('[name="meal-date"]').value, '2026-10-17');
  assert.equal(doc.querySelector('[name="meal-date"]').disabled, false);
  doc.querySelector('[data-meal-next]').click(); await new Promise(setImmediate);
  doc.querySelector('[data-meal-next]').click();
  f.repo.createItem = create;
  doc.querySelector('[data-meal-confirm]').click(); await waitForSubmission(doc);
  assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /sucesso/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1);
  assert.equal(f.rows.LANCAMENTOS[0].fields.FORNECEDOR, 'Beto'); assert.equal(f.rows.FOLHAPGTO.length, 1);
});

test('pedido vazio da versão original com token no Title recupera edição e corrige filial sem duplicar', async t => {
  const f = fixture();
  f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'FILIAL');
  f.columns.NOTASPENDENTES.find(c => c.name === 'Title').displayName = 'FILIAL';
  f.rows.NOTASPENDENTES.push({ id:'21', fields:{ Title:'APP-vale-alimentacao-edit-legacy', FORNECEDOR:'Ana', VALORTOTAL:10,
    OBS:'outubro\nConferido pela auditoria', STATUS:'PENDENTE AUDITORIA' }, eTag:'"1"' });
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'edit-legacy', orderId:'21', signature:JSON.stringify(original) };
  assert.equal(await data.canEditPending(original, progress), true);
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  dom.window.localStorage.setItem('energetico:meal-voucher:pending:legacy', JSON.stringify({ draft:original, progress, files:[] }));
  const view = createMealVoucherView({ data, documentRef:doc, storage:dom.window.localStorage, sessionKey:'legacy' });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  assert.equal(doc.querySelector('[name="meal-date"]').disabled, false);
  const corrected = { ...original, date:'2026-10-16', paymentDate:'2026-10-16', lines:[{ supplier:suppliers[0], quantity:4, unitValue:45 }] };
  await data.post(corrected, progress); await data.post(corrected, progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.NOTASPENDENTES[0].id, '21');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.Title, 'OBRA A'); assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 180);
  assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE, /VALE ALIMENTAÇÃO edit-legacy/);
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /Conferido pela auditoria$/);
  assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.LANCAMENTOS[0].fields.AGRUPAR, '21');
  assert.equal(f.rows.FOLHAPGTO.length, 1);
});

test('compatibilidade legada não autoriza sobrescrever filial alterada para outra obra', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'legacy-other-branch', signature:JSON.stringify(original) };
  f.rows.NOTASPENDENTES.push({ id:'21', fields:{ Title:'APP-vale-alimentacao-legacy-other-branch', FILIAL:'OUTRA OBRA',
    FORNECEDOR:'Ana', VALORTOTAL:10, OBS:'outubro', STATUS:'PENDENTE AUDITORIA' }, eTag:'"1"' });
  assert.equal(await data.canEditPending(original, progress), false); assert.equal(f.writes.length, 0);
});

test('pedido legado sem OBS original preserva notas de auditoria ao liberar edição', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = { ...draft([suppliers[0]]), obs:'' }, progress = { operationId:'legacy-blank-obs', signature:JSON.stringify(original) };
  f.rows.NOTASPENDENTES.push({ id:'21', fields:{ Title:'APP-vale-alimentacao-legacy-blank-obs', FILIAL:'OBRA A',
    FORNECEDOR:'Ana', VALORTOTAL:10, OBS:'Conferido pela auditoria', STATUS:'PENDENTE AUDITORIA' }, eTag:'"1"' });
  assert.equal(await data.canEditPending(original, progress), true);
  await data.post({ ...original, date:'2026-10-16' }, progress);
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /\nConferido pela auditoria$/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
});

test('pedido existente apenas selecionado não bloqueia correção antes do primeiro lançamento', async () => {
  const f = fixture(), create = f.repo.createItem;
  f.rows.NOTASPENDENTES.push(...['98','99'].map(id => ({ id, fields:{ FILIAL:'OBRA A', FORNECEDOR:'DIVERSOS', STATUS:'PENDENTE', VALORTOTAL:100, OBS:'' }, eTag:'"1"' })));
  let rejected = false;
  f.repo.createItem = async (...args) => { if (!rejected) { rejected = true; throw new Error('dados rejeitados'); } return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = { ...draft([suppliers[0]]), orderMode:'existing', orderId:'99' }, progress = { operationId:'existing-edit' };
  await assert.rejects(data.post(original, progress), /rejeitados/);
  assert.equal(await data.canEditPending(original, progress), true);
  await data.post({ ...original, orderId:'98', paymentDate:'2026-10-16' }, progress);
  assert.equal(f.rows.NOTASPENDENTES.find(row => row.id === '99').fields.VALORTOTAL, 100);
  assert.equal(f.rows.NOTASPENDENTES.find(row => row.id === '98').fields.VALORTOTAL, 110);
  assert.equal(f.rows.LANCAMENTOS[0].fields.AGRUPAR, '98');
});

test('inspeção de edição falha fechada e identifica lançamentos sem IDs no progresso local', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'inspect-1', signature:JSON.stringify(original) };
  f.rows.LANCAMENTOS.push({ id:'3', fields:{ __PowerAppsId__:'APP-vale-alimentacao-inspect-1-1' } });
  assert.equal(await data.canEditPending(original, progress), false);
  f.rows.LANCAMENTOS.length = 0;
  f.rows.FOLHAPGTO.push({ id:'4', fields:{ Title:'APP-vale-alimentacao-inspect-1-folha-1' } });
  assert.equal(await data.canEditPending(original, progress), false);
  f.rows.FOLHAPGTO.length = 0;
  f.repo.getItemsPage = async () => { throw new Error('offline'); };
  await assert.rejects(data.canEditPending(original, progress), /offline/);
  assert.equal(f.writes.length, 0);
});

test('consulta incompleta não autoriza editar uma tentativa anterior', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo });
  f.repo.getItemsPage = async () => ({ items:[] });
  await assert.rejects(data.canEditPending(draft([]), { operationId:'incomplete', signature:JSON.stringify({ orderMode:'new' }) }), /incomplet|confirmar/i);
  assert.equal(f.writes.length, 0);
});

test('tela recupera a tentativa sem gravações e confirma pagamento corrigido no serviço real', async t => {
  const f = fixture(), create = f.repo.createItem;
  let rejected = false;
  f.repo.createItem = async (...args) => { if (!rejected) { rejected = true; throw new Error('rejeitado'); } return create(...args); };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const original = draft([suppliers[0]]), progress = { operationId:'view-data-recovery' };
  await assert.rejects(data.post(original, progress), /rejeitado/);
  const dom = new JSDOM('<body></body>', { url:'https://example.invalid' }), doc = dom.window.document;
  const storage = dom.window.localStorage, key = 'energetico:meal-voucher:pending:integration';
  storage.setItem(key, JSON.stringify({ draft:original, progress, files:[] }));
  const view = createMealVoucherView({ data, documentRef:doc, storage, sessionKey:'integration' });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  const paid = doc.querySelector('[name="meal-payment-date"]'); assert.equal(paid.disabled, false);
  paid.value = '2026-10-16'; paid.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  doc.querySelector('[data-meal-next]').click(); await new Promise(setImmediate);
  doc.querySelector('[data-meal-next]').click();
  doc.querySelector('[data-meal-confirm]').click(); await waitForSubmission(doc);
  assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /sucesso/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 1); assert.equal(f.rows.FOLHAPGTO.length, 1);
  assert.equal(f.rows.LANCAMENTOS[0].fields['DATA PGTO EFETUADO'], '2026-10-16T12:00:00Z');
  assert.equal(storage.getItem(key), null);
});

test('busca todos os fornecedores elegíveis e cria um pedido com um lançamento por fornecedor', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const options = await data.loadOptions();
  assert.deepEqual(options.suppliers.map(s => s.label), ['Ana', 'Beto']);
  const progress = { operationId: 'abc-1' };
  const result = await data.post(draft(options.suppliers), progress);
  assert.equal(result.total, 30);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.FORNECEDOR, 'DIVERSOS');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 30);
  assert.deepEqual(f.rows.LANCAMENTOS.map(row => row.fields.PRODUTO), ['PEDREIRO', 'SERVENTE']);
  assert.ok(f.rows.LANCAMENTOS.every(row => row.fields.AGRUPAR === result.orderId));
  assert.deepEqual(f.rows.FOLHAPGTO.map(row => row.fields.IDFOLHA), [11, 12]);
  assert.deepEqual(f.rows.FOLHAPGTO.map(row => row.fields.IDLANCAMENTO), result.lines.map(line => Number(line.id)));
  assert.ok(f.rows.FOLHAPGTO.every(row => row.fields.TIPOPGTO === 'VALE REFEIÇÃO'));
  assert.equal((await data.post(draft(options.suppliers), progress)).orderId, result.orderId);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test('retoma falha parcial sem duplicar pedido e lançamento', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const options = await data.loadOptions(), progress = { operationId: 'retry-1' };
  f.failSecond();
  await assert.rejects(data.post(draft(options.suppliers), progress), /rede interrompida/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.LANCAMENTOS.length, 1);
  f.recover();
  await data.post(draft(options.suppliers), progress);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test('pedido novo mantém FILIAL quando a coluna interna é Title', async () => {
  const f = fixture();
  f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'FILIAL');
  f.columns.NOTASPENDENTES.find(c => c.name === 'Title').displayName = 'FILIAL';
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const result = await data.post(draft([suppliers[0]]), { operationId: 'title-branch' });
  assert.equal(result.orderId, '1');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.Title, 'OBRA A');
  assert.equal(f.rows.LANCAMENTOS.length, 1);
});

test('retomada localiza pedido criado mesmo quando a resposta da criação se perde', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'FILIAL');
  f.columns.NOTASPENDENTES.find(c => c.name === 'Title').displayName = 'FILIAL';
  const { suppliers } = await data.loadOptions(), progress = { operationId: 'lost-order-response' };
  f.loseOrderResponse();
  await assert.rejects(data.post(draft([suppliers[0]]), progress), /General exception/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  const result = await data.post(draft([suppliers[0]]), progress);
  assert.equal(result.orderId, '1');
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.LANCAMENTOS.length, 1);
});

test('retomada de envio iniciado na versão anterior corrige a filial e não duplica pedido', async () => {
  const f = fixture();
  f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'FILIAL');
  f.columns.NOTASPENDENTES.find(c => c.name === 'Title').displayName = 'FILIAL';
  f.rows.NOTASPENDENTES.push({ id: '21', fields: { Title: 'APP-vale-alimentacao-legacy-1', FORNECEDOR: 'Ana', VALORTOTAL: 10, OBS: 'outubro', STATUS: 'PENDENTE AUDITORIA' }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const result = await data.post(draft([suppliers[0]]), { operationId: 'legacy-1' });
  assert.equal(result.orderId, '21');
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.Title, 'OBRA A');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.OBS, 'outubro');
  assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE, /VALE ALIMENTAÇÃO legacy-1/);
});

test('retomada de pedido legado preserva observações acrescentadas depois da primeira tentativa', async () => {
  const f = fixture();
  f.rows.NOTASPENDENTES.push({ id: '21', fields: { Title: 'APP-vale-alimentacao-legacy-obs', FILIAL: 'OBRA A', FORNECEDOR: 'Ana', VALORTOTAL: 10, OBS: 'outubro', STATUS: 'PENDENTE AUDITORIA' }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions(), progress = { operationId: 'legacy-obs' };
  await data.post(draft([suppliers[0]]), progress);
  f.rows.NOTASPENDENTES[0].fields.OBS += '\nConferido pela auditoria';
  await data.post(draft([suppliers[0]]), progress);
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /Conferido pela auditoria/);
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
});

test('retomada não duplica pedido quando uma automação acrescenta texto à observação', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions(), progress = { operationId: 'annotated-order' };
  f.appendOrderObs(); f.loseOrderResponse();
  await assert.rejects(data.post(draft([suppliers[0]]), progress), /General exception/);
  const result = await data.post(draft([suppliers[0]]), progress);
  assert.equal(result.orderId, '1');
  assert.equal(f.rows.NOTASPENDENTES.length, 1);
});

test('data de pagamento efetuado informada é gravada em cada lançamento', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await data.post({ ...draft(suppliers), paymentDate: '2026-10-16' }, { operationId: 'paid-date' });
  assert.deepEqual(f.rows.LANCAMENTOS.map(row => row.fields['DATA PGTO EFETUADO']), ['2026-10-16T12:00:00Z', '2026-10-16T12:00:00Z']);
});

test('novo pedido grava VALORTOTAL como texto quando a coluna real é Texto com uma linha', async () => {
  const f = fixture();
  f.columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL').number = undefined;
  f.columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL').text = {};
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await data.post(draft(suppliers), { operationId: 'text-order-total' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, '30');
  assert.equal(f.rows.LANCAMENTOS.length, 2);
});

test('pedido existente também atualiza VALORTOTAL de texto sem erro de tipo', async () => {
  const f = fixture();
  f.columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL').number = undefined;
  f.columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL').text = {};
  f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'DIVERSOS', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: '40', OBS: '' }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await data.post({ ...draft(suppliers), orderMode: 'existing', orderId: '99' }, { operationId: 'text-existing-total' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, '70');
});

test('não cria pedido ou lançamentos quando falta IDFOLHA do mês para um fornecedor', async () => {
  const f = fixture(); f.rows.IDFOLHA.pop();
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await assert.rejects(data.post(draft(suppliers), { operationId: 'missing-sheet' }), /IDFOLHA|folha/i);
  assert.equal(f.rows.NOTASPENDENTES.length, 0);
  assert.equal(f.rows.LANCAMENTOS.length, 0);
});

test('não escolhe folha ambígua quando há duas IDFOLHA no mês do fornecedor', async () => {
  const f = fixture(); f.rows.IDFOLHA.push({ id: '13', fields: { MESREFERENCIA: '2026-10', FORNECEDOR: 'Ana' } });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await assert.rejects(data.post(draft(suppliers), { operationId: 'ambiguous-sheet' }), /IDFOLHA|folha/i);
  assert.equal(f.rows.NOTASPENDENTES.length, 0);
});

test('fornecedores homônimos não podem compartilhar a mesma IDFOLHA por engano', async () => {
  const f = fixture(); f.rows.FORNECEDORES.push({ id: '4', fields: { CADASTRO: 'Ana', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PEDREIRO' } });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const duplicates = suppliers.filter(row => row.label === 'Ana');
  await assert.rejects(data.post(draft(duplicates), { operationId: 'same-name-1' }), /homônim|IDFOLHA/i);
  assert.equal(f.rows.NOTASPENDENTES.length, 0);
});

test('pedido existente incompatível não recebe lançamentos', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA B', FORNECEDOR: 'DIVERSOS', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: 0 }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await assert.rejects(data.post({ ...draft(suppliers), orderMode: 'existing', orderId: '99' }, { operationId: 'bad-1' }), /filial/i);
  assert.equal(f.rows.LANCAMENTOS.length, 0);
});

test('pedido aprovado não pode receber novos lançamentos', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'DIVERSOS', STATUS: 'APROVADO SUBMETER', VALORTOTAL: 40 }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await assert.rejects(data.post({ ...draft(suppliers), orderMode: 'existing', orderId: '99' }, { operationId: 'approved-1' }), /pendente/i);
  assert.equal(f.rows.LANCAMENTOS.length, 0);
});

test('pedido existente compatível soma o total uma única vez e mantém o mesmo ID', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'DIVERSOS', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: 40 }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const selected = { ...draft(suppliers), orderMode: 'existing', orderId: '99' }, progress = { operationId: 'existing-1' };
  const result = await data.post(selected, progress);
  assert.equal(result.orderId, '99');
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 70);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
  await data.post(selected, progress);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 70);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
});

test('contrato real dos anexos confirma o pedido e somente o último lançamento sem duplicar na retomada', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const file = new File(['abc'], 'comprovante.pdf', { type: 'application/pdf' });
  const selected = { ...draft(suppliers), files: [file] }, progress = { operationId: 'files-1' };
  await data.post(selected, progress);
  await data.post(selected, progress);
  assert.deepEqual(f.deliveries, [
    { list:'NOTASPENDENTES', id:'1', name:'comprovante.pdf' },
    { list:'LANCAMENTOS', id:'2', name:'comprovante.pdf' },
  ]);
});

test('total de pedido existente é somado com centavos exatos', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'Ana', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: 0.1 }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  await data.post({ ...draft([suppliers[0]]), lines: [{ supplier: suppliers[0], quantity: '1', unitValue: '0,20' }], orderMode: 'existing', orderId: '99' }, { operationId: 'cent-1' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 0.3);
});

test('não cria lançamento nem FOLHAPGTO para fornecedor com quantidade ou valor em branco', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const selected = draft(suppliers);
  selected.lines[1].quantity = '';
  await data.post(selected, { operationId: 'blank-1' });
  assert.deepEqual(f.rows.LANCAMENTOS.map(row => row.fields.FORNECEDOR), ['Ana']);
  assert.deepEqual(f.rows.FOLHAPGTO.map(row => row.fields.FORNECEDOR), ['Ana']);
});

test('IDFOLHA alterada durante o lote não recebe vínculo incorreto', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  f.changeSheetDuringLaunch();
  await assert.rejects(data.post(draft([suppliers[0]]), { operationId: 'sheet-race-1' }), /IDFOLHA|folha/i);
  assert.equal(f.rows.FOLHAPGTO.length, 0);
});

test('pedido existente reconcilia edição concorrente sem duplicar o acréscimo na retomada', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'DIVERSOS', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: 40, OBS: 'Original' }, eTag: '"1"' });
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const selected = { ...draft(suppliers), orderMode: 'existing', orderId: '99' };
  f.changeOrderDuringLaunch();
  await data.post(selected, { operationId: 'concurrent-1' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 75);
  await data.post(selected, { operationId: 'concurrent-1' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL, 75);
  assert.equal(f.rows.LANCAMENTOS.length, 2);
});

test('renomeação de conta ou etapa impede gravar rótulos obsoletos', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  f.rows.CADASTROCONTA[0].fields.CONTA = 'BANCO';
  await assert.rejects(data.post(draft(suppliers), { operationId: 'stale-account' }), /conta|cadastro/i);
  assert.equal(f.rows.NOTASPENDENTES.length, 0);
});

test('anexo diferente com nome já existente não é descartado silenciosamente', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id: '99', fields: { FILIAL: 'OBRA A', FORNECEDOR: 'Ana', STATUS: 'PENDENTE AUDITORIA', VALORTOTAL: 40, OBS: '' }, eTag: '"1"' });
  f.seedAttachment('NOTASPENDENTES', '99', 'comprovante.pdf');
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const file = new File(['novo'], 'comprovante.pdf', { type: 'application/pdf' });
  await assert.rejects(data.post({ ...draft([suppliers[0]]), orderMode: 'existing', orderId: '99', files: [file] }, { operationId: 'same-name' }), /nome|anexo/i);
});

test('OBS contém somente a nota humana e o controle técnico fica fora dos campos de negócio', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  await data.post({ ...draft(suppliers), obs:'PAGAMENTO VALE REFEIÇÃO EM SEMANA COMUN' }, { operationId:'clean-notes' });
  assert.equal(f.rows.NOTASPENDENTES[0].fields.OBS, 'PAGAMENTO VALE REFEIÇÃO EM SEMANA COMUN');
  assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE, /clean-notes/);
  assert.ok(f.rows.LANCAMENTOS.every(row => !/\[VALE (?:REVISÃO|ALIMENTAÇÃO)/.test(row.fields.OBS)));
});

test('resposta de upload perdida é reconciliada por conteúdo após recriar o serviço e o progresso', async () => {
  const f = fixture(), upload = f.repo.uploadAttachment;
  let lost = false;
  f.repo.uploadAttachment = async (...args) => { await upload(...args); if (!lost) { lost = true; throw new Error('resposta perdida'); } };
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const selected = { ...draft(suppliers), files:[new File(['abc'], 'comprovante.pdf', { type:'application/pdf', lastModified:0 })] };
  await data.post(selected, { operationId:'lost-upload' });
  await createMealVoucherData({ repository:f.repo }).post(selected, { operationId:'lost-upload' });
  assert.equal(f.rows.NOTASPENDENTES.length, 1); assert.equal(f.rows.LANCAMENTOS.length, 2); assert.equal(f.rows.FOLHAPGTO.length, 2);
  assert.equal(f.deliveries.length, 2);
});

test('arquivos iguais já entregues pela versão anterior são reconhecidos sem booleano local', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const file = new File(['abc'], 'comprovante.pdf', { type:'application/pdf', lastModified:0 });
  const selected = { ...draft(suppliers), files:[file] }, progress = { operationId:'legacy-file' };
  const upload = f.repo.uploadAttachment;
  f.repo.uploadAttachment = async (...args) => { if (args[1] === 'LANCAMENTOS') throw new Error('rede indisponível'); return upload(...args); };
  await assert.rejects(data.post(selected, progress), /rede/);
  delete progress.uploadedFiles; f.repo.uploadAttachment = upload;
  await createMealVoucherData({ repository:f.repo }).post(selected, progress);
  assert.equal(f.deliveries.length, 2); assert.equal(f.rows.FOLHAPGTO.length, 2);
});

test('destino final dos anexos não muda quando a mesma revisão é retomada em outra ordem', async () => {
  const f = fixture(), data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const file = new File(['abc'], 'comprovante.pdf', { type:'application/pdf', lastModified:0 });
  const selected = { ...draft(suppliers), files:[file] };
  await data.post(selected, { operationId:'stable-last' });
  await createMealVoucherData({ repository:f.repo }).post({ ...selected, lines:[...selected.lines].reverse() }, { operationId:'stable-last' });
  assert.deepEqual(f.deliveries.map(({list,id}) => ({list,id})), [{list:'NOTASPENDENTES',id:'1'},{list:'LANCAMENTOS',id:'2'}]);
});

test('schema técnico ausente bloqueia antes de gravar registros financeiros', async () => {
  const f = fixture(); f.columns.NOTASPENDENTES = f.columns.NOTASPENDENTES.filter(c => c.name !== 'VALECONTROLE');
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  await assert.rejects(data.post(draft(suppliers), { operationId:'missing-schema' }), /VALECONTROLE|controle técnico/i);
  assert.equal(f.writes.length, 0);
});

test('operações de um pedido existente retêm controles independentes sem somar novamente ao retomar', async () => {
  const f = fixture(); f.rows.NOTASPENDENTES.push({ id:'99', fields:{FILIAL:'OBRA A',FORNECEDOR:'DIVERSOS',STATUS:'PENDENTE AUDITORIA',VALORTOTAL:40,OBS:'Nota anterior'}, eTag:'"1"' });
  const data = createMealVoucherData({ repository:f.repo }), { suppliers } = await data.loadOptions();
  const selected = { ...draft(suppliers), orderMode:'existing', orderId:'99' };
  await data.post(selected, {operationId:'existing-a'}); await data.post(selected, {operationId:'existing-b'});
  await createMealVoucherData({repository:f.repo}).post(selected, {operationId:'existing-a'});
  assert.equal(f.rows.NOTASPENDENTES[0].fields.VALORTOTAL,100);
  assert.equal(f.rows.NOTASPENDENTES[0].fields.OBS,'Nota anterior');
  assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE,/existing-a/); assert.match(f.rows.NOTASPENDENTES[0].fields.VALECONTROLE,/existing-b/);
});

test('retomada migra marcadores legados da OBS sem alterar notas humanas nem repetir registros', async () => {
  const f = fixture(), data = createMealVoucherData({repository:f.repo}), {suppliers} = await data.loadOptions();
  const selected = draft(suppliers), progress = {operationId:'legacy-obs-migration'};
  await data.post(selected,progress);
  const fields = f.rows.NOTASPENDENTES[0].fields;
  fields.OBS += `\n${fields.VALECONTROLE}\nConferido pela auditoria`; delete fields.VALECONTROLE;
  await createMealVoucherData({repository:f.repo}).post(selected,JSON.parse(JSON.stringify(progress)));
  assert.equal(fields.OBS,'outubro\nConferido pela auditoria'); assert.match(fields.VALECONTROLE,/legacy-obs-migration/);
  assert.equal(f.rows.NOTASPENDENTES.length,1); assert.equal(f.rows.LANCAMENTOS.length,2); assert.equal(f.rows.FOLHAPGTO.length,2);
});

for (const committed of [false,true]) test(`journal de PATCH legado permanece recuperável (${committed ? 'gravado' : 'não gravado'}) sem códigos na OBS`, async () => {
  const f=fixture(),create=f.repo.createItem,update=f.repo.updateItem;
  f.repo.createItem=async(...args)=>{if(args[1]==='LANCAMENTOS')throw new Error('lançamento rejeitado');return create(...args);};
  const data=createMealVoucherData({repository:f.repo}),{suppliers}=await data.loadOptions();
  const original=draft(suppliers),progress={operationId:`old-edit-${committed}`};
  await assert.rejects(data.post(original,progress),/rejeitado/);
  let lose=true;f.repo.updateItem=async(...args)=>{if(lose){lose=false;if(committed)await update(...args);throw new Error('PATCH perdido');}return update(...args);};
  const correction={...original,date:'2026-10-16'};
  await assert.rejects(data.post(correction,progress),/PATCH perdido/);
  const legacy=fields=>{const copy={...fields};copy.OBS=`${copy.OBS}${copy.OBS ? '\n' : ''}${copy.VALECONTROLE}`;delete copy.VALECONTROLE;return copy;};
  f.rows.NOTASPENDENTES[0].fields=legacy(f.rows.NOTASPENDENTES[0].fields);
  for(const phase of ['before','after']){progress.orderEdit[phase]=legacy(progress.orderEdit[phase]);progress.orderEdit[`${phase}Obs`]=progress.orderEdit[phase].OBS;}
  f.repo.createItem=create;f.repo.updateItem=update;
  const resumed=createMealVoucherData({repository:f.repo});
  assert.equal(await resumed.canEditPending(correction,progress),true);
  await resumed.post(correction,progress);
  assert.equal(f.rows.NOTASPENDENTES.length,1);assert.equal(f.rows.NOTASPENDENTES[0].fields.OBS,'outubro');
  assert.equal(f.rows.NOTASPENDENTES[0].fields['DATA PEDIDO'],'2026-10-16T12:00:00Z');assert.equal(f.rows.FOLHAPGTO.length,2);
});

test('leituras de itens selecionam explicitamente o campo oculto antes de reconciliar o pedido', async () => {
  const f=fixture(),page=f.repo.getItemsPage,get=f.repo.getItem,columns=f.repo.getColumns,queries=[];
  f.repo.getColumns=async(site,list,options)=>{if(list==='NOTASPENDENTES')assert.equal(options.includeHidden,true);return columns(site,list,options);};
  f.repo.getItemsPage=async(...args)=>{if(args[1]==='NOTASPENDENTES'){queries.push(args[2]);assert.match(args[2],/fields\(\$select=[^)]*VALECONTROLE/);}return page(...args);};
  f.repo.getItem=async(...args)=>{if(args[1]==='NOTASPENDENTES'){queries.push(args[3]);assert.match(args[3],/fields\(\$select=[^)]*VALECONTROLE/);}return get(...args);};
  const data=createMealVoucherData({repository:f.repo}),{suppliers}=await data.loadOptions();await data.post(draft(suppliers),{operationId:'explicit-hidden'});
  assert.ok(queries.length>2);
});
