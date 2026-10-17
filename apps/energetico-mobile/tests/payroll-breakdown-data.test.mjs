import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollBreakdownData } from '../src/chat/payroll-breakdown-data.js';

function fixture() {
  const common = ['Title','FOLHAOPERACAO','FILIAL','FORNECEDOR','VALORTOTAL','FORMAPGTO','OBS','DATAPREVISTOPGTO','DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO'];
  const names = { FORNECEDORES: ['CADASTRO','STATUS','EMPREITEIRO','FILIAL','PROFISSAO'], IDFOLHA: ['FORNECEDOR','MESREFERENCIA'], FOLHAPGTO: ['Title','FORNECEDOR','TIPOPGTO','VALORUNITARIO','QTD','DATA','IDFOLHA','IDLANCAMENTO','IDPROVISAO'], DESCRITIVOPROVISAO: common, 'PROVISÃO PGTOS': [...common,'PRODUTO','QTD','FRETE','ETAPA','STATUS','TIPOPGTO','DESCRITIVOPROVISAO','IDFOLHA'] };
  const columns = Object.fromEntries(Object.entries(names).map(([name, fields]) => [name, fields.map(label => ({ name: label, displayName: label, ...label.startsWith('DATA') ? { dateTime: {} } : { text: {} } }))]));
  Object.assign(columns.FOLHAPGTO.find(c => c.name === 'IDPROVISAO'), { enforceUniqueValues: true, indexed: true });
  for (const list of ['DESCRITIVOPROVISAO','PROVISÃO PGTOS']) Object.assign(columns[list].find(c=>c.name==='FOLHAOPERACAO'), { enforceUniqueValues:true, indexed:true });
  const supplier = { id: '1', fields: { CADASTRO: 'Ana', STATUS: 'ATIVO', EMPREITEIRO: 'SIM', FILIAL: 'OBRA A', PROFISSAO: 'PEDREIRO' } };
  const rows = { FORNECEDORES: [supplier, { id: '2', fields: { ...supplier.fields, CADASTRO: 'Beto', STATUS: 'INATIVO' } }, { id: '3', fields: { ...supplier.fields, CADASTRO: 'Caio', EMPREITEIRO: 'NÃO' } }], DESCRITIVOPROVISAO: [], 'PROVISÃO PGTOS': [] };
  rows.IDFOLHA = [{ id: '19', fields: { FORNECEDOR: 'Ana', MESREFERENCIA: '10/2026' } }]; rows.FOLHAPGTO = [];
  const writes = []; let failChild = false, loseResponse = false, stop = false, hideSaved = false;
  const repo = {
    resolveList: async (_site, aliases) => ({ status: 'resolved', id: aliases[0] }),
    getColumns: async (_site, list) => columns[list],
    getItemsPage: async (_site, list, _query, options) => options.cursor ? { items: rows[list].slice(1), hasMore: false } : { items: rows[list].slice(0, 1), hasMore: rows[list].length > 1, nextLink: 'next' },
    getItems: async (_site, list) => structuredClone(hideSaved && list !== 'IDFOLHA' ? [] : rows[list]),
    getItem: async (_site, list, id) => structuredClone(rows[list].find(row => row.id === String(id))),
    createItem: async (_site, list, fields) => {
      if (fields.FOLHAOPERACAO && rows[list].some(row=>row.fields.FOLHAOPERACAO===fields.FOLHAOPERACAO)) throw Object.assign(new Error('Operação duplicada'),{status:400});
      if (list === 'FOLHAPGTO' && fields.IDPROVISAO && rows[list].some(row => row.fields.IDPROVISAO === fields.IDPROVISAO)) throw Object.assign(new Error('IDPROVISAO duplicado'), { status: 400 });
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

test('preparação cria IDFOLHA opcional somente quando ausente e confirma o esquema sem registros financeiros', async () => {
  const f = fixture(), requests = [];
  f.columns['PROVISÃO PGTOS'] = f.columns['PROVISÃO PGTOS'].filter(c => c.name !== 'IDFOLHA');
  f.repo.resolveSites = async () => ({ personal: { id: 'site-id' } }); f.repo.clearCache = () => {};
  const data = createPayrollBreakdownData({ repository: f.repo, schemaGraph: { request: async (path, options) => {
    requests.push([path, options]); f.columns['PROVISÃO PGTOS'].push({ name: 'IDFOLHA', displayName: 'IDFOLHA', number: { decimalPlaces: 'none' } });
  } } });
  await data.prepare(); await data.prepare();
  assert.equal(requests.length, 1); assert.equal(requests[0][1].method, 'POST');
  assert.equal(requests[0][1].body.name, 'IDFOLHA'); assert.equal(requests[0][1].body.required, false);
  assert.deepEqual(requests[0][1].scopes, ['Sites.Manage.All']); assert.equal(f.writes.length, 0);
});

test('preparação confirma o vínculo exclusivo de origem no servidor antes de permitir pagamentos', async () => {
  const f = fixture(), requests = [];
  f.columns.FOLHAPGTO = f.columns.FOLHAPGTO.filter(c => c.name !== 'IDPROVISAO');
  f.repo.resolveSites = async () => ({ personal: { id: 'site-id' } }); f.repo.clearCache = () => {};
  const graph = { request: async (_path, options) => {
    requests.push(options.body); f.columns.FOLHAPGTO.push({ ...options.body });
  } };
  const data = createPayrollBreakdownData({ repository: f.repo, schemaGraph: graph });
  await data.prepare(); await data.prepare();
  assert.equal(requests.length,1); assert.equal(requests[0].name,'IDPROVISAO'); assert.equal(requests[0].enforceUniqueValues,true);
  assert.equal(requests[0].indexed,true); assert.equal(requests[0].required,false); assert.equal(f.writes.length,0);
  f.columns.FOLHAPGTO.find(c=>c.name==='IDPROVISAO').enforceUniqueValues = false;
  await assert.rejects(data.prepare(), /exclusivos/);
  const supplier = (await data.loadSuppliers())[0];
  await assert.rejects(data.post(draft(supplier), { operationId:'non-unique' }), /exclusivos/);
  assert.equal(f.writes.length,0);
});

test('migração prepara todos os vínculos, recupera resposta perdida e não escreve registros financeiros', async () => {
  const f=fixture(), requests=[];
  for(const [list,name] of [['PROVISÃO PGTOS','IDFOLHA'],['FOLHAPGTO','IDPROVISAO'],['DESCRITIVOPROVISAO','FOLHAOPERACAO'],['PROVISÃO PGTOS','FOLHAOPERACAO']]) f.columns[list]=f.columns[list].filter(c=>c.name!==name);
  f.repo.resolveSites=async()=>({personal:{id:'site-id'}});f.repo.clearCache=()=>{};
  const data=createPayrollBreakdownData({repository:f.repo,schemaGraph:{request:async(path,options)=>{
    requests.push(options.body);const list=decodeURIComponent(path.split('/').at(-2));f.columns[list].push({...options.body});
    throw new Error('Resposta perdida');
  }}});
  await data.prepare();await data.prepare();assert.equal(requests.length,4);
  assert.equal(requests.filter(body=>body.enforceUniqueValues).length,3);assert.equal(f.writes.length,0);
});

test('sem permissão para criar coluna, a preparação falha antes de qualquer registro financeiro', async () => {
  const f=fixture();f.columns['PROVISÃO PGTOS']=f.columns['PROVISÃO PGTOS'].filter(c=>c.name!=='IDFOLHA');
  f.repo.resolveSites=async()=>({personal:{id:'site-id'}});f.repo.clearCache=()=>{};
  const data=createPayrollBreakdownData({repository:f.repo,schemaGraph:{request:async()=>{throw Object.assign(new Error('Sem permissão'),{status:403});}}});
  await assert.rejects(data.prepare(),/Sem permissão/);assert.equal(f.writes.length,0);
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
  await f.data.post(draft(suppliers[0]), progress); assert.equal(f.writes.length, 9);
});

test('vincula cada provisão à folha e cria uma única linha de pagamento pendente recuperável', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], progress = { operationId: 'linked' };
  await f.data.post(draft(supplier), progress);
  assert.deepEqual(f.rows['PROVISÃO PGTOS'].map(row => row.fields.IDFOLHA), ['19','19','19']);
  assert.equal(f.rows.FOLHAPGTO.length, 3);
  assert.deepEqual(f.rows.FOLHAPGTO.map(row => row.fields.Title), ['APP-folha-provisao-1','APP-folha-provisao-2','APP-folha-provisao-3']);
  assert.ok(f.rows.FOLHAPGTO.every(row => row.fields.IDFOLHA === '19' && !row.fields.IDLANCAMENTO));
  await f.data.post(draft(supplier), JSON.parse(JSON.stringify(progress)));
  assert.equal(f.rows.FOLHAPGTO.length, 3);
});

test('folha ausente ou ambígua e coluna IDFOLHA ausente impedem qualquer gravação financeira', async () => {
  for (const setup of [f => { f.rows.IDFOLHA = []; }, f => { f.rows.IDFOLHA.push({ ...f.rows.IDFOLHA[0], id: '20' }); }, f => { f.columns['PROVISÃO PGTOS'] = f.columns['PROVISÃO PGTOS'].filter(c => c.name !== 'IDFOLHA'); }]) {
    const f = fixture(), supplier = (await f.data.loadSuppliers())[0]; setup(f);
    await assert.rejects(f.data.post(draft(supplier), { operationId: 'invalid-sheet' }), /folha|IDFOLHA/i);
    assert.equal(f.writes.length, 0);
  }
});

test('resposta perdida no vínculo de pagamento retoma sem duplicar provisão ou pagamento', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem, progress = { operationId: 'lost-payment' };
  let lose = true;
  f.repo.createItem = async (...args) => { const saved = await create(...args); if (lose && args[1] === 'FOLHAPGTO') { lose = false; throw new Error('Resposta perdida'); } return saved; };
  await f.data.post(draft(supplier), progress);
  await f.data.post(draft(supplier), JSON.parse(JSON.stringify(progress)));
  assert.equal(f.rows.FOLHAPGTO.length, 3); assert.equal(f.rows['PROVISÃO PGTOS'].length, 3);
});

