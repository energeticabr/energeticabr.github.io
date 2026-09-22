function normalizedDateText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function isDateQuestion(message, options = []) {
  if (message?.calendarPicker === true || message?.calendar_picker === true) return true;
  const question = normalizedDateText(message?.question || message?.prompt || message?.text);
  if (!/\bdata\b/.test(question)) return false;
  const choices = options.map(option => normalizedDateText(option?.label || option?.title || option?.id)).join(" ");
  const datePreset = /\b(?:ontem|hoje|amanha|outra data|digitar data|data de hoje)\b/.test(choices);
  const dateFormat = /\b(?:dd\s*[,/]\s*dd|dd\/mm|dd\/mm\/aaaa|formato\s+dd)\b/.test(question);
  const directRequest = /\b(?:qual|informe|indique|digite|envie|selecione|escolha|nova)\b[^\n?.!]{0,80}\bdata\b/.test(question);
  return datePreset || dateFormat || directRequest;
}

export function isActiveDateQuestion(messages = []) {
  const latest = [...messages].reverse().find(message => message?.role !== "user");
  if (!latest) return false;
  return isDateQuestion(latest, Array.isArray(latest.options) ? latest.options : []);
}

export function normalizePartialDateSubmission(value, messages = []) {
  if (!isActiveDateQuestion(messages)) return value;
  const text = String(value || "").trim();
  if (/^\d{2}\/(?:\d{2}\/)?$/.test(text)) return text.slice(0, -1);
  return value;
}
