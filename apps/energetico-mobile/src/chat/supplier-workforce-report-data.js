import Decimal from "decimal.js";
import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeRhSupplier, normalizeRhPresence } from "./rh-reports-model.js";

const Money = Decimal.clone({ precision: 40 });
const SITE = "personal";
const WINDOW_PAGES = 100;
const MAX_TOTAL_PAGES = 10_000;
const LISTS = { suppliers: ["FORNECEDORES"], presences: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"] };
const SCHEMA = {
  suppliers: {
    name: ["CADASTRO"], branch: ["FILIAL"], property: ["IMOVEL", "IMÓVEL"], profession: ["PROFISSAO", "PROFISSÃO"],
    status: ["STATUS"], contractor: ["EMPREITEIRO"], paymentMethod: ["FORMA PGTO", "FORMA DE PAGAMENTO"],
    dailyValue: ["VLR DIARIO", "VLR DIÁRIO"], stage: ["DESCRITIVOETAPA ATUAL", "ETAPA ATUAL"],
    activity: ["ATIVIDADE EXERCIDA"], measurement: ["MEDIÇÃOATUAL", "MEDICAOATUAL"],
  },
  presences: { date: ["DATA"], branch: ["FILIAL"], property: ["IMOVEL", "IMÓVEL"], supplier: ["FORNECEDOR"],
    stage: ["ETAPA"], presence: ["PRESENCA", "PRESENÇA"], paymentId: ["IDPGTO", "ID PGTO"] },
};
const OPTIONAL = { suppliers: new Set(["stage", "activity", "measurement"]), presences: new Set(["paymentId"]) };
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const identity = value => String(value ?? "").trim().normalize("NFC").toLocaleUpperCase("pt-BR");

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
    const entries = ["LookupValue", "Value", "value", "Title", "title"].filter(name => value[name] != null).map(name => scalar(value[name]));
    if (!entries.length) throw new TypeError("Registro com valor estruturado inválido.");
    if (new Set(entries).size > 1) throw new TypeError("Registro com identidade estruturada ambígua.");
    return entries[0];
  }
  if (!["number", "string", "boolean"].includes(typeof value)) throw new TypeError("Registro com campo inválido.");
  return String(value).trim();
}

function dailyMoney(value) {
  if (value == null) return { value: null, blank: true };
  const unknown = { value: null, blank: false };
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? { value, blank: false } : unknown;
  let raw;
  try { raw = scalar(value); } catch { return { value: null, blank: false }; }
  if (typeof value === "object") {
    const name = ["LookupValue", "Value", "value", "Title", "title"].find(field => value[field] != null);
    return dailyMoney(value[name]);
  }
  if (!raw) return { value: null, blank: true };
  const localized = /^R\$\s*/.test(raw);
  const digits = raw.replace(/^R\$\s*/, "");
  if (!/^-?(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(digits)) return unknown;
  // An unmarked 1.234 can be a grouped integer or a decimal. Never guess.
  if (typeof value !== "number" && !localized && /^-?[1-9]\d{0,2}\.\d{3}$/.test(digits)) return unknown;
  const comma = digits.lastIndexOf(","); const dot = digits.lastIndexOf(".");
  const grouped = /^-?[1-9]\d{0,2}(?:\.\d{3})+$/.test(digits);
  const normalized = comma > dot ? digits.replaceAll(".", "").replace(",", ".") : comma >= 0 ? digits.replaceAll(",", "")
    : grouped && (localized || digits.split(".").length > 2) ? digits.replaceAll(".", "") : digits;
  const exact = new Money(normalized); const number = exact.toNumber();
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER || !new Money(number).eq(exact)) return unknown;
  return { value: number, blank: false };
}

function resolveSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema SharePoint inválido.");
  const dataColumns = columns.filter(column => !column?.computed && !/^LinkTitle/i.test(String(column?.name ?? "")));
  const resolved = {}; const warnings = []; const names = new Set();
  for (const [field, aliases] of Object.entries(SCHEMA[kind])) {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length > 1 || matches.length === 1 && (typeof matches[0].name !== "string" || !matches[0].name.trim() || names.has(matches[0].name))) {
      throw new TypeError(`Coluna ${aliases[0]} ambígua na lista ${LISTS[kind][0]}.`);
    }
    if (!matches.length) {
      if (!OPTIONAL[kind].has(field)) throw new TypeError(`Coluna ${aliases[0]} ausente na lista ${LISTS[kind][0]}.`);
      // IDPGTO is irrelevant to workforce counts; its absence needs no warning.
      if (field !== "paymentId") warnings.push(`Coluna opcional ${aliases[0]} ausente na lista ${LISTS[kind][0]}.`);
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

function normalizeItem(item, resolved, kind, warnings) {
  // Pass only metadata-resolved fields to shared normalizers, never their raw fallback aliases.
  const canonical = {}; let daily;
  for (const [field, column] of Object.entries(resolved)) {
    const raw = item.fields[column.name];
    if (field === "dailyValue") { daily = dailyMoney(raw); canonical[SCHEMA[kind][field][0]] = daily.value; }
    else canonical[SCHEMA[kind][field][0]] = scalar(raw);
  }
  if (kind === "presences") {
    if (!validSourceDate(canonical.DATA)) throw new TypeError("Registro com data inválida.");
    const row = normalizeRhPresence({ id: item.id, fields: canonical });
    if (!row.supplier || !validDate(row.date)) throw new TypeError("Registro com fornecedor ou data inválida.");
    return row;
  }
  const contractor = identity(canonical.EMPREITEIRO);
  if (!["", "SIM", "NAO", "NÃO"].includes(contractor)) throw new TypeError("Registro com EMPREITEIRO inválido.");
  const row = normalizeRhSupplier({ id: item.id, fields: canonical });
  if (row.contractor && !row.name) throw new TypeError("Registro com identidade de fornecedor inválida.");
  if (!daily.blank && daily.value === null) warnings.push(`${row.name || row.id}: valor diário inválido ou ambíguo; totais de diária indisponíveis.`);
  return Object.freeze({ ...row, dailyValue: daily.value, dailyValueBlank: daily.blank });
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
      || page.error || page.partial || page.aborted || page.truncated || page.complete !== undefined && page.complete !== true
      || page.batchCount !== undefined && page.batchCount !== page.items.length || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("O SharePoint retornou uma página inválida ou incompleta.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && page.items.length === 0) throw new TypeError("Conclusão inconsistente na paginação SharePoint.");
    for (const item of page.items) {
      const id = String(item?.id ?? "");
      if (!/^[1-9]\d*$/.test(id) || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
        throw new TypeError("Página com ID ou campos de registro inválidos.");
      }
      if (ids.has(id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(id); rows.push(normalizeItem(item, resolved, kind, warnings));
    }
    if (!page.hasMore) return { rows: Object.freeze(rows), warnings };
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum snapshot parcial foi disponibilizado.");
}

/** Complete readonly workforce snapshot: all pages of exactly two lists. */
export function createSupplierWorkforceReportData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório.");
  }
  async function loadSnapshot({ signal: externalSignal } = {}) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController(); const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal)), SHAREPOINT_SITES);
      const [suppliers, presences] = await Promise.all(Object.keys(LISTS).map(kind => loadList(repository, kind, signal)));
      abortIfNeeded(signal);
      const known = new Set();
      for (const row of suppliers.rows) {
        const name = identity(row.name); if (!name) continue;
        if (known.has(name)) throw new TypeError(`Fornecedor com identidade ambígua no cadastro: ${row.name}.`);
        known.add(name);
      }
      const warnings = new Set([...suppliers.warnings, ...presences.warnings]);
      for (const row of presences.rows) if (!known.has(identity(row.supplier))) {
        warnings.add(`Fornecedor ${row.supplier}: presença sem cadastro correspondente; confira a identidade.`);
      }
      return Object.freeze({ complete: true, suppliers: suppliers.rows, presences: presences.rows, warnings: Object.freeze([...warnings]) });
    } catch (error) { controller.abort(error); throw error; }
    finally { externalSignal?.removeEventListener("abort", abort); }
  }
  return Object.freeze({ loadSnapshot });
}
