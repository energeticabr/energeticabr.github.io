import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationGalleryData } from '../apps/energetico-mobile/src/chat/registration-gallery-data.js';
import { createGalleryRecordData } from '../apps/energetico-mobile/src/chat/gallery-record-data.js';
import { getPowerAppsUiContract } from '../portal/catalog/powerapps-ui-contract.js';

async function fixture(kind = 'contracts', { lookupOptions, prepareEditColumns, columns: suppliedColumns,
  candidateOptions, fields: suppliedFields = {}, searchOptions } = {}) {
  const entity = kind === 'contracts' ? 'empreiteiros' : 'descricoes-de-presenca';
  const contract = getPowerAppsUiContract(entity, { mode: 'edit' });
  const fields = { FILIAL: 'OBRA A', FORNECEDOR: 'FORNECEDOR A', IDDESCRITIVOETAPA: '7', ATIVIDADEEXECUTADA: 'ATUAL', ...suppliedFields };
  const calls = [], writes = [];
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'fictional-list' }),
    getColumns: async () => suppliedColumns || contract.formFields.map(name => ({ name, text: {} })),
    getItem: async () => ({ id: '42', eTag: '"fixture-v1"', fields }),
    getItemsPage: async () => ({ items: [], hasMore: false }),
    async searchPowerAppsOptions(site, source, term, dependencies, options) {
      calls.push({ site, source, term, dependencies, options });
      if (searchOptions) return searchOptions(site, source, term, dependencies, options);
      if (source.listName === 'FORNECEDORES' && source.valueField === 'ATIVIDADE EXERCIDA'
        || source.listName === 'DEMONSTRATIVOETAPA' && source.valueField === 'ETAPA') {
        return lookupOptions ?? [{ value: 'ALVENARIA', label: 'ALVENARIA' }];
      }
      if (source.listName === 'FILIAIS') return [{ value: 'OBRA B', label: 'OBRA B' }];
      if (source.valueField === 'CADASTRO') return [{ value: 'FORNECEDOR B', label: 'FORNECEDOR B' }];
      if (source.valueField === 'ID') return [{ value: '8', label: '8 - ETAPA' }];
      if (source.fixedFilters?.some(filter => filter.fieldName === 'ATIVIDADE EXECUTADA' || filter.fieldName === 'ETAPA')) {
        return candidateOptions ?? [{ value: 'ALVENARIA', label: 'ALVENARIA' }, { value: 'PINTURA', label: 'PINTURA' }];
      }
      return [{ value: 'ALVENARIA', label: 'ALVENARIA' }, { value: 'PINTURA', label: 'PINTURA' }];
    },
    async updateItem(...args) { writes.push(args); return { id: args[2], fields: args[3] }; },
  };
  const data = prepareEditColumns
    ? createGalleryRecordData({ repository, listName: 'EMPREITEIRO', resolveList: repository.resolveList, prepareEditColumns })
    : createRegistrationGalleryData({ kind, repository });
  const context = await data.loadEditor('42');
  const column = context.columns.find(c => c.name === 'ATIVIDADEEXECUTADA');
  const source = column.powerApps.optionSources[0];
  const availability = source.availability;
  // Same public descriptors the dynamic form sends, using hand-checked fixture values.
  const lookup = {
    kind: 'filtered-list', entityId: availability.lookup.entityId,
    listName: availability.lookup.listName, valueField: availability.lookup.valueField,
    fixedFilters: [{ fieldName: availability.lookup.matchField, operator: 'eq', value: kind === 'contracts' ? 'FORNECEDOR A' : '7' }],
    displayFields: [availability.lookup.valueField], searchFields: [availability.lookup.valueField],
  };
  const { availability: _availability, ...base } = source;
  const candidate = { ...base, dependsOn: availability.candidateDependencies,
    fixedFilters: [...(source.fixedFilters || []), { fieldName: availability.candidateField, operator: 'eq', value: 'ALVENARIA' }] };
  const search = (selectedSource, dependencies = {}, term = '') => context.powerAppsOptionSearch(column, selectedSource, term, dependencies, { limit: 20, browse: !term });
  return { context, column, source, lookup, candidate, search, calls, data, writes };
}