test('duas retomadas simultâneas não duplicam o pagamento da mesma provisão', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem, progress = { operationId: 'parallel-recovery' };
  let fail = true;
  f.repo.createItem = async (...args) => { if (fail && args[1] === 'FOLHAPGTO') throw Object.assign(new Error('Recusado'), { status: 400 }); return create(...args); };
  const one = draft(supplier); one.lines = one.lines.slice(0,1);
  await assert.rejects(f.data.post(one, progress), /Recusado/); fail = false;
  const get = f.repo.getItems; let reads = 0, release;
  const bothRead = new Promise(resolve => { release = resolve; });
  f.repo.getItems = async (...args) => {
    const snapshot = await get(...args);
    if (args[1] === 'FOLHAPGTO' && ++reads <= 2) { if (reads === 2) release(); await bothRead; }
    return snapshot;
  };
  const second = createPayrollBreakdownData({ repository: f.repo });
  await Promise.all([f.data.post(one, structuredClone(progress)), second.post(one, structuredClone(progress))]);
  assert.equal(f.rows.FOLHAPGTO.length, 1); assert.equal(f.rows.FOLHAPGTO[0].fields.IDPROVISAO, '1');
});

test('duas retomadas simultâneas antes da primeira criação preservam uma provisão e um descritivo por linha', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem, progress = { operationId:'parallel-source' };
  const one = draft(supplier); one.lines = one.lines.slice(0,1); let fail = true;
  f.repo.createItem = async (...args) => { if (fail) throw Object.assign(new Error('Recusado'),{status:400}); return create(...args); };
  await assert.rejects(f.data.post(one,progress), /Recusado/); fail = false;
  const get=f.repo.getItems, gates=new Map();
  for(const list of ['DESCRITIVOPROVISAO','PROVISÃO PGTOS']) { let release; const promise=new Promise(resolve=>{release=resolve;}); gates.set(list,{reads:0,promise,release}); }
  f.repo.getItems=async(...args)=>{const snapshot=await get(...args),gate=gates.get(args[1]);if(gate&&++gate.reads<=2){if(gate.reads===2)gate.release();await gate.promise;}return snapshot;};
  await Promise.all([f.data.post(one,structuredClone(progress)),createPayrollBreakdownData({repository:f.repo}).post(one,structuredClone(progress))]);
  assert.equal(f.rows.DESCRITIVOPROVISAO.length,1);assert.equal(f.rows['PROVISÃO PGTOS'].length,1);assert.equal(f.rows.FOLHAPGTO.length,1);
});

