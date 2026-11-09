// Work CNO established from the company's fiscal history; same identity used by
// the automatic fiscal WhatsApp checker. Presentation punctuation is irrelevant.
const WORK_CNO = '900254406072';
const NUMBER = String.raw`(?:[0-9]{12}|[0-9]{2}[\s./-]*[0-9]{3}[\s./-]*[0-9]{5}[\s./-]*[0-9]{2})(?![0-9A-Za-z]|[./-][0-9])`;
const NUMERIC_TOKEN = String.raw`[0-9]+(?:\s*[./-]\s*[0-9]+)*(?![0-9A-Za-z]|\s*[./-]\s*[0-9])`;
const CANDIDATE = `(?:${NUMBER}|${NUMERIC_TOKEN})`;
// A short number after a delimiter may be an address or a quantity.
const LIST_ENTRY = String.raw`(?=(?:[0-9][\s./-]*){9})` + CANDIDATE;
const LIST = `${CANDIDATE}(?:\\s*(?:[,;|]|\\be\\b|\\bou\\b)\\s*${LIST_ENTRY})*`;
const MENTION = new RegExp(String.raw`\b(?:CNOs?|Cadastro\s+Nacional\s+de\s+Obras)\b(?:\s|[:=#.,º°()/\-]|n[uú]mero|n[º°o]|da\s+obra|obra|e\s+endere[cç]o){0,80}(${LIST})`, 'gi');
const CORRECTION_LABEL = String.raw`\b(?:CNOs?|Cadastro\s+Nacional\s+de\s+Obras)\b`;
const CORRECTION_PREFIX = String.raw`(?:\s|[:=#.,º°()/\-]|n[uú]mero|n[º°o]|da\s+obra|obra|e\s+endere[cç]o|para|correto|correta|é|deve\s+ser|passa\s+a\s+ser){0,80}`;
const CORRECTION_MENTION = new RegExp(`${CORRECTION_LABEL}${CORRECTION_PREFIX}(${LIST})`, 'gi');
const REPLACEMENT = new RegExp(String.raw`^\s*[,;:.–—-]?\s*(?:considerar\s+(?:o\s+)?correto|leia[\s-]*se|passa\s+a\s+ser|corrigir\s+para|substituir\s+por|por|pelo|e\s+informar|est[aá]\s+incorret[oa]\s*;\s*(?:o\s+)?correto\s+[ée])\s*[:=#-]?\s*(?:${CORRECTION_LABEL}${CORRECTION_PREFIX})?(${LIST})`, 'i');
const REMOVAL_BEFORE = /\b(?:remover|excluir|retirar|desconsiderar)\s+(?:o\s+)?$/i;
const REMOVAL_AFTER = /^\s*(?:deve\s+ser\s+)?(?:removid[oa]|exclu[ií]d[oa]|retirad[oa]|desconsiderad[oa])\b/i;
const CORRECTION_BEFORE = /\bcorre[cç][aã]o\s+(?:de|do)\s*$/i;
const format = value => `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 10)}/${value.slice(10)}`;
const completeNumber = new RegExp(`^${NUMBER}$`);
const candidate = new RegExp(`^${CANDIDATE}$`);
const candidateList = new RegExp(CANDIDATE, 'g');
const reportedValue = value => completeNumber.test(value) ? value.replace(/\D/g, '') : value.replace(/\s+/g, ' ');

function mentionedCnos(value) {
  const found = new Set();
  if (typeof value !== 'string') return found;
  for (const match of value.matchAll(MENTION)) {
    for (const number of match[1].matchAll(candidateList)) found.add(reportedValue(number[0]));
  }
  return found;
}

