import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentProgrammingGalleryData, createPendingProvisionAttachmentsData } from '../src/chat/orders-gallery-data.js';
import { createProvisionPaymentEditor } from '../../../portal/forms/provision-payment-edit.js';
import { JSDOM } from 'jsdom';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';

function fixture({ single = false, parentDates = {}, withTarget = false } = {}) {
  const records = {
    parents: new Map([['42', { id: '42', eTag: 'p1', fields: {
      FILIAL: '004', FORNECEDOR: 'A', VALORTOTAL: '30', DATAPREVISTOPGTO: null,
      DATAPGTOEFETUADO: null, DATAPGTOAGENDADO: null, DATAEXECUCAOAGENDAMENTO: null, PGTOAGENDADO: null,
      ...parentDates,
    } }]]),
    children: new Map([
      ['2', { id: '2', eTag: 'c2', fields: { DESCRITIVOPROVISAO: '42', FILIAL: '004', FORNECEDOR: 'A', QTD: '1', VALORTOTAL: '10', FRETE: '0', DATAPGTOEFETUADO: null } }],
      ...single ? [] : [['3', { id: '3', eTag: 'c3', fields: { DESCRITIVOPROVISAO: '42', FILIAL: '004', FORNECEDOR: 'A', QTD: '1', VALORTOTAL: '20', FRETE: '0', DATAPGTOEFETUADO: null } }]],
    ]),
  };
  if (single) records.parents.get('42').fields.VALORTOTAL = '10';
  if (withTarget) {
    records.parents.set('99', { id: '99', eTag: 'p99', fields: {
      ...structuredClone(records.parents.get('42').fields), FILIAL: '000', FORNECEDOR: 'B', OBS: 'Destino de teste', VALORTOTAL: '40',
    } });
    records.children.set('4', { id: '4', eTag: 'c4', fields: {
      DESCRITIVOPROVISAO: '99', FILIAL: '000', FORNECEDOR: 'B', QTD: '2', VALORTOTAL: '20', FRETE: '0',
    } });
  }
  const columns = {
    parents: [...['FILIAL', 'FORNECEDOR', 'VALORTOTAL'].map(name => ({ name, text: {} })),
      ...['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO', 'PGTOAGENDADO'].map(name => ({ name, dateTime: {} }))],
    children: [...['DESCRITIVOPROVISAO', 'FILIAL', 'FORNECEDOR', 'QTD', 'VALORTOTAL', 'FRETE'].map(name => ({ name, text: {} })),
      ...['DATAPREVISTOPGTO', 'DATAPGTOEFETUADO', 'DATAPGTOAGENDADO', 'DATAEXECUCAOAGENDAMENTO'].map(name => ({ name, dateTime: {} }))],
  };
  const writes = [];
  const repository = {
    async resolveList(_site, aliases) { return { status: 'resolved', id: aliases.includes('DESCRITIVOPROVISAO') ? 'parents' : 'children' }; },
    async getColumns(_site, list) { return structuredClone(columns[list]); },
    async getItemsPage(_site, list) { return { items: [...records[list].values()].map(row => structuredClone(row)), hasMore: false }; },
    async getItem(_site, list, id) { return structuredClone(records[list].get(String(id))); },
    async updateItem(_site, list, id, fields, { eTag }) {
      const row = records[list].get(String(id));
      assert.equal(eTag, row.eTag);
      writes.push({ list, id: String(id), fields: structuredClone(fields) });
      Object.assign(row.fields, fields);
      row.eTag += 'n';
      return structuredClone(row);
    },
  };
  return { data: createPaymentProgrammingGalleryData({ repository }), records, writes, repository };
}

test('editing one child amount recalculates the parent from all linked provision lines', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('2');
  await f.data.saveEditor(context, { VALORTOTAL: '5' });
  assert.equal(f.records.children.get('2').fields.VALORTOTAL, '5');
  assert.equal(f.records.children.get('3').fields.VALORTOTAL, '20');
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '25');
});

test('payment editor displays FILIAL and FORNECEDOR as locked and rejects direct edits', async () => {
  const f = fixture();
  const context = await f.data.loadEditor('2');
  for (const name of ['FILIAL', 'FORNECEDOR']) {
    const column = context.columns.find(candidate => candidate.name === name);
    assert.equal(column?.readOnly, true, name);
    assert.equal(column?.disabled, true, name);
    await assert.rejects(f.data.saveEditor(context, { [name]: 'OUTRO' }), /não é editável|descritivo/i);
  }
  assert.deepEqual(f.writes, []);
});

