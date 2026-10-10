import Decimal from 'decimal.js';
import {formatOperationsDate} from './operations-reports-model.js';

const unnamed = 'Fornecedor não informado';
const unknownProfession = 'Profissão não informada';
const identity = name => name.normalize('NFC').toLocaleLowerCase('pt-BR');
const compareNames = (a, b) => a.localeCompare(b, 'pt-BR');

export function currentPayrollMonth(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('Data atual inválida.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value.padStart(4, '0')}-${parts.find(p => p.type === 'month').value}`;
}

function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['LookupValue', 'Value', 'value']) {
      if (Object.hasOwn(value, key)) {
        const inner = value[key];
        if (inner == null) return '';
        if (typeof inner === 'string') return inner.trim();
        break;
      }
    }
  }
  throw new TypeError('Mês de referência inválido.');
}

/** Reference fields are calendar labels, even when SharePoint serializes them as ISO dates. */
export function normalizePayrollMonth(value) {
  const text = scalar(value);
  if (!text) return '';
  let year, month, day;
  let match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) [, month, year] = match;
  else if ((match = /^(\d{4})-(\d{2})$/.exec(text))) [, year, month] = match;
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text))) [, day, month, year] = match;
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/.exec(text))) {
    [, year, month, day] = match;
    if (match[4] && (!/^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(match[4])
      || !Number.isFinite(Date.parse(text)))) throw new TypeError('Data de referência inválida.');
  } else throw new TypeError('Mês de referência inválido.');
  const y = Number(year), m = Number(month), d = Number(day || 1);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) throw new TypeError('Data de referência inválida.');
  return `${year}-${String(m).padStart(2, '0')}`;
}

export function buildSupplierPayrollOverview(snapshot, { month = '', supplier = '', profession = '' } = {}) {
  if (snapshot?.complete !== true || !Array.isArray(snapshot.sheets)) throw new TypeError('Snapshot completo de folhas obrigatório.');
  const chosenMonth = normalizePayrollMonth(month);
  if (typeof supplier !== 'string') throw new TypeError('Fornecedor inválido.');
  const chosenSupplier = identity(supplier.trim());
  if (typeof profession !== 'string') throw new TypeError('Profissão inválida.');
  const chosenProfession = identity(profession.trim());
  const groups = new Map(), ids = new Set(), months = new Set();
  for (const sheet of snapshot.sheets) {
    const id = String(sheet?.id ?? '');
    if (!/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id)) || ids.has(id)) {
      throw new TypeError('ID de folha inválido ou duplicado.');
    }
    ids.add(id);
    if (sheet.supplier != null && typeof sheet.supplier !== 'string') throw new TypeError('Fornecedor inválido.');
    const name = sheet.supplier?.trim() || unnamed, key = identity(name);
    if (sheet.profession != null && typeof sheet.profession !== 'string') throw new TypeError('Profissão inválida.');
    const professionLabel = sheet.profession?.trim() || unknownProfession;
    const period = normalizePayrollMonth(sheet.month);
    if (period) months.add(period);
    if (!groups.has(key)) groups.set(key, { key, supplier: name, profession: professionLabel, ids: [], sheets: [] });
    const group = groups.get(key);
    // Apply the same safe duplicate rule to older/external snapshots, before
    // filtering periods: conflicting professions never identify a supplier.
    if (identity(group.profession) !== identity(professionLabel)) group.profession = unknownProfession;
    group.sheets.push({ id, supplier: group.supplier, month: period,
      referenceLabel: period ? `${period.slice(5)}/${period.slice(0, 4)}` : 'Sem referência' });
  }
  const all = [...groups.values()].sort((a, b) => compareNames(a.supplier, b.supplier));
  const filtered = [];
  for (const group of all) {
    if (chosenSupplier && chosenSupplier !== group.key) continue;
    if (chosenProfession && chosenProfession !== identity(group.profession)) continue;
    const sheets = group.sheets.filter(s => !chosenMonth || s.month === chosenMonth)
      .sort((a, b) => Number(a.id) - Number(b.id));
    if (sheets.length) filtered.push({ key: group.key, supplier: group.supplier, profession: group.profession,
      ids: sheets.map(s => s.id), sheets });
  }
  const professions = new Map(all.map(g => [identity(g.profession), g.profession]));
  return { groups: filtered, months: [...months].sort().reverse(), suppliers: all.map(g => g.supplier),
    professions: [...professions.values()].sort(compareNames),
    sheetCount: filtered.reduce((n, g) => n + g.sheets.length, 0) };
}

function decimal(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? new Decimal(value) : null;
  if (typeof value !== 'string') return null;
  let raw = value.trim().replace(/^R\$\s*/, '');
  if (!/^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/.test(raw)) return null;
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  return new Decimal(raw);
}

