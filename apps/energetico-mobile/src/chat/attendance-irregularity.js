import { isValidRhidReportDate } from './rhid-attendance-table.js';

const PUNCH_SLOTS = [
  ['entry1', 'E1'], ['exit1', 'S1'], ['entry2', 'E2'], ['exit2', 'S2'],
];

/** Allow up to 30 minutes either side of the workday; missing punches still require justification. */
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
  const range = day === 5 ? [450, 510, '7h30 a 8h30']
    : day >= 1 && day <= 4 ? [510, 570, '8h30 a 9h30'] : null;
  if (!range || (minutes >= range[0] && minutes <= range[1])) return null;
  return { date, minutes, limit: range[2], duration: `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` };
}