for (const kind of ['presenceDescriptions', 'contracts']) {
  test(`${kind} activity authorizes its exact availability lookup and candidate before opening alternatives`, async () => {
    const f = await fixture(kind);
    assert.deepEqual(await f.search(f.lookup), [{ value: 'ALVENARIA', label: 'ALVENARIA' }]);
    assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA A' })).length, 2);
    assert.equal((await f.search(f.source, { FILIAL: 'OBRA A' }, 'PIN'))[1].value, 'PINTURA');
    assert.deepEqual(f.calls.map(call => call.source.kind), ['filtered-list', 'dependent', 'dependent']);
  });
}

test('availability lookup rejects foreign list, field, value, dependency and nonempty search without repository access', async () => {
  const f = await fixture();
  const invalid = [
    { ...f.lookup, listName: 'OTHER LIST' },
    { ...f.lookup, valueField: 'CADASTRO' },
    { ...f.lookup, fixedFilters: [{ fieldName: 'OTHER', operator: 'eq', value: 'FORNECEDOR A' }] },
    { ...f.lookup, fixedFilters: [{ fieldName: 'CADASTRO', operator: 'eq', value: 'OTHER SUPPLIER' }] },
    { ...f.lookup, fixedFilters: [] },
    { ...f.lookup, fixedFilters: [...f.lookup.fixedFilters, { fieldName: 'STATUS', operator: 'eq', value: 'ATIVO' }] },
  ];
  for (const source of invalid) await assert.rejects(f.search(source), /comprovada/);
  await assert.rejects(f.search(f.lookup, { FILIAL: 'OBRA A' }), /comprovada/);
  await assert.rejects(f.search(f.lookup, {}, 'AL'), /comprovada/);
  assert.equal(f.calls.length, 0);
});