/** One unknown amount invalidates the definitive total, including unsafe sums. */
export function summarizePayrollPayments(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Lista de pagamentos inválida.');
  let total = new Decimal(0), uncalculated = 0;
  for (const row of rows) {
    let cents = null;
    if (row && Object.hasOwn(row, 'totalCents')) {
      if (Number.isSafeInteger(row.totalCents)) cents = row.totalCents;
    } else if (row) {
      const unit = decimal(row.unitValue), quantity = decimal(row.quantity);
      if (unit && quantity) {
        const amount = unit.mul(quantity).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        if (amount.abs().lte(Number.MAX_SAFE_INTEGER)) cents = amount.toNumber();
      }
    }
    if (cents === null) uncalculated++;
    else total = total.plus(cents);
  }
  return { totalCents: uncalculated || total.abs().gt(Number.MAX_SAFE_INTEGER) ? null : total.toNumber(), uncalculated };
}

/** Reuse the paid-total policy per rubric, never replace an unknown amount with zero. */
export function summarizePayrollPaymentsByType(rows) {
  if (!Array.isArray(rows)) throw new TypeError('Lista de pagamentos inválida.');
  const groups = new Map();
  for (const row of rows) {
    const type = (typeof row?.type === 'string' ? row.type.normalize('NFC').trim().replace(/\s+/g, ' ') : '')
      .toLocaleUpperCase('pt-BR') || 'RUBRICA NÃO INFORMADA';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(row);
  }
  return [...groups].sort(([a], [b]) => compareNames(a, b))
    .map(([type, payments]) => ({ type, ...summarizePayrollPayments(payments) }));
}

export function payrollReferencePeriod(month) {
  const normalized = normalizePayrollMonth(month);
  if (!normalized) return {start:'Sem referência',end:'Sem referência'};
  const [y,m] = normalized.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const day = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
  const suffix = `${normalized.slice(5)}/${normalized.slice(0,4)}`;
  return {start:`01/${suffix}`,end:`${day}/${suffix}`};
}

/** Named rubrics retain their identity; new rubrics are never folded into Outros. */
export function payrollTypeAppearance(type) {
  const key = String(type||'RUBRICA NÃO INFORMADA').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
  const known = {
    'SALARIO':['#16794d','#e4f7ec','💰'], 'VALE REFEICAO':['#946600','#fff4cc','🍴'],
    'VALE TRANSPORTE':['#245a92','#e6f0fc','🚌'], 'PREMIACAO':['#7d3bae','#f1e6fc','★'],
    'AJUDA DE CUSTO':['#a25316','#fff0e2','🤝'], '13 SALARIO':['#147d80','#def5f4','💵'],
    'FERIAS E/OU ENCARGOS':['#b83f65','#fce5ed','☀'],
  };
  const hash = [...key].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%360;
  const [color,background,icon] = known[key] || [`hsl(${hash} 50% 32%)`,`hsl(${hash} 65% 94%)`,'◈'];
  return {color,background,icon};
}

export function buildPayrollReportCsv(groups) {
  if (!Array.isArray(groups)) throw new TypeError('Grupos de folha inválidos.');
  const quoted = value => `"${String(value ?? '').replaceAll('"','""')}"`;
  const text = value => {
    const raw = String(value ?? '');
    const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
    return quoted(safe);
  };
  const number = value => decimal(value)?.toFixed().replace('.',',') ?? 'Não calculado';
  const cents = value => !Number.isSafeInteger(value) ? 'Não calculado' : new Decimal(value).div(100).toFixed(2).replace('.',',');
  const lines = [['REGISTRO','FORNECEDOR','PERÍODO INICIAL','PERÍODO FINAL','ID PAGAMENTO','IDFOLHA','TIPO','DATA','ID LANÇAMENTO','DESCRIÇÃO','VALOR UNITÁRIO','QTD.','VALOR TOTAL','CONTA/FORMAPGTO','OBSERVAÇÕES']];
  for (const group of groups) {
    if (!Array.isArray(group.rows)||!Array.isArray(group.sheets)) throw new TypeError('Grupo incompleto.');
    const periods = [...new Set(group.sheets.map(s=>normalizePayrollMonth(s.month)))].map(payrollReferencePeriod);
    const start = periods.map(p=>p.start).join(' | '), end = periods.map(p=>p.end).join(' | ');
    const byId = new Map(group.sheets.map(s=>[String(s.id),payrollReferencePeriod(s.month)]));
    for (const row of group.rows) {
      const p = byId.get(String(row.payrollId));
      if (!p) throw new TypeError('Pagamento fora das folhas selecionadas.');
      lines.push(['PAGAMENTO',group.supplier,p.start,p.end,row.id,row.payrollId,row.type,formatOperationsDate(row.date),row.launchId,row.description,number(row.unitValue),number(row.quantity),cents(row.totalCents),row.paymentMethod,row.observations]);
    }
    for (const total of summarizePayrollPaymentsByType(group.rows)) lines.push(['TOTAL POR TIPO',group.supplier,start,end,'','',total.type,'','','','','',cents(total.totalCents)]);
    lines.push(['TOTAL GERAL',group.supplier,start,end,'','','','','','','','',cents(summarizePayrollPayments(group.rows).totalCents)]);
  }
  return '\ufeff' + lines.map(line=>Array.from({length:15},(_,i)=>[10,11,12].includes(i)?quoted(line[i]):text(line[i])).join(';')).join('\r\n')+'\r\n';
}
