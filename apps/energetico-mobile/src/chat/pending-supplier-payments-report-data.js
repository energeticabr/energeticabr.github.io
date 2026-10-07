import Decimal from "decimal.js";
import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeRhSupplier, normalizeRhPresence, normalizeRhLaunch } from "./rh-reports-model.js";

const Money = Decimal.clone({ precision: 40 });
const SITE = "personal"; const WINDOW_PAGES = 100; const MAX_TOTAL_PAGES = 10_000;
const LISTS = { suppliers: ["FORNECEDORES"], presences: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"], launches: ["LANCAMENTOS"] };
const schema = {
  suppliers: {
    name: ["CADASTRO"], branch: ["FILIAL"], status: ["STATUS"], contractor: ["EMPREITEIRO"],
    dailyValue: ["VLR DIARIO", "VLR DIÁRIO"], paymentMethod: ["FORMA PGTO", "FORMA DE PAGAMENTO"],
    hours: ["HORASTRABALHO", "HORAS TRABALHO"], property: ["IMOVEL", "IMÓVEL"], profession: ["PROFISSAO", "PROFISSÃO"],
    stage: ["DESCRITIVOETAPA ATUAL", "ETAPA ATUAL"], activity: ["ATIVIDADE EXERCIDA"], measurement: ["MEDIÇÃOATUAL", "MEDICAOATUAL"],
  },
  presences: {
    date: ["DATA"], branch: ["FILIAL"], supplier: ["FORNECEDOR"], profession: ["PROFISSAO", "PROFISSÃO"],
    presence: ["PRESENCA", "PRESENÇA"], status: ["STATUS"], dailyValue: ["VLORDIARIO", "VALOR DIÁRIO", "VALOR DIARIO"], paymentId: ["IDPGTO", "ID PGTO"],
    property: ["IMOVEL", "IMÓVEL"], stage: ["ETAPA"], activity: ["ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"],
    motivation: ["MOTIVACAO", "MOTIVAÇÃO"], observation: ["OBS", "OBSERVAÇÃO", "OBSERVACAO"],
    entry1: ["HORÁRIO", "HORARIO"], exit1: ["HORARIOSAIDA1"], entry2: ["HORARIOENTRADA2"], exit2: ["HORARIOSAIDA2"],
  },
  launches: { date: ["DATA", "field_2"], branch: ["FILIAL", "Title"], supplier: ["FORNECEDOR", "field_5"],
    unitValue: ["VALOR UNITÁRIO", "VALOR UNITARIO", "VALORUNITARIO", "field_9"], quantity: ["QUANTIDADE", "field_8"], advance: ["ADIANTAMENTO"] },
};
const required = { suppliers: ["name", "branch", "status", "contractor", "dailyValue", "paymentMethod"],
  presences: ["date", "branch", "supplier", "profession", "presence", "status", "dailyValue", "paymentId"],
  launches: ["date", "branch", "supplier", "unitValue", "quantity", "advance"] };
const normalize = { suppliers: normalizeRhSupplier, presences: normalizeRhPresence, launches: normalizeRhLaunch };
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const choice = value => String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); }).then(value => {
      abortIfNeeded(signal); resolve(value);
    }, reject).catch(reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function scalar(value) {
  if (value == null) return "";
  if (Array.isArray(value)) throw new TypeError("Registro com valores múltiplos ambíguos.");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "Title", "title"]) if (value[name] != null) return scalar(value[name]);
    throw new TypeError("Registro com valor estruturado inválido.");
  }
  if (!["number", "string", "boolean"].includes(typeof value)) throw new TypeError("Registro com campo inválido.");
  return String(value).trim();
}

function money(value) {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return money(value.Value ?? value.value ?? value.LookupValue);
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
  if (typeof value !== "string") return null;
  const localized = /^R\$\s*/.test(value.trim());
  const raw = value.trim().replace(/^R\$\s*/, "");
  if (!/^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(raw)) return null;
  const comma = raw.lastIndexOf(","); const dot = raw.lastIndexOf(".");
  // Bare 1.234 could mean a decimal or a grouped integer. Do not guess.
  // Zero-prefixed fractions cannot be valid thousands grouping.
  const grouped = /^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(raw);
  if (!localized && comma < 0 && /^-?[1-9]\d{0,2}\.\d{3}$/.test(raw)) return null;
  const normalized = comma > dot ? raw.replaceAll(".", "").replace(",", ".") : comma >= 0 ? raw.replaceAll(",", "")
    : grouped && (localized || raw.split(".").length > 2) ? raw.replaceAll(".", "") : raw;
  const result = new Money(normalized).toNumber();
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
}

function resolveSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido.");
  const dataColumns = columns.filter(column => !column?.computed && !/^LinkTitle(?:NoMenu|\d+)?$/i.test(String(column?.name ?? "")));
  const resolved = {}; const warnings = []; const names = new Set();
  for (const [field, aliases] of Object.entries(schema[kind])) {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length > 1 || matches.length === 1 && (!matches[0].name || names.has(matches[0].name))) {
      throw new TypeError(`Coluna ${aliases[0]} ambígua na lista ${LISTS[kind][0]}.`);
    }
    if (matches.length === 0) {
      if (required[kind].includes(field)) throw new TypeError(`Coluna ${aliases[0]} ausente na lista ${LISTS[kind][0]}.`);
      warnings.push(`Coluna opcional ${aliases[0]} ausente na lista ${LISTS[kind][0]}.`);
    } else { resolved[field] = matches[0]; names.add(matches[0].name); }
  }
  return { resolved, warnings };
}

