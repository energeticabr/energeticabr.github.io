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

test('prepara Graph e anexos SharePoint antes de abrir o formulário', async () => {
  const f = fixture(), requests = [];
  const data = createPayrollBreakdownData({ repository: f.repo, tokenProvider: async scopes => { requests.push(scopes); return 'token'; } });
  await data.prepare(); assert.equal(requests.length,2); assert.deepEqual(requests[0], ['Sites.Read.All','Sites.ReadWrite.All']); assert.match(requests[1][0], /AllSites.Read$/); assert.match(requests[1][1], /AllSites.Write$/); assert.equal(f.writes.length, 0);
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
  assert.deepEqual([...new Set(f.writes.map(write=>write.list))].sort(),['DESCRITIVOPROVISAO','FOLHAPGTO','PROVISÃO PGTOS'].sort(), 'desdobrar não cria lançamentos nem pedidos; somente a baixa pode criá-los');
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

test('contexto conserva data, quantidade e valor de cada pagamento sem regravar a folha', async () => {
  const f=fixture(), supplier=(await f.data.loadSuppliers())[0];
  f.columns.LANCAMENTOS=['VALORUNITARIO','QUANTIDADE','FRETE','FORNECEDOR','FILIAL'].map(name=>({name,displayName:name,text:{}}));
  f.rows.LANCAMENTOS=[
    {id:'91',fields:{VALORUNITARIO:100,QUANTIDADE:2,FRETE:0,FORNECEDOR:'Ana',FILIAL:'OBRA A'}},
    {id:'92',fields:{VALORUNITARIO:120,QUANTIDADE:1,FRETE:0,FORNECEDOR:'Ana',FILIAL:'OBRA A'}},
  ];
  f.rows.FOLHAPGTO=[
    {id:'31',fields:{Title:'pago-31',IDFOLHA:'19',FORNECEDOR:'Ana',TIPOPGTO:'SALÁRIO',IDLANCAMENTO:'91',DATA:'2026-10-12T00:00:00Z'}},
    {id:'32',fields:{Title:'pago-32',IDFOLHA:'19',FORNECEDOR:'Ana',TIPOPGTO:'SALÁRIO',IDLANCAMENTO:'92',DATA:'2026-10-18T00:00:00Z'}},
  ];
  const context=await f.data.loadPayrollContext(supplier,'2026-10');
  assert.equal(context.paidTotal,320); assert.equal(context.payments.length,2);
  assert.deepEqual(context.payments.map(p=>[p.id,p.date,p.rubric,p.quantity,p.unitValue,p.total,p.launchId]),
    [['31','2026-10-12','salary',2,100,200,'91'],['32','2026-10-18','salary',1,120,120,'92']]);
  assert.equal(f.writes.length,0);
});

function legacyFixture(){
  const f=fixture();
  f.columns.LANCAMENTOS=['FORNECEDOR','FILIAL','VALORUNITARIO','QUANTIDADE','FRETE','IDFOLHA','TIPOPGTO','IDPGTOAGENDADO','AGRUPAR'].map(name=>({name,displayName:name,text:{}}));
  f.rows.LANCAMENTOS=[{id:'91',fields:{FORNECEDOR:'Ana',FILIAL:'OBRA A',VALORUNITARIO:100,QUANTIDADE:2,FRETE:0,IDFOLHA:'19',TIPOPGTO:'SALÁRIO',IDPGTOAGENDADO:'',AGRUPAR:''}}];
  f.rows.FOLHAPGTO=[{id:'31',fields:{Title:'pago-31',IDFOLHA:'19',FORNECEDOR:'Ana',TIPOPGTO:'SALÁRIO',IDLANCAMENTO:'91',DATA:'2026-10-12'}}];
  return f;
}
const legacySupplier={id:'1',label:'Ana',branch:'OBRA A',profession:'PEDREIRO'};

function legacyMealFixture() {
  const f=legacyFixture();
  f.rows.FOLHAPGTO[0].fields.TIPOPGTO='VALE REFEIÇÃO';
  Object.assign(f.rows.LANCAMENTOS[0].fields,{TIPOPGTO:'VALE REFEIÇÃO',AGRUPAR:'41'});
  f.rows.NOTASPENDENTES=[{id:'41',fields:{FORNECEDOR:'OPERADORA ALIMENTAÇÃO',FILIAL:'OBRA A'}}];
  f.columns.NOTASPENDENTES=['FORNECEDOR','FILIAL'].map(name=>({name}));
  return f;
}

for(const provider of ['OPERADORA ALIMENTAÇÃO','DIVERSOS'])test(`histórico de alimentação legado lê lançamento do funcionário com pedido da operadora ${provider}`,async()=>{
  const f=legacyMealFixture();f.rows.NOTASPENDENTES[0].fields.FORNECEDOR=provider;
  const context=await f.data.loadPayrollContext(legacySupplier,'2026-10');
  assert.equal(context.paid.meal,200);assert.equal(context.paidTotal,200);
  assert.equal(context.payments[0].launchId,'91');assert.equal(f.writes.length,0);
});

for(const [reason,mutate] of [
  ['funcionário do pagamento',f=>f.rows.FOLHAPGTO[0].fields.FORNECEDOR='Beto'],
  ['funcionário do lançamento',f=>f.rows.LANCAMENTOS[0].fields.FORNECEDOR='Beto'],
  ['filial do lançamento',f=>f.rows.LANCAMENTOS[0].fields.FILIAL='OUTRA'],
  ['filial do pedido',f=>f.rows.NOTASPENDENTES[0].fields.FILIAL='OUTRA'],
  ['operadora ausente',f=>f.rows.NOTASPENDENTES[0].fields.FORNECEDOR=''],
  ['rubrica não alimentar',f=>{f.rows.FOLHAPGTO[0].fields.TIPOPGTO='SALÁRIO';f.rows.LANCAMENTOS[0].fields.TIPOPGTO='SALÁRIO';}],
])test(`pedido de operadora não dispensa conferência de ${reason}`,async()=>{
  const f=legacyMealFixture();mutate(f);
  await assert.rejects(f.data.loadPayrollContext(legacySupplier,'2026-10'),/fornecedor|filial/i);assert.equal(f.writes.length,0);
});

test('histórico usa Title renomeado FILIAL e ignora espelhos Graph somente leitura sem facet computed',async()=>{
  const f=legacyFixture();
  f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FILIAL');
  f.columns.LANCAMENTOS.push({name:'Title',displayName:'FILIAL',readOnly:false,text:{}},
    {name:'LinkTitle',displayName:'FILIAL',readOnly:true},
    {name:'LinkTitleNoMenu',displayName:'FILIAL',readOnly:true},
    {name:'LinkTitle2',displayName:'FILIAL',readOnly:true,hidden:true});
  f.rows.LANCAMENTOS[0].fields.Title='OBRA A';delete f.rows.LANCAMENTOS[0].fields.FILIAL;
  const context=await f.data.loadPayrollContext(legacySupplier,'2026-10');
  assert.equal(context.paidTotal,200);assert.equal(f.writes.length,0);
  f.rows.LANCAMENTOS[0].fields.Title='OUTRA OBRA';
  await assert.rejects(f.data.loadPayrollContext(legacySupplier,'2026-10'),/filial/i);
  assert.equal(f.writes.length,0);
});

test('histórico não escolhe arbitrariamente entre duas colunas graváveis com rótulo FILIAL',async()=>{
  const f=legacyFixture();
  f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FILIAL');
  f.columns.LANCAMENTOS.push({name:'Title',displayName:'FILIAL',text:{}},{name:'Branch2',displayName:'FILIAL',text:{}});
  await assert.rejects(f.data.loadPayrollContext(legacySupplier,'2026-10'),/FILIAL/);
  assert.equal(f.writes.length,0);
});
for(const [reason,mutate] of [
  ['fornecedor alheio',f=>f.rows.LANCAMENTOS[0].fields.FORNECEDOR='Beto'],
  ['filial alheia',f=>f.rows.LANCAMENTOS[0].fields.FILIAL='OUTRA OBRA'],
  ['fornecedor ausente',f=>delete f.rows.LANCAMENTOS[0].fields.FORNECEDOR],
  ['coluna filial ausente',f=>f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FILIAL')],
  ['coluna fornecedor ambígua',f=>{f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FORNECEDOR');f.columns.LANCAMENTOS.push({name:'OwnerA',displayName:'FORNECEDOR'},{name:'OwnerB',displayName:'FORNECEDOR'});}],
  ['folha divergente',f=>f.rows.LANCAMENTOS[0].fields.IDFOLHA='20'],
  ['rubrica divergente',f=>f.rows.LANCAMENTOS[0].fields.TIPOPGTO='VALE REFEIÇÃO'],
  ['fornecedor selecionado sem filial',()=>{}],
  ['pedido alheio',f=>{f.rows.LANCAMENTOS[0].fields.AGRUPAR='41';f.rows.NOTASPENDENTES=[{id:'41',fields:{FORNECEDOR:'Beto',FILIAL:'OBRA A'}}];f.columns.NOTASPENDENTES=['FORNECEDOR','FILIAL'].map(name=>({name}));}],
  ['provisão sem vínculo reverso',f=>{f.rows.LANCAMENTOS[0].fields.IDPGTOAGENDADO='12';f.rows['PROVISÃO PGTOS']=[{id:'12',fields:{FORNECEDOR:'Ana',FILIAL:'OBRA A',IDFOLHA:'19',TIPOPGTO:'SALÁRIO',IDLANCAMENTOS:'92'}}];f.columns['PROVISÃO PGTOS'].push({name:'IDLANCAMENTOS'});}],
]) test(`histórico direto recusa ${reason} antes de retornar dinheiro`,async()=>{
  const f=legacyFixture();mutate(f);
  await assert.rejects(f.data.loadPayrollContext(reason==='fornecedor selecionado sem filial'?{id:'1',label:'Ana'}:legacySupplier,'2026-10'),/fornecedor|filial|campo|vínculo|rubrica|folha/i);
  assert.equal(f.writes.length,0);
});
test('histórico direto mapeia metadados canônicos e revalida propriedade a cada consulta',async()=>{
  const f=legacyFixture();let clears=0;f.repo.clearCache=()=>{clears++;};
  const row=f.rows.LANCAMENTOS[0].fields;
  for(const c of f.columns.LANCAMENTOS){const original=c.name;c.name=`Source_${original}`;row[c.name]=row[original];delete row[original];}
  assert.equal((await f.data.loadPayrollContext(legacySupplier,'2026-10')).paidTotal,200);
  row.Source_FORNECEDOR='Beto';
  await assert.rejects(f.data.loadPayrollContext(legacySupplier,'2026-10'),/fornecedor/i);
  assert.ok(clears>=2);assert.equal(f.writes.length,0);
});
for(const {unit,quantity,freight,total} of [
  {unit:100,quantity:2,freight:'7,25',total:207.25},
  {unit:'0,104',quantity:1,freight:'0,004',total:0.11},
  {unit:'0,10',quantity:1,freight:'0,005',total:0.11},
]) test(`lançamento e provisão retornam o mesmo total exato ${total} com frete sem alterar preço unitário`,async()=>{
  const totals=[];
  for(const provision of [false,true]){
    const f=legacyFixture();Object.assign(f.rows.LANCAMENTOS[0].fields,{VALORUNITARIO:unit,QUANTIDADE:quantity,FRETE:freight});
    if(provision){
      f.rows['PROVISÃO PGTOS']=[{id:'12',fields:{FORNECEDOR:'Ana',FILIAL:'OBRA A',IDFOLHA:'19',TIPOPGTO:'SALÁRIO',QTD:quantity,VALORTOTAL:unit,FRETE:freight,DATAPGTOEFETUADO:'2026-10-12',DATAPREVISTOPGTO:'2026-10-09'}}];
      Object.assign(f.rows.FOLHAPGTO[0].fields,{Title:'APP-folha-provisao-12',IDPROVISAO:'12',IDLANCAMENTO:''});
    }
    const context=await f.data.loadPayrollContext(legacySupplier,'2026-10');
    assert.equal(context.paidTotal,total);assert.equal(context.paid.salary,total);assert.equal(context.payments[0].total,total);
    assert.equal(context.payments[0].unitValue,Number(String(unit).replace(',','.')));assert.equal(context.payments[0].quantity,quantity);
    totals.push(context.paidTotal);assert.equal(f.writes.length,0);
  }
  assert.deepEqual(totals,[total,total]);
});
for(const invalid of ['ausente','ambíguo','inválido'])test(`frete ${invalid} no lançamento impede apuração financeira silenciosa`,async()=>{
  const f=legacyFixture();
  if(invalid==='ausente')f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FRETE');
  else if(invalid==='ambíguo'){f.columns.LANCAMENTOS=f.columns.LANCAMENTOS.filter(c=>c.name!=='FRETE');f.columns.LANCAMENTOS.push({name:'FreightA',displayName:'FRETE'},{name:'FreightB',displayName:'FRETE'});}
  else f.rows.LANCAMENTOS[0].fields.FRETE='desconhecido';
  await assert.rejects(f.data.loadPayrollContext(legacySupplier,'2026-10'),/FRETE|valores inválidos/);assert.equal(f.writes.length,0);
});

test('anexo inválido impede o lote antes de criar qualquer registro financeiro', async()=>{
  const f=fixture(),supplier=(await f.data.loadSuppliers())[0],raw=draft(supplier);
  raw.lines[0].files=[{name:'programa.exe',size:2,type:'application/octet-stream',arrayBuffer:async()=>new Uint8Array([1,2]).buffer}];
  await assert.rejects(f.data.post(raw,{operationId:'bad-file'}),/tipo/i);assert.equal(f.writes.length,0);
});
test('arquivos da linha são verificados na provisão e retomada conserva financeiro e manifesto', async()=>{
  const f=fixture(),supplier=(await f.data.loadSuppliers())[0],raw=draft(supplier),files=new Map();raw.lines=raw.lines.slice(0,1);
  const bytes=new Uint8Array([1,2,3]).buffer;raw.lines[0].files=[{name:'recibo.pdf',size:3,type:'application/pdf',arrayBuffer:async()=>bytes}];
  f.repo.listAttachments=async(_s,l,id)=>[...(files.get(`${l}:${id}`)||new Map()).keys()].map(name=>({name}));
  f.repo.downloadAttachment=async(_s,l,id,name)=>files.get(`${l}:${id}`).get(name);
  let fail=true;
  f.repo.uploadAttachment=async(_s,l,id,file,name)=>{if(fail)throw new Error('Falha de anexo');const dest=files.get(`${l}:${id}`)||new Map();files.set(`${l}:${id}`,dest);dest.set(name,await file.arrayBuffer());};
  const progress={operationId:'files-retry'};await assert.rejects(f.data.post(raw,progress),/Falha de anexo/);assert.equal(f.writes.length,3);
  const restored=JSON.parse(JSON.stringify(progress)),missing={...raw,lines:raw.lines.map(({files,...line})=>line)};
  await assert.rejects(f.data.post(missing,restored),/selecione novamente/i);assert.equal(f.writes.length,3);
  fail=false;await f.data.post(raw,restored);assert.equal(f.writes.length,3);assert.equal(files.get('PROVISÃO PGTOS:1').size,1);
});
