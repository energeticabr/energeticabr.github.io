import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { provisionDayOffset } from './pending-provision-dates.js';
import { diarySuggestionKey, recentDiaryActivities } from './construction-diary-activity-suggestions.js';

const MAX_PAGES = 100;

export function createRecentConstructionDiaryActivitiesData({ tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== 'function') throw new TypeError('A consulta dos diários requer a sessão Microsoft ativa.');
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);
  async function load({ today = new Date(), signal } = {}) {
    const check = () => { if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError'); };
    const start = provisionDayOffset(today, -4);
    const after = provisionDayOffset(today, 1);
    if (!start || !after) return [];
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
    const query = `$expand=fields&$top=100&$filter=fields/${dateField} ge '${start}T00:00:00Z' and fields/${dateField} lt '${after}T00:00:00Z'`;
    const rows = [];
    let cursor = '';
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      check();
      const page = await repository.getItemsPage('personal', list.id, query, {
        ...options, pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' },
        ...(cursor ? { cursor } : {}),
      });
      check();
      if (!page || !Array.isArray(page.items)) throw new Error('A consulta de atividades retornou uma página inválida.');
      rows.push(...page.items);
      if (page.hasMore !== true) return recentDiaryActivities(rows, { today, dateField, activityField });
      if (!page.nextLink) throw new Error('A paginação dos diários não retornou o próximo cursor.');
      cursor = page.nextLink;
    }
    throw new Error('A consulta dos diários excedeu o limite seguro de páginas.');
  }
  return Object.freeze({ load });
}
