export function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

export function normalizeCadastroValue(value = "") {
  return String(value).trim().toLocaleUpperCase("pt-BR");
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

export function formatDateTime(value, locale = "pt-BR") {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Nao informado";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nao informado";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
