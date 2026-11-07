export function normalizeSearchText(value) {
  return normalizeSearchSeparators(String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR'));
}

export function normalizeSearchSeparators(text) {
  return text
    .replace(/,/g, '.')
    .replace(/(\d)\s*\.\s*(?=\d)/g, '$1.')
    .replace(/\s+/g, ' ')
    .replace(/(\d) (?=(?:mm|cm|m|km|kg|g|mg|ml|l|kva|kv|v|kw|w|hz|pol)(?![\p{L}\p{N}]))/giu, '$1')
    .trim();
}

function compactSearchText(text) {
  // A gap between digits can separate two different IDs or measurements.
  return text.replace(/(\d) +(?=\d)| +/g, (gap, digit) => digit ? gap : '');
}

function includesWithoutSpaces(text, query) {
  // Keep short fragments and numeric-only searches on the ordinary path.
  return query.length >= 3 && /\p{L}/u.test(query) && text.includes(query);
}

export function includesSearchText(text, query) {
  return text.includes(query)
    || includesWithoutSpaces(compactSearchText(text), compactSearchText(query));
}

export function containsSearchText(value, query) {
  return includesSearchText(normalizeSearchText(value), normalizeSearchText(query));
}

export function matchesSearchTerms(text, terms) {
  if (terms.every(term => text.includes(term))) return true;
  const compact = compactSearchText(text);
  return terms.every(term => text.includes(term) || includesWithoutSpaces(compact, term));
}

export function startsWithSearchText(text, query) {
  const compact = compactSearchText(query);
  return text.startsWith(query)
    || (compact.length >= 3 && /\p{L}/u.test(compact) && compactSearchText(text).startsWith(compact));
}

// Remote indexed searches can request literal prefixes and keep their existing limits.
function searchPrefixVariants(value) {
  const literal = String(value ?? '').trim();
  const spaced = literal.replace(/\s+/g, ' ').replace(/(\d) *([.,]) *(?=\d)/g, '$1$2');
  const variants = new Set([literal, spaced]);
  if (spaced.length >= 3 && /\p{L}/u.test(spaced)) {
    const compact = compactSearchText(spaced);
    variants.add(compact);
    variants.add(spaced.replace(/(\d) *(?=\p{L})/gu, '$1 '));
    variants.add(spaced.replace(/(\p{L}) *(?=\d)/gu, '$1 '));
    variants.add(compact.replace(/(\d)(?=\p{L})|(\p{L})(?=\d)/gu, '$1$2 '));
  }
  return [...new Set([...variants].flatMap(prefix => [
    prefix, prefix.replaceAll(',', '.'), prefix.replaceAll('.', ','),
    prefix.replace(/[.,]/g, separator => separator === '.' ? ',' : '.'),
  ]))].filter(Boolean);
}

export function odataSearchPrefix(field, value) {
  const clauses = searchPrefixVariants(value)
    .map(prefix => `startswith(${field},'${prefix.replaceAll("'", "''")}')`);
  return clauses.length > 1 ? `(${clauses.join(' or ')})` : clauses[0] || '';
}
