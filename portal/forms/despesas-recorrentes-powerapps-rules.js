const RECURRENCE_BY_LABEL = Object.freeze({
  "Diário": "Day",
  Semanal: "Week",
  Mensal: "Month",
  Anual: "Year",
});

const STORED_RECURRENCES = new Set(Object.values(RECURRENCE_BY_LABEL));

export const F21_RECURRENCE_OPTIONS = Object.freeze(
  Object.entries(RECURRENCE_BY_LABEL).map(([label, value]) => Object.freeze({ label, value })),
);

function normalizedText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function normalizeF21Recurrence(value) {
  const recurrence = normalizedText(value);
  if (Object.hasOwn(RECURRENCE_BY_LABEL, recurrence)) return RECURRENCE_BY_LABEL[recurrence];
  if (STORED_RECURRENCES.has(recurrence)) return recurrence;
  return recurrence;
}

export function normalizeF21RecurrenceDays(value) {
  return normalizedText(value);
}

export function isF21RecurrenceDaysVisible(recurrence) {
  return normalizeF21Recurrence(recurrence) === "";
}

export function normalizeF21RecurringExpenseRules(values = {}) {
  const recurrence = normalizeF21Recurrence(values.RECORRENCIA);

  return {
    RECORRENCIA: recurrence,
    RECORRENCIADIAS: normalizeF21RecurrenceDays(values.RECORRENCIADIAS),
    recurrenceDaysVisible: isF21RecurrenceDaysVisible(recurrence),
  };
}