test('payment editor offers existing descriptions and the current link as an editable closed selection', async () => {
  const f = fixture({ withTarget: true });
  const context = await f.data.loadEditor('2');
  const column = context.columns.find(candidate => candidate.name === 'DESCRITIVOPROVISAO');
  assert.equal(column?.control, 'select');
  assert.equal(column.readOnly, false);
  assert.equal(column.editable, true);
  assert.equal(column.label, 'Descritivo da provisão');
  assert.deepEqual(column.choices, ['99', '42']);
  assert.match(column.optionLabels['99'], /99.*B.*Destino de teste/);
  assert.equal(context.item.fields.DESCRITIVOPROVISAO, '42');
  assert.deepEqual(f.writes, []);
});

test('relinking a provision recalculates both parents and preserves every unrelated identity', async () => {
  const f = fixture({ withTarget: true });
  Object.assign(f.records.children.get('2').fields, { IDFOLHA: 7, FOLHAOPERACAO: 'TEST-ORIGIN', OBS: 'Manter', Attachments: true });
  const before = structuredClone(f.records.children.get('2').fields);
  await f.data.saveEditor(await f.data.loadEditor('2'), { DESCRITIVOPROVISAO: '99' });
  assert.deepEqual(f.records.children.get('2').fields, { ...before, DESCRITIVOPROVISAO: '99' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '20');
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL, '50');
  assert.equal(f.records.children.size, 3);
  assert.deepEqual(f.writes.find(write => write.list === 'children').fields, { DESCRITIVOPROVISAO: '99' });
});

test('moving the sole child zeros the old description without deleting it', async () => {
  const f = fixture({ single: true, withTarget: true });
  await f.data.saveEditor(await f.data.loadEditor('2'), { DESCRITIVOPROVISAO: '99', VALORTOTAL: '5' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '0');
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL, '45');
  assert.equal(f.records.parents.size, 2);
});

test('an initially unlinked provision can acquire an existing description', async () => {
  const f = fixture({ withTarget: true });
  f.records.children.get('2').fields.DESCRITIVOPROVISAO = '';
  f.records.parents.get('42').fields.VALORTOTAL = '20';
  await f.data.saveEditor(await f.data.loadEditor('2'), { DESCRITIVOPROVISAO: '99' });
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL, '50');
  assert.equal(f.writes.some(write => write.list === 'parents' && write.id === '42'), false);
});

test('missing or invalid target descriptions never write a provision or a parent', async () => {
  for (const target of ['', '0', '-2', '99x', '888']) {
    const f = fixture({ withTarget: true });
    await assert.rejects(f.data.saveEditor(await f.data.loadEditor('2'), { DESCRITIVOPROVISAO: target }));
    assert.deepEqual(f.writes, []);
  }
  const f = fixture({ withTarget: true });
  const context = await f.data.loadEditor('2');
  f.records.parents.delete('99');
  await assert.rejects(f.data.saveEditor(context, { DESCRITIVOPROVISAO: '99' }));
  assert.deepEqual(f.writes, []);
});

test('a failed parent synchronization retries only missing totals after the confirmed move', async () => {
  for (const failedId of ['42', '99']) {
    const f = fixture({ withTarget: true });
    const context = await f.data.loadEditor('2');
    const update = f.repository.updateItem;
    let fail = true;
    f.repository.updateItem = (...args) => {
      if (args[1] === 'parents' && args[2] === failedId && fail) { fail = false; throw new Error('offline'); }
      return update(...args);
    };
    await assert.rejects(f.data.saveEditor(context, { DESCRITIVOPROVISAO: '99' }), /offline/);
    assert.equal(f.records.children.get('2').fields.DESCRITIVOPROVISAO, '99');
    await f.data.saveEditor(context, { DESCRITIVOPROVISAO: '99' });
    assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '20');
    assert.equal(f.records.parents.get('99').fields.VALORTOTAL, '50');
    assert.equal(f.writes.filter(write => write.list === 'children').length, 1);
  }
});

test('a provision moved elsewhere since the editor opened is not stolen by a stale relink', async () => {
  const f = fixture({ withTarget: true });
  const context = await f.data.loadEditor('2');
  f.records.children.get('2').fields.DESCRITIVOPROVISAO = '123';
  f.records.children.get('2').eTag = 'changed';
  await assert.rejects(f.data.saveEditor(context, { DESCRITIVOPROVISAO: '99' }), /v[ií]nculo|mudou/i);
  assert.deepEqual(f.writes, []);
});

