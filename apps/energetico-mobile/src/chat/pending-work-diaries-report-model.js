import { provisionDateKey } from './pending-provision-dates.js';

const LIMIT = 2000;
const ROW_FIELDS = ['id', 'date', 'branch', 'status'];

function identifier(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (!['string', 'number'].includes(typeof raw) || !/^\d+$/.test(String(raw))
    || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    throw new TypeError('ID inválido no relatório de diários pendentes.');
  }
  return Number(raw);
}

function branchText(value) {
  if (value == null) return '';
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('Campo FILIAL inválido no relatório de diários pendentes.');
  }
  return String(value).trim();
}

function calendarDate(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError('Campo DATA inválido no relatório de diários pendentes.');
  const raw = value.trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    // Date.parse can roll an impossible timestamp day into the following month.
    if (!provisionDateKey(raw.slice(0, 10))
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw)) return '';
  }
  return provisionDateKey(raw);
}

/** Adapt the read-only reminder snapshot without changing its rows or ordering.
 * Rows expose numeric id, calendar date, pt-BR dateLabel, branch and status.
 * Labels are plain text: consumers must use textContent, never HTML interpolation.
 */
export function buildPendingWorkDiariesReport(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Array.isArray(snapshot.rows) || !Number.isSafeInteger(snapshot.count)
    || snapshot.count < 0 || snapshot.count !== snapshot.rows.length
    || snapshot.complete === false || snapshot.partial || snapshot.incomplete || snapshot.truncated
    || snapshot.aborted || snapshot.error || snapshot.hasMore || snapshot.nextLink) {
    throw new TypeError('Snapshot de diários pendentes inválido ou incompleto; contagem inconsistente.');
  }

  const unique = new Map();
  // Validate before filtering and capping so neither operation hides corrupt rows.
  for (const row of snapshot.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || ROW_FIELDS.some(field => !Object.hasOwn(row, field))) {
      throw new TypeError('Registro ou campo incompleto no relatório de diários pendentes.');
    }
    const id = identifier(row.id), date = calendarDate(row.date), branch = branchText(row.branch);
    if (typeof row.status !== 'string') throw new TypeError('Campo STATUS inválido no relatório de diários pendentes.');
    const status = row.status.trim().toUpperCase();
    const normalized = { id, date, dateLabel: date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—', branch, status };
    const previous = unique.get(id);
    if (previous && (previous.date !== date || previous.branch !== branch || previous.status !== status)) {
      throw new TypeError('ID duplicado com campos conflitantes no relatório de diários pendentes.');
    }
    unique.set(id, normalized);
  }

  const pending = [...unique.values()].filter(row => row.status === 'PENDENTE').sort((a, b) => b.id - a.id);
  const pendingCount = pending.length, limited = pendingCount >= LIMIT;
  return { rows: pending.slice(0, LIMIT), pendingCount, limited,
    countLabel: limited ? '⚠️ > 2.000' : pendingCount.toLocaleString('pt-BR') };
}
