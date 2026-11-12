import Decimal from 'decimal.js';
import { normalizeSearchText } from '../../../../portal/core/search-text.js';

const VERSION = 1;
export const NFE_RECENT_STAGE_USES = 5;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const headerFields = ['supplierId', 'branchId', 'accountId'];
const numericFields = ['quantity', 'unitPrice', 'discount', 'adjustment'];
const lineFields = ['productId', 'stageId', ...numericFields, 'date', 'dueDate', 'unitReviewed'];
const commonWords = new Set(['a','as','o','os','e','de','do','da','dos','das','com','sem','em','para','produto','servico','material','item','fornecimento']);
const encoder = new TextEncoder();
const clean = value => String(value ?? '').trim();
const selectionId = value => /^[a-z0-9_-]{1,64}$/i.test(clean(value)) ? clean(value) : '';
const key = value => normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').trim();
const descriptionKey = value => normalizeSearchText(value)
  .replace(/(\d)[./-](?=\d)|[^a-z0-9]+/g, (part, digit) => digit ? part : ' ').trim();

function issuerSource(invoice) {
  const taxId = clean(invoice?.taxId).toUpperCase().replace(/[.\/\s-]/g, '');
  if (/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(taxId)) return `tax:${taxId}`;
  const supplier = key(invoice?.supplier);
  return supplier ? `name:${supplier}` : '';
}

export async function nfeLearningIssuerHash(invoice) {
  const issuer = issuerSource(invoice);
  if (!issuer) return '';
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(`nfe-learning:${issuer}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function compactFingerprint(value) {
  // Stable 128-bit FNV-1a for local comparisons and oversized descriptions.
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (const byte of encoder.encode(value)) hash = BigInt.asUintN(128, (hash ^ BigInt(byte)) * 0x1000000000000000000013bn);
  return hash.toString(16).padStart(32, '0');
}

function issuerKey(invoice) {
  if (HEX_SHA256.test(invoice?.learningIssuerHash)) return invoice.learningIssuerHash;
  const issuer = issuerSource(invoice);
  return issuer ? `local-${compactFingerprint(issuer)}` : '';
}

function lineIdentity(line) {
  const description = descriptionKey(line?.description);
  const code = clean(line?.code).normalize('NFKC').toLocaleLowerCase('pt-BR');
  return {
    code:code.length > 80 ? '' : code,
    description:description.length > 400 ? `#${compactFingerprint(description)}` : description,
    unit:key(String(line?.unit ?? '').normalize('NFKC')).replaceAll(' ', '').slice(0, 20),
  };
}

function compactIdentity({ code, description, unit }) {
  return { code:code ? compactFingerprint(code).slice(-16) : '',
    description:compactFingerprint(description).slice(-16), unit };
}

function sameValue(field, left, right) {
  const a = clean(left), b = clean(right);
  if (a === b) return true;
  if (!numericFields.includes(field)) return false;
  const decimal = /^-?\d+(?:[.,]\d+)?$/;
  return decimal.test(a) && decimal.test(b) && new Decimal(a.replace(',', '.')).eq(b.replace(',', '.'));
}

function indexedLines(lines) {
  if (!Array.isArray(lines)) return new Map();
  return new Map(lines.map(line => [clean(line?.number), line]));
}

