import { matchesSearchTerms, normalizeSearchText } from '../../../../portal/core/search-text.js';
const numberFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function searchableText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(searchableText).join('\0');
  if (typeof value === 'object') {
    // Search human-readable lookup/person values, never opaque metadata.
    return ['LookupValue', 'Value', 'value', 'DisplayName', 'displayName', 'Title', 'title', 'Name', 'name', 'Email', 'email']
      .filter(key => value[key] != null).map(key => searchableText(value[key])).join('\0');
  }
  const raw = String(value);
  // A timestamp's civil date belongs to the view's timezone rules. Only
  // date-only values have an unambiguous Brazilian alias here.
  const date = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) return `${raw} ${date[3]}/${date[2]}/${date[1]}`;
  if (typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(raw.trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return `${raw} R$ ${numberFormat.format(numeric)} ${String(numeric).replace('.', ',')}`;
  }
  return raw;
}

export function matchesGallerySearch(query, values) {
  const search = normalizeSearchText(query);
  if (!search) return true;
  return matchesSearchTerms(normalizeSearchText(searchableText(values)), search.split(' '));
}