test('availability candidate requires a successful owned lookup and exact dependency values', async () => {
  const f = await fixture();
  await assert.rejects(f.search(f.candidate, { FILIAL: 'OBRA A' }), /comprovada/);
  await f.search(f.lookup);
  for (const dependencies of [{}, { FILIAL: 'OTHER' }, { FILIAL: 'OBRA A', EXTRA: 'x' }]) {
    await assert.rejects(f.search(f.candidate, dependencies), /comprovada/);
  }
  await assert.rejects(f.search({ ...f.candidate, fixedFilters: [{ fieldName: 'ATIVIDADE EXECUTADA', operator: 'eq', value: 'OTHER' }] }, { FILIAL: 'OBRA A' }), /comprovada/);
  await assert.rejects(f.search({ ...f.candidate, dependsOn: [{ fieldName: 'FILIAL', targetField: 'OTHER' }] }, { FILIAL: 'OBRA A' }), /comprovada/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA A' })).length, 2);
});

test('availability allows changed editable parents only after their own catalog has proved the values', async () => {
  const f = await fixture();
  const lookup = { ...f.lookup, fixedFilters: [{ fieldName: 'CADASTRO', operator: 'eq', value: 'FORNECEDOR B' }] };
  await assert.rejects(f.search(lookup), /comprovada/);
  for (const name of ['FORNECEDOR', 'FILIAL']) {
    const parent = f.context.columns.find(c => c.name === name);
    await f.context.powerAppsOptionSearch(parent, parent.powerApps.optionSources[0], '', {}, { browse: true, limit: 20 });
  }
  assert.equal((await f.search(lookup))[0].value, 'ALVENARIA');
  assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA B' })).length, 2);
});

for (const lookupOptions of [[], [{ value: 'ALVENARIA', label: 'ALVENARIA' }, { value: 'PINTURA', label: 'PINTURA' }], [{ value: {}, label: 'INVALID' }]]) {
  test(`availability candidate is not trusted after empty, ambiguous or malformed lookup (${JSON.stringify(lookupOptions)})`, async () => {
    const f = await fixture('contracts', { lookupOptions });
    await f.search(f.lookup).catch(() => {});
    await assert.rejects(f.search(f.candidate, { FILIAL: 'OBRA A' }), /comprovada/);
    assert.equal(f.calls.length, 1);
  });
}

test('malformed availability outcomes cannot grant a derived lookup', async () => {
  const f = await fixture('contracts', { prepareEditColumns: ({ columns }) => columns.map(column => column.name !== 'ATIVIDADEEXECUTADA' ? column : {
    ...column, powerApps: { ...column.powerApps, optionSources: column.powerApps.optionSources.map(source => ({ ...source, availability: { ...source.availability, whenMissing: 'source' } })) },
  }) });
  await assert.rejects(f.search(f.lookup), /comprovada/);
  await assert.rejects(f.data.saveEditor(f.context, { ATIVIDADEEXECUTADA: 'PINTURA' }), /comprovada/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.length, 0);
});

test('availability candidate preserves every fixed filter owned by the original source', async () => {
  const f = await fixture('contracts', { prepareEditColumns: ({ columns }) => columns.map(column => column.name !== 'ATIVIDADEEXECUTADA' ? column : {
    ...column, powerApps: { ...column.powerApps, optionSources: column.powerApps.optionSources.map(source => ({
      ...source, fixedFilters: [{ fieldName: 'STATUS', operator: 'eq', value: 'ATIVO' }],
    })) },
  }) });
  await f.search(f.lookup);
  const withoutOriginalFilter = { ...f.candidate, fixedFilters: f.candidate.fixedFilters.slice(1) };
  await assert.rejects(f.search(withoutOriginalFilter, { FILIAL: 'OBRA A' }), /comprovada/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA A' })).length, 2);
});

test('availability proof is invalidated before a repeated lookup returns no match', async () => {
  const lookupOptions = [{ value: 'ALVENARIA', label: 'ALVENARIA' }];
  const f = await fixture('contracts', { lookupOptions });
  await f.search(f.lookup);
  assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA A' })).length, 2);
  lookupOptions.length = 0;
  await f.search(f.lookup);
  await assert.rejects(f.search(f.candidate, { FILIAL: 'OBRA A' }), /comprovada/);
  assert.equal(f.calls.length, 3);
});

test('availability proof belongs to its own loaded editor context', async () => {
  const first = await fixture(), second = await fixture();
  await first.search(first.lookup);
  await assert.rejects(second.search(second.candidate, { FILIAL: 'OBRA A' }), /comprovada/);
  assert.equal(second.calls.length, 0);
});

test('record-bound availability dependency cannot be replaced by another proved parent value', async () => {
  const f = await fixture('presenceDescriptions');
  const parent = f.context.columns.find(c => c.name === 'FILIAL');
  await f.context.powerAppsOptionSearch(parent, parent.powerApps.optionSources[0], '', {}, { browse: true, limit: 20 });
  await f.search(f.lookup);
  await assert.rejects(f.search(f.candidate, { FILIAL: 'OBRA B' }), /comprovada/);
  assert.equal((await f.search(f.candidate, { FILIAL: 'OBRA A' })).length, 2);
});

test('quote ID replacement is revalidated by exact value while preserving its owned display source', async () => {
  const searches = [], saved = [];
  const repository = {
    getColumns: async () => [{ name: 'ORCAMENTOESCOLHIDO', text: {} }],
    getItem: async () => ({ id: '7', eTag: '"v1"', fields: { ORCAMENTOESCOLHIDO: '41' } }),
    async searchPowerAppsOptions(site, source, term, dependencies, options) {
      searches.push({ site, source, term, dependencies, options });
      return options.exactValue === true && term === '42' ? [{ value: '42', label: '42 - FORNECEDOR (ETAPA)' }] : [];
    },
    updateItem: async (...args) => { saved.push(args); return { id: '7', fields: args[3] }; },
  };
  const data = createGalleryRecordData({ repository, listName: 'NOVACOTACAO', resolveList: async () => ({ id: 'quotes' }) });
  const context = await data.loadEditor('7');
  await data.saveEditor(context, { ORCAMENTOESCOLHIDO: '42' });
  assert.deepEqual(searches[0].options, { limit: 20, exactValue: true });
  assert.equal(searches[0].source.valueField, 'ID');
  assert.deepEqual(searches[0].source.searchFields, ['EXIBICAO']);
  assert.equal(saved[0][4].eTag, '"v1"');
});

test('native group person fields remain unresolvable and cannot use an availability source', async () => {
  const calls = [];
  const repository = {
    getColumns: async () => [{ name: 'OWNER', personOrGroup: { chooseFromType: 'peopleAndGroups', allowMultipleSelection: true } }],
    getItem: async () => ({ id: '42', eTag: '"v1"', fields: {} }),
    searchRelationshipOptions: async (...args) => { calls.push(args); return []; },
    searchPowerAppsOptions: async (...args) => { calls.push(args); return []; },
  };
  const data = createGalleryRecordData({ repository, listName: 'CUSTOM', metadataOnly: true, resolveList: async () => ({ id: 'custom' }) });
  const context = await data.loadEditor('42'), column = context.columns[0];
  await assert.rejects(context.relationshipSearch(column, ''), /comprovada/);
  await assert.rejects(context.powerAppsOptionSearch(column, { kind: 'filtered-list', listName: 'OTHER', valueField: 'Title' }, '', {}), /comprovada/);
  assert.equal(calls.length, 0);
});

for (const kind of ['contracts', 'presenceDescriptions']) {
  test(`${kind} save replays availability after selection and recovers once with a fresh valid gate`, async () => {
    const lookupOptions = [{ value: 'ALVENARIA', label: 'ALVENARIA' }];
    const f = await fixture(kind, { lookupOptions });
    await f.search(f.lookup);
    await f.search(f.candidate, { FILIAL: 'OBRA A' });
    lookupOptions.length = 0;
    await assert.rejects(f.data.saveEditor(f.context, { ATIVIDADEEXECUTADA: 'PINTURA' }), /disponibilidade|comprovada|válida/i);
    assert.equal(f.writes.length, 0);
    const failedSaveCall = f.calls.at(-1);
    assert.deepEqual(failedSaveCall.source, f.lookup);
    assert.equal(failedSaveCall.term, '');
    assert.equal(failedSaveCall.options.exactValue, undefined);
    lookupOptions.push({ value: 'ALVENARIA', label: 'ALVENARIA' });
    await f.data.saveEditor(f.context, { ATIVIDADEEXECUTADA: 'PINTURA' });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0][3].ATIVIDADEEXECUTADA, 'PINTURA');
    assert.equal(f.writes[0][4].eTag, '"fixture-v1"');
    assert.deepEqual(f.calls.slice(-3).map(call => ({ term: call.term, exactValue: call.options.exactValue })), [
      { term: '', exactValue: undefined }, { term: '', exactValue: undefined }, { term: 'PINTURA', exactValue: true },
    ]);
  });

  for (const condition of ['missing lookup', 'multiple lookup', 'missing candidate']) {
    test(`${kind} save blocks ${condition} before any write`, async () => {
      const f = await fixture(kind, {
        lookupOptions: condition === 'missing lookup' ? [] : condition === 'multiple lookup'
          ? [{ value: 'ALVENARIA', label: 'ALVENARIA' }, { value: 'PINTURA', label: 'PINTURA' }] : undefined,
        candidateOptions: condition === 'missing candidate' ? [] : undefined,
      });
      await assert.rejects(f.data.saveEditor(f.context, { ATIVIDADEEXECUTADA: 'PINTURA' }), /disponibilidade|comprovada|válida/i);
      assert.equal(f.writes.length, 0);
    });
  }

  test(`${kind} changed availability parent revalidates an unchanged child with merged fields`, async () => {
    const parent = kind === 'contracts' ? 'FORNECEDOR' : 'IDDESCRITIVOETAPA';
    const updated = kind === 'contracts' ? 'FORNECEDOR B' : '8';
    const f = await fixture(kind, { lookupOptions: [] });
    await assert.rejects(f.data.saveEditor(f.context, { [parent]: updated }), /disponibilidade|comprovada|válida/i);
    assert.equal(f.writes.length, 0);
    const gate = f.calls.find(call => call.source.valueField === (kind === 'contracts' ? 'ATIVIDADE EXERCIDA' : 'ETAPA'));
    assert.equal(gate.source.fixedFilters[0].value, updated);
  });

  test(`${kind} blank availability parent follows whenBlank source without auxiliary lookups`, async () => {
    const parent = kind === 'contracts' ? 'FORNECEDOR' : 'IDDESCRITIVOETAPA';
    const f = await fixture(kind, { fields: { [parent]: '' }, lookupOptions: [] });
    await f.data.saveEditor(f.context, { ATIVIDADEEXECUTADA: 'PINTURA' });
    assert.equal(f.writes.length, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.exactValue, true);
    assert.equal(f.calls[0].term, 'PINTURA');
  });
}

