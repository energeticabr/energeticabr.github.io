import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { buildStageReport, dateKey } from "./operations-reports-model.js";

const SITE = "personal";
const MAX_PAGES = 100;
const PREFER = "HonorNonIndexedQueriesWarningMayFailRandomly";
const LISTS = {
  activities: ["DEMONSTRATIVOETAPA"], launches: ["LANCAMENTOOBRA"],
  diaries: ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS", "DIARIODEOBRAS"],
  tasks: ["TAREFASDELEGADAS"],
};
const REQUIRED_COLUMNS = {
  activities: ["FILIAL", "ETAPA", "ATIVIDADEEXECUTADA", "STATUS", "FORNECEDOR", "IMOVEL", "DATAEXECUTADO", "DATAPREVISTO"],
  launches: ["FILIAL", "ETAPA", "INÍCIO", "FIM", "STATUS", "PERCENTUALEFETUADO"],
  diaries: ["DATA", "FILIAL", "STATUS"],
  tasks: ["DATAIDENTIFICACAO", "DATA FATAL", "RESPONSÁVEL", "CONCLUÍDO", "DIFICULDADE", "ASSOCIAÇÃO", "PRIORITÁRIA", "TAREFA"],
};
const scalar = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const key = value => scalar(value).replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const statusKey = value => scalar(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const abortIfNeeded = signal => { if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError"); };

function field(item, columns, ...aliases) {
  const wanted = new Set(aliases.map(key));
  const fields = item?.fields || {};
  const column = (columns || []).find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  if (column && fields[column.name] != null) return scalar(fields[column.name]);
  const direct = Object.entries(fields).find(([name, value]) => value != null && wanted.has(key(name)));
  return direct ? scalar(direct[1]) : "";
}

function asActivity(item, columns) {
  const get = (...names) => field(item, columns, ...names);
  return {
    id: scalar(item?.id || get("ID")), branch: get("FILIAL"), stage: get("ETAPA"),
    activity: get("ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"), property: get("IMOVEL", "IMÓVEL"),
    supplier: get("FORNECEDOR"), executionDate: get("DATAEXECUTADO"),
    plannedDate: get("DATAPREVISTO"), status: get("STATUS"),
  };
}
function asLaunch(item, columns) {
  const get = (...names) => field(item, columns, ...names);
  const raw = get("PERCENTUALEFETUADO", "PERCENTUAL EFETUADO");
  const parsed = raw ? Number(raw.replace(",", ".")) : NaN;
  return {
    id: scalar(item?.id || get("ID")), branch: get("FILIAL"), stage: get("ETAPA"),
    startDate: get("INÍCIO", "INICIO"), endDate: get("FIM"), status: get("STATUS"),
    percent: Number.isFinite(parsed) ? parsed * 100 : null,
  };
}
function asDiary(item, columns) {
  const get = (...names) => field(item, columns, ...names);
  return { id: scalar(item?.id || get("ID")), date: get("DATA"), branch: get("FILIAL"), status: get("STATUS") };
}
function asTask(item, columns) {
  const get = (...names) => field(item, columns, ...names);
  return {
    id: scalar(item?.id || get("ID")), task: get("TAREFA"), status: get("CONCLUÍDO", "CONCLUIDO"),
    identifiedDate: get("DATAIDENTIFICACAO", "DATA IDENTIFICAÇÃO"), dueDate: get("DATA FATAL", "DATAFATAL"),
    responsible: get("RESPONSÁVEL", "RESPONSAVEL"), association: get("ASSOCIAÇÃO", "ASSOCIACAO"),
    priority: get("PRIORITÁRIA", "PRIORITARIA"), difficulty: get("DIFICULDADE"),
  };
}

export function createOperationsReportsData({ tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("O relatório requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function itemsFor(kind, signal) {
    abortIfNeeded(signal);
    const list = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
    const columns = await repository.getColumns(SITE, list.id, signal ? { signal } : {});
    abortIfNeeded(signal);
    if (!Array.isArray(columns)) throw new Error(`As colunas de ${LISTS[kind][0]} não foram retornadas pelo SharePoint.`);
    for (const required of REQUIRED_COLUMNS[kind]) {
      const matches = columns.filter(entry => key(entry?.displayName) === key(required) || key(entry?.name) === key(required));
      if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || ""))
        throw new Error(`Não foi possível identificar com segurança a coluna ${required} de ${LISTS[kind][0]}.`);
    }
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    const items = [];
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, list.id, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: PREFER }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items)) throw new Error("O SharePoint retornou uma página de itens inválida.");
      items.push(...page.items);
      if (!page.hasMore) {
        if (items.some(item => !/^[1-9]\d{0,15}$/.test(String(item?.id ?? "")))) {
          throw new Error("O SharePoint retornou um ID inválido; o relatório não exibirá registros ou totais incompletos.");
        }
        return { items, columns };
      }
      if (!page.nextLink) throw new Error("A paginação do relatório não informou a próxima página.");
      cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadStages({ signal } = {}) {
    abortIfNeeded(signal);
    const [activitySet, launchSet] = await Promise.all([itemsFor("activities", signal), itemsFor("launches", signal)]);
    abortIfNeeded(signal);
    return {
      activities: activitySet.items.map(item => asActivity(item, activitySet.columns)),
      launches: launchSet.items.map(item => asLaunch(item, launchSet.columns)),
    };
  }

  async function loadPendingDiaries({ signal } = {}) {
    const set = await itemsFor("diaries", signal);
    abortIfNeeded(signal);
    const pending = set.items.map(item => asDiary(item, set.columns)).filter(row => statusKey(row.status) === "PENDENTE")
      .sort((a, b) => Number(b.id) - Number(a.id));
    return { rows: pending.slice(0, 2000), totalPending: pending.length, limited: pending.length > 2000 };
  }

  async function loadPersonalTasks({ signal } = {}) {
    const set = await itemsFor("tasks", signal);
    abortIfNeeded(signal);
    const all = set.items.map(item => asTask(item, set.columns));
    const summary = {
      pending: all.filter(row => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(statusKey(row.status))).length,
      completed: all.filter(row => statusKey(row.status) === "CONCLUIDO").length,
      total: all.length,
    };
    all.sort((a, b) => dateKey(b.identifiedDate).localeCompare(dateKey(a.identifiedDate)) || Number(b.id) - Number(a.id));
    return { rows: all.slice(0, 2000), summary, limited: all.length > 2000 };
  }

  async function loadReport(number, options = {}) {
    const report = Number(number);
    if (report === 6) {
      const result = buildStageReport(await loadStages(options));
      return { ...result, stages: result.stages.map(stage => ({
        ...stage, start: stage.startDate, end: stage.endDate,
        activities: stage.rows.map(row => ({ ...row, start: row.executionDate, end: row.plannedDate })),
      })) };
    }
    if (report === 7) {
      const result = await loadPendingDiaries(options);
      return { ...result, count: result.totalPending };
    }
    if (report === 8) {
      const set = await itemsFor("tasks", options.signal);
      abortIfNeeded(options.signal);
      const rows = set.items.map(item => asTask(item, set.columns)).map(row => ({
        ...row, identified: row.identifiedDate, due: row.dueDate,
        responsibleKey: statusKey(row.responsible) || "SEM RESPONSÁVEL",
      }));
      const summary = {
        pending: rows.filter(row => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(statusKey(row.status))).length,
        completed: rows.filter(row => statusKey(row.status) === "CONCLUIDO").length,
        total: rows.length,
      };
      rows.sort((a, b) => dateKey(b.identifiedDate).localeCompare(dateKey(a.identifiedDate)) || Number(b.id) - Number(a.id));
      return { rows, summary, limited: rows.length > 2000 };
    }
    throw new RangeError("Selecione o relatório 6, 7 ou 8.");
  }

  return Object.freeze({ loadStages, loadPendingDiaries, loadPersonalTasks, loadReport });
}
