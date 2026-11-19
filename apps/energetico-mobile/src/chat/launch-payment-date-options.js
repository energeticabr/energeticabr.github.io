function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function saoPauloDateParts(value = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const part = name => Number(parts.find(item => item.type === name)?.value);
    return { year: part("year"), month: part("month"), day: part("day") };
  } catch {
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
}

function isPaymentDateQuestion(message, status) {
  const question = normalized([message?.question, message?.prompt, message?.text].filter(Boolean).join(" "));
  return new RegExp(`\\bdata\\s+(?:(?:de|do)\\s+)?(?:pagamento|pgto)\\s+${status}\\b`, "u").test(question);
}

function dateIso({ year, month, day }) {
  if (![year, month, day].every(Number.isInteger)) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftIsoDate(iso, offset) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return dateIso({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function paymentDateIso(value, now = new Date()) {
  const text = normalized(value).replace(/\s+/gu, " ").trim();
  const today = dateIso(saoPauloDateParts(now));
  if (!text || !today) return "";
  if (/\bhoje\b/u.test(text)) return today;
  if (/\bontem\b/u.test(text)) return shiftIsoDate(today, -1);
  if (/\bamanha\b/u.test(text)) return shiftIsoDate(today, 1);

  const iso = text.match(/(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/u);
  if (iso) return dateIso({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) });

  const numeric = text.match(/(?:^|\D)(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?:\D|$)/u);
  if (!numeric) return "";
  const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : saoPauloDateParts(now).year;
  return dateIso({ year, month: Number(numeric[2]), day: Number(numeric[1]) });
}

function paymentDateOptionKind(option) {
  const value = normalized([
    option?.reply,
    option?.id,
    option?.label,
    option?.title,
  ].filter(Boolean).join(" "));
  if (/(?:hoje|today)/u.test(value)) return "today";
  if (/(?:ontem|yesterday)/u.test(value)) return "yesterday";
  if (/(?:amanha|tomorrow)/u.test(value)) return "tomorrow";
  if (/\b(?:em branco|blank|sem data)\b/u.test(value)) return "blank";
  return "other";
}

function optionReplyId(option) {
  return String(option?.reply || option?.id || "").trim();
}

export function isEffectivePaymentDatePoll(message) {
  if (message?.type !== "poll") return false;
  return isPaymentDateQuestion(message, "efetuado");
}

function paymentDateOptions(options) {
  return options.filter(option => paymentDateOptionKind(option) !== "tomorrow");
}

export function orderEffectivePaymentDateOptions(message, options) {
  if (message?.type !== "poll" || !Array.isArray(options)
    || !(isEffectivePaymentDatePoll(message) || isPaymentDateQuestion(message, "previsto"))) return options;
  return paymentDateOptions(options);
}

export function recommendEffectivePaymentDate(previousPoll, submittedText, replyId, result, now = new Date()) {
  if (previousPoll?.type !== "poll"
    || !isPaymentDateQuestion(previousPoll, "previsto")
    || !Array.isArray(result?.messages)) return result;

  const selectedOption = (Array.isArray(previousPoll.options) ? previousPoll.options : [])
    .find(option => optionReplyId(option) === String(replyId || "").trim());
  const answer = selectedOption?.label || selectedOption?.title || submittedText;
  const predictedDate = paymentDateIso(answer, now);
  if (!predictedDate) {
    const effectivePollIndex = lastIndexMatching(result.messages, isEffectivePaymentDatePoll);
    if (effectivePollIndex < 0) return result;
    const messages = [...result.messages];
    const poll = messages[effectivePollIndex];
    messages[effectivePollIndex] = {
      ...poll,
      options: paymentDateOptions(Array.isArray(poll.options) ? poll.options : []),
    };
    return { ...result, messages };
  }

  const effectivePollIndex = lastIndexMatching(result.messages, isEffectivePaymentDatePoll);
  if (effectivePollIndex < 0) return result;

  const messages = [...result.messages];
  const poll = messages[effectivePollIndex];
  const options = paymentDateOptions(Array.isArray(poll.options) ? poll.options : []).map(option => ({ ...option }));
  const existingOption = options.find(option =>
    paymentDateIso(option.label || option.title, now) === predictedDate);
  if (existingOption) existingOption.recommendedDate = true;
  if (!existingOption) {
    const [year, month, day] = predictedDate.split("-");
    options.unshift({ label: `${day}/${month}/${year}`, recommendedDate: true });
  }
  messages[effectivePollIndex] = {
    ...poll,
    options,
  };
  return { ...result, messages };
}

function lastIndexMatching(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}