test('trocar a folha após a conferência impede gravar em outra referência silenciosamente', async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0];
  await assert.rejects(f.data.post(draft(supplier), { operationId: 'changed-sheet', sheetId: '20' }), /folha vinculada mudou/i);
  assert.equal(f.writes.length, 0);
});

for (const settled of [true, false]) test(`${settled ? 'baixa' : 'agendamento'} durante falha parcial permite recuperar a mesma linha da folha`, async () => {
  const f = fixture(), supplier = (await f.data.loadSuppliers())[0], create = f.repo.createItem, progress = { operationId: 'paid-during-recovery' };
  let fail = true;
  f.repo.createItem = async (...args) => { if (fail && args[1] === 'FOLHAPGTO') throw Object.assign(new Error('Recusado'), { status: 400 }); return create(...args); };
  await assert.rejects(f.data.post(draft(supplier), progress), /Recusado/);
  for (const row of [f.rows.DESCRITIVOPROVISAO[0], f.rows['PROVISÃO PGTOS'][0]]) {
    row.fields[settled ? 'DATAPGTOEFETUADO' : 'DATAPGTOAGENDADO'] = '2026-10-02T00:00:00Z'; row.fields.FORMAPGTO = 'PIX';
  }
  f.rows['PROVISÃO PGTOS'][0].fields.PGTOAGENDADO = settled ? 'PAGO' : 'AGENDADO';
  fail = false; await f.data.post(draft(supplier), progress);
  assert.equal(f.rows.FOLHAPGTO.length, 3); assert.equal(f.rows['PROVISÃO PGTOS'].length, 3);
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

test('lista de provisões sem TIPOPGTO mantém rubrica no pagamento da folha', async () => {
  const f=fixture(), supplier=(await f.data.loadSuppliers())[0];
  f.columns['PROVISÃO PGTOS']=f.columns['PROVISÃO PGTOS'].filter(c=>c.name!=='TIPOPGTO');
  await f.data.post(draft(supplier),{operationId:'optional-payment-type'});
  assert.deepEqual(f.rows.FOLHAPGTO.map(row=>row.fields.TIPOPGTO),['SALÁRIO','VALE REFEIÇÃO','13 SALÁRIO']);
  assert.ok(f.rows['PROVISÃO PGTOS'].every(row=>row.fields.IDFOLHA==='19'));
});
