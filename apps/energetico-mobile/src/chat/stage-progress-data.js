import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { normalizeStageProgressDate, summarizeStageCompletion } from "./stage-progress-model.js";
import { stageReportGroupKey } from "./operations-reports-model.js";

const SITE = "personal";
const WINDOW_PAGES = 100;
// Reject runaway traversal entirely; never report truncated counts as complete.
const MAX_TOTAL_PAGES = 10_000;
const LISTS = {
  activities: ["DEMONSTRATIVOETAPA"], launches: ["LANCAMENTOOBRA"],
  assignments: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"],
};
const STARTED = "ATIVIDADE INICIADA";
const FINALIZED = "ATIVIDADE FINALIZADA";
const isItemId = id => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
const SCHEMA = {
  assignments: [["IDDESCRITIVOETAPA", "ID DESCRITIVO ETAPA"], ["DATA"], ["FORNECEDOR"]],
  activities: [["FILIAL"], ["ETAPA"], ["ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"], ["IMOVEL", "IMÓVEL"],
    ["FORNECEDOR"], ["DATAEXECUTADO"], ["DATAPREVISTO"], ["STATUS"]],
  launches: [["FILIAL"], ["ETAPA"], ["INÍCIO", "INICIO"], ["FIM"], ["STATUS"],
    ["PERCENTUALEFETUADO", "PERCENTUAL EFETUADO"], ["TIPO"]],
};
const scalar = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const columnKey = value => scalar(value).replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

// Stop waiting even when a supplied repository or token provider ignores abort.
function abortable(operation, signal) {
  abortIfNeeded(signal);
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { signal.removeEventListener("abort", abort); callback(value); };
    const abort = () => finish(reject, signal.reason || new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { abortIfNeeded(signal); return operation(); })
      .then(value => { abortIfNeeded(signal); finish(resolve, value); }, error => finish(reject, error))
      .catch(error => finish(reject, error));
  });
}

function validateSchema(columns, kind) {
  if (!Array.isArray(columns)) throw new TypeError("Esquema de colunas SharePoint inválido.");
  // Graph may omit the computed facet for system columns. LinkTitle copies
  // the Title label and DocIcon is labeled "Tipo" in Portuguese.
  const dataColumns = columns.filter(column => column?.computed !== true
    && !/^(?:LinkTitle(?:NoMenu|2)?|DocIcon)$/i.test(String(column?.name ?? "")));
  const resolved = SCHEMA[kind].map(aliases => {
    const wanted = new Set(aliases.map(columnKey));
    const matches = dataColumns.filter(column => wanted.has(columnKey(column?.name)) || wanted.has(columnKey(column?.displayName)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || "")) {
      throw new TypeError(`Coluna ${aliases[0]} ausente, ambígua ou insegura na lista ${LISTS[kind][0]}.`);
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
  if (kind === "activities") return Object.freeze({
    id: String(item.id), branch: get(0), stage: get(1), activity: get(2), property: get(3), supplier: get(4),
    executionDate: normalizeStageProgressDate(get(5)), plannedDate: normalizeStageProgressDate(get(6)), status: get(7),
  });
  const raw = get(5);
  const parsed = /^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw.replace(",", ".")) : NaN;
  return Object.freeze({ id: String(item.id), branch: get(0), stage: get(1),
    startDate: normalizeStageProgressDate(get(2)), endDate: normalizeStageProgressDate(get(3)), status: get(4),
    percent: Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed * 100 : null, type: get(6) });
}

async function resolveSchema(repository, kind, signal) {
  const resolved = await abortable(() => repository.resolveList(SITE, LISTS[kind], { signal }), signal);
  if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
  const columns = validateSchema(await abortable(() => repository.getColumns(SITE, resolved.id, { signal }), signal), kind);
  return { id: resolved.id, columns };
}

async function readCompleteList(repository, listId, signal, normalize, options = {}) {
  const query = new URLSearchParams({ $expand: "fields", $top: "100", ...options }).toString();
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
      if (!["string", "number"].includes(typeof item?.id) || !isItemId(id)
        || !item?.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) {
        throw new TypeError("Página com ID ou campos de registro inválidos.");
      }
      if (ids.has(id)) throw new TypeError("ID duplicado na paginação SharePoint.");
      ids.add(id); rows.push(normalize(item));
    }
    if (!page.hasMore) return Object.freeze(rows);
    if (cursors.has(next)) throw new TypeError("Cursor repetido: ciclo de paginação SharePoint.");
    cursors.add(next); cursor = next;
  }
  throw new RangeError("Limite seguro de paginação excedido; nenhum total parcial foi disponibilizado.");
}

