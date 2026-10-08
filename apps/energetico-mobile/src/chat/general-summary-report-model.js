import Decimal from 'decimal.js';

const Money = Decimal.clone({ precision: 40 });
const SOURCES = {
  provisions: { name: 'PROVISÃO PGTOS', metrics: ['dueToday', 'overdue'] },
  auditOrders: { name: 'NOTASPENDENTES', metrics: ['auditOrders'] },
  quotes: { name: 'NOVACOTACAO', metrics: ['quotes'] },
  documents: { name: 'DOCUMENTOS_1', metrics: ['documents'] },
  tasks: { name: 'LANCAMENTOTAREFAS', metrics: ['pendingTasks'] },
  delegatedTasks: { name: 'TAREFASDELEGADAS', metrics: ['delegatedTasks'] },
  contractors: { name: 'EMPREITEIRO', metrics: ['activeContracts'] },
  presences: { name: 'DESCRITIVOPRESENCA', metrics: ['pendingPayments'] },
  diaries: { name: 'DIÁRIO DE OBRAS', metrics: ['pendingDiaries'] },
  properties: { name: 'IMOVEL CADASTRADO', metrics: ['commercialDocuments'] },
  pathologies: { name: 'SACPATOLOGIAS', metrics: ['activePathologies'] },
};
const DOCUMENT_FIELDS = ['insurance', 'proposal', 'bankContract', 'deed', 'brokerDocument', 'fiscalDocument'];
const dayFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function generalSummaryText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return String(value).trim();
  if (Array.isArray(value) && value.length <= 1) return generalSummaryText(value[0]);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const name of ['LookupValue', 'Value', 'value', 'Title', 'LookupId']) {
      if (Object.hasOwn(value, name)) return generalSummaryText(value[name]);
    }
  }
  throw new TypeError('Campo com valor inválido ou múltiplo.');
}

const key = value => generalSummaryText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ');
const pendingTask = row => ['ATIVIDADE CRIADA', 'EM ATENDIMENTO'].includes(key(row.status));

/** Strict decimal parsing: blank is zero; malformed or ambiguous text is never zero. */
export function strictDecimal(value) {
  if (Array.isArray(value) && value.length <= 1) return strictDecimal(value[0]);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const name of ['LookupValue', 'Value', 'value', 'Title', 'LookupId']) {
      if (Object.hasOwn(value, name)) return strictDecimal(value[name]);
    }
  }
  // Keep numeric Graph values numeric: 1.234 is unambiguous as a JSON number.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new TypeError('VLORDIARIO inválido.');
    return new Money(value);
  }
  const text = generalSummaryText(value);
  if (!text) return new Money(0);
  const localized = /^R\$\s*/.test(text);
  const raw = text.replace(/^R\$\s*/, '');
  let normalized;
  if (localized || raw.includes('.') && raw.includes(',')) {
    if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(raw)) normalized = raw.replaceAll('.', '').replace(',', '.');
    else if (!localized && /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) normalized = raw.replaceAll(',', '');
  } else if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    if (/^-?[1-9]\d{0,2}[.,]\d{3}$/.test(raw)) throw new TypeError('VLORDIARIO ambíguo.');
    normalized = raw.replace(',', '.');
  } else if (/^-?\d{1,3}(?:\.\d{3}){2,}$/.test(raw)) {
    normalized = raw.replaceAll('.', '');
  } else if (/^-?\d{1,3}(?:,\d{3}){2,}$/.test(raw)) {
    normalized = raw.replaceAll(',', '');
  }
  if (normalized === undefined) throw new TypeError('VLORDIARIO inválido.');
  const decimal = new Money(normalized);
  if (!decimal.isFinite() || decimal.abs().gt(Number.MAX_SAFE_INTEGER)) throw new TypeError('VLORDIARIO fora do limite seguro.');
  return decimal;
}

function calendarDay(value) {
  const raw = generalSummaryText(value);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : '';
  const time = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day
    || raw.includes('T') && !Number.isFinite(Date.parse(raw))) throw new TypeError('Data de calendário inválida.');
  return day;
}

