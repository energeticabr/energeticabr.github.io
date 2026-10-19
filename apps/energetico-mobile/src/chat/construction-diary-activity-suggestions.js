import { provisionDateKey } from './pending-provision-dates.js';
import { diaryActivityContent } from '../ui/construction-diary-items.js';

export function diarySuggestionKey(value) {
  return String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ').trim().replace(/[;.!?]+$/, '');
}

function dateKey(value, dateColumn) {
  // SharePoint date-only fields can be serialized as midnight UTC. Their
  // calendar date must not be shifted to the previous day in São Paulo.
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (dateColumn?.dateTime?.format === 'dateOnly'
    || !dateColumn?.dateTime?.format && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d+)?Z$/i.test(text))
    return provisionDateKey(text.slice(0, 10));
  return provisionDateKey(value);
}

function activityLines(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n')
    .replace(/;\s*(?=\d+\.\s)/g, ';\n')
    .split('\n')
    .map(line => diaryActivityContent(line).trim().replace(/;+\s*$/, '').trim())
    .filter(Boolean);
}

export function diaryActivityInDraft(draft, activity) {
  const key = diarySuggestionKey(activityLines(activity)[0]);
  return Boolean(key) && activityLines(draft).some(line => diarySuggestionKey(line) === key);
}

export function recentDiaryActivities(rows, { diaryDate, branch, dateColumn,
  dateField = 'DATA', activityField = 'ATIVIDADEEXECUTADA', statusField = 'STATUS', branchField = 'FILIAL' } = {}) {
  const end = dateKey(diaryDate, dateColumn), branchKey = diarySuggestionKey(branch);
  if (!end || !branchKey) return [];
  const dated = (Array.isArray(rows) ? rows : []).map(row => {
    const fields = row?.fields || row || {};
    return { id: String(row?.id || ''), day: dateKey(fields[dateField], dateColumn), text: fields[activityField],
      status: diarySuggestionKey(fields[statusField]), branch: diarySuggestionKey(fields[branchField]) };
  }).filter(row => row.day && row.day < end && row.status === 'concluido' && row.branch === branchKey)
    .sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id, 'en', { numeric: true })).slice(0, 5);
  const seen = new Set();
  const activities = [];
  for (const row of dated) for (const activity of activityLines(row.text)) {
    const identity = diarySuggestionKey(activity);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    activities.push(activity);
  }
  return activities;
}

export function appendRecentDiaryActivity(draft, activity) {
  const choice = activityLines(activity)[0];
  if (!choice) return String(draft ?? '');
  const existing = activityLines(draft);
  if (existing.some(item => diarySuggestionKey(item) === diarySuggestionKey(choice))) return String(draft ?? '');
  const lines = [...existing, choice];
  return `${lines.map((line, index) => `${index + 1}. ${line.replace(/;+\s*$/, '')};`).join('\n')}\n${lines.length + 1}. `;
}
