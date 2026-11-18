import { normalizeSearchText } from '../../../../portal/core/search-text.js';

const stopWords = new Set(['de','da','do','das','dos','para','com','sem','e','o','a',
  'produto','material','servico','item','fornecimento']);
const roman = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6' };
const terminology = new Set(['aco:vergalhao','aco:vergalhoes']);
const unitAliases = { sc:'saco', sac:'saco', sacos:'saco', kg:'kg', quilo:'kg', quilograma:'kg',
  un:'un', und:'un', unid:'un', unidade:'un', unidades:'un', pc:'un', pca:'un', peca:'un',
  mt:'m', metro:'m', metros:'m', mt2:'m2', mt3:'m3', lt:'l', litro:'l', cx:'caixa' };
const unitKey = value => {
  const key = normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
  return unitAliases[key] || key;
};

function features(label) {
  const name = normalizeSearchText(String(label ?? '').normalize('NFKC'))
    .replace(/\bcp[\s-]*(vi|iv|iii|ii|v|i|[1-6])\b/g, (_, type) => `cp${roman[type] || type}`)
    .replace(/\bca[\s-]*(\d+)\b/g, 'ca$1');
  // Retain decimal measures: 12.5 mm must never become the token 125 mm.
  const terms = new Set((name.match(/[a-z]+\d+(?:\.\d+)?[a-z]*|\d+(?:\.\d+)?[a-z]*\d*|[a-z]+/g) || [])
    .filter(term => !stopWords.has(term)));
  const attributes = new Map(), mass = new Set();
  for (const [, presence, term] of name.matchAll(/\b(com|sem)\s+([a-z]+)\b/g)) {
    addAttribute(attributes, `presence:${term}`, presence);
  }
  for (const term of terms) {
    const weight = term.match(/^(\d+(?:\.\d+)?)(kg|g)$/);
    if (weight) {
      mass.add(term);
      addAttribute(attributes, 'mass', Number(weight[1]) * (weight[2] === 'kg' ? 1000 : 1));
      continue;
    }
    const measure = term.match(/^(\d+(?:\.\d+)?)(mm|cm|m|m2|m3|ml|l)$/);
    const code = term.match(/^([a-z]+)(\d+(?:\.\d+)?)$/);
    if (measure) addAttribute(attributes, measure[2], Number(measure[1]));
    else if (code) addAttribute(attributes, code[1], code[2]);
    else if (/^\d+(?:\.\d+)?$/.test(term)) addAttribute(attributes, 'number', Number(term));
  }
  return { name, terms, attributes, mass };
}

function addAttribute(attributes, type, value) {
  if (!attributes.has(type)) attributes.set(type, new Set());
  attributes.get(type).add(value);
}

function attributePenalty(source, target) {
  let conflicts = 0;
  for (const [type, values] of target.attributes) {
    const actual = source.attributes.get(type);
    if (!actual) continue;
    if (![...values].every(value => actual.has(value))) conflicts++;
  }
  return Math.min(0.45, conflicts * 0.22);
}

function termSimilarity(left, right) {
  if (left === right) return 1;
  if (terminology.has([left, right].sort().join(':'))) return 0.82;
  if ((/^cp[1-6]$/.test(left) && /^cp[1-6]$/.test(right))
    || (/^ca(?:25|50|60)$/.test(left) && /^ca(?:25|50|60)$/.test(right))) return 0.6;
  // Typos/plurals may match words, never dimensions, technical classes or model numbers.
  if (!/^[a-z]{4,}$/.test(left) || !/^[a-z]{4,}$/.test(right)) return 0;
  const limit = Math.min(2, Math.floor(Math.max(left.length, right.length) / 4));
  if (Math.abs(left.length - right.length) > limit) return 0;
  let previous = Array.from({ length:right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length] <= limit ? 0.75 : 0;
}

function score(source, target, sameUnit) {
  if (source.name === target.name && source.name) return 1.12 + (sameUnit ? 0.12 : 0);
  const omitMass = !source.mass.size || !target.mass.size;
  const sourceTerms = [...source.terms].filter(term => !omitMass || !source.mass.has(term));
  const targetTerms = [...target.terms].filter(term => !omitMass || !target.mass.has(term));
  let common = 0, sharesWord = false, sharesCode = false;
  const remaining = new Set(sourceTerms);
  for (const term of targetTerms) {
    let matched, similarity = 0;
    for (const candidate of remaining) {
      const value = termSimilarity(term, candidate);
      if (value > similarity) { similarity = value; matched = candidate; }
      if (value === 1) break;
    }
    if (!matched) continue;
    remaining.delete(matched);
    common += similarity;
    sharesWord ||= /^[a-z]{3,}$/.test(term);
    sharesCode ||= /^[a-z]+\d/.test(term);
  }
  // A descriptive word or technical class identifies related material; units/numbers alone do not.
  if ((!sharesWord && !sharesCode) || !sourceTerms.length || !targetTerms.length) return 0;
  // Related material remains selectable even when every available variant differs.
  return Math.max(0.001, 0.65 * common / targetTerms.length + 0.25 * common / sourceTerms.length
    + (sharesCode ? 0.08 : 0) + (sameUnit ? 0.12 : 0) - attributePenalty(source, target));
}

export function createNfeProductMatcher(products) {
  const candidates = products.map(option => ({ option, features:features(option.label), unit:unitKey(option.unit) }))
    .sort((left, right) => left.option.label.localeCompare(right.option.label, 'pt-BR', { numeric:true })
      || left.option.id.localeCompare(right.option.id, 'pt-BR', { numeric:true }));
  return line => {
    const source = features(line.description), unit = unitKey(line.unit);
    let best, high = 0;
    for (const candidate of candidates) {
      const value = score(source, candidate.features, Boolean(unit && unit === candidate.unit));
      if (value > high) {
        best = candidate.option;
        high = value;
      }
    }
    return best?.id || '';
  };
}
