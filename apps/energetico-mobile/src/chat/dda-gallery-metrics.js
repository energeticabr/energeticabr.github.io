import Decimal from 'decimal.js';
import { normalizeDdaReportRows } from './dda-report-model.js';
import { registrationRawField, registrationNumber, REGISTRATION_GALLERY_MODELS } from './registration-gallery-data.js';
import { ddaTodayKey } from '../ui/dda-card.js';

const Money = Decimal.clone({ precision: 40 });
const dayMs = 86_400_000;
const dateKey = date => date.toISOString().slice(0, 10);
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && dateKey(new Date(value)) === value;

/** Metrics always describe the full snapshot, never the current search/page. */
export function buildDdaGalleryMetrics(snapshot, now = new Date()) {
  const rows = normalizeDdaReportRows(snapshot);
  const todayKey = ddaTodayKey(now);
  const anchor = new Date(todayKey + 'T12:00:00Z');
  const sunday = new Date(anchor.getTime() - anchor.getUTCDay() * dayMs);
  const weekStart = dateKey(sunday), weekEnd = dateKey(new Date(sunday.getTime() + 5 * dayMs));
  const pending = rows.flatMap((row, index) => {
    if (!['Em aberto', 'Agendado'].includes(row.status)) return [];
    const payment = registrationRawField(snapshot.rows[index].fields, 'VALOR_PAGAMENTO', REGISTRATION_GALLERY_MODELS.dda);
    const number = registrationNumber(payment);
    const amount = payment == null || payment === '' ? row.amount
      : number != null && number >= 0 && number <= Number.MAX_SAFE_INTEGER / 100 ? new Money(number).toDecimalPlaces(2).toFixed(2) : null;
    return [{ ...row, amount }];
  });
  const sum = selected => selected.some(row => row.amount == null) ? null
    : selected.reduce((total, row) => total.plus(row.amount), new Money(0)).toFixed(2);
  const missingDue = pending.some(row => !validDay(row.due));
  const times = rows.map(row => /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(row.checkedAt) ? Date.parse(row.checkedAt) : NaN).filter(Number.isFinite);
  return {
    total: sum(pending), today: missingDue ? null : sum(pending.filter(row => row.due === todayKey)),
    week: missingDue ? null : sum(pending.filter(row => row.due >= weekStart && row.due <= weekEnd)),
    weekStart, weekEnd, todayKey,
    lastCommunication: times.length ? new Date(times.reduce((max, time) => Math.max(max, time), -Infinity)).toISOString() : null,
    unknownCount: rows.filter(row => !['Em aberto', 'Agendado', 'Pago', 'Baixado'].includes(row.status)).length,
  };
}
