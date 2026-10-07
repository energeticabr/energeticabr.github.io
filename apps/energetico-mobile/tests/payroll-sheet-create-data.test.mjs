import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';

const module = await import('../src/chat/payroll-sheet-create-data.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { createPayrollSheetCreateData } = module;
const clone = value => structuredClone(value);
const draft = { supplierId: '7', month: '2026-10' };
const operation = { operationId: 'sheet-test-1' };

// Keep the frozen production repository real; only the remote Graph boundary is fake.
function fixture(overrides = {}) {
  const columns = {
    suppliers: [{ name: 'Title', displayName: 'CADASTRO', text: {} },
      { name: 'LinkTitle', displayName: 'CADASTRO', readOnly: true, computed: true },
      { name: 'LinkTitleNoMenu', displayName: 'CADASTRO', readOnly: true },
      { name: 'EMPREITEIRO', displayName: 'EMPREITEIRO', text: {} },
      { name: 'STATUS', displayName: 'STATUS', text: {} }],
    // Live IDFOLHA has a separate unused Title; all four text defaults are null.
    sheets: [{ name: 'Title', displayName: 'Title', text: {}, defaultValue: null },
      { name: 'FORNECEDOR', displayName: 'FORNECEDOR', text: {}, defaultValue: null },
      { name: 'MESREFERENCIA', displayName: 'MESREFERENCIA', text: {}, defaultValue: null },
      { name: 'STATUS', displayName: 'STATUS', text: {}, defaultValue: null }],
  };
  const rows = {
    suppliers: [{ id: '7', fields: { Title: "ÁGUA D'OURO", EMPREITEIRO: 'SIM', STATUS: 'ATIVO' } },
      { id: '9', fields: { Title: 'BETA', EMPREITEIRO: 'NÃO', STATUS: 'INATIVO' } }],
    sheets: [],
  };
  const calls = [], writes = [];
  const hooks = {};
  let pageSize = 1;
  const graph = { async request(path, options = {}) {
    const url = new URL(path, 'https://graph.microsoft.com/v1.0/');
    const match = url.pathname.match(/\/lists\/(suppliers|sheets)\/(columns|items)(?:\/([^/]+))?$/);
    calls.push({ path, options });
    await hooks.before?.({ path, options, match });
    if (match) {
      const [, list, resource, id] = match;
      if (resource === 'columns') return { value: clone(columns[list]) };
      if (options.method === 'POST') {
        assert.equal(list, 'sheets', 'only IDFOLHA may receive a write');
        assert.deepEqual(options.scopes, ['Sites.ReadWrite.All']);
        const defaults = Object.fromEntries(columns[list].filter(c => !c.readOnly && !c.computed).map(c => [c.name, c.defaultValue ?? null]));
        const row = { id: String(100 + writes.length), fields: { ...defaults, ...clone(options.body.fields) } };
        writes.push({ list, fields: clone(options.body.fields) });
        rows[list].push(row);
        await hooks.afterCreate?.(row);
        return clone(row);
      }
      if (id) {
        await hooks.beforeItem?.(list, id);
        const row = rows[list].find(row => row.id === id);
        if (!row) throw Object.assign(new Error('Registro não encontrado.'), { status: 404 });
        return clone(row);
      }
      await hooks.beforePage?.(list, url);
      if (hooks.page) return hooks.page(list, url);
      const start = Number(url.searchParams.get('page') || 0);
      const next = start + pageSize;
      const result = { value: clone(rows[list].slice(start, next)) };
      if (next < rows[list].length) result['@odata.nextLink'] = `https://graph.microsoft.com/v1.0/sites/site-id/lists/${list}/items?page=${next}`;
      return result;
    }
    if (url.pathname.endsWith('/lists')) return { value: [
      { id: 'suppliers', displayName: 'FORNECEDORES', list: { template: 'genericList' } },
      { id: 'sheets', displayName: 'IDFOLHA', list: { template: 'genericList' } },
    ] };
    return { id: 'site-id' };
  } };
  const repository = createSharePointRepository(graph, { personal: { host: 'tenant.sharepoint.com', path: '/sites/test' } });
  assert.equal(Object.isFrozen(repository), true);
  assert.equal(typeof createPayrollSheetCreateData, 'function', 'IDFOLHA data factory must exist');
  const data = createPayrollSheetCreateData({ repository, now: () => new Date('2026-10-07T12:00:00Z'), ...overrides });
  return { data, repository, columns, rows, calls, writes, hooks, setPageSize: value => { pageSize = value; } };
}

test('options read every supplier page, ignore computed Title auxiliaries, and never create', async () => {
  const f = fixture();
  const options = await f.data.loadOptions();
  assert.deepEqual(options.suppliers, [{ id: '7', label: "ÁGUA D'OURO" }, { id: '9', label: 'BETA' }]);
  assert.equal(options.defaultMonth, '2026-10');
  assert.ok(f.calls.some(call => call.path.includes('items?page=1')));
  assert.equal(f.writes.length, 0);
});

test('default month uses Sao Paulo at UTC month and year boundaries', async () => {
  const f = fixture({ now: () => new Date('2027-01-01T01:00:00Z') });
  assert.equal((await f.data.loadOptions()).defaultMonth, '2026-12');
});

test('live schema save rereads supplier and writes FORNECEDOR, MM/YYYY and ATIVO without inventing Title', async () => {
  const f = fixture();
  await f.data.loadOptions();
  f.rows.suppliers[0].fields.Title = 'NOME ATUAL';
  const result = await f.data.save({ ...draft, supplier: 'NOME INVENTADO', PowerAppsId: 'injetado', status: 'INATIVO', Title: 'INJETADO' }, operation);
  assert.equal(result.id, '100');
  assert.equal(result.fields.Title, null);
  assert.deepEqual(f.writes, [{ list: 'sheets', fields: { FORNECEDOR: 'NOME ATUAL', MESREFERENCIA: '10/2026', STATUS: 'ATIVO' } }]);
  assert.ok(f.calls.some(call => /items\/7\?/.test(call.path)));
  assert.ok(f.calls.some(call => /items\/100\?/.test(call.path)));
});

test('actual date metadata receives an ISO date in the selected month', async () => {
  const f = fixture();
  f.columns.sheets[2] = { name: 'Reference_x0020_Month', displayName: 'MESREFERENCIA', dateTime: { format: 'dateOnly' } };
  await f.data.save(draft, operation);
  assert.deepEqual(f.writes[0].fields, { FORNECEDOR: "ÁGUA D'OURO", Reference_x0020_Month: '2026-10-01T12:00:00Z', STATUS: 'ATIVO' });
});

test('internal aliases are resolved from metadata rather than hardcoded field names', async () => {
  const f = fixture();
  f.columns.suppliers = [{ name: 'CADASTRO_x0020_NOME', displayName: 'CADASTRO', text: {} }];
  f.rows.suppliers[0].fields = { CADASTRO_x0020_NOME: 'ALFA' };
  f.rows.suppliers[1].fields = { CADASTRO_x0020_NOME: 'BETA' };
  f.columns.sheets = [{ name: 'Fornecedor_x0020_Nome', displayName: 'Fornecedor', text: {} },
    { name: 'Ref_x0020_Mes', displayName: 'MÊS REFERÊNCIA', text: {} }];
  await f.data.save(draft, operation);
  assert.deepEqual(f.writes[0].fields, { Fornecedor_x0020_Nome: 'ALFA', Ref_x0020_Mes: '10/2026' });
});

test('a renamed Title is used only when its metadata identifies it as the sheet supplier', async () => {
  const f = fixture();
  f.columns.sheets = [{ name: 'Title', displayName: 'FORNECEDOR', text: {} },
    { name: 'LinkTitle2', displayName: 'FORNECEDOR', readOnly: true, computed: true },
    { name: 'MESREFERENCIA', displayName: 'MESREFERENCIA', text: {} }];
  await f.data.save(draft, operation);
  assert.deepEqual(f.writes[0].fields, { Title: "ÁGUA D'OURO", MESREFERENCIA: '10/2026' });
});

test('supplier label FORNECEDOR alias also resolves without requiring a renamed Title', async () => {
  const f = fixture();
  f.columns.suppliers = [{ name: 'FORNECEDOR', displayName: 'FORNECEDOR', text: {} },
    { name: 'Title', displayName: 'Title', text: {} }];
  f.rows.suppliers = [{ id: '7', fields: { Title: null, FORNECEDOR: 'ALFA' } }];
  assert.deepEqual((await f.data.loadOptions()).suppliers, [{ id: '7', label: 'ALFA' }]);
  await f.data.save(draft, operation);
  assert.equal(f.writes[0].fields.FORNECEDOR, 'ALFA');
});

test('IDFOLHA registration keeps all registered suppliers without imposing payment-only contractor eligibility', async () => {
  const f = fixture();
  assert.deepEqual((await f.data.loadOptions()).suppliers.map(row => row.id), ['7', '9']);
  await f.data.save({ ...draft, supplierId: '9' }, operation);
  assert.equal(f.writes[0].fields.FORNECEDOR, 'BETA');
  assert.equal(f.writes[0].fields.STATUS, 'ATIVO');
});

test('STATUS is optional and is never invented when absent from sheet metadata', async () => {
  const f = fixture(); f.columns.sheets.pop();
  await f.data.save(draft, operation);
  assert.deepEqual(f.writes[0].fields, { FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '10/2026' });
});

test('optional STATUS resolves its internal alias and validates the ATIVO choice', async () => {
  const f = fixture();
  f.columns.sheets[3] = { name: 'Estado_x0020_Folha', displayName: 'STATUS', choice: { choices: ['ATIVO', 'INATIVO'] } };
  const result = await f.data.save(draft, operation);
  assert.deepEqual(f.writes[0].fields, { FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '10/2026', Estado_x0020_Folha: 'ATIVO' });
  assert.equal(result.fields.Estado_x0020_Folha, 'ATIVO');
});

test('unsupported optional STATUS metadata and disallowed ATIVO values fail before any POST', async () => {
  for (const patch of [{ readOnly: true }, { computed: true }, { calculated: {} }, { lookup: {} },
    { personOrGroup: {} }, { number: {} }, { dateTime: {} }, { boolean: {} },
    { text: undefined, geolocation: {} }, { text: undefined }, { choice: { choices: ['INATIVO'] } },
    { choice: { choices: ['ATIVO'], allowMultipleValues: true } }, { text: { maxLength: 4 } }]) {
    const f = fixture(); Object.assign(f.columns.sheets[3], patch);
    await assert.rejects(f.data.save(draft, operation), /STATUS|campo|metadados/i);
    assert.equal(f.writes.length, 0);
  }
});

test('ambiguous optional STATUS metadata fails closed rather than choosing a field', async () => {
  const f = fixture(); f.columns.sheets.push({ name: 'OtherStatus', displayName: 'STATUS', text: {} });
  await assert.rejects(f.data.save(draft, operation), /ambígu|ambig|únic/i);
  assert.equal(f.writes.length, 0);
});

test('post-create reread and uncertain retry must confirm ATIVO without creating a replacement', async () => {
  for (const status of [null, 'INATIVO']) {
    const f = fixture();
    f.hooks.afterCreate = row => { row.fields.STATUS = status; };
    await assert.rejects(f.data.save(draft, operation), /STATUS|confirm/i);
    await assert.rejects(f.data.save(draft, operation), /STATUS|confirm/i);
    assert.equal(f.writes.length, 1);
  }
});

test('an existing inactive tuple is returned without a new create or an unauthorized status update', async () => {
  const f = fixture();
  f.rows.sheets.push({ id: '21', fields: { Title: null, FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '10/2026', STATUS: 'INATIVO' } });
  assert.equal((await f.data.save(draft, operation)).id, '21');
  assert.equal(f.writes.length, 0);
  assert.equal(f.rows.sheets[0].fields.STATUS, 'INATIVO');
});

test('real ambiguity is rejected for supplier label, sheet supplier, and reference', async () => {
  for (const [list, column] of [
    ['suppliers', { name: 'OtherSupplier', displayName: 'CADASTRO', text: {} }],
    ['sheets', { name: 'OtherSupplier', displayName: 'FORNECEDOR', text: {} }],
    ['sheets', { name: 'OtherMonth', displayName: 'MESREFERENCIA', text: {} }],
  ]) {
    const f = fixture(); f.columns[list].push(column);
    await assert.rejects(f.data.save(draft, operation), /ambígu|ambig|únic/i);
    assert.equal(f.writes.length, 0);
  }
});

test('read-only, computed, lookup and unsupported field types cannot be written', async () => {
  for (const patch of [{ readOnly: true }, { calculated: {} }, { computed: true }, { lookup: {} }, { personOrGroup: {} }, { number: {} }]) {
    const f = fixture(); Object.assign(f.columns.sheets[1], patch);
    await assert.rejects(f.data.save(draft, operation));
    assert.equal(f.writes.length, 0);
  }
});

test('invalid months, noncanonical IDs, missing suppliers and missing operation IDs cannot create', async () => {
  const f = fixture();
  for (const month of ['', '10/2026', '2026-1', '2026-00', '2026-13', '0000-01', '2026-10-01']) {
    await assert.rejects(f.data.save({ ...draft, month }, operation));
  }
  for (const supplierId of ['', '07', ' 7', '7.0', '1e2', '0', '-1', '9007199254740992', '555']) {
    await assert.rejects(f.data.save({ ...draft, supplierId }, operation));
  }
  await assert.rejects(f.data.save(draft));
  assert.equal(f.writes.length, 0);
});

test('duplicate supplier labels fail closed because the stored tuple cannot distinguish their IDs', async () => {
  const f = fixture(); f.rows.suppliers[1].fields.Title = "ÁGUA D'OURO";
  await assert.rejects(f.data.save(draft, operation), /ambígu|ambig|únic/i);
  assert.equal(f.writes.length, 0);
});

test('duplicate on the last sheet page returns its verified ID instead of creating', async () => {
  const f = fixture();
  f.rows.sheets.push({ id: '20', fields: { Title: null, FORNECEDOR: 'BETA', MESREFERENCIA: '10/2026', STATUS: 'ATIVO' } },
    { id: '21', fields: { Title: null, FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '2026-10-01T12:00:00Z', STATUS: 'ATIVO' } });
  assert.equal((await f.data.save(draft, operation)).id, '21');
  assert.equal(f.writes.length, 0);
  assert.ok(f.calls.some(call => call.path.includes('/sheets/items?page=1')));
});

test('multiple existing supplier/month sheets are ambiguous and cannot trigger another create', async () => {
  const f = fixture();
  f.rows.sheets.push({ id: '20', fields: { Title: null, FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '10/2026', STATUS: 'ATIVO' } },
    { id: '21', fields: { Title: null, FORNECEDOR: "ÁGUA D'OURO", MESREFERENCIA: '10/2026', STATUS: 'ATIVO' } });
  await assert.rejects(f.data.save(draft, operation), /mais de uma|ambígu|ambig/i);
  assert.equal(f.writes.length, 0);
});

test('lost create response retry re-queries the pinned tuple and recovers without another POST', async () => {
  const f = fixture(); let lost = true;
  f.hooks.afterCreate = () => { if (lost) { lost = false; throw new Error('Resposta perdida'); } };
  await assert.rejects(f.data.save(draft, operation), /perdida/i);
  f.rows.suppliers[0].fields.Title = 'RENOMEADO DEPOIS';
  const result = await f.data.save(draft, operation);
  assert.equal(result.id, '100');
  assert.equal(result.fields.FORNECEDOR, "ÁGUA D'OURO");
  assert.equal(result.fields.Title, null);
  assert.equal(f.writes.length, 1);
  await assert.rejects(f.data.save({ ...draft, month: '2026-11' }, operation), /operaç|alterad/i);
});

test('same tuple under another operation still returns the existing ID', async () => {
  const f = fixture();
  await f.data.save(draft, operation);
  assert.equal((await f.data.save(draft, { operationId: 'another-operation' })).id, '100');
  assert.equal(f.writes.length, 1);
});

test('overlapping saves cannot reach a second creation', async () => {
  const f = fixture(); let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  f.hooks.afterCreate = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const first = f.data.save(draft, operation);
  await entered;
  await assert.rejects(f.data.save(draft, { operationId: 'overlap' }), /andamento|cadastrad/i);
  release(); await first;
  assert.equal(f.writes.length, 1);
});

test('save stays busy until an existing sheet has completed its trusted reread', async () => {
  const f = fixture();
  await f.data.save(draft, operation);
  let release, started, blocked = false;
  const entered = new Promise(resolve => { started = resolve; });
  f.hooks.beforeItem = list => { if (list === 'sheets' && !blocked) { blocked = true; started(); return new Promise(resolve => { release = resolve; }); } };
  const retry = f.data.save(draft, operation);
  await entered;
  try { await assert.rejects(f.data.save(draft, { operationId: 'overlap-verification' }), /andamento|cadastrad/i); }
  finally { release(); }
  await retry;
  assert.equal(f.writes.length, 1);
});

test('failed POST with no confirmed server outcome permits reconciliation reads but no second POST', async () => {
  const f = fixture(); let fail = true;
  f.hooks.before = ({ options }) => { if (options.method === 'POST' && fail) { fail = false; throw new Error('Conexão perdida antes do envio'); } };
  await assert.rejects(f.data.save(draft, operation), /perdida/);
  const start = f.calls.length;
  await assert.rejects(f.data.save(draft, operation), /confirm|aguarde/i);
  assert.equal(f.writes.length, 0);
  const retryCalls = f.calls.slice(start);
  assert.ok(retryCalls.some(call => call.path.includes('/sheets/items?')));
  assert.equal(retryCalls.filter(call => call.options.method === 'POST').length, 0);
});

test('committed POST with lost response and stale empty reconciliation never posts the same operation again', async () => {
  const f = fixture(); let lost = true;
  f.hooks.afterCreate = () => { if (lost) { lost = false; throw new Error('Resposta perdida'); } };
  await assert.rejects(f.data.save(draft, operation), /perdida/i);
  let stale = true;
  f.hooks.page = list => ({ value: stale && list === 'sheets' ? [] : clone(f.rows[list]) });
  for (let retry = 0; retry < 2; retry++) {
    await assert.rejects(f.data.save(draft, operation), error => {
      assert.match(error.message, /confirm|aguarde/i);
      assert.equal(error.payrollSheetCreateUncertain, true);
      return true;
    });
    assert.equal(f.writes.length, 1);
  }
  stale = false;
  assert.equal((await f.data.save(draft, operation)).id, '100');
  assert.equal(f.writes.length, 1);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
});

test('uncertain tuples survive new operation IDs and newly created data services', async () => {
  const attempts = new Map(), f = fixture({ attempts });
  f.hooks.afterCreate = () => { throw new Error('Resposta perdida'); };
  await assert.rejects(f.data.save(draft, operation), /perdida/i);
  f.hooks.page = list => ({ value: list === 'sheets' ? [] : clone(f.rows[list]) });
  const reopened = createPayrollSheetCreateData({ repository: f.repository, attempts });
  await assert.rejects(reopened.save(draft, { operationId: 'reopened-operation' }), /confirm|aguarde/i);
  assert.equal(f.writes.length, 1);
});

test('two data services sharing attempts cannot concurrently post the same tuple', async () => {
  const attempts = new Map(), f = fixture({ attempts });
  const other = createPayrollSheetCreateData({ repository: f.repository, attempts });
  await Promise.allSettled([f.data.save(draft, operation), other.save(draft, { operationId: 'concurrent-operation' })]);
  assert.equal(f.writes.length, 1);
});

test('a preflight read failure does not lock a draft that never attempted POST', async () => {
  const f = fixture(); let fail = true;
  f.hooks.beforePage = list => { if (list === 'sheets' && fail) { fail = false; throw new Error('Leitura indisponível'); } };
  await assert.rejects(f.data.save(draft, operation), error => {
    assert.equal(error.payrollSheetCreateUncertain, undefined); return true;
  });
  assert.equal((await f.data.save({ ...draft, month: '2026-11' }, operation)).id, '100');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].fields.MESREFERENCIA, '11/2026');
});

