import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { provisionDateKey } from './pending-provision-dates.js';
import { diarySuggestionKey, recentDiaryActivities } from './construction-diary-activity-suggestions.js';

const MAX_PAGES = 100;

export function createRecentConstructionDiaryActivitiesData({ tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== 'function') throw new TypeError('A consulta dos diários requer a sessão Microsoft ativa.');
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);
  async function load({ diaryDate, branch, signal } = {}) {
    const check = () => { if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError'); };
    if (diaryDate == null || !String(diaryDate).trim() || !provisionDateKey(diaryDate) || !diarySuggestionKey(branch))
      throw new Error('A referência de data e filial do diário não está disponível.');
    const options = signal ? { signal } : {};
    check();
    const list = await repository.resolveList('personal', ['DIÁRIO DE OBRAS', 'DIARIO DE OBRAS'], options);
    if (list?.status !== 'resolved' || !list.id) throw new Error('A lista DIÁRIO DE OBRAS não está disponível nesta conta.');
    const columns = await repository.getColumns('personal', list.id, options);
    const column = aliases => {
      const names = (Array.isArray(columns) ? columns : []).filter(item => aliases.some(alias => diarySuggestionKey(item.name) === diarySuggestionKey(alias) || diarySuggestionKey(item.displayName) === diarySuggestionKey(alias)))
        .map(item => item.name).filter(Boolean);
      const unique = [...new Set(names)];
      if (unique.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(unique[0])) throw new Error(`Não foi possível identificar a coluna ${aliases[0]} dos diários.`);
      return unique[0];
    };
    const dateField = column(['DATA']);
    const activityField = column(['ATIVIDADEEXECUTADA', 'ATIVIDADES EXECUTADAS']);
    const statusField = column(['STATUS']), branchField = column(['FILIAL']);
    const dateColumn = columns.find(item => item.name === dateField);
    // No calendar lower bound: gaps between completed diaries must not hide history.
    // Filter one SharePoint column server-side and enforce date/branch locally.
    const query = `$expand=fields($select=${[dateField, activityField, statusField, branchField].join(',')})&$top=100&$filter=fields/${statusField} eq 'CONCLUÍDO'`;
    const rows = new Map(), cursors = new Set();
    let cursor = '';
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      check();
      const page = await repository.getItemsPage('personal', list.id, query, {
        ...options, pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
        ...(cursor ? { cursor } : {}),
      });
      check();
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || page.complete === false
        || page.partial || page.incomplete || page.truncated || page.aborted || page.error
        || page.hasMore !== Boolean(page.nextLink) || page.hasMore && typeof page.nextLink !== 'string')
        throw new Error('A consulta de atividades retornou uma página inválida ou incompleta.');
      for (const row of page.items) {
        if (!/^[1-9]\d*$/.test(String(row?.id || '')) || !row.fields
          || [dateField, statusField, branchField].some(name => !Object.hasOwn(row.fields, name)))
          throw new Error('A consulta de atividades retornou um diário incompleto.');
        rows.set(String(row.id), row);
      }
      if (!page.hasMore) return recentDiaryActivities([...rows.values()], {
        diaryDate, branch, dateColumn, dateField, activityField, statusField, branchField,
      });
      if (cursors.has(page.nextLink)) throw new Error('Cursor de diários repetido.');
      cursors.add(page.nextLink);
      cursor = page.nextLink;
    }
    throw new Error('A consulta dos diários excedeu o limite seguro de páginas.');
  }
  return Object.freeze({ load });
}