export function createNfeLearningExample(invoice, fiscal, baseline, reviewed, manualStages) {
  const issuer = issuerKey(invoice);
  if (!issuer || !baseline || !reviewed || !Array.isArray(fiscal?.lines)) return null;
  const before = indexedLines(baseline.lines), after = indexedLines(reviewed.lines);
  const source = indexedLines(fiscal.lines);
  if (source.size !== fiscal.lines.length || before.size !== source.size || after.size !== source.size || source.has('')) return null;

  const header = Object.fromEntries(headerFields.map(field => [field, selectionId(reviewed[field])]));
  const headerChanged = headerFields.filter(field => !sameValue(field, baseline[field], header[field]));
  const { branchId } = header;
  const lines = [];
  for (const [number, original] of source) {
    const previous = before.get(number), corrected = after.get(number);
    if (!previous || !corrected) return null;
    const changed = lineFields.filter(field => (field !== 'stageId' || !manualStages || manualStages.has(number))
      && !sameValue(field, previous[field], corrected[field]));
    const productId = selectionId(corrected.productId), stageId = selectionId(corrected.stageId);
    const identity = lineIdentity(original);
    if (identity.description && productId) lines.push({ ...identity, productId, stageId, branchId, changed });
  }
  const hasHeader = Object.values(header).every(Boolean);
  if (!hasHeader && !lines.length) return null;
  const compact = lines.reduce((size, line) => size + line.code.length + line.description.length, 0) > 20_000;
  return {
    version:VERSION, issuer, ...(hasHeader ? { header, headerChanged } : {}), ...(compact ? { compact:true } : {}),
    lines:compact ? lines.map(line => ({ ...line, ...compactIdentity(line) })) : lines,
  };
}

function descriptionFeatures({ description }) {
  const terms = new Set(description.split(' ').filter(word => !commonWords.has(word)));
  return {
    terms,
    qualifiers:[...terms].filter(word => /\d|^[ivx]{1,5}$/.test(word)).sort().join(' '),
    distinctive:[...terms].filter(word => /[a-z]{4}/.test(word) && !/\d/.test(word)),
  };
}

function exactRank(line, saved) {
  if (line.code && saved.code) return line.code === saved.code ? 4 : 0;
  return 3;
}

function fuzzyRank(line, features, saved, other) {
  const sameCode = Boolean(line.code && line.code === saved.code);
  if (!sameCode && line.code && saved.code) return 0;
  const left = features.terms, right = other.terms;
  const common = [...left].filter(word => right.has(word)).length;
  if (common < 3 || common !== Math.min(left.size,right.size)
      || common / Math.max(left.size,right.size) < (sameCode ? 0.75 : 0.85)) return 0;
  return sameCode ? 2 : 1;
}

function uniqueSelection(rows, field) {
  const choices = new Set(rows.map(row => selectionId(row[field])).filter(Boolean));
  return choices.size === 1 ? choices.values().next().value : '';
}

export function preferredNfeStage(recent) {
  const counts = new Map();
  for (const stage of recent) counts.set(stage, (counts.get(stage) || 0) + 1);
  let preferred = '', highest = 0;
  for (const [stage, count] of counts) {
    // In a tie, the first stage in this newest-first sample wins.
    if (count <= highest) continue;
    preferred = stage;
    highest = count;
  }
  return preferred;
}

function indexCorrections(history) {
  const exact = new Map(), compact = new Map(), fuzzy = new Map();
  const add = (index, key, value) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(value);
  };
  const exactKey = ({ unit, description }) => JSON.stringify([unit, description]);
  // Shared unit and model qualifiers are required for a fuzzy match.
  const fuzzyKey = (unit, qualifiers, word) => JSON.stringify([unit, qualifiers, word]);
  history.forEach((event, order) => {
    for (const saved of event.lines) {
      if (typeof saved?.description !== 'string' || typeof saved.unit !== 'string' || !Array.isArray(saved.changed)) continue;
      const features = event.compact || saved.description.startsWith('#') ? null : descriptionFeatures(saved);
      const entry = { saved, order, features };
      add(event.compact ? compact : exact, exactKey(saved), entry);
      if (!features) continue;
      for (const word of features.distinctive) add(fuzzy, fuzzyKey(saved.unit, features.qualifiers, word), entry);
    }
  });
  const cache = new WeakMap();
  return line => {
    if (cache.has(line)) return cache.get(line);
    const identity = lineIdentity(line);
    const hashed = compact.size ? compactIdentity(identity) : null;
    const compactMatches = hashed ? compact.get(exactKey(hashed)) || [] : [];
    const matches = identity.description ? [
      ...(exact.get(exactKey(identity)) || []).map(entry => ({ ...entry, rank:exactRank(identity, entry.saved) })),
      ...compactMatches.map(entry => ({ ...entry, rank:exactRank(hashed, entry.saved) })),
    ] : [];
    let approximate;
    const candidates = { matches, approximate() {
      if (approximate) return approximate;
      approximate = [];
      if (!fuzzy.size || !identity.description || identity.description.startsWith('#')) return approximate;
      const features = descriptionFeatures(identity), counts = new Map();
      for (const word of features.distinctive) {
        for (const entry of fuzzy.get(fuzzyKey(identity.unit, features.qualifiers, word)) || []) {
          counts.set(entry, (counts.get(entry) || 0) + 1);
        }
      }
      for (const [entry, count] of counts) {
        if (count < 2) continue;
        const rank = fuzzyRank(identity, features, entry.saved, entry.features);
        if (rank) approximate.push({ ...entry, rank });
      }
      return approximate;
    } };
    if (line && typeof line === 'object') cache.set(line, candidates);
    return candidates;
  };
}