// This projection is published by the server only after validating the fiscal
// event and attaching its verified PDF to this invoice. Never use loose JSON,
// another invoice's event, or an unregistered correction to validate the CNO.
export function registeredInvoiceCorrections(fields) {
  const key = fields.CHAVE_ACESSO;
  if (typeof key !== 'string' || !/^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/.test(key) || typeof fields.CARTAS_CORRECAO_JSON !== 'string') return [];
  let projection;
  try { projection = JSON.parse(fields.CARTAS_CORRECAO_JSON); } catch { return []; }
  if (!projection || projection.version !== 1 || projection.key !== key || !Array.isArray(projection.events)) return [];
  return projection.events.filter(event => {
    if (!event || typeof event !== 'object' || !Number.isInteger(event.sequence) || event.sequence < 1 || event.sequence > 20) return false;
    const seq = String(event.sequence).padStart(2, '0');
    if (event.eventId !== `ID110110${key}${seq}` || event.eventType !== '110110' || event.cStat !== '135'
      || typeof event.protocol !== 'string' || !/^[0-9]{15}$/.test(event.protocol)
      || typeof event.correction !== 'string' || !event.correction.trim()
      || typeof event.issuedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.issuedAt) || !Number.isFinite(Date.parse(event.issuedAt))
      || typeof event.xmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.xmlSha256)
      || typeof event.pdfSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.pdfSha256)
      || event.fileName !== `CCe-${key}-110110-${seq}.pdf`) return false;
    return true;
  });
}

function applicableCorrection(fields) {
  const applicable = [];
  for (const event of registeredInvoiceCorrections(fields)) {
    if (!/\b(?:CNOs?|Cadastro\s+Nacional\s+de\s+Obras)\b/i.test(event.correction)) continue;
    // Read labeled CNOs and explicit replacement clauses only. A separate
    // order number must never validate the work's CNO. A later CNO removal
    // still supersedes an older event without supplying a replacement.
    const found = new Set(), replacements = new Set();
    for (const match of event.correction.matchAll(CORRECTION_MENTION)) {
      const before = event.correction.slice(0, match.index), after = event.correction.slice(match.index + match[0].length);
      const replacement = after.match(REPLACEMENT);
      if (!REMOVAL_BEFORE.test(before) && !REMOVAL_AFTER.test(after)) {
        for (const number of match[1].matchAll(candidateList)) {
          const value = reportedValue(number[0]);
          found.add(value);
          if (!replacement && CORRECTION_BEFORE.test(before)) replacements.add(value);
        }
      }
      if (replacement) {
        for (const number of replacement[1].matchAll(candidateList)) replacements.add(reportedValue(number[0]));
      }
    }
    applicable.push({event, numbers:replacements.size ? replacements : found});
  }
  return applicable.sort((a, b) => b.event.sequence - a.event.sequence)[0] || null;
}

function cnoResult(found) {
  const values = [...found].sort();
  const complete = values.filter(value => /^[0-9]{12}$/.test(value));
  const invalidNumbers = values.filter(value => !/^[0-9]{12}$/.test(value));
  const conflicts = complete.filter(value => value !== WORK_CNO).map(format);
  const status = conflicts.length ? 'conflict' : invalidNumbers.length ? 'invalid' : found.has(WORK_CNO) ? 'valid' : 'missing';
  return {status, numbers:[...complete.map(format), ...invalidNumbers], conflicts, expected:format(WORK_CNO),
    ...(invalidNumbers.length ? {invalidNumbers} : {})};
}

/** Read only fiscal content, never infer a CNO from an unrelated identity. */
export function invoiceConstructionCno(fields = {}) {
  const correction = applicableCorrection(fields);
  if (correction) {
    return {...cnoResult(correction.numbers), corrected:true, correctionSequence:correction.event.sequence,
      correctionEventId:correction.event.eventId};
  }
  const found = new Set();
  for (const field of ['OBSERVACOES_NOTA', 'INFORMACOES_FISCO', 'DESCRICAO_SERVICO', 'DESCRICAO_ITENS']) {
    const value = fields[field];
    for (const number of mentionedCnos(value)) found.add(number);
  }
  const structured = typeof fields.CNO === 'string' ? fields.CNO.trim() : '';
  if (candidate.test(structured)) found.add(reportedValue(structured));
  return cnoResult(found);
}
