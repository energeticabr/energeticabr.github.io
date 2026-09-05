const MAX_PAGES = 50;
const PAGE_SIZE = 200;

function normalizedKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function field(fields, aliases) {
  const entries = Object.entries(fields || {});
  for (const alias of aliases) {
    const key = normalizedKey(alias);
    const match = entries.find(([name]) => normalizedKey(name) === key);
    if (match && match[1] !== undefined && match[1] !== null) return match[1];
  }
  return "";
}

function scalar(value) {
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (value && typeof value === "object") return String(value.displayName || value.title || value.label || value.LookupValue || value.value || "").trim();
  return String(value ?? "").trim();
}

function dateKey(value) {
  if (!value) return "";
  const raw = scalar(value);
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1, 4);
  if (direct) return direct.join("-");
  const brazilian = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)?.slice(1, 4);
  if (brazilian) return `${brazilian[2]}-${brazilian[1]}-${brazilian[0]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recordDate(item) {
  return dateKey(field(item?.fields, ["DATA", "DATA PRESENCA", "DATA DA PRESENCA", "Created", "CRIADO"]));
}

function person(item) {
  return scalar(field(item?.fields, ["CADASTRO", "FUNCIONARIO", "FUNCIONÁRIO", "COLABORADOR", "FORNECEDOR", "Title"]));
}

function branch(item) {
  return scalar(field(item?.fields, ["FILIAL", "OBRA", "IMOVEL", "IMÓVEL"]));
}

function activity(item) {
  return scalar(field(item?.fields, ["ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA", "ATIVIDADE", "DESCRICAO", "DESCRIÇÃO"]));
}

export function buildPresenceValidationSummary({ presenceItems = [], descriptionItems = [], date } = {}) {
  const selectedDate = date || todayKey();
  const presences = presenceItems.filter(item => recordDate(item) === selectedDate);
  const descriptions = descriptionItems.filter(item => recordDate(item) === selectedDate);
  const incomplete = descriptions.filter(item => !person(item) || !branch(item) || !activity(item));
  const signatures = new Map();
  const duplicateIds = [];
  for (const item of descriptions) {
    const signature = [recordDate(item), normalizedKey(person(item)), normalizedKey(branch(item)), normalizedKey(activity(item))].join("|");
    if (!signature.replace(/\|/g, "")) continue;
    if (signatures.has(signature)) duplicateIds.push(String(item.id || ""));
    else signatures.set(signature, item.id);
  }
  const incompleteItemIds = incomplete.map(item => String(item.id || "")).filter(Boolean);
  const issueIds = [...new Set([...incompleteItemIds, ...duplicateIds])];
  const people = new Set([...presences, ...descriptions].map(person).filter(Boolean).map(normalizedKey));
  return Object.freeze({
    date: selectedDate,
    presenceCount: presences.length,
    descriptionCount: descriptions.length,
    uniquePeople: people.size,
    inconsistencies: issueIds.length,
    incompleteItemIds: Object.freeze(incompleteItemIds),
    duplicateItemIds: Object.freeze(duplicateIds),
  });
}

async function loadAllItems(repository, entity, options = {}) {
  const list = await repository.resolveList(entity.siteKey, entity.listNames, { signal: options.signal });
  if (list.status !== "resolved") throw new Error(`A base ${entity.title} não foi localizada no SharePoint.`);
  const items = [];
  let cursor = "";
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const page = await repository.getItemsPage(entity.siteKey, list.id, `$expand=fields&$top=${PAGE_SIZE}`, {
      cursor,
      pageNumber,
      maxPages: MAX_PAGES,
      signal: options.signal,
    });
    items.push(...(page.items || []));
    if (!page.hasMore || !page.nextLink) return items;
    cursor = page.nextLink;
  }
  throw new Error(`A validação atingiu o limite operacional de ${MAX_PAGES * PAGE_SIZE} registros. Refine o período.`);
}

export async function loadPresenceValidation(repository, entities = [], options = {}) {
  if (!repository) throw new TypeError("A validação de presença requer acesso ao SharePoint.");
  const presenceEntity = entities.find(entity => entity.id === "presencas");
  const descriptionEntity = entities.find(entity => entity.id === "descricoes-de-presenca");
  if (!presenceEntity || !descriptionEntity) throw new Error("As bases de presença não estão configuradas no portal.");
  const [presenceItems, descriptionItems] = await Promise.all([
    loadAllItems(repository, presenceEntity, options),
    loadAllItems(repository, descriptionEntity, options),
  ]);
  return buildPresenceValidationSummary({ presenceItems, descriptionItems, date: options.date || todayKey() });
}

