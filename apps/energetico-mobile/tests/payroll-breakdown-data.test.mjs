import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollBreakdownData } from '../src/chat/payroll-breakdown-data.js';

function fixture() {
  const common = ['Title','FILIAL','FORNECEDOR','VALORTOTAL','FORMAPGTO','OBS','DATAPREVISTOPGTO','DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO'];
  const names = { FORNECEDORES: ['CADASTRO','STATUS','EMPREITEIRO','FILIAL','PROFISSAO'], DESCRITIVOPROVISAO: common, 'PROVISÃO PGTOS': [...common,'PRODUTO','QTD','FRETE','ETAPA','STATUS','TIPOPGTO','DESCRITIVOPROVISAO'] };
  const columns = Object.fromEntries(Object.entries(names).map(([name, fields]) => [name, fields.map(label => ({ name: label, displayName: label, ...label.startsWith('DATA') ? { dateTime: {} } : { text: {} } }))]));
  const supplier = { id: '1', fields: { CADASTRO: 'Ana', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PEDREIRO' } };
  const rows = { FORNECEDORES: [supplier, { id: '2', fields: { ...supplier.fields, CADASTRO: 'Beto', STATUS: 'INATIVO' } }, { id: '3', fields: { ...supplier.fields, CADASTRO: 'Caio', EMPREITEIRO: 'NÃO' } }], DESCRITIVOPROVISAO: [], 'PROVISÃO PGTOS': [] };
  const writes = []; let failChild = false, loseResponse = false, stop = false, hideSaved = false;
  const repo = {
    resolveList: async (_site, aliases) => ({ status: 'resolved', id: aliases[0] }),
    getColumns: async (_site, list) => columns[list],
    getItemsPage: async (_site, list, _query, options) => options.cursor ? { items: rows[list].slice(1), hasMore: false } : { items: rows[list].slice(0, 1), hasMore: rows[list].length > 1, nextLink: 'next' },
    getItems: async (_site, list) => structuredClone(hideSaved ? [] : rows[list]),
    getItem: async (_site, list, id) => structuredClone(rows[list].find(row => row.id === String(id))),
    createItem: async (_site, list, fields) => {
      if (failChild && list === 'PROVISÃO PGTOS') throw Object.assign(new Error('Falha de validação'), { status: 400 });
      const row = { id: String(rows[list].length + 1), fields: { ...fields } }; rows[list].push(row); writes.push({ list, fields });
      if (loseResponse) { loseResponse = false; throw new Error('Resposta perdida'); }
      return structuredClone(row);
    },
  };
  const data = createPayrollBreakdownData({ repository: repo, assertSession: () => { if (stop) throw new Error('Sessão encerrada'); } });
  return { repo, data, rows, columns, writes, fail: () => { failChild = true; }, recover: () => { failChild = false; }, lose: () => { loseResponse = true; }, stop: () => { stop = true; }, hide: value => { hideSaved = value; } };
}
const draft = supplier => ({ supplier, month: '2026-10', lines: [
  { date: '2026-10-02', rubric: 'salary', quantity: '5', unitValue: '100' },
  { date: '2026-10-09', rubric: 'meal', quantity: '4', unitValue: '45' },
  { date: '2026-10-31', rubric: 'thirteenth', quantity: '1', unitValue: '1000' },
  { date: '2026-10-31', rubric: 'vacation', quantity: '1', unitValue: '' },
] });

test('prepara somente o acesso Graph usado pelas provisões', async () => {
  const f = fixture(), requests = [];
  const data = createPayrollBreakdownData({ repository: f.repo, tokenProvider: async scopes => { requests.push(scopes); return 'token'; } });
  await data.prepare(); assert.deepEqual(requests, [['Sites.Read.All','Sites.ReadWrite.All']]); assert.equal(f.writes.length, 0);
});

test('consulta fornecedores elegíveis em todas as páginas e cria um descritivo por provisão', async () => {
  const f = fixture();
  f.rows.FORNECEDORES.push({ id: '4', fields: { ...f.rows.FORNECEDORES[0].fields, CADASTRO: 'Dani' } });
  const suppliers = await f.data.loadSuppliers(); assert.deepEqual(suppliers.map(s => s.label), ['Ana', 'Dani']);
  const progress = { operationId: 'operation-one' }, result = await f.data.post(draft(suppliers[0]), progress);
  assert.equal(result.total, 1680); assert.equal(result.lines.length, 3);
  const parents = f.rows.DESCRITIVOPROVISAO, children = f.rows['PROVISÃO PGTOS'];
  assert.equal(parents.length, 3); assert.equal(children.length, 3);
  assert.deepEqual(parents.map(p => p.fields.VALORTOTAL), ['500','180','1000']);
  assert.deepEqual(children.map(p => p.fields.VALORTOTAL), ['100','45','1000']);
  assert.deepEqual(children.map(p => p.fields.DESCRITIVOPROVISAO), ['1','2','3']);
  for (const row of children) {
    assert.equal(row.fields.FILIAL, 'OBRA A'); assert.equal(row.fields.PRODUTO, 'PEDREIRO'); assert.equal(row.fields.ETAPA, ''); assert.equal(row.fields.FORMAPGTO, '');
    assert.equal(row.fields.DATAPGTOEFETUADO, null); assert.equal(row.fields.STATUS, 'PAGAMENTO PREVISTO'); assert.equal(row.fields.FRETE, '0');
  }
  assert.equal(children[0].fields.DATAPREVISTOPGTO, '2026-10-02T00:00:00Z');
  assert.equal(children[1].fields.OBS, 'Pagamento de Vale alimentação referente à semana anterior à data 09/10/2026');
  await f.data.post(draft(suppliers[0]), progress); assert.equal(f.writes.length, 6);
});

test('mapeia nomes internos e tipos numéricos e preserva campos vazios em escolhas', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0];
  for (const list of ['DESCRITIVOPROVISAO', 'PROVISÃO PGTOS']) {
    const total = f.columns[list].find(c => c.name === 'VALORTOTAL'); delete total.text; total.currency = {}; total.name = 'Valor_x0020_total';
    const payment = f.columns[list].find(c => c.name === 'FORMAPGTO'); delete payment.text; payment.choice = { choices: ['PIX', 'DINHEIRO'] };
  }
  const result = await f.data.post(draft(supplier), { operationId: 'metadata' });
  assert.equal(result.total, 1680);
  assert.equal(f.rows.DESCRITIVOPROVISAO[0].fields.Valor_x0020_total, 500);
  assert.equal(f.rows['PROVISÃO PGTOS'][0].fields.Valor_x0020_total, 100);
  assert.equal(f.rows['PROVISÃO PGTOS'][0].fields.FORMAPGTO, '');
});

