import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvisionLaunchLink } from '../src/chat/provision-launch-link.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createPendingProvisionAttachmentsData } from '../src/chat/orders-gallery-data.js';

function fixture() {
  const text = name => ({name, text: {}});
  const date = name => ({name, dateTime: {}});
  const number = name => ({name, number: {}});
  const columns = {
    DESCRITIVOPROVISAO: [date('DATAPGTOEFETUADO'), date('DATAPREVISTOPGTO')],
    'PROVISÃO PGTOS': [text('DESCRITIVOPROVISAO'), text('IDLANCAMENTOS'), text('STATUS'), text('PGTOAGENDADO'),
      text('FORNECEDOR'), text('FILIAL'), text('PRODUTO'), text('QTD'), text('VALORTOTAL'), text('FRETE'),
      date('DATAPGTOEFETUADO'), date('DATAPREVISTOPGTO')],
    LANCAMENTOS: [text('IDPGTOAGENDADO'), {...text('field_5'), displayName: 'FORNECEDOR'}, {...text('Title'), displayName: 'FILIAL'},
      {...date('field_4'), displayName: 'DATA PGTO EFETUADO'}, {...number('field_8'), displayName: 'QUANTIDADE'},
      {...number('field_9'), displayName: 'VALOR UNITÁRIO'}, {...number('field_10'), displayName: 'FRETE'}],
  };
  const item = (id, fields) => ({id, eTag: '"1"', fields});
  const parent = item('21', {DATAPREVISTOPGTO: '2026-11-10T12:00:00Z'});
  const child = item('41', {DESCRITIVOPROVISAO: '21', STATUS: 'PAGAMENTO PREVISTO', FORNECEDOR: 'Fornecedor teste',
    FILIAL: '004 - Edifício', PRODUTO: 'Contabilidade', QTD: '1', VALORTOTAL: '300', DATAPREVISTOPGTO: '2026-11-10T12:00:00Z'});
  const launch = item('81', {field_5: 'FORNECEDOR TESTE', Title: '004 - Edifício (Todos)', field_4: '2026-11-10T01:00:00Z',
    field_8: 1, field_9: 300, field_10: 0});
  const rows = {DESCRITIVOPROVISAO: {'21': parent}, 'PROVISÃO PGTOS': {'41': child}, LANCAMENTOS: {'81': launch}};
  const writes = [];
  let fail;
  const repository = {
    resolveList: async (_, [name]) => ({id: name, status: 'resolved'}),
    getColumns: async (_, list) => columns[list],
    listAttachments: async () => [],
    getItem: async (_, list, id) => structuredClone(rows[list][id]),
    getItemsPage: async (_, list, query) => {
      assert.match(query, /\$top=100$/);
      return {items: structuredClone(Object.values(rows[list])), hasMore: false};
    },
    async updateItem(_, list, id, fields, {eTag}) {
      const row = rows[list][id];
      assert.equal(row.eTag, eTag);
      if (fail?.(list, fields, false)) throw new Error('erro de rede simulado');
      writes.push([list, id, fields]);
      Object.assign(row.fields, fields);
      row.eTag = JSON.stringify(String(Number(JSON.parse(eTag)) + 1));
      if (fail?.(list, fields, true)) throw new Error('resposta de gravação perdida');
      return structuredClone(row);
    },
  };
  return {service: createProvisionLaunchLink({repository}), repository, parent, child, launch, rows, writes,
    setFailure(callback) { fail = callback; }};
}

test('vincula nas duas direções e baixa usando o dia de São Paulo do lançamento', async () => {
  const f = fixture();
  const preview = await f.service.preview('21', '81');
  assert.equal(preview.launch.paidDate, '2026-11-09');
  assert.equal(preview.launch.total, 300);
  assert.deepEqual(preview.children.map(row => row.id), ['41']);
  assert.equal(f.writes.length, 0);
  const result = await f.service.save(preview, '41');
  assert.equal(result.parentPaid, true);
  assert.equal(f.launch.fields.IDPGTOAGENDADO, '41');
  assert.equal(f.child.fields.IDLANCAMENTOS, '81');
  assert.equal(f.child.fields.PGTOAGENDADO, 'PAGO');
  assert.equal(Date.parse(f.child.fields.DATAPGTOEFETUADO), Date.parse(f.launch.fields.field_4));
  assert.equal(Date.parse(f.parent.fields.DATAPGTOEFETUADO), Date.parse(f.launch.fields.field_4));
  assert.equal(f.child.fields.VALORTOTAL, '300');
  assert.equal((await f.service.save(preview, '41')).parentPaid, true);
});

