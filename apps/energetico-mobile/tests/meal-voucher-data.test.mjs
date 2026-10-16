import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealVoucherData } from '../src/chat/meal-voucher-data.js';

function fixture() {
  const names = {
    FORNECEDORES: ['CADASTRO','STATUS','EMPREITEIRO','FILIAL','PROFISSAO'],
    CADASTROCONTA: ['CONTA'], LANCAMENTOOBRA: ['ETAPA','FILIAL'],
    IDFOLHA: ['MESREFERENCIA','FORNECEDOR'], FOLHAPGTO: ['Title','FORNECEDOR','TIPOPGTO','VALORUNITARIO','QTD','DATA','IDFOLHA','IDLANCAMENTO'],
    NOTASPENDENTES: ['Title','FILIAL','FORNECEDOR','VALORTOTAL','DATA PEDIDO','STATUS','OBS','FORMAPGTO','NOTA FISCAL'],
    LANCAMENTOS: ['__PowerAppsId__','AGRUPAR','FILIAL','TIPO TRANSAÇÃO','DATA','DATA PGTO PREVISTO','DATA PGTO EFETUADO','FORNECEDOR','PRODUTO','ETAPA','QUANTIDADE','VALOR UNITÁRIO','CONTA','FRETE','OBS'],
  };
  const columns = Object.fromEntries(Object.entries(names).map(([list, labels]) => [list, labels.map(label => ({ name: label, displayName: label, ...(/DATA/.test(label) ? { dateTime: {} } : list === 'NOTASPENDENTES' && label === 'VALORTOTAL' ? { number: {} } : { text: {} }) }))]));
  const rows = { FORNECEDORES: [
    { id: '1', fields: { CADASTRO: 'Ana', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PEDREIRO' } },
    { id: '2', fields: { CADASTRO: 'Beto', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'SERVENTE' } },
    { id: '3', fields: { CADASTRO: 'Caio', STATUS: 'INATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PINTOR' } },
  ], CADASTROCONTA: [{ id: '8', fields: { CONTA: 'CAIXA' } }], LANCAMENTOOBRA: [{ id: '7', fields: { ETAPA: 'FUNDAÇÃO', FILIAL: 'OBRA A' } }],
  IDFOLHA: [{ id: '11', fields: { MESREFERENCIA: '10/2026', FORNECEDOR: 'Ana' } }, { id: '12', fields: { MESREFERENCIA: '10/2026', FORNECEDOR: 'Beto' } }],
  FOLHAPGTO: [], NOTASPENDENTES: [], LANCAMENTOS: [] };
  const writes = [], uploads = [];
  let failSecond = false, changeSheetDuringLaunch = false, changeOrderDuringLaunch = false, loseOrderResponse = false, appendOrderObs = false;
  const repo = {
    resolveList: async (_site, aliases) => ({ status: 'resolved', id: aliases[0] }),
    getColumns: async (_site, list) => columns[list],
    getItemsPage: async (_site, list) => ({ items: rows[list], hasMore: false }),
    getItem: async (_site, list, id) => rows[list].find(row => row.id === String(id)),
    createItem: async (_site, list, fields) => { if (failSecond && list === 'LANCAMENTOS' && rows.LANCAMENTOS.length === 1) throw new Error('rede interrompida'); if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'Title')?.displayName === 'FILIAL' && fields.Title !== 'OBRA A') throw new Error('General exception while processing'); if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL')?.text && typeof fields.VALORTOTAL !== 'string') throw new Error('General exception while processing'); const row = { id: String(rows[list].length + (list === 'FORNECEDORES' ? 10 : 1)), fields: { ...fields }, eTag: '"1"' }; rows[list].push(row); writes.push({ list, fields }); if (appendOrderObs && list === 'NOTASPENDENTES') row.fields.OBS += '\nAuditado automaticamente'; if (loseOrderResponse && list === 'NOTASPENDENTES') { loseOrderResponse = false; throw new Error('General exception while processing'); } if (changeSheetDuringLaunch && list === 'LANCAMENTOS') rows.IDFOLHA[0].fields.MESREFERENCIA = '11/2026'; if (changeOrderDuringLaunch && list === 'LANCAMENTOS') { rows.NOTASPENDENTES[0].fields.VALORTOTAL = 45; changeOrderDuringLaunch = false; } return row; },
    updateItem: async (_site, list, id, fields) => { if (list === 'NOTASPENDENTES' && columns.NOTASPENDENTES.find(c => c.name === 'VALORTOTAL')?.text && fields.VALORTOTAL !== undefined && typeof fields.VALORTOTAL !== 'string') throw new Error('General exception while processing'); const row = rows[list].find(item => item.id === String(id)); Object.assign(row.fields, fields); writes.push({ list, fields, update: true }); return row; },
    listAttachments: async () => uploads.map(fileName => ({ fileName })),
    uploadAttachment: async (_site, _list, _id, file) => { uploads.push(file.name); },
  };
  return { repo, columns, rows, writes, uploads, failSecond: () => { failSecond = true; }, recover: () => { failSecond = false; }, loseOrderResponse: () => { loseOrderResponse = true; }, appendOrderObs: () => { appendOrderObs = true; }, changeSheetDuringLaunch: () => { changeSheetDuringLaunch = true; }, changeOrderDuringLaunch: () => { changeOrderDuringLaunch = true; } };
}
const draft = suppliers => ({ date: '2026-10-15', dueDate: '2026-10-30', referenceMonth: '2026-10', stage: { id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }, account: { id: '8', label: 'CAIXA' }, orderMode: 'new', obs: 'outubro', files: [], lines: suppliers.map((supplier, index) => ({ supplier, quantity: '1', unitValue: index ? '20' : '10' })) });

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
  assert.match(f.rows.NOTASPENDENTES[0].fields.OBS, /VALE ALIMENTAÇÃO legacy-1/);
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

test('anexos são vinculados ao pedido e retomada não duplica arquivo', async () => {
  const f = fixture(), data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const file = new File(['abc'], 'comprovante.pdf', { type: 'application/pdf' });
  const selected = { ...draft(suppliers), files: [file] }, progress = { operationId: 'files-1' };
  await data.post(selected, progress);
  await data.post(selected, progress);
  assert.deepEqual(f.uploads, ['comprovante.pdf']);
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
  f.uploads.push('comprovante.pdf');
  const data = createMealVoucherData({ repository: f.repo });
  const { suppliers } = await data.loadOptions();
  const file = new File(['novo'], 'comprovante.pdf', { type: 'application/pdf' });
  await assert.rejects(data.post({ ...draft([suppliers[0]]), orderMode: 'existing', orderId: '99', files: [file] }, { operationId: 'same-name' }), /nome|anexo/i);
});
