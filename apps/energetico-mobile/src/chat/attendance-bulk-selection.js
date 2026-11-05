import { attendanceRhidOptionContext } from './attendance-rhid-badges.js';

// Match complete supplier names, never another worker who shares a first name.
const WITHOUT_CLOCK = new Set([
  'ISRAEL', 'ISRAEL ESCORAMENTO', 'ISRAEL ESCORAMENTO E ARMACOES',
  'RAFAEL', 'RAFAEL GONTIJO',
]);
const SLOTS = ['entry1', 'exit1', 'entry2', 'exit2'];
const time = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? '').trim());

export function attendanceClockExempt(option, poll) {
  const name = attendanceRhidOptionContext(option, poll)?.name || '';
  return WITHOUT_CLOCK.has(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLocaleUpperCase('pt-BR').replace(/\s+/g, ' '));
}

export function attendanceBulkEligible(option, poll) {
  if (!option || option.disabled || option.rhidBadge?.status === 'loading') return false;
  if (attendanceClockExempt(option, poll)) return true;
  const badge = option.rhidBadge;
  if (!badge || !['present', 'inconsistent'].includes(badge.status)) return false;
  // Explicit empty slots take precedence over a stale duration. Older badges
  // without slots can still prove a worked duration, but unknown states cannot.
  if (badge.punches && typeof badge.punches === 'object') return SLOTS.some(slot => time(badge.punches[slot]));
  return Number.isInteger(badge.minutes) && badge.minutes > 0;
}
