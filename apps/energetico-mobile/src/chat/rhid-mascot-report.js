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

export function rhidMascotAmbiguousNames(rowsByDay) {
  const identities = new Map();
  const ambiguous = new Set();
  for (const rows of rowsByDay.values()) {
    for (const row of rows) {
      const name = rhidNameKey(row?.NOME_COLABORADOR);
      const id = String(row?.ID_PESSOA_RHID ?? '').trim();
      if (!name || !id) continue;
      if (identities.has(name) && identities.get(name) !== id) ambiguous.add(name);
      identities.set(name, id);
    }
  }
  return ambiguous;
}

export function rhidMascotDay(rows, date, descriptiveRows, ambiguousNames = rhidMascotAmbiguousNames(new Map([[date, rows]]))) {
  const table = buildRhidAttendanceTable(rows);
  const statusesByName = new Map();
  for (const item of descriptiveRows || []) {
    const name = rhidNameKey(item.supplier);
    const status = rhidNameKey(item.presence);
    if (!name || !['PRESENTE', 'AUSENTE', 'PENDENTE'].includes(status)) continue;
    if (!statusesByName.has(name)) statusesByName.set(name, new Set());
    statusesByName.get(name).add(status);
  }
  const peopleByName = new Map();
  for (const person of table.people) {
    const name = rhidNameKey(person.name);
    peopleByName.set(name, (peopleByName.get(name) || 0) + 1);
  }
  const visibleRows = [], people = [];
  for (const [index, person] of table.people.entries()) {
    const row = table.rows[index];
    const name = rhidNameKey(person.name);
    const ambiguous = ambiguousNames.has(name) || peopleByName.get(name) > 1;
    const statuses = ambiguous ? null : statusesByName.get(name);
    const clockPunch = person.rawPunches.length > 0;
    if (!statuses && !clockPunch && isRhidAttendanceRowWithoutPunches(row)) continue;
    const pending = statuses?.has('PENDENTE') === true;
    const mismatch = clockPunch ? statuses?.has('AUSENTE') === true
      : person.emptyPunchSource && statuses?.has('PRESENTE') === true;
    let label = 'Sem presença no Descritivo';
    if (ambiguous) label = 'Nome ambíguo no RHID';
    else if (mismatch) label = clockPunch ? 'Ausente no Descritivo, com batida no relógio' : 'Presente no Descritivo, sem batida no relógio';
    else if (pending) label = 'Pendente no Descritivo';
    else if (statuses) label = statuses.has('PRESENTE') ? 'Presente no Descritivo' : 'Ausente no Descritivo';
    const presenceComparison = descriptiveRows ? { pending, mismatch, label } : null;
    people.push({ ...person, presenceComparison });
    visibleRows.push(row);
  }
  return { ...table, reportDate: date, rows: visibleRows, people };
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