test('session invalidation after creation refuses a successful result and recovers on a later valid session', async () => {
  let valid = true;
  const f = fixture({ assertSession: () => { if (!valid) throw new Error('Sessão encerrada'); } });
  f.hooks.afterCreate = () => { valid = false; };
  await assert.rejects(f.data.save(draft, operation), /sessão/i);
  valid = true;
  assert.equal((await f.data.save(draft, operation)).id, '100');
  assert.equal(f.writes.length, 1);
});

test('canonical supplier IDs are enforced at the real repository boundary', async () => {
  const f = fixture(); f.rows.suppliers[0].id = '07';
  await assert.rejects(f.data.loadOptions(), /ID|cadastrad/i);
  assert.equal(f.writes.length, 0);
});

test('Graph authentication error code is preserved for the caller after a failed POST', async () => {
  const f = fixture();
  f.hooks.before = ({ options }) => {
    if (options.method === 'POST') throw Object.assign(new Error('Token expirado'), { code: 'InvalidAuthenticationToken', status: 401 });
  };
  await assert.rejects(f.data.save(draft, operation), error => {
    assert.equal(error.code, 'InvalidAuthenticationToken');
    assert.equal(error.status, 401);
    assert.equal(error.payrollSheetCreateUncertain, true);
    return true;
  });
  assert.equal(f.writes.length, 0);
});

