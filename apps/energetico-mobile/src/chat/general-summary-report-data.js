import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { buildGeneralSummaryReport, generalSummaryText } from './general-summary-report-model.js';

const SITE = 'personal';
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const CONCURRENCY = 4;
const LISTS = {
  provisions: ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'],
  auditOrders: ['NOTASPENDENTES'], quotes: ['NOVACOTACAO', 'NOVA COTACAO', 'NOVA COTAÇÃO'],
  documents: ['DOCUMENTOS_1', 'DOCUMENTOS1', 'DOCUMENTOS 1', 'DOCUMENTOS'],
  tasks: ['LANCAMENTOTAREFAS', 'LANCAMENTO TAREFAS'], delegatedTasks: ['TAREFASDELEGADAS', 'TAREFAS DELEGADAS'], contractors: ['EMPREITEIRO'],
  presences: ['DESCRITIVOPRESENCA', 'DESCRITIVO PRESENCA'], diaries: ['DIÁRIO DE OBRAS', 'DIARIO DE OBRAS'],
  properties: ['IMOVEL CADASTRADO', 'IMÓVEL CADASTRADO'], pathologies: ['SACPATOLOGIAS', 'SAC PATOLOGIAS'],
};
const STATUS = { status: ['STATUS'] };
const SCHEMA = {
  provisions: { dueDate: ['DATA PREVISTO PGTO'], paidDate: ['DATA PGTO EFETUADO'] },
  auditOrders: STATUS, quotes: STATUS, documents: STATUS,
  tasks: { status: ['CONCLUÍDO'], identifiedAt: ['DATA IDENTIFICAÇÃO'] },
  delegatedTasks: { status: ['CONCLUÍDO'] }, contractors: STATUS,
  presences: { presence: ['PRESENCA', 'PRESENÇA'], status: ['STATUS'], dailyValue: ['VLORDIARIO', 'VALOR DIÁRIO'] },
  diaries: STATUS,
  properties: { branch: ['FILIAL'], property: ['IMOVEL'], insurance: ['SEGURO'], proposal: ['IDPROPOSTA'],
    bankContract: ['IDCONTRATOCAIXA'], deed: ['IDESCRITURA'], brokerDocument: ['IDDOCUMENTOCORRETAGEM'], fiscalDocument: ['IDDOCFISCAL'] },
  pathologies: STATUS,
};
const columnKey = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
}

// Injected repositories and token providers may ignore cancellation. Consume late
// rejections and remove our listener immediately, including on abort itself.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort); callback(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException('Consulta cancelada.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); })
      .catch(error => finish(reject, error));
  });
}

function resolveSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError('Esquema SharePoint inválido.');
  const eligible = columns.filter(column => !column?.computed && !/^LinkTitle/i.test(column?.name || ''));
  const resolved = {};
  for (const [field, aliases] of Object.entries(SCHEMA[kind])) {
    const wanted = new Set(aliases.map(columnKey));
    const matches = eligible.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || '')) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura.`);
    }
    resolved[field] = matches[0].name;
  }
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length) throw new TypeError('Uma coluna corresponde a mais de um campo.');
  return resolved;
}

// Object key order is not a version conflict, including in nested lookup values.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

async function loadSource(repository, kind, signal) {
  const resolved = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
  if (resolved?.status !== 'resolved' || !resolved.id) throw new Error('Lista indisponível nesta conta.');
  // The shared repository returns the first alias match. Its complete cached
  // discovery must identify one physical list before any summary total is read.
  // Minimal injected adapters can supply an already-resolved unique list.
  if (typeof repository.listLists === 'function') {
    const lists = await abortable(() => repository.listLists(SITE, { signal }), signal);
    if (!Array.isArray(lists)) throw new TypeError('Descoberta de listas inválida.');
    const listName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const aliases = new Set(LISTS[kind].map(listName)), matches = new Set();
    for (const list of lists) {
      if (!aliases.has(listName(list?.displayName))) continue;
      if (typeof list.id !== 'string' || !list.id.trim()) throw new TypeError('ID da lista inválido na descoberta.');
      matches.add(list.id.toLowerCase());
    }
    if (matches.size !== 1 || !matches.has(String(resolved.id).toLowerCase())) {
      throw new TypeError('Lista ausente ou ambígua entre os nomes configurados.');
    }
  }
  const columns = resolveSchema(await abortable(() => repository.getColumns(SITE, resolved.id, { signal }), signal), kind);
  const query = new URLSearchParams({ $expand: 'fields', $top: '100' }).toString();
  const rows = [], ids = new Map(), cursors = new Set();
  let cursor = '';
  for (let index = 0; index < MAX_TOTAL_PAGES; index++) {
    const page = await abortable(() => repository.getItemsPage(SITE, resolved.id, query, {
      signal, pageNumber: index % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (page?.error?.code === 'AUTH_REQUIRED' || page?.error?.name === 'AbortError') throw page.error;
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== 'boolean'
      || page.error || page.incomplete || page.complete === false || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== 'string') throw new TypeError('Página SharePoint inválida ou incompleta.');
    const next = page.nextLink?.trim() || '';
    if (page.hasMore !== Boolean(next) || page.hasMore && !page.items.length) throw new TypeError('Paginação SharePoint inconsistente.');
    for (const item of page.items) {
      const id = String(item?.id ?? '');
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !item?.fields
        || typeof item.fields !== 'object' || Array.isArray(item.fields)) throw new TypeError('Registro SharePoint ou ID inválido.');
      const fingerprint = JSON.stringify(canonical(item.fields));
      if (ids.has(id)) {
        if (ids.get(id) !== fingerprint) throw new TypeError(`Versões conflitantes do ID duplicado ${id}.`);
        continue;
      }
      ids.set(id, fingerprint);
      const row = { id };
      for (const [field, column] of Object.entries(columns)) {
        // Graph omits blank fields. Preserve numeric JSON daily values for strictDecimal.
        row[field] = field === 'dailyValue' ? item.fields[column] : generalSummaryText(item.fields[column]);
      }
      rows.push(Object.freeze(row));
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError('Cursor repetido na paginação SharePoint.');
    cursors.add(next); cursor = next;
  }
  throw new RangeError('Limite seguro de paginação excedido; nenhum total parcial foi disponibilizado.');
}

/** GET-only report loader. Each source completes before its metrics are exposed. */
export function createGeneralSummaryData({ tokenProvider, repository: suppliedRepository,
  fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES, now = () => new Date() } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== 'function') throw new TypeError('O relatório exige a sessão Microsoft ativa.');
  if (suppliedRepository && ['resolveList', 'getColumns', 'getItemsPage'].some(name => typeof suppliedRepository[name] !== 'function')) {
    throw new TypeError('Repositório SharePoint inválido.');
  }
  async function loadReport({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal), { fetch: fetchImpl },
      ), siteConfig);
      const kinds = Object.keys(LISTS), sources = {};
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, kinds.length) }, async () => {
        while (next < kinds.length) {
          abortIfNeeded(signal);
          const kind = kinds[next++];
          try { sources[kind] = await loadSource(repository, kind, signal); }
          catch (error) {
            abortIfNeeded(signal);
            if (error?.code === 'AUTH_REQUIRED' || error?.name === 'AbortError') {
              controller.abort(error); throw error;
            }
            sources[kind] = error instanceof Error ? error : new Error('Consulta da fonte falhou.');
          }
        }
      }));
      abortIfNeeded(signal);
      return buildGeneralSummaryReport(sources, { now });
    } finally {
      externalSignal?.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({ loadReport });
}
