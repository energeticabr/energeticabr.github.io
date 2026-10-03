// Catalog filter Items are taken from G22/G14/G13/G39/G19_2 and
// G31/G48/G6/G49/G23/G25 in the extracted Power Apps source. Internal aliases
// below are proven by References/DataSources.json; live metadata must still
// identify exactly one column before any values are exposed.
function key(value) {
  return String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function source(listName, sourceField, options = {}) {
  return freeze({ listName, listAliases: [listName], sourceField, dependsOn: [], disabledUntil: [], ...options });
}
const branch = source('FILIAIS', 'FILIAL', { sourceAliases: ['Title'] });
const stages = source('LANCAMENTOOBRA', 'ETAPA', {
  listAliases: ['LANCAMENTOOBRA', 'LANCAMENTO OBRA'], sourceAliases: ['field_3'], dependsOn: ['FILIAL'],
  conditions: [{ sourceField: 'FILIAL', filterField: 'FILIAL', optional: true }],
});
const suppliers = source('FORNECEDORES', 'CADASTRO', { sourceAliases: ['Title'] });
const contractorSuppliers = source('FORNECEDORES', 'CADASTRO', {
  sourceAliases: ['Title'], conditions: [{ sourceField: 'EMPREITEIRO', value: 'SIM' }],
});
const activeContracts = source('EMPREITEIRO', 'ID', {
  labelFields: ['FORNECEDOR'], conditions: [{ sourceField: 'STATUS', value: 'ATIVO' }],
});
export const REGISTRATION_GALLERY_FILTER_SOURCES = freeze({
  asset: { FILIAL: branch, IMOBILIZADO: source('CADASTROIMOBILIZADO', 'IMOBILIZADO', { listAliases: ['CADASTROIMOBILIZADO', 'CADASTRO IMOBILIZADO'] }) },
  assetFunction: {},
  assetProduct: { FUNCAO: source('FUNCAOIMOBILIZADO', 'FUNCAO', { listAliases: ['FUNCAOIMOBILIZADO', 'FUNÇÃO IMOBILIZADO'] }) },
  assetGroup: { GRUPOIMOBILIZADOS: source('CADASTROIMOBILIZADO', 'GRUPOIMOBILIZADO', { listAliases: ['CADASTROIMOBILIZADO', 'CADASTRO IMOBILIZADO'] }) },
  workDiary: { FILIAL: branch, ETAPA: stages },
  quotes: { FILIAL: branch, ETAPA: source(stages.listName, stages.sourceField, {
    ...stages, disabledUntil: ['FILIAL'], conditions: [{ sourceField: 'FILIAL', filterField: 'FILIAL' }],
  }) },
  contracts: { FILIAL: branch, FORNECEDOR: contractorSuppliers },
  contractLines: {
    FILIAL: branch,
    FORNECEDOR: source(suppliers.listName, suppliers.sourceField, { ...suppliers,
      conditions: [{ sourceField: 'EMPREITEIRO', value: 'SIM' }, { sourceField: 'STATUS', value: 'ATIVO' }],
    }),
    IDCONTRATO: source(activeContracts.listName, activeContracts.sourceField, { ...activeContracts,
      dependsOn: ['FORNECEDOR'], conditions: [...activeContracts.conditions, { sourceField: 'FORNECEDOR', filterField: 'FORNECEDOR', optional: true }],
    }),
  },
  measurements: {},
  measurementLines: {
    FILIAL: branch, NUMEROCONTRATO: activeContracts,
    FORNECEDOR: source('LINHASMEDICAO', 'FORNECEDOR', { dependsOn: ['FILIAL'], conditions: [{ sourceField: 'FILIAL', filterField: 'FILIAL', optional: true }] }),
  },
  stageDemonstratives: {
    FILIAL: branch, ETAPA: stages, FORNECEDOR: suppliers,
    ATIVIDADEEXECUTADA: source('ATIVIDADE EXECUTADA', 'ATIVIDADE EXECUTADA', { sourceAliases: ['ATIVIDADEEXECUTADA'] }),
  },
  constructionStages: { FILIAL: branch, ETAPA: source(stages.listName, stages.sourceField, {
    ...stages, conditions: [{ sourceField: 'FILIAL', filterField: 'FILIAL' }],
  }) },
  recurringTasks: {
    FILIAL: branch,
    FORNECEDOR: source('FORNECEDORES', 'CADASTRO', { sourceAliases: ['Title'], conditions: [
      { sourceField: 'FILIAL', value: '000 - ESCRITÓRIO CENTRAL' }, { sourceField: 'TIPO', value: 'MÃO DE OBRA' }, { sourceField: 'STATUS', value: 'ATIVO' },
    ] }),
    'ASSOCIAÇÃO': source('CADASTROTAREFAS', 'ASSOCIAÇÃO', { sourceAliases: ['field_1'] }),
    RECORRENCIA: source('TAREFASRECORRENTES', 'RECORRENCIA', { metadataChoices: true }),
  },
});

export function getRegistrationGalleryFilterSource(kind, field) {
  const fields = REGISTRATION_GALLERY_FILTER_SOURCES[kind];
  return Object.entries(fields || {}).find(([name]) => key(name) === key(field))?.[1] || null;
}
function abortError() { return new DOMException('A consulta das opções foi cancelada.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw signal.reason || abortError(); }
async function read(callback, signal) {
  checkAbort(signal);
  if (!signal) return callback();
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { checkAbort(signal); return callback(); }),
      new Promise((_, reject) => { onAbort = () => reject(signal.reason || abortError()); signal.addEventListener('abort', onAbort, { once: true }); }),
    ]);
  } finally { signal.removeEventListener('abort', onAbort); }
}
function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const property of ['lookupValue', 'LookupValue', 'Value', 'value']) {
      if (Object.hasOwn(value, property) && value[property] !== value) return scalar(value[property]);
    }
  }
  throw new TypeError('O catálogo retornou um valor de opção inválido.');
}
function filterValue(filters, field) {
  return scalar(Object.entries(filters || {}).find(([name]) => key(name) === key(field))?.[1]);
}
function columnFor(columns, field, aliases = []) {
  const accepted = new Set([field, ...aliases].map(key));
  const matches = columns.filter(column => column?.name && [column.name, column.displayName].some(name => name && accepted.has(key(name))));
  if (matches.length !== 1) throw new Error(`O campo ${field} do catálogo está ${matches.length ? 'ambíguo' : 'indisponível'}.`);
  // Column names become OData field selectors; reject unexpected syntax.
  if (!/^[a-z_][a-z0-9_]*$/i.test(matches[0].name)) throw new Error(`O campo ${field} do catálogo tem um nome interno inválido.`);
  return matches[0];
}
const MAX_PAGES = 100;