function identificationOrder(value) {
  const raw = generalSummaryText(value);
  const day = calendarDay(raw);
  if (!day) return -Infinity;
  return Date.parse(raw.includes('T') ? raw : `${day}T00:00:00Z`);
}

function sourceMetrics(kind, rows, today, warnings) {
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new TypeError('Registro inválido.');
  const countStatus = statuses => rows.filter(row => statuses.includes(key(row.status))).length;
  switch (kind) {
    case 'provisions': {
      const due = rows.filter(row => !generalSummaryText(row.paidDate)).map(row => calendarDay(row.dueDate)).filter(Boolean);
      return { dueToday: due.filter(day => day === today).length, overdue: due.filter(day => day < today).length };
    }
    case 'auditOrders': return { auditOrders: countStatus(['PENDENTE AUDITORIA']) };
    case 'quotes': return { quotes: countStatus(['ATIVA', 'ATIVO']) };
    case 'documents': return { documents: countStatus(['PENDENTE']) };
    case 'tasks': {
      // Complete input is sorted locally: never filter pending statuses before FirstN.
      const latest = rows.map(row => ({ row, order: identificationOrder(row.identifiedAt) }))
        .sort((a, b) => a.order === b.order ? 0 : a.order > b.order ? -1 : 1).slice(0, 2000);
      if (rows.length > 2000) warnings.push('LANCAMENTOTAREFAS: indicador limitado às 2000 tarefas mais recentes por DATA IDENTIFICAÇÃO (ordem decrescente).');
      return { pendingTasks: latest.filter(({ row }) => pendingTask(row)).length };
    }
    case 'delegatedTasks': return { delegatedTasks: rows.filter(pendingTask).length };
    case 'contractors': return { activeContracts: countStatus(['ATIVO']) };
    case 'presences': {
      const total = rows.filter(row => key(row.presence) === 'PRESENTE' && key(row.status) !== 'PAGO')
        .reduce((sum, row) => sum.plus(strictDecimal(row.dailyValue)), new Money(0));
      const value = total.toNumber();
      if (!total.isFinite() || total.abs().times(100).gt(Number.MAX_SAFE_INTEGER) || !new Money(value).eq(total)) {
        throw new TypeError('Soma de VLORDIARIO excede a precisão segura em centavos.');
      }
      return { pendingPayments: value };
    }
    case 'diaries': return { pendingDiaries: countStatus(['PENDENTE']) };
    case 'properties': return { commercialDocuments: rows.filter(row => generalSummaryText(row.branch)
      && generalSummaryText(row.property) && key(row.property) !== 'TODOS' && !key(row.property).startsWith('ESCRITORIO'))
      .reduce((sum, row) => sum + DOCUMENT_FIELDS.filter(field => !generalSummaryText(row[field])).length, 0) };
    case 'pathologies': return { activePathologies: countStatus(['ATIVO']) };
    default: throw new TypeError('Fonte desconhecida.');
  }
}

/**
 * Pure projection of complete canonical source arrays. A missing/null/Error source
 * leaves only its own metrics unavailable. Called by createGeneralSummaryData.
 * Canonical row fields are those emitted by the loader schema; no UI dependencies.
 */
export function buildGeneralSummaryReport(sources = {}, { now = () => new Date() } = {}) {
  const instant = new Date(typeof now === 'function' ? now() : now);
  const updatedAt = instant.toISOString();
  const parts = Object.fromEntries(dayFormatter.formatToParts(instant).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const metrics = {}, warnings = [];
  for (const [kind, source] of Object.entries(SOURCES)) {
    Object.assign(metrics, Object.fromEntries(source.metrics.map(metric => [metric, null])));
    try {
      const rows = sources[kind];
      if (rows instanceof Error) throw rows;
      if (!Array.isArray(rows)) throw new TypeError('Fonte indisponível ou incompleta.');
      Object.assign(metrics, sourceMetrics(kind, rows, today, warnings));
    } catch (error) {
      if (error?.code === 'AUTH_REQUIRED' || error?.name === 'AbortError') throw error;
      warnings.push(`${source.name}: ${error.message || 'Não foi possível calcular o indicador.'}`);
    }
  }
  return Object.freeze({ metrics: Object.freeze(metrics), today, updatedAt, warnings: Object.freeze(warnings) });
}
