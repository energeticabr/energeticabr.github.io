import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createContractorEmploymentStore } from '../../../../portal/forms/contractor-employment-store.js';

const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase('pt-BR');
export function filterContractorEmploymentRows(rows, filters = {}) {
  return rows.filter(row => ['STATUS', 'FILIAL', 'CARGO'].every(name => !filters[name] || key(row.fields?.[name]) === key(filters[name]))
    && (!filters.search || key([row.id, ...Object.values(row.fields || {})].map(text).join(' ')).includes(key(filters.search))));
}
/** Gallery and supplier form use the same RH-only editor and status checkpoint rules. */
export function createContractorEmploymentData(options = {}) {
  const repository = options.repository || createSharePointRepository(
    createGraphClient(options.tokenProvider, { fetch: options.fetchImpl || globalThis.fetch }), options.siteConfig || SHAREPOINT_SITES);
  return createContractorEmploymentStore({ ...options, repository });
}