export function createRegistrationGalleryFilterData({ repository, siteKey = 'personal', kind } = {}) {
  if (!repository || typeof repository.resolveList !== 'function' || typeof repository.getItemsPage !== 'function') {
    throw new TypeError('As opções de catálogo exigem o repositório SharePoint e seus metadados.');
  }
  const cache = new Map();
  const generations = new Map();
  function getFilterSource(field) { return getRegistrationGalleryFilterSource(kind, field); }
  async function resolveCatalog(descriptor, signal) {
    const options = signal ? { signal } : {};
    if (typeof repository.listLists === 'function') {
      const lists = await read(() => repository.listLists(siteKey, options), signal);
      if (!Array.isArray(lists)) throw new Error('A consulta de listas do catálogo retornou um resultado inválido.');
      const aliases = new Set(descriptor.listAliases.map(key));
      const matches = lists.filter(list => aliases.has(key(list.displayName)));
      if (matches.length !== 1 || !matches[0].id) throw new Error(`A lista ${descriptor.listName} do catálogo está ${matches.length > 1 ? 'ambígua' : 'indisponível'}.`);
      return matches[0];
    }
    const list = await read(() => repository.resolveList(siteKey, descriptor.listAliases, options), signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${descriptor.listName} do catálogo não está disponível nesta conta SharePoint.`);
    return list;
  }
  async function loadFilterOptions(field, { filters = {}, signal, refresh = false } = {}) {
    checkAbort(signal);
    const descriptor = getFilterSource(field);
    if (!descriptor) return null;
    if (typeof repository.getColumns !== 'function') throw new Error('Os metadados do catálogo não estão disponíveis.');
    const fieldKey = key(field);
    const generation = (generations.get(fieldKey) || 0) + 1;
    generations.set(fieldKey, generation);
    function active() {
      checkAbort(signal);
      if (generations.get(fieldKey) !== generation) throw abortError();
    }
    const selected = Object.fromEntries(descriptor.dependsOn.map(name => [name, filterValue(filters, name)]));
    if (descriptor.disabledUntil.some(name => !filterValue(filters, name).trim())) return Object.freeze([]);
    const cacheKey = JSON.stringify([fieldKey, selected]);
    if (refresh) cache.delete(cacheKey);
    else if (cache.has(cacheKey)) return cache.get(cacheKey);
    const list = await resolveCatalog(descriptor, signal); active();
    const columns = await read(() => repository.getColumns(siteKey, list.id, signal ? { signal } : {}), signal); active();
    if (!Array.isArray(columns)) throw new Error('Os metadados do catálogo retornaram um resultado inválido.');
    const needed = new Map();
    needed.set(descriptor.sourceField, columnFor(columns, descriptor.sourceField, descriptor.sourceAliases));
    if (descriptor.metadataChoices) {
      const choices = needed.get(descriptor.sourceField).choice?.choices;
      if (!Array.isArray(choices) || choices.some(choice => typeof choice !== 'string')) throw new Error('As opções cadastradas do filtro não estão disponíveis.');
      const options = Object.freeze([...new Set(choices)].filter(choice => choice.trim()).map(value => Object.freeze({ value, label: value })));
      active(); cache.set(cacheKey, options); return options;
    }
    for (const name of [...(descriptor.labelFields || []), ...(descriptor.conditions || []).map(condition => condition.sourceField)]) {
      if (!needed.has(name)) needed.set(name, columnFor(columns, name));
    }
    function value(item, name) { return name === 'ID' ? scalar(item.id ?? item.fields[needed.get(name).name]) : scalar(item.fields[needed.get(name).name]); }
    const selectors = [...new Set([...needed.values()].map(column => column.name))].join(',');
    const query = `$select=id&$expand=fields($select=${selectors})&$top=100`;
    const values = new Map();
    const cursors = new Set();
    let cursor = '';
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      active();
      const page = await read(() => repository.getItemsPage(siteKey, list.id, query, {
        pageNumber, maxPages: MAX_PAGES, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}),
      }), signal);
      active();
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean') throw new Error('A consulta do catálogo retornou uma página inválida.');
      for (const item of page.items) {
        if (!item?.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) throw new Error('O catálogo retornou um registro inválido.');
        if (!(descriptor.conditions || []).every(condition => {
          const expected = condition.filterField ? selected[condition.filterField] : scalar(condition.value);
          return condition.optional && !expected?.trim() || value(item, condition.sourceField) === expected;
        })) continue;
        const optionValue = value(item, descriptor.sourceField);
        if (!optionValue.trim() || values.has(optionValue)) continue;
        const labelParts = [optionValue, ...(descriptor.labelFields || []).map(name => value(item, name))];
        values.set(optionValue, Object.freeze({ value: optionValue, label: labelParts.join(' - ') }));
      }
      if (!page.hasMore) {
        if (page.nextLink) throw new Error('A paginação do catálogo retornou um cursor inconsistente.');
        const options = Object.freeze([...values.values()]); active(); cache.set(cacheKey, options); return options;
      }
      if (typeof page.nextLink !== 'string' || !page.nextLink.trim() || cursors.has(page.nextLink)) throw new Error('A paginação do catálogo não retornou um próximo cursor válido.');
      cursor = page.nextLink; cursors.add(cursor);
    }
    throw new Error('A paginação do catálogo excedeu o limite seguro; as opções não foram disponibilizadas.');
  }
  return Object.freeze({ getFilterSource, loadFilterOptions });
}
