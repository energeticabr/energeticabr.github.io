// Work CNO established from the company's fiscal history; same identity used by
// the automatic fiscal WhatsApp checker. Presentation punctuation is irrelevant.
const WORK_CNO = '900254406072';
const NUMBER = String.raw`(?:[0-9]{12}|[0-9]{2}[\s./-]*[0-9]{3}[\s./-]*[0-9]{5}[\s./-]*[0-9]{2})(?![0-9A-Za-z]|[./-][0-9])`;
const LIST = `${NUMBER}(?:\\s*(?:[,;|]|\\be\\b|\\bou\\b)\\s*${NUMBER})*`;
const MENTION = new RegExp(String.raw`\b(?:CNOs?|Cadastro\s+Nacional\s+de\s+Obras)\b(?:\s|[:=#.,º°()/\-]|n[uú]mero|n[º°o]|da\s+obra|obra|e\s+endere[cç]o){0,80}(${LIST})`, 'gi');
const format = value => `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 10)}/${value.slice(10)}`;

/** Read only fiscal content, never infer a CNO from an unrelated identity. */
export function invoiceConstructionCno(fields = {}) {
  const found = new Set();
  for (const field of ['OBSERVACOES_NOTA', 'INFORMACOES_FISCO', 'DESCRICAO_SERVICO', 'DESCRICAO_ITENS']) {
    const value = fields[field];
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(MENTION)) {
      for (const number of match[1].matchAll(new RegExp(NUMBER, 'g'))) found.add(number[0].replace(/\D/g, ''));
    }
  }
  if (typeof fields.CNO === 'string' && new RegExp(`^${NUMBER}$`).test(fields.CNO.trim())) found.add(fields.CNO.replace(/\D/g, ''));
  const conflicts = [...found].filter(value => value !== WORK_CNO).sort().map(format);
  return {status: conflicts.length ? 'conflict' : found.has(WORK_CNO) ? 'valid' : 'missing',
    numbers: [...found].sort().map(format), conflicts, expected: format(WORK_CNO)};
}