test('retoma falha parcial sem recriar descritivo e bloqueia edição do lote iniciado', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], progress = { operationId: 'partial' }; let snapshots = [];
  f.fail(); await assert.rejects(f.data.post(draft(supplier), progress, () => snapshots.push(structuredClone(progress))), /validação/);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1); assert.equal(f.rows['PROVISÃO PGTOS'].length, 0);
  assert.ok(snapshots.some(p => p.lines?.['2026-10-02:salary']?.parent.attempted));
  const changed = draft(supplier); changed.lines[0].unitValue = '90';
  await assert.rejects(f.data.post(changed, progress), /não pode ser alterado/);
  f.recover(); await f.data.post(draft(supplier), JSON.parse(JSON.stringify(progress)));
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 3); assert.equal(f.rows['PROVISÃO PGTOS'].length, 3);
});

test('recupera resposta perdida sem duplicar, inclusive com leitura ainda não consistente', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], progress = { operationId: 'lost-response' };
  f.lose(); f.hide(true); await assert.rejects(f.data.post(draft(supplier), progress), /Resposta perdida/);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1);
  await assert.rejects(f.data.post(draft(supplier), progress), /pendente/); assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1);
  f.hide(false); await f.data.post(draft(supplier), progress);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 3); assert.equal(f.rows['PROVISÃO PGTOS'].length, 3);
});

test('revalida fornecedor e todos os metadados antes de gravar qualquer linha', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0];
  f.rows.FORNECEDORES[0].fields.STATUS = 'INATIVO';
  await assert.rejects(f.data.post(draft(supplier), { operationId: 'inactive' }), /fornecedor/);
  f.rows.FORNECEDORES[0].fields.STATUS = 'ATIVO'; f.columns['PROVISÃO PGTOS'] = f.columns['PROVISÃO PGTOS'].filter(c => c.name !== 'QTD');
  await assert.rejects(f.data.post(draft(supplier), { operationId: 'bad-schema' }), /QTD/); assert.equal(f.writes.length, 0);
});

test('sessão encerrada entre as gravações impede as próximas e persiste recuperação', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem;
  f.repo.createItem = async (...args) => { const result = await create(...args); f.stop(); return result; };
  const progress = { operationId: 'session' };
  await assert.rejects(f.data.post(draft(supplier), progress), /Sessão/);
  assert.equal(f.writes.length, 1); assert.equal(progress.lines['2026-10-02:salary'].parent.attempted, true);
});

test('rejeição explícita de limite de requisições permite retomar o POST sem duplicar os itens anteriores', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem;
  let throttled = true;
  f.repo.createItem = async (...args) => {
    if (throttled && args[1] === 'PROVISÃO PGTOS') throw Object.assign(new Error('Limite de requisições'), { status: 429 });
    return create(...args);
  };
  const progress = { operationId: 'throttled' };
  await assert.rejects(f.data.post(draft(supplier), progress), /Limite/);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 1); assert.equal(progress.lines['2026-10-02:salary'].child.attempted, false);
  throttled = false; await f.data.post(draft(supplier), JSON.parse(JSON.stringify(progress)));
  assert.equal(f.rows.DESCRITIVOPROVISAO.length, 3); assert.equal(f.rows['PROVISÃO PGTOS'].length, 3);
});