test('candidate-only parent changes revalidate retained activity while keeping fixed filters and transforms', async () => {
  const f = await fixture('contracts', {
    fields: { LOOKUPCONTEXT: 'FORNECEDOR A|SUFFIX', CANDIDATECONTEXT: 'OBRA A|SUFFIX' },
    prepareEditColumns: ({ columns }) => [
      ...columns.map(column => column.name !== 'ATIVIDADEEXECUTADA' ? column : {
        ...column, powerApps: { ...column.powerApps, optionSources: column.powerApps.optionSources.map(source => ({ ...source,
          fixedFilters: [{ fieldName: 'STATUS', operator: 'eq', value: 'ATIVO' }],
          availability: { ...source.availability,
            lookup: { ...source.availability.lookup, dependency: { fieldName: 'LOOKUPCONTEXT', transform: { kind: 'split-first', separator: '|' } } },
            candidateDependencies: [{ fieldName: 'CANDIDATECONTEXT', targetField: 'FILIAL', transform: { kind: 'split-first', separator: '|' } }],
          },
        })) },
      }),
      ...['LOOKUPCONTEXT', 'CANDIDATECONTEXT'].map(name => ({ name, label: name, editable: true, control: 'text' })),
    ],
    searchOptions: async (_site, source, term, dependencies) => {
      if (source.valueField === 'ATIVIDADE EXERCIDA') {
        assert.equal(source.fixedFilters[0].value, 'FORNECEDOR A');
        assert.equal(term, '');
        return [{ value: 'ALVENARIA', label: 'ALVENARIA' }];
      }
      if (source.fixedFilters?.some(filter => filter.fieldName === 'ATIVIDADE EXECUTADA')) {
        assert.deepEqual(source.fixedFilters, [{ fieldName: 'STATUS', operator: 'eq', value: 'ATIVO' },
          { fieldName: 'ATIVIDADE EXECUTADA', operator: 'eq', value: 'ALVENARIA' }]);
        assert.deepEqual(source.dependsOn, [{ fieldName: 'CANDIDATECONTEXT', targetField: 'FILIAL', transform: { kind: 'split-first', separator: '|' } }]);
        assert.deepEqual(dependencies, { CANDIDATECONTEXT: 'OBRA B|SUFFIX' });
        return [];
      }
      return [{ value: 'ATUAL', label: 'ATUAL' }];
    },
  });
  await assert.rejects(f.data.saveEditor(f.context, { CANDIDATECONTEXT: 'OBRA B|SUFFIX' }), /disponibilidade|comprovada|válida/i);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.length, 2);
});
