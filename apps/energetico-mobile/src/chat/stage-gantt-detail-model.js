import { normalizeStageProgressDate } from './stage-progress-model.js';

const key = value => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/\s+/g, ' ');

export function buildGanttProfessionDetail(snapshot) {
  if (snapshot?.complete !== true || snapshot.error || snapshot.partial || snapshot.truncated || snapshot.aborted
    || !Array.isArray(snapshot.rows)) throw new TypeError('O detalhamento exige presenças completas.');
  const professions = new Map();
  const ids = new Set();
  for (const row of snapshot.rows) {
    const date = normalizeStageProgressDate(row?.date);
    if (!date) throw new TypeError('Presença vinculada sem data.');
    if (!/^[1-9]\d*$/.test(String(row.id)) || ids.has(String(row.id))
      || typeof row.supplier !== 'string' || !row.supplier.trim() || typeof row.profession !== 'string') {
      throw new TypeError('Presença vinculada inválida ou duplicada.');
    }
    ids.add(String(row.id));
    const professionName = row.profession.trim() || 'SEM PROFISSÃO';
    const professionKey = key(professionName);
    if (!professions.has(professionKey)) professions.set(professionKey, { name: professionName, people: new Map() });
    const profession = professions.get(professionKey);
    const personKey = key(row.supplier);
    if (!profession.people.has(personKey)) profession.people.set(personKey, { name: row.supplier.trim(), dates: new Set() });
    profession.people.get(personKey).dates.add(date);
  }
  const groups = [...professions.values()].map(profession => {
    const people = [...profession.people.values()].map(person => {
      const dates = [...person.dates].sort();
      return { name: person.name, days: dates.length, firstDate: dates[0], lastDate: dates.at(-1) };
    }).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'pt-BR'));
    return { name: profession.name, days: people.reduce((sum, person) => sum + person.days, 0), people };
  }).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'pt-BR'));
  return { days: groups.reduce((sum, profession) => sum + profession.days, 0), professions: groups };
}