function infer(candidates, field, eligible = () => true) {
  const accepted = entry => entry.rank > 0 && eligible(entry.saved) && selectionId(entry.saved[field]);
  let matches = candidates.matches.filter(accepted);
  if (!matches.length) matches = candidates.approximate().filter(accepted);
  let best = 0, winning = [];
  for (const entry of matches) {
    if (entry.rank < best) continue;
    if (entry.rank > best) {
      winning = [];
      best = entry.rank;
    }
    winning.push(entry);
  }
  // Only an exact match can supersede older contradictory examples.
  let newest = Infinity;
  if (best >= 3) {
    for (const { saved, order } of winning) if (saved.changed.includes(field)) newest = Math.min(newest, order);
  }
  return uniqueSelection(winning.filter(entry => newest === Infinity || entry.order === newest).map(entry => entry.saved), field);
}

export function createNfeLearningModel(examples, invoice, _fiscal, catalog) {
  const issuer = issuerKey(invoice);
  const history = issuer && Array.isArray(examples)
    ? examples.filter(event => event?.version === VERSION && event.issuer === issuer && Array.isArray(event.lines)) : [];
  const corrections = indexCorrections(history);
  const options = items => new Map((items || []).map(item => [selectionId(item.id), item]));
  const suppliers = options(catalog?.suppliers), branches = options(catalog?.branches), accounts = options(catalog?.accounts);
  const products = options(catalog?.products), stages = options(catalog?.stages);
  const saved = history.find(event => event.header)?.header;
  const supplierId = selectionId(saved?.supplierId), branchId = selectionId(saved?.branchId), accountId = selectionId(saved?.accountId);
  const header = supplierId && suppliers.has(supplierId) ? {
    supplierId,
    ...(branches.has(branchId) ? { branchId } : {}),
    ...(accounts.has(accountId) ? { accountId } : {}),
  } : {};
  const recentStages = new Map();
  return {
    header,
    product(line) {
      const id = infer(corrections(line), 'productId');
      return id && products.has(id) ? id : '';
    },
    stage(line, branchValue, productValue) {
      const branchId = selectionId(branchValue), productId = selectionId(productValue);
      const branch = branches.get(branchId);
      const branchLabel = key(branch?.label);
      if (!branchLabel || !products.has(productId)) return '';
      const eligible = saved => saved?.branchId === branchId && saved.productId === productId
        && key(stages.get(selectionId(saved.stageId))?.branch) === branchLabel;
      const productAndBranch = JSON.stringify([productId, branchId]);
      if (!recentStages.has(productAndBranch)) {
        const recent = [];
        for (const event of history) {
          const stage = uniqueSelection(event.lines.filter(eligible), 'stageId');
          if (stage) recent.push(stage);
          if (recent.length === NFE_RECENT_STAGE_USES) break;
        }
        recentStages.set(productAndBranch, preferredNfeStage(recent));
      }
      return recentStages.get(productAndBranch) || infer(corrections(line), 'stageId', eligible);
    },
  };
}