test('recusa lançamento sem data, com outro vínculo ou alterado depois da conferência', async () => {
  const f = fixture(), paid = f.launch.fields.field_4;
  f.launch.fields.field_4 = '';
  await assert.rejects(f.service.preview('21', '81'), /data de pagamento efetivo/i);
  f.launch.fields.field_4 = paid;
  f.launch.fields.IDPGTOAGENDADO = '42';
  await assert.rejects(f.service.preview('21', '81'), /outra provisão/i);
  delete f.launch.fields.IDPGTOAGENDADO;
  const preview = await f.service.preview('21', '81');
  f.launch.fields.field_4 = '2026-11-08';
  f.launch.eTag = '"2"';
  await assert.rejects(f.service.save(preview, '41'), /alterado/i);
  assert.equal(f.writes.length, 0);
});

test('mantém descritivo aberto se há outro item pendente e avança seu vencimento', async () => {
  const f = fixture();
  f.rows['PROVISÃO PGTOS']['42'] = {id: '42', eTag: '"1"', fields: {
    ...f.child.fields, DATAPREVISTOPGTO: '2026-11-16T12:00:00Z', PRODUTO: 'Outro',
  }};
  const preview = await f.service.preview('21', '81');
  assert.equal(preview.children.length, 2);
  const result = await f.service.save(preview, '41');
  assert.deepEqual(result.pendingChildIds, ['42']);
  assert.equal(result.parentPaid, false);
  assert.equal(f.parent.fields.DATAPGTOEFETUADO, undefined);
  assert.equal(f.rows['PROVISÃO PGTOS']['42'].fields.PGTOAGENDADO, undefined);
  assert.equal(result.dueDate, '2026-11-16');
});

test('retoma a baixa parcial e reconhece resposta perdida sem repetir os vínculos', async () => {
  const f = fixture(), preview = await f.service.preview('21', '81');
  f.setFailure((list, fields, written) => list === 'PROVISÃO PGTOS' && fields.PGTOAGENDADO && !written);
  await assert.rejects(f.service.save(preview, '41'), /erro de rede/);
  assert.equal(f.child.fields.PGTOAGENDADO, undefined);
  f.setFailure((list, fields, written) => list === 'PROVISÃO PGTOS' && fields.PGTOAGENDADO && written);
  const retry = await f.service.preview('21', '81');
  assert.equal((await f.service.save(retry, '41')).parentPaid, true);
  assert.equal(f.writes.filter(([list]) => list === 'LANCAMENTOS').length, 1);
});

test('se a escrita no descritivo falhar, um novo serviço retoma somente o fechamento já vinculado', async () => {
  const f = fixture(), preview = await f.service.preview('21', '81');
  const journal = [];
  f.setFailure((list, _, written) => list === 'DESCRITIVOPROVISAO' && !written);
  await assert.rejects(f.service.save(preview, '41', { rememberOperation: record => journal.push(record) }), /erro de rede/);
  assert.equal(f.child.fields.PGTOAGENDADO, 'PAGO');
  assert.deepEqual(journal, [{ id: '21', launchId: '81', childId: '41' }]);
  assert.equal(f.parent.fields.DATAPGTOEFETUADO, undefined);
  f.setFailure(null);
  const restarted = createProvisionLaunchLink({ repository: f.repository });
  const resumed = await restarted.preview('21', '81');
  assert.equal((await restarted.save(resumed, '41')).parentPaid, true);
  assert.equal(f.writes.filter(([list]) => list === 'LANCAMENTOS').length, 1);
  assert.equal(f.writes.filter(([list, , fields]) => list === 'PROVISÃO PGTOS' && fields.PGTOAGENDADO).length, 1);
});

test('reabre o descritivo se uma nova provisão aparecer durante o fechamento', async () => {
  const f = fixture(), preview = await f.service.preview('21', '81');
  f.setFailure((list, fields, written) => {
    if (list === 'DESCRITIVOPROVISAO' && fields.DATAPGTOEFETUADO && written) {
      f.rows['PROVISÃO PGTOS']['42'] = {id: '42', eTag: '"1"', fields: {
        DESCRITIVOPROVISAO: '21', STATUS: 'PAGAMENTO PREVISTO', DATAPREVISTOPGTO: '2026-11-18',
      }};
    }
    return false;
  });
  await assert.rejects(f.service.save(preview, '41'), /voltou a ficar pendente/i);
  assert.equal(f.parent.fields.DATAPGTOEFETUADO, null);
  const result = await f.service.save(preview, '41');
  assert.equal(result.parentPaid, false);
  assert.deepEqual(result.pendingChildIds, ['42']);
});

test('data antiga no descritivo não interrompe a baixa de filhos pendentes', async () => {
  const f = fixture();
  f.parent.fields.DATAPGTOEFETUADO = '2026-10-01T12:00:00Z';
  f.rows['PROVISÃO PGTOS']['42'] = {id: '42', eTag: '"1"', fields: {
    ...f.child.fields, DATAPREVISTOPGTO: '2026-11-18T12:00:00Z',
  }};
  const preview = await f.service.preview('21', '81');
  assert.equal((await f.service.save(preview, '41')).parentPaid, false);
  assert.equal(f.parent.fields.DATAPGTOEFETUADO, '2026-10-01T12:00:00Z');
  f.rows.LANCAMENTOS['82'] = {id: '82', eTag: '"1"', fields: {
    ...f.launch.fields, IDPGTOAGENDADO: '', field_4: '2026-11-19T12:00:00Z',
  }};
  assert.equal((await f.service.save(await f.service.preview('21', '82'), '42')).parentPaid, true);
  assert.equal(Date.parse(f.parent.fields.DATAPGTOEFETUADO), Date.parse(f.rows.LANCAMENTOS['82'].fields.field_4));
});

