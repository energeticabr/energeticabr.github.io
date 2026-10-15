import { provisionDateKey, provisionDayOffset } from './pending-provision-dates.js';
import { diaryActivityContent } from '../ui/construction-diary-items.js';

export function diarySuggestionKey(value) {
  return String(value ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ').trim().replace(/[;.!?]+$/, '');
}

function dateKey(value) {
  // SharePoint date-only fields can be serialized as midnight UTC. Their
  // calendar date must not be shifted to the previous day in São Paulo.
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d+)?Z$/i.test(text)) return provisionDateKey(text.slice(0, 10));
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

export function recentDiaryActivities(rows, { today = new Date(), dateField = 'DATA', activityField = 'ATIVIDADEEXECUTADA' } = {}) {
  const end = provisionDateKey(today);
  const start = provisionDayOffset(end, -4);
  if (!end || !start) return [];
  const dated = (Array.isArray(rows) ? rows : []).map(row => {
    const fields = row?.fields || row || {};
    return { day: dateKey(fields[dateField]), text: fields[activityField] };
  }).filter(row => row.day >= start && row.day <= end).sort((a, b) => b.day.localeCompare(a.day));
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