test('description options include later pages and incomplete pages do not become valid choices', async () => {
  const f = fixture({ withTarget: true });
  const pages = f.repository.getItemsPage;
  f.repository.getItemsPage = async (site, list, query, options) => list !== 'parents' ? pages(site,list,query,options)
    : options.pageNumber === 1 ? { items: [structuredClone(f.records.parents.get('42'))], hasMore: true, nextLink: 'parents-page-2' }
      : { items: [structuredClone(f.records.parents.get('99'))], hasMore: false };
  const context = await f.data.loadEditor('2');
  assert.deepEqual(context.columns.find(column => column.name === 'DESCRITIVOPROVISAO')?.choices, ['99','42']);
  f.repository.getItemsPage = async () => ({ items: [], hasMore: false, complete: false });
  await assert.rejects(f.data.loadEditor('2'), /completa|consulta|p.gina/i);
  assert.deepEqual(f.writes, []);
});

test('the real provision form selects a description and submits the new link with a visible receipt', async t => {
  const f = fixture({ withTarget: true });
  const dom = new JSDOM('<main id="gallery"></main>', { url: 'https://example.test' });
  const previous = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  const actions = createGalleryRecordActions({ document: dom.window.document, host: dom.window.document.querySelector('main'),
    loadEditor: f.data.loadEditor, saveEditor: f.data.saveEditor });
  t.after(() => { actions.destroy(); dom.window.close(); globalThis.FormData = previous; });
  const buttons = actions.render({ id:'2',fields:structuredClone(f.records.children.get('2').fields) });
  dom.window.document.querySelector('main').append(buttons);
  buttons.querySelector('[data-gallery-action="edit"]').click();
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle(); await settle();
  const document = dom.window.document, stored = document.querySelector('[name="DESCRITIVOPROVISAO"]');
  assert.equal(stored?.value, '42');
  const input = stored.closest('.dynamic-field').querySelector('[role="combobox"]');
  assert.match(input.value,/42.*A/);
  input.click();
  const option = [...document.querySelectorAll('[role="option"]')].find(node => /ID 99/.test(node.textContent));
  assert.ok(option); option.click();
  assert.equal(stored.value,'99');
  document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await settle(); await settle();
  assert.equal(f.records.children.get('2').fields.DESCRITIVOPROVISAO,'99');
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL,'20');
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL,'50');
  assert.match(document.querySelector('[data-gallery-edit-success]')?.textContent || '',/REGISTRO EDITADO/);
});

test('a lost move response is read back and never moves the provision twice', async () => {
  const f = fixture({ withTarget: true });
  const update = f.repository.updateItem;
  f.repository.updateItem = async (...args) => {
    const result = await update(...args);
    if (args[1] === 'children') throw new Error('response lost');
    return result;
  };
  await f.data.saveEditor(await f.data.loadEditor('2'),{DESCRITIVOPROVISAO:'99'});
  assert.equal(f.writes.filter(write => write.list === 'children').length,1);
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL,'20');
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL,'50');
});

test('relinking includes exact decimal quantity and freight and catches a sibling race', async () => {
  const f = fixture({ withTarget: true });
  Object.assign(f.records.children.get('2').fields,{QTD:'2.5',VALORTOTAL:'0.1',FRETE:'0.05'});
  f.records.parents.get('42').fields.VALORTOTAL = '20.3';
  const update = f.repository.updateItem;
  let raced = false;
  f.repository.updateItem = async (...args) => {
    const result = await update(...args);
    if (args[1] === 'parents' && args[2] === '99' && !raced) {
      raced = true; f.records.children.get('4').fields.VALORTOTAL = '30';
    }
    return result;
  };
  await f.data.saveEditor(await f.data.loadEditor('2'),{DESCRITIVOPROVISAO:'99'});
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL,'20');
  assert.equal(f.records.parents.get('99').fields.VALORTOTAL,'60.3');
});