async function loadList(repository, kind, signal) {
  const { id, columns } = await resolveSchema(repository, kind, signal);
  return readCompleteList(repository, id, signal, item => normalizeItem(item, columns, kind));
}

function requireActivityId(value) {
  const id = String(value ?? "");
  if (!isItemId(id)) throw new TypeError("ID do demonstrativo de etapa inválido.");
  return id;
}

function normalizeActivityRecord(item, columns, id) {
  if (String(item?.id) !== id || !item.fields) throw new Error("O SharePoint não confirmou o demonstrativo selecionado.");
  return normalizeItem(item, columns, "activities");
}

export function createStageProgressData({ tokenProvider, repository: suppliedRepository } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório exige uma sessão Microsoft ativa.");
  if (suppliedRepository && ["resolveList", "getColumns", "getItemsPage"].some(name => typeof suppliedRepository[name] !== "function")) {
    throw new TypeError("Repositório SharePoint inválido para o relatório.");
  }
  async function withRepository(externalSignal, operation) {
    abortIfNeeded(externalSignal);
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    try {
      const repository = suppliedRepository || createSharePointRepository(createGraphClient(
        scopes => abortable(() => tokenProvider(scopes, { signal }), signal),
      ), SHAREPOINT_SITES);
      const result = await operation(repository, signal);
      abortIfNeeded(signal);
      return result;
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      externalSignal?.removeEventListener("abort", abort);
    }
  }
  async function loadSnapshot({ signal } = {}) {
    return withRepository(signal, async (repository, activeSignal) => {
      const [activities, launches] = await Promise.all([
        loadList(repository, "activities", activeSignal), loadList(repository, "launches", activeSignal),
      ]);
      return Object.freeze({ complete: true, activities, launches });
    });
  }

  async function loadLatestAssignmentDate(activityId, { signal } = {}) {
    const itemId = requireActivityId(activityId);
    return withRepository(signal, async (repository, activeSignal) => {
      const { id, columns: [reference, date, supplier] } = await resolveSchema(repository, "assignments", activeSignal);
      const referenceField = reference.lookup ? `${reference.name}LookupId` : reference.name;
      const value = reference.number || reference.lookup ? itemId : `'${itemId}'`;
      const expand = `fields($select=${referenceField},${date.name},${supplier.name})`;
      const assignmentDate = ({ fields }) => {
        if (scalar(fields[referenceField]) !== itemId || !scalar(fields[supplier.name])) return "";
        return normalizeStageProgressDate(scalar(fields[date.name]));
      };
      let dates;
      try {
        dates = await readCompleteList(repository, id, activeSignal, assignmentDate, {
          $expand: expand, $filter: `fields/${referenceField} eq ${value}`,
        });
      } catch (error) {
        // An unindexed column may be rejected by SharePoint; scan only the three needed fields.
        if (error?.status !== 400) throw error;
        dates = await readCompleteList(repository, id, activeSignal, assignmentDate, { $expand: expand });
      }
      return dates.reduce((latest, date) => date > latest ? date : latest, "");
    });
  }

  async function finalizeActivity(activityId, endDate, { expectedActivity, signal } = {}) {
    const itemId = requireActivityId(activityId);
    const date = normalizeStageProgressDate(endDate);
    if (!date || date !== endDate) throw new TypeError("Informe uma data fim válida.");
    return withRepository(signal, async (repository, activeSignal) => {
      const { id, columns } = await resolveSchema(repository, "activities", activeSignal);
      const current = await abortable(() => repository.getItem(SITE, id, itemId, "$expand=fields", { signal: activeSignal }), activeSignal);
      const row = normalizeActivityRecord(current, columns, itemId);
      if (row.status.toUpperCase() === FINALIZED) {
        if (row.plannedDate === date) return row;
        throw Object.assign(new Error("Esta atividade já foi finalizada com outra data. Atualize o relatório para conferir."), { code: "stage_progress_changed" });
      }
      const displayedFields = ["branch", "stage", "activity", "property", "supplier", "executionDate", "plannedDate"];
      if (row.status.toUpperCase() !== STARTED || expectedActivity && displayedFields.some(field => row[field] !== expectedActivity[field])) {
        throw Object.assign(new Error("A atividade mudou. Atualize o relatório para conferir."), { code: "stage_progress_changed" });
      }
      const saved = await repository.updateItem(SITE, id, itemId, {
        [columns[6].name]: `${date}T12:00:00Z`,
        [columns[7].name]: FINALIZED,
      }, { eTag: current.eTag || current["@odata.etag"], signal: activeSignal });
      const updated = normalizeActivityRecord(saved, columns, itemId);
      if (updated.status !== FINALIZED || updated.plannedDate !== date) {
        throw new Error("O SharePoint não confirmou a data e o status da finalização. Atualize o relatório para conferir.");
      }
      return updated;
    });
  }

  async function finalizeStage(launchId, endDate, { expectedStage, signal } = {}) {
    const itemId = String(launchId ?? "");
    if (!isItemId(itemId)) throw new TypeError("ID da etapa inválido.");
    const date = normalizeStageProgressDate(endDate);
    if (!date || date !== endDate) throw new TypeError("Informe uma data fim válida.");
    return withRepository(signal, async (repository, activeSignal) => {
      const { id, columns } = await resolveSchema(repository, "launches", activeSignal);
      const current = await abortable(() => repository.getItem(SITE, id, itemId, "$expand=fields", { signal: activeSignal }), activeSignal);
      if (String(current?.id) !== itemId || !current.fields) throw new Error("O SharePoint não confirmou a etapa selecionada.");
      const stage = normalizeItem(current, columns, "launches");
      if (stage.status.toUpperCase() === "FINALIZADO" && stage.endDate === date) return stage;
      const displayedFields = ["branch", "stage", "startDate", "endDate", "percent"];
      if (!stage.branch || !stage.stage || stage.status.toUpperCase() !== "INICIADO"
        || expectedStage && displayedFields.some(field => stage[field] !== expectedStage[field])) {
        throw Object.assign(new Error("A etapa mudou. Atualize o relatório para conferir."), { code: "stage_progress_changed" });
      }
      const stageKey = stageReportGroupKey(stage);
      const activities = await loadList(repository, "activities", activeSignal);
      const { ready } = summarizeStageCompletion(activities.filter(row => stageReportGroupKey(row) === stageKey));
      if (!ready) {
        throw Object.assign(new Error("Finalize todos os descritivos vinculados antes de finalizar a etapa."),
          { code: "stage_progress_incomplete" });
      }
      const saved = await repository.updateItem(SITE, id, itemId, {
        [columns[3].name]: `${date}T12:00:00Z`,
        [columns[4].name]: "FINALIZADO",
      }, { eTag: current.eTag || current["@odata.etag"], signal: activeSignal });
      if (String(saved?.id) !== itemId || !saved.fields) throw new Error("O SharePoint não confirmou a gravação da etapa.");
      const updated = normalizeItem(saved, columns, "launches");
      if (updated.status.toUpperCase() !== "FINALIZADO" || updated.endDate !== date) {
        throw new Error("O SharePoint não confirmou a data e o status da etapa.");
      }
      return updated;
    });
  }

  return Object.freeze({ loadSnapshot, loadLatestAssignmentDate, finalizeActivity, finalizeStage });
}