test('um conflito no vínculo reverso preserva o vínculo que já existia na provisão', async () => {
  const f = fixture();
  f.child.fields.IDLANCAMENTOS = '81';
  const preview = await f.service.preview('21', '81');
  f.setFailure((list, fields, written) => {
    if (list !== 'LANCAMENTOS' || !fields.IDPGTOAGENDADO || written) return false;
    f.launch.fields.IDPGTOAGENDADO = '42';
    f.launch.eTag = '"2"';
    return true;
  });
  await assert.rejects(f.service.save(preview, '41'), /outra provisão/i);
  assert.equal(f.child.fields.IDLANCAMENTOS, '81');
  assert.equal(f.child.fields.PGTOAGENDADO, undefined);
});

test('edição concorrente no valor da provisão impede a baixa antes da confirmação', async () => {
  const f = fixture(), preview = await f.service.preview('21', '81');
  f.setFailure((list, fields, written) => {
    if (list === 'PROVISÃO PGTOS' && fields.IDLANCAMENTOS && written) {
      f.child.fields.VALORTOTAL = '400';
      f.child.eTag = '"3"';
    }
    return false;
  });
  await assert.rejects(f.service.save(preview, '41'), /alterados/);
  assert.equal(f.child.fields.PGTOAGENDADO, undefined);
});

test('um filho inativo não aparece como pagamento pendente', async () => {
  const f = fixture();
  f.rows['PROVISÃO PGTOS']['42'] = {id: '42', eTag: '"1"', fields: {
    ...f.child.fields, STATUS: 'CANCELADO', DATAPREVISTOPGTO: null,
  }};
  const preview = await f.service.preview('21', '81');
  assert.deepEqual(preview.children.map(row => row.id), ['41']);
  assert.equal((await f.service.save(preview, '41')).parentPaid, true);
  assert.equal(f.rows['PROVISÃO PGTOS']['42'].fields.STATUS, 'CANCELADO');
});

test('fluxo do relatório consulta pelo ID, confirma a baixa no adaptador e retira apenas o descritivo pago', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T15:00:00Z') });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  const f = fixture(), handlers = new Map();
  let state;
  const controller = createAppController({
    store: createConversationStore({ randomUUID: () => 'teste' }),
    view: {
      render(next) { state = next; },
      on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
      focusComposer() {}, destroy() {},
    },
    auth: { initialize: async () => ({ homeAccountId: 'teste' }), getToken: async () => 'token-ficticio', signOut: async () => {} },
    client: {
      sendText: async () => ({ status: 'processed', messages: [] }),
      getPendingProvisionSnapshot: async () => ({ due: true, sourceKind: 'provision-description', rows: [
        { id: '21', supplier: 'Fornecedor teste', dueDate: '2026-11-10', total: '300' },
        { id: '22', supplier: 'Outro fornecedor', dueDate: '2026-11-10', total: '100' },
      ] }),
    },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: options => createPendingProvisionAttachmentsData({ ...options, repository: f.repository }),
  });
  t.after(() => controller.stop());
  await controller.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await handlers.get('open-pending-provision-link')({ paymentId: '21' }), true);
  assert.equal(await handlers.get('lookup-pending-provision-launch')({ value: '81' }), true);
  assert.equal(state.pendingProvisionLink.preview.children[0].id, '41');
  assert.equal(f.writes.length, 0);
  f.setFailure((list, _, written) => list === 'DESCRITIVOPROVISAO' && !written);
  assert.equal(await handlers.get('confirm-pending-provision-link')({ value: '41' }), false);
  assert.equal(state.pendingProvisionLink.status, 'error');
  assert.deepEqual(state.pendingProvisionLinkRecoveries, [{ id: '21', launchId: '81', childId: '41' }]);
  assert.equal(await handlers.get('close-pending-provision-link')({}), true);
  f.setFailure(null);
  assert.equal(await handlers.get('resume-pending-provision-link')({ paymentId: '21', value: '81' }), true);
  assert.equal(await handlers.get('confirm-pending-provision-link')({ value: '41' }), true);
  assert.equal(state.pendingProvisionLink.status, 'success');
  assert.deepEqual(state.pendingProvisionLinkRecoveries, []);
  assert.deepEqual(state.pendingProvisions.rows.map(row => row.id), ['22']);
  assert.equal(await handlers.get('close-pending-provision-link')({}), true);
  assert.equal(state.pendingProvisionLink, null);
});
