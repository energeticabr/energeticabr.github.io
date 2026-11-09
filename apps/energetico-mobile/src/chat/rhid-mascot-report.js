import { buildRhidAttendanceTable, isRhidAttendanceRowWithoutPunches, isValidRhidReportDate } from './rhid-attendance-table.js';
import { rhidNameKey } from './rhid-monthly-model.js';

export function rhidMascotMonths(start, end, today) {
  if (!isValidRhidReportDate(start) || !isValidRhidReportDate(end) || start > end || end > today) {
    throw new Error('Informe um período válido até hoje.');
  }
  const months = [];
  const date = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  while (date.toISOString().slice(0, 7) <= end.slice(0, 7)) {
    if (months.length === 12) throw new Error('Selecione até 12 meses por consulta.');
    months.push(date.toISOString().slice(0, 7));
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return months;
}

export function rhidMascotDay(rows, date) {
  const table = buildRhidAttendanceTable(rows);
  const indexes = table.rows.flatMap((row, index) =>
    !isRhidAttendanceRowWithoutPunches(row) || table.people[index].rawPunches.length ? [index] : []);
  return { ...table, reportDate: date, rows: indexes.map(i => table.rows[i]), people: indexes.map(i => table.people[i]) };
}

export const rhidMascotFilters = { supplier: 'Fornecedor', profession: 'Profissão', branch: 'Filial', property: 'Imóvel' };
export const rhidMascotPageSize = 14;

export function filterRhidMascotDays(tables, directory = [], filters = {}) {
  const registrations = new Map();
  for (const supplier of directory) {
    const key = rhidNameKey(supplier.name);
    if (key) registrations.set(key, registrations.has(key) ? null : supplier);
  }
  const identities = new Map();
  for (const table of tables) {
    for (const person of table.people) {
      if (!person.personKey) continue;
      const name = rhidNameKey(person.name);
      if (!identities.has(name)) identities.set(name, new Set());
      identities.get(name).add(person.personKey);
    }
  }
  const choices = Object.fromEntries(Object.keys(rhidMascotFilters).map(field => [field, new Map()]));
  const days = tables.map(table => {
    const rows = [], people = [];
    table.people.forEach((person, index) => {
      const name = rhidNameKey(person.name);
      const registration = identities.get(name)?.size > 1 ? null : registrations.get(name);
      const values = { supplier: registration?.name || person.name, profession: registration?.profession,
        branch: registration?.branch, property: registration?.property };
      for (const [field, label] of Object.entries(values)) {
        const key = rhidNameKey(label);
        if (key) choices[field].set(key, label);
      }
      if (Object.keys(choices).some(field => filters[field] && filters[field] !== rhidNameKey(values[field]))) return;
      people.push({ ...person, profession: values.profession, branch: values.branch, property: values.property });
      rows.push(table.rows[index]);
    });
    return { ...table, rows, people };
  }).filter(table => table.rows.length);
  return { days, options: Object.fromEntries(Object.entries(choices).map(([field, values]) => [
    field, [...values].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR')),
  ])) };
}