test('repeated or malformed supplier and sheet cursors never allow partial options or a write', async () => {
  for (const list of ['suppliers', 'sheets']) {
    const f = fixture();
    f.hooks.page = current => current === list
      ? { value: [], '@odata.nextLink': `https://graph.microsoft.com/v1.0/sites/site-id/lists/${list}/items?page=1` }
      : { value: clone(f.rows[current]) };
    await assert.rejects(list === 'suppliers' ? f.data.loadOptions() : f.data.save(draft, operation), /consulta|pagina|cursor/i);
    assert.equal(f.writes.length, 0);
  }
});

test('aborted loads stop before discovery and after an in-flight supplier page', async () => {
  const f = fixture(), early = new AbortController(); early.abort();
  await assert.rejects(f.data.loadOptions({ signal: early.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
  const active = new AbortController();
  f.hooks.beforePage = list => { if (list === 'suppliers') active.abort(); };
  await assert.rejects(f.data.loadOptions({ signal: active.signal }), { name: 'AbortError' });
  assert.equal(f.writes.length, 0);
});

test('session invalidation after supplier reread and sheet await blocks writes', async () => {
  for (const stage of ['supplier', 'sheets']) {
    let valid = true;
    const f = fixture({ assertSession: () => { if (!valid) throw new Error('Sessão encerrada'); } });
    f.hooks.beforeItem = list => { if (stage === 'supplier' && list === 'suppliers') valid = false; };
    f.hooks.beforePage = list => { if (stage === 'sheets' && list === 'sheets') valid = false; };
    await assert.rejects(f.data.save(draft, operation), /sessão/i);
    assert.equal(f.writes.length, 0);
  }
});

test('post-create reread must verify persisted supplier and reference rather than trust POST', async () => {
  const f = fixture();
  f.hooks.afterCreate = row => { row.fields.MESREFERENCIA = '11/2026'; };
  await assert.rejects(f.data.save(draft, operation), /confirm|confer/i);
});

test('supplier changed during preflight is rejected before storing a mixed tuple', async () => {
  const f = fixture(); let reads = 0;
  f.hooks.beforeItem = list => { if (list === 'suppliers' && ++reads === 2) f.rows.suppliers[0].fields.Title = 'ALTERADO'; };
  await assert.rejects(f.data.save(draft, operation), /alterad|revise/i);
  assert.equal(f.writes.length, 0);
});
