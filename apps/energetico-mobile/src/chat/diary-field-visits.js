import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createPendingConstructionDiaryData } from './pending-construction-diary-data.js';
import { provisionDateKey } from './pending-provision-dates.js';

const scalar = value => {
  if (value == null) return '';
  if (typeof value === 'object') return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.title);
  return String(value).trim();
};
const key = value => scalar(value).replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const fieldKey = value => key(value).replace(/[^A-Z0-9]/g, '');

function day(value, column) {
  const text = scalar(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    if (!provisionDateKey(text.slice(0, 10))) return '';
    // Calendar dates often arrive as midnight UTC, not an instant in São Paulo.
    if (column?.dateTime?.format === 'dateOnly'
      || !column?.dateTime?.format && /T00:00:00(?:\.0+)?Z$/i.test(text)) return text.slice(0, 10);
  }
  return provisionDateKey(text);
}

function columnsForVisit(columns) {
  const source = (Array.isArray(columns) ? columns : []).filter(column => column?.computed !== true
    && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name || '')));
  return ['DATA', 'PRODUTO', 'FILIAL'].map(label => {
    const matches = source.filter(column => [column.name, column.displayName].some(value => fieldKey(value) === label));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || ''))
      throw new Error(`Coluna ${label} dos lançamentos ausente ou ambígua.`);
    return matches[0];
  });
}

/** Read-only join by diary ID, date and branch; never infer a visit from its label. */
export function createDiaryFieldVisitData({ tokenProvider, repository: suppliedRepository,
  fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== 'function') throw new TypeError('A consulta de visitas requer a sessão Microsoft.');
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);
  const diaries = createPendingConstructionDiaryData({ repository, strictReport: true });
  async function load({ diaryIds = [], signal } = {}) {
    const check = () => { if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError'); };
    check();
    if (!Array.isArray(diaryIds) || diaryIds.some(id => !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))))
      throw new TypeError('IDs de diário inválidos.');
    const selected = new Set(diaryIds.map(String));
    if (!selected.size) return [];
    const snapshot = await diaries.loadSnapshot({ signal, includeDateMetadata: true }); check();
    const candidates = snapshot.rows.filter(row => selected.has(row.id) && day(row.date, snapshot.dateColumn) && key(row.branch));
    if (!candidates.length) return [];
    const options = signal ? { signal } : {};
    const list = await repository.resolveList('personal', ['LANCAMENTOS', 'LANÇAMENTOS'], options); check();
    if (list?.status !== 'resolved' || !list.id) throw new Error('A lista LANCAMENTOS não está disponível.');
    const columns = columnsForVisit(await repository.getColumns('personal', list.id, options)); check();
    const [date, product, branch] = columns;
    // A single filtered traversal for every displayed diary, not one request per button.
    const query = `$expand=fields($select=${columns.map(column => column.name).join(',')})&$top=100&$filter=fields/${product.name} eq 'VISITA EM CAMPO'`;
    const visited = new Set(), cursors = new Set(); let cursor = '';
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      check();
      const page = await repository.getItemsPage('personal', list.id, query, { ...options, pageNumber, maxPages: 100,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }, ...(cursor ? { cursor } : {}) });
      check();
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || page.complete === false
        || page.partial || page.incomplete || page.truncated || page.aborted || page.error
        || page.hasMore !== Boolean(page.nextLink) || page.hasMore && typeof page.nextLink !== 'string')
        throw new Error('Página de visitas inválida ou incompleta.');
      for (const row of page.items) {
        const fields = row?.fields;
        if (!fields || typeof fields !== 'object' || columns.some(column => !Object.hasOwn(fields, column.name)))
          throw new Error('Registro de visita incompleto.');
        if (key(fields[product.name]) !== 'VISITA EM CAMPO') continue;
        const dateKey = day(fields[date.name], date), branchKey = key(fields[branch.name]);
        if (dateKey && branchKey) visited.add(JSON.stringify([dateKey, branchKey]));
      }
      if (!page.hasMore) {
        const matched = new Set(candidates.filter(row => visited.has(JSON.stringify([day(row.date, snapshot.dateColumn), key(row.branch)]))).map(row => row.id));
        return [...selected].filter(id => matched.has(id));
      }
      if (cursors.has(page.nextLink)) throw new Error('Cursor de visitas repetido.');
      cursors.add(page.nextLink); cursor = page.nextLink;
    }
    throw new Error('Consulta de visitas excedeu o limite seguro de páginas.');
  }
  return Object.freeze({ load });
}