function validDate(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validSourceDate(value) {
  if (validDate(value)) return true;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(Z|[+-](\d{2}):(\d{2}))$/);
  return Boolean(match && validDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4]) <= 59 && (!match[6] || Number(match[6]) <= 23 && Number(match[7]) <= 59)
    && Number.isFinite(Date.parse(value)));
}

function normalizeItem(item, resolved, kind) {
  // Only metadata-resolved fields are given to the shared normalizers: an absent
  // optional column must not accidentally read a similarly named raw field.
  const raw = {}; const canonical = {};
  for (const [field, column] of Object.entries(resolved)) {
    raw[field] = item.fields[column.name];
    canonical[schema[kind][field][0]] = ["dailyValue", "hours", "unitValue", "quantity"].includes(field) ? money(raw[field]) : scalar(raw[field]);
  }
  if (kind !== "suppliers" && !validSourceDate(canonical.DATA)) throw new TypeError("Registro com data financeira inválida.");
  const row = normalize[kind]({ id: item.id, fields: canonical });
  const core = kind === "suppliers" ? row.contractor ? ["name", "branch", "status"] : []
    : kind === "presences" ? ["date", "branch", "supplier", "presence", "status"] : ["date"];
  if (core.some(field => !row[field]) || kind !== "suppliers" && !validDate(row.date)) throw new TypeError("Registro com campos obrigatórios ou data inválida.");
  if (kind === "suppliers") {
    if (!["", "SIM", "NAO"].includes(choice(canonical.EMPREITEIRO))) throw new TypeError("Registro com EMPREITEIRO inválido.");
    return Object.freeze({ ...row, dailyValue: money(raw.dailyValue), dailyValueBlank: raw.dailyValue == null || scalar(raw.dailyValue) === "",
      hours: money(raw.hours), hoursInvalid: raw.hours != null && scalar(raw.hours) !== "" && (money(raw.hours) === null || money(raw.hours) < 0) });
  }
  if (kind === "presences") {
    if (!["PRESENTE", "PENDENTE", "AUSENTE"].includes(choice(row.presence))) throw new TypeError("Registro com PRESENCA inválida.");
    if (row.paymentId && (!/^\d+$/.test(row.paymentId) || new Money(row.paymentId).lte(0))) throw new TypeError("Registro com IDPGTO inválido ou ambíguo.");
    return Object.freeze({ ...row, dailyValue: money(raw.dailyValue), dailyValueBlank: raw.dailyValue == null || scalar(raw.dailyValue) === "" });
  }
  const unitValue = money(raw.unitValue); const quantity = money(raw.quantity);
  const product = unitValue === null || quantity === null ? null : new Money(unitValue).times(quantity).toNumber();
  return Object.freeze({ ...row, unitValue, quantity,
    total: product !== null && Number.isFinite(product) && Math.abs(product) <= Number.MAX_SAFE_INTEGER ? product : null });
}

async function loadList(repository, kind, signal) {
  const list = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
  if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
  const { resolved, warnings } = resolveSchema(await abortable(() => repository.getColumns(SITE, list.id, { signal }), signal), kind);
  const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let index = 0; index < MAX_TOTAL_PAGES; index++) {
    const page = await abortable(() => repository.getItemsPage(SITE, list.id, query, { signal,
      pageNumber: index % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}) }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("O SharePoint retornou uma página inválida ou incompleta.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && page.items.length === 0) throw new TypeError("Conclusão inconsistente na paginação SharePoint.");
    for (const item of page.items) {
      const id = String(item?.id ?? "");
      if (!/^[1-9]\d*$/.test(id) || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) throw new TypeError("Página com ID ou campos de registro inválidos.");
      if (ids.has(id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(id);
      const row = normalizeItem(item, resolved, kind);
      rows.push(row);
      if (kind === "launches" && !row.supplier) warnings.push(`Lançamento ${id}: fornecedor não informado; registro preservado para vínculos por IDPGTO.`);
    }
    if (!page.hasMore) return { rows: Object.freeze(rows), warnings };
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum total parcial foi disponibilizado.");
}

/** Fully traverses all three readonly lists; never returns partial financial data. */
export function createPendingSupplierPaymentsReportData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) throw new TypeError("Repositório SharePoint inválido para o relatório.");
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal)), SHAREPOINT_SITES);
      const lists = await Promise.all(Object.keys(LISTS).map(kind => loadList(repository, kind, signal)));
      abortIfNeeded(signal);
      return Object.freeze({ complete: true, suppliers: lists[0].rows, presences: lists[1].rows, launches: lists[2].rows,
        warnings: Object.freeze(lists.flatMap(list => list.warnings)) });
    } catch (error) { controller.abort(error); throw error; }
    finally { externalSignal?.removeEventListener("abort", abort); }
  }
  return Object.freeze({ loadSnapshot });
}
