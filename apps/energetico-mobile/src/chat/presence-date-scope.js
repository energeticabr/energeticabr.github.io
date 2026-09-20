const DATE_PATTERNS = [
  /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/,
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/,
];

export const PRESENCE_OTHER_DATES_REPLY_ID = "presence_other_dates";
export const PRESENCE_OTHER_DATES_LABEL = "📅 VER OUTRAS DATAS";

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function presenceDateKey(value) {
  if (!value) return "";
  const raw = text(value);
  let match = DATE_PATTERNS[0].exec(raw);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  match = DATE_PATTERNS[1].exec(raw);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

function tableCells(table) {
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  return rows.flatMap(row => Array.isArray(row) ? row : [row]);
}

function presenceDateFromTable(message) {
  const table = message?.detail_table || message?.detailTable;
  if (!table || (table.kind && normalized(table.kind) !== "presence")) return "";
  const isPresenceQuestion = /presen[cç]a/i.test(text(message?.question || message?.prompt || ""));
  if (!isPresenceQuestion && !table.kind) return "";
  const cell = tableCells(table).find(item => /\bdata\b/i.test(text(item?.label || item?.name)));
  return presenceDateKey(cell?.value);
}

function presenceDateFromConfirmation(message) {
  const confirmation = message?.presence_confirmation || message?.presenceConfirmation;
  if (!confirmation || typeof confirmation !== "object") return "";
  return presenceDateKey(
    confirmation.date || confirmation.data || confirmation.presenceDate || confirmation.presence_date,
  );
}

export function latestPresenceValidationDate(messages = []) {
  for (const message of [...messages].reverse()) {
    const date = presenceDateFromTable(message) || presenceDateFromConfirmation(message);
    if (date) return date;
  }
  return "";
}

function optionDateKey(option) {
  return presenceDateKey(
    option?.date || option?.data || option?.presenceDate || option?.presence_date
      || option?.label || option?.title || option?.text || option?.id,
  );
}

function isPendingPresencePoll(message) {
  if (message?.type !== "poll" || !Array.isArray(message.options)) return false;
  if (message?.presentation === "accordion") return true;
  return /pendentes?.{0,30}valida[cç][aã]o.{0,30}presen[cç]a/i.test(
    text(message.question || message.prompt),
  );
}

function otherDatesOption() {
  return {
    id: PRESENCE_OTHER_DATES_REPLY_ID,
    reply: PRESENCE_OTHER_DATES_REPLY_ID,
    label: PRESENCE_OTHER_DATES_LABEL,
  };
}

export function scopePendingPresenceMessage(message, selectedDate) {
  if (!isPendingPresencePoll(message) || !selectedDate) return message;
  const allOptions = message.options.slice();
  const datedOptions = allOptions.map(option => ({ option, date: optionDateKey(option) }))
    .filter(item => item.date);
  if (!datedOptions.length) return message;
  const visibleOptions = datedOptions
    .filter(item => item.date === selectedDate)
    .map(item => item.option);
  const hasOtherDate = datedOptions.some(item => item.date !== selectedDate);
  return {
    ...message,
    options: [
      ...visibleOptions,
      ...(hasOtherDate || !visibleOptions.length ? [otherDatesOption()] : []),
    ],
    presenceDateAllOptions: allOptions,
    presenceDateKey: selectedDate,
    ...(visibleOptions.length
      ? {}
      : { presenceDateSummary: { date: selectedDate, count: datedOptions.length } }),
  };
}

export function scopePresenceResult(result = {}, selectedDate = "") {
  if (!selectedDate || !Array.isArray(result.messages)) return result;
  return {
    ...result,
    messages: result.messages.map(message => scopePendingPresenceMessage(message, selectedDate)),
  };
}

export function expandPresenceDatesMessage(message) {
  if (!Array.isArray(message?.presenceDateAllOptions)) return message;
  const { presenceDateSummary: _summary, ...messageWithoutSummary } = message;
  return {
    ...messageWithoutSummary,
    options: message.presenceDateAllOptions.slice(),
    presenceDateExpanded: true,
  };
}