test('a changed payment date reaches the parent only when this is its sole child and payment dates are blank', async () => {
  const single = fixture({ single: true });
  const context = await single.data.loadEditor('2');
  await single.data.saveEditor(context, { DATAPGTOEFETUADO: '2026-10-16' });
  assert.match(single.records.parents.get('42').fields.DATAPGTOEFETUADO, /^2026-10-16/);

  const multiple = fixture();
  await multiple.data.saveEditor(await multiple.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(multiple.records.parents.get('42').fields.DATAPGTOEFETUADO, null);

  const alreadyDated = fixture({ single: true, parentDates: { DATAPGTOAGENDADO: '2026-10-20T00:00:00Z' } });
  await alreadyDated.data.saveEditor(await alreadyDated.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(alreadyDated.records.parents.get('42').fields.DATAPGTOEFETUADO, null);
});

test('a SharePoint-normalized date is confirmed without mistaking its ISO representation for a failed save', async () => {
  const f = fixture({ single: true });
  const update = f.repository.updateItem;
  f.repository.updateItem = (site, list, id, fields, options) => update(site, list, id,
    list === 'children' && fields.DATAPGTOEFETUADO
      ? { ...fields, DATAPGTOEFETUADO: `${fields.DATAPGTOEFETUADO}T00:00:00Z` }
      : fields, options);
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(f.records.parents.get('42').fields.DATAPGTOEFETUADO, '2026-10-16T00:00:00Z');
});

test('parent date readback accepts equivalent SharePoint ISO precision', async () => {
  const f = fixture({ single: true });
  const update = f.repository.updateItem;
  f.repository.updateItem = (site, list, id, fields, options) => update(site, list, id,
    fields.DATAPGTOEFETUADO
      ? { ...fields, DATAPGTOEFETUADO: list === 'children'
        ? `${fields.DATAPGTOEFETUADO}T00:00:00Z`
        : fields.DATAPGTOEFETUADO.replace(/Z$/, '.000Z') }
      : fields, options);
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.match(f.records.parents.get('42').fields.DATAPGTOEFETUADO, /^2026-10-16/);
});

test('changing the due date updates an existing parent due date when payment dates remain blank', async () => {
  const f = fixture({ single: true, parentDates: { DATAPREVISTOPGTO: '2026-10-20T00:00:00Z' } });
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPREVISTOPGTO: '2026-10-25' });
  assert.match(f.records.parents.get('42').fields.DATAPREVISTOPGTO, /^2026-10-25/);
});

test('missing payment-date metadata cannot be treated as proof that every parent date is blank', async () => {
  const f = fixture({ single: true });
  const getColumns = f.repository.getColumns;
  f.repository.getColumns = async (site, list) => (await getColumns(site, list))
    .filter(column => list !== 'parents' || column.name !== 'PGTOAGENDADO');
  await f.data.saveEditor(await f.data.loadEditor('2'), { DATAPGTOEFETUADO: '2026-10-16' });
  assert.equal(f.records.parents.get('42').fields.DATAPGTOEFETUADO, null);
});

test('a parent write failure leaves the child saved and a retry completes only the missing total', async () => {
  const f = fixture();
  const update = f.repository.updateItem;
  let once = true;
  f.repository.updateItem = (...args) => {
    if (args[1] === 'parents' && once) { once = false; throw new Error('offline'); }
    return update(...args);
  };
  const context = await f.data.loadEditor('2');
  await assert.rejects(f.data.saveEditor(context, { VALORTOTAL: '5' }), /offline/);
  assert.equal(f.records.children.get('2').fields.VALORTOTAL, '5');
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '30');
  await f.data.saveEditor(context, { VALORTOTAL: '5' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '25');
  assert.equal(f.writes.filter(write => write.list === 'children').length, 1);
});

test('quantity and freight preserve exact decimal totals when a provision amount changes', async () => {
  const f = fixture();
  Object.assign(f.records.children.get('2').fields, { QTD: '2.5', VALORTOTAL: '0.10', FRETE: '0.05' });
  Object.assign(f.records.children.get('3').fields, { QTD: '1', VALORTOTAL: '20', FRETE: '0' });
  f.records.parents.get('42').fields.VALORTOTAL = '20.3';
  await f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: '0.20' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '20.55');
});

test('a sibling changed during the parent write is included before synchronization reports success', async () => {
  const f = fixture();
  const update = f.repository.updateItem;
  let raced = false;
  f.repository.updateItem = async (...args) => {
    const saved = await update(...args);
    if (args[1] === 'parents' && !raced) {
      raced = true;
      f.records.children.get('3').fields.VALORTOTAL = '30';
      f.records.children.get('3').eTag += 'n';
    }
    return saved;
  };
  await f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: '5' });
  assert.equal(f.records.parents.get('42').fields.VALORTOTAL, '35');
});

test('the pending-payment due-date pencil uses the same child-to-parent date rule', async () => {
  const f = fixture({ single: true });
  const popup = createPendingProvisionAttachmentsData({ repository: f.repository });
  await popup.updateDueDate('2', '2026-10-25');
  assert.match(f.records.parents.get('42').fields.DATAPREVISTOPGTO, /^2026-10-25/);
});

test('an invalid edited amount is rejected before writing the child or the parent', async () => {
  const f = fixture();
  await assert.rejects(f.data.saveEditor(await f.data.loadEditor('2'), { VALORTOTAL: 'NÃO É NÚMERO' }), /decimal|valor/i);
  assert.deepEqual(f.writes, []);
});
