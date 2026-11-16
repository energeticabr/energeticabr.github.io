import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeRhSupplier, normalizeRhPresence } from "./rh-reports-model.js";
import { normalizeStageProgressDate } from "./stage-progress-model.js";
import { attendanceActivityOptions } from "./attendance-summary-model.js";
import { isValidRhidReportDate, shiftRhidReportDate } from "./rhid-attendance-table.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
// An overall runaway guard rejects the entire load; it never publishes truncated totals.
const MAX_TOTAL_PAGES = 10_000;
const PRESENCE_LIST = ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"];
const LISTS = { suppliers: ["FORNECEDORES"], directory: ["FORNECEDORES"], presences: PRESENCE_LIST, rhid: PRESENCE_LIST,
  stages: ["DEMONSTRATIVOETAPA"], activities: ["ATIVIDADE EXECUTADA", "ATIVIDADES EXECUTADAS"] };
const SCHEMA = {
  suppliers: [["CADASTRO"], ["STATUS"], ["FILIAL"], ["PROFISSAO", "PROFISSÃO"],
    ["DESCRITIVOETAPA ATUAL", "ETAPA ATUAL"], ["ATIVIDADE EXERCIDA"]],
  directory: [["CADASTRO"], ["PROFISSAO", "PROFISSÃO"], ["FILIAL"], ["IMOVEL", "IMÓVEL"]],
  rhid: [["DATA"], ["FORNECEDOR"], ["PRESENCA", "PRESENÇA"]],
  presences: [["DATA"], ["FILIAL"], ["FORNECEDOR"], ["PROFISSAO", "PROFISSÃO"], ["PRESENCA", "PRESENÇA"]],
  stages: [["FILIAL"], ["ETAPA"], ["IMOVEL", "IMÓVEL"], ["STATUS"], ["ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"], ["FORNECEDOR"]],
  activities: [["FILIAL"], ["ATIVIDADE EXECUTADA", "ATIVIDADEEXECUTADA"], ["ETAPA"]],
};
const itemId = value => /^[1-9]\d*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value));
const scalar = value => {
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (value && typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value ?? "").trim();
};
const valueKey = value => scalar(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
const columnKey = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Repositories/token providers may ignore the signal. Stop awaiting them on cancellation,
// while still consuming their eventual rejection and removing all our listeners.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); resolve(value); }, reject)
      .catch(reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  // A renamed Title also renames the computed LinkTitle display labels. These
  // presentation-only fields are not item data; Graph may omit their type facet.
  const dataColumns = columns.filter(column => column?.computed !== true
    && !/^LinkTitle(?:NoMenu|2)?$/i.test(String(column?.name ?? "")));
  const resolved = SCHEMA[kind].map(aliases => {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (!matches.length && kind === "suppliers" && aliases === SCHEMA.suppliers[5]) {
      matches.push(...dataColumns.filter(column => column.name === "field_2"));
    }
    if (!matches.length && kind === "activities" && aliases === SCHEMA.activities[1]) {
      matches.push(...dataColumns.filter(column => column.name === "Title"));
    }
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente ou ambígua na lista ${LISTS[kind][0]}.`);
    }
    return matches[0];
  });
  if (new Set(resolved.map(column => column.name)).size !== resolved.length) {
    throw new TypeError(`Colunas ambíguas na lista ${LISTS[kind][0]}.`);
  }
  return resolved;
}

function normalizeItem(item, columns, kind) {
  const get = index => scalar(item.fields[columns[index].name]);
  const id = String(item.id);
  if (kind === "stages") return Object.freeze({
    id, branch: get(0), stage: get(1), property: get(2), status: get(3), activity: get(4), supplier: get(5),
  });
  if (kind === "activities") return Object.freeze({ id, branch: get(0), activity: get(1), stage: get(2) });
  if (kind === "directory") return normalizeRhSupplier(item, columns);
  if (kind === "suppliers") {
    const stageColumn = columns[4];
    const rawStage = item.fields[stageColumn.name];
    const stage = stageColumn.lookup ? scalar(item.fields[`${stageColumn.name}LookupId`] ?? rawStage?.LookupId ?? rawStage) : get(4);
    return Object.freeze({ id, name: get(0), status: get(1), branch: get(2), profession: get(3), stage, activity: get(5) });
  }
  if (kind === "rhid") {
    const { date, supplier, presence } = normalizeRhPresence(item, columns);
    if (!isValidRhidReportDate(date)) throw new TypeError("Registro do Descritivo Presença com data inválida.");
    return Object.freeze({ date, supplier, presence });
  }
  const date = normalizeStageProgressDate(get(0));
  if (!isValidRhidReportDate(date) || !get(4)) throw new TypeError("Registro de presença com data ou presença inválida.");
  return Object.freeze({ id, date, branch: get(1), supplier: get(2), profession: get(3), presence: get(4) });
}

async function resolveSchema(repository, kind, signal) {
  const resolved = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
  if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, resolved.id, { signal }), signal), kind);
  return { id: resolved.id, columns };
}

function selectedFields(columns, kind) {
  return columns.flatMap((column, index) => kind === "suppliers" && index === 4 && column.lookup
    ? [column.name, `${column.name}LookupId`] : [column.name]);
}

async function loadList(repository, kind, signal, range) {
  const { id: listId, columns } = await resolveSchema(repository, kind, signal);
  const fields = selectedFields(columns, kind);
  const expand = kind === "directory" ? "fields" : `fields($select=${fields.join(",")})`;
  const params = new URLSearchParams({ $expand: expand, $top: "100" });
  if (range) {
    const dateField = `fields/${fields[0]}`;
    params.set("$filter", `${dateField} ge '${range.start}T00:00:00Z' and ${dateField} lt '${shiftRhidReportDate(range.end, 1)}T00:00:00Z'`);
  }
  const query = params.toString();
  const rows = []; const ids = new Set(); const cursors = new Set(); let cursor = "";
  for (let pageIndex = 0; pageIndex < MAX_TOTAL_PAGES; pageIndex++) {
    const page = await abortable(() => repository.getItemsPage(SITE, listId, query, {
      signal, pageNumber: pageIndex % WINDOW_PAGES + 1, maxPages: WINDOW_PAGES,
      headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
    }), signal);
    if (!Array.isArray(page?.items) || page.items.length > 100 || typeof page.hasMore !== "boolean"
      || page.error || page.partial || page.aborted || page.truncated
      || page.batchCount !== undefined && page.batchCount !== page.items.length
      || page.nextLink != null && typeof page.nextLink !== "string") {
      throw new TypeError("O SharePoint retornou uma página inválida ou incompleta.");
    }
    const next = page.nextLink?.trim() || "";
    if (page.hasMore !== Boolean(next) || page.hasMore && page.items.length === 0) {
      throw new TypeError("A paginação retornou uma página com conclusão inconsistente.");
    }
    for (const item of page.items) {
      const id = String(item?.id ?? "");
      if (!/^[1-9]\d*$/.test(id) || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
        throw new TypeError("Página com ID ou campos de registro inválidos.");
      }
      if (ids.has(id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(id); rows.push(normalizeItem(item, columns, kind));
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum total parcial foi disponibilizado.");
}

async function readCatalogItem(repository, kind, id, signal) {
  const schema = await resolveSchema(repository, kind, signal);
  const item = await abortable(() => repository.getItem(SITE, schema.id, id, "", {
    restrictedFields: selectedFields(schema.columns, kind), signal,
  }), signal);
  if (String(item?.id) !== id || !item.fields) throw new Error("O SharePoint não confirmou o vínculo selecionado.");
  return normalizeItem(item, schema.columns, kind);
}

function catalogChanged() {
  return Object.assign(new Error("O catálogo de vínculos mudou no SharePoint."), { code: "ATTENDANCE_CATALOG_CHANGED" });
}

function supplierRecord(item, columns, id) {
  if (String(item?.id) !== id || !item.fields) throw new Error("O SharePoint não confirmou o cadastro do fornecedor.");
  return normalizeItem(item, columns, "suppliers");
}

function registryLinkField(column, value) {
  if (column.readOnly) throw new Error("O vínculo está bloqueado no cadastro do SharePoint.");
  if (column.lookup) {
    if (value && !itemId(value)) throw new Error("Selecione um vínculo válido.");
    return [`${column.name}LookupId`, value || null];
  }
  return [column.name, column.number ? value ? Number(value) : null : value];
}

/** Loads current registrations and historical attendance from their own SharePoint lists. */
export function createAttendanceSummaryData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório.");
  }
  const repositoryFor = signal => suppliedRepository || createSharePointRepository(createGraphClient(
    scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
  ), SHAREPOINT_SITES);

  async function withRepository(externalSignal, operation) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      return await operation(repositoryFor(signal), signal);
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  function loadSnapshot({ signal } = {}) {
    return withRepository(signal, async (repository, activeSignal) => {
      const [suppliers, presences, stages] = await Promise.all(
        ["suppliers", "presences", "stages"].map(kind => loadList(repository, kind, activeSignal)),
      );
      abortIfNeeded(activeSignal);
      return Object.freeze({ complete: true, suppliers, presences, stages });
    });
  }

  function loadSupplierEditor(id, { signal } = {}) {
    if (!itemId(id)) throw new TypeError("ID de cadastro de fornecedor inválido.");
    id = String(id);
    return withRepository(signal, async (repository, activeSignal) => {
      const { id: listId, columns } = await resolveSchema(repository, "suppliers", activeSignal);
      const fields = selectedFields(columns, "suppliers");
      const item = await abortable(() => repository.getItem(SITE, listId, id, "", { restrictedFields: fields, signal: activeSignal }), activeSignal);
      const supplier = supplierRecord(item, columns, id);
      const eTag = item.eTag || item["@odata.etag"] || item["odata.etag"] || item.fields["@odata.etag"];
      if (!eTag || eTag === "*") throw new Error("A versão do cadastro do fornecedor não foi identificada.");
      const [catalog, descriptions] = await Promise.all(
        ["activities", "stages"].map(kind => loadList(repository, kind, activeSignal)),
      );
      const branch = valueKey(supplier.branch);
      const inBranch = row => branch && valueKey(row.branch) === branch;
      const activities = catalog.filter(row => row.activity && inBranch(row));
      const stages = descriptions.filter(row => row.id === supplier.stage || (inBranch(row) && valueKey(row.status) === "ATIVIDADE INICIADA"));
      return { supplier, eTag, activities, stages };
    });
  }

  function saveSupplierLinks(editor, links, { signal } = {}) {
    const { supplier, eTag, activities, stages } = editor;
    const { stage, activity } = links;
    const selectedStage = stages.find(row => row.id === stage);
    const stageChanged = stage !== supplier.stage;
    const activityChanged = activity !== supplier.activity;
    const verifyLinks = (stageChanged && stage) || (activityChanged && activity);
    if (!itemId(supplier?.id) || typeof stage !== "string" || typeof activity !== "string"
      || (stageChanged && stage && !selectedStage)
      || ((stageChanged || activityChanged) && activity
        && !attendanceActivityOptions(activities, selectedStage?.stage).includes(activity))) {
      throw new TypeError("Selecione vínculos válidos para o fornecedor.");
    }
    return withRepository(signal, async (repository, activeSignal) => {
      const { id, columns } = await resolveSchema(repository, "suppliers", activeSignal);
      const changes = {};
      if (stageChanged) {
        const [name, value] = registryLinkField(columns[4], stage);
        changes[name] = value;
      }
      if (activityChanged) {
        if (columns[5].lookup) throw new Error("O tipo do campo Atividade exercida não aceita o valor selecionado.");
        changes[columns[5].name] = registryLinkField(columns[5], activity)[1];
      }
      if (!Object.keys(changes).length) return supplier;
      if (verifyLinks) {
        const activityId = activity
          ? activities.find(row => row.activity === activity && valueKey(row.stage) === valueKey(selectedStage.stage))?.id : null;
        try {
          const [stageNow, activityNow] = await Promise.all([
            readCatalogItem(repository, "stages", stage, activeSignal),
            activityId ? readCatalogItem(repository, "activities", activityId, activeSignal) : null,
          ]);
          const branch = valueKey(supplier.branch);
          if (!branch || valueKey(stageNow.branch) !== branch || valueKey(stageNow.status) !== "ATIVIDADE INICIADA"
            || (activity && (!activityNow || activityNow.activity !== activity || valueKey(activityNow.branch) !== branch
              || valueKey(activityNow.stage) !== valueKey(stageNow.stage)))) throw catalogChanged();
        } catch (error) {
          if (error?.status === 404) throw catalogChanged();
          throw error;
        }
      }
      const readbackFields = selectedFields(columns, "suppliers");
      const item = await abortable(() => repository.updateItem(SITE, id, supplier.id, changes, {
        eTag, readbackFields, signal: activeSignal,
      }), activeSignal);
      const saved = supplierRecord(item, columns, supplier.id);
      if (saved.stage !== stage || saved.activity !== activity) {
        throw new Error("O SharePoint não confirmou os vínculos selecionados.");
      }
      return saved;
    });
  }

  function loadSupplierDirectory({ signal = new AbortController().signal } = {}) {
    return loadList(repositoryFor(signal), "directory", signal);
  }
  async function loadRhidPresences({ start, end, signal = new AbortController().signal } = {}) {
    if (!isValidRhidReportDate(start) || !isValidRhidReportDate(end) || start > end) {
      throw new RangeError("Período inválido para o Descritivo Presença.");
    }
    const rows = await loadList(repositoryFor(signal), "rhid", signal, { start, end });
    return rows.filter(row => row.date >= start && row.date <= end);
  }
  return Object.freeze({ loadSnapshot, loadSupplierEditor, saveSupplierLinks, loadSupplierDirectory, loadRhidPresences });
}
