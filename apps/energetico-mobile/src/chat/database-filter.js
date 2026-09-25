export function latestDatabaseFilter(messages = []) {
  const poll = [...messages]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  if (poll?.databaseFilter !== true) return null;
  const key = String(poll.databaseFilterKey || "").trim();
  return key ? { key, message: poll } : null;
}

function normalizeFilterText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function isDatabaseRegistrationOption(option) {
  if (option?.registrationAction === true || option?.actionType === "registration") return true;
  const identifiers = [option?.reply, option?.id]
    .filter(value => value != null)
    .map(normalizeFilterText);
  if (identifiers.some(value => /^(?:register|registration|cadastro|cadastrar)(?:$|[:_-])/.test(value))) return true;
  const labels = [option?.label, option?.title, option?.text]
    .filter(Boolean)
    .map(value => normalizeFilterText(value).replace(/^[^\p{L}\p{N}]*/u, ""));
  return labels.some(value => /^(?:cadastrar|cadastro|efetuar\s+cadastro|fazer\s+cadastro|novo\s+cadastro)\b/.test(value));
}

function registrationOptionKeys(option) {
  const keys = [];
  for (const [name, value] of [["reply", option?.reply], ["id", option?.id]]) {
    const normalized = normalizeFilterText(value).trim();
    if (normalized) keys.push(`${name}:${normalized}`);
  }
  const label = normalizeFilterText(option?.label || option?.title || option?.text).trim();
  if (label) keys.push(`label:${label}`);
  return keys;
}

export function preserveDatabaseFilterRegistrationOptions(previousMessages, result) {
  const previous = latestDatabaseFilter(previousMessages);
  const incoming = latestDatabaseFilter(result?.messages);
  const previousQuestion = normalizeFilterText(previous?.message.question || previous?.message.prompt).trim();
  const incomingQuestion = normalizeFilterText(incoming?.message.question || incoming?.message.prompt).trim();
  if (!previous || !incoming || previous.key !== incoming.key || previousQuestion !== incomingQuestion) return result;
  const registrations = (Array.isArray(previous.message.options) ? previous.message.options : [])
    .filter(isDatabaseRegistrationOption);
  if (!registrations.length) return result;

  const options = Array.isArray(incoming.message.options) ? [...incoming.message.options] : [];
  const keys = new Set(options.flatMap(registrationOptionKeys));
  let changed = false;
  for (const option of registrations) {
    const optionKeys = registrationOptionKeys(option);
    if (optionKeys.some(key => keys.has(key))) continue;
    options.push(option);
    optionKeys.forEach(key => keys.add(key));
    changed = true;
  }
  if (!changed) return result;

  return {
    ...result,
    messages: result.messages.map(message => message === incoming.message
      ? { ...message, options }
      : message),
  };
}
