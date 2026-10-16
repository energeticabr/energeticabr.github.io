import { isValidRhidReportDate } from './rhid-attendance-table.js';

const PUNCH_SLOTS = [
  ['entry1', 'E1'], ['exit1', 'S1'], ['entry2', 'E2'], ['exit2', 'S2'],
];

/** Boundaries are inclusive and measured in worked minutes, never elapsed clock time. */
export function attendanceIrregularity({ date, minutes, punches, status } = {}) {
  if (!isValidRhidReportDate(date)) return null;
  const missingPunches = status === 'absent'
    ? PUNCH_SLOTS.map(([, label]) => label)
    : punches && typeof punches === 'object' && !Array.isArray(punches)
      ? PUNCH_SLOTS.filter(([slot]) => !String(punches[slot] ?? '').trim()).map(([, label]) => label)
      : [];
  if (missingPunches.length) return { date, missingPunches };
  if (!Number.isInteger(minutes) || minutes < 0) return null;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const range = day === 5 ? [460, 500, '7h40 a 8h20']
    : day >= 1 && day <= 4 ? [525, 570, '8h45 a 9h30'] : null;
  if (!range || (minutes >= range[0] && minutes <= range[1])) return null;
  return { date, minutes, limit: range[2], duration: `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` };
}
