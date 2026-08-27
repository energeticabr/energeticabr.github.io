import { classifyEntityAvailability } from "../data/attachments.js";

const PENDING_STATUS = /^(PENDENTE|AGUARDANDO|ABERTO|EM ANDAMENTO)(?:$|\s|-)/;
const DATE_FIELDS = Object.freeze([
  "DATA PGTO PREVISTO",
  "DATAPGTOPREVISTO",
  "DATA_PGTO_PREVISTO",
  "DATA VENCIMENTO",
  "DATAVENCIMENTO",
  "VENCIMENTO",
]);
const VALUE_FIELDS = Object.freeze([
  "VALOR PENDENTE",
  "VALORPENDENTE",
  "VALOR TOTAL",
  "VALORTOTAL",
  "VALOR",
  "TOTAL",
]);
const STATUS_FIELDS = Object.freeze(["STATUS", "SITUACAO", "SITUAÇÃO", "CONCLUIDO", "CONCLUÍDO"]);

function metric(id, label, entityIds, kind = "count") {
  return Object.freeze({ id, label, entityIds: Object.freeze(entityIds), kind });
}

export const DASHBOARD_METRIC_DEFINITIONS = Object.freeze([
  metric("vencimentos-hoje", "Vencimentos hoje", ["lancamentos", "provisoes-de-pagamento", "notas-pendentes"], "due-today"),
  metric("vencidos", "Vencidos", ["lancamentos", "provisoes-de-pagamento", "notas-pendentes"], "overdue"),
  metric("auditoria", "Auditoria", ["auditorias"]),
  metric("cotacoes", "Cotações", ["novas-cotacoes"]),
  metric("documentos", "Documentos", ["documentos-operacionais"]),
  metric("contratos", "Contratos", ["linhas-de-contrato"]),
  metric("valores-pendentes", "Valores pendentes", ["lancamentos", "provisoes-de-pagamento", "notas-pendentes"], "pending-value"),
  metric("diarios", "Diários", ["diarios-de-obras"]),
  metric("documentacao-comercial", "Documentação comercial", ["homologacao-comercial", "apontamentos-comerciais"]),
  metric("patologias", "Patologias", ["patologias-sac"]),
  metric("tarefas", "Tarefas", ["lancamentos-de-tarefas", "tarefas-delegadas"]),
]);

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

function fieldValue(item, candidates) {
  const fields = item?.fields || {};
  const byNormalizedName = new Map(Object.entries(fields).map(([name, value]) => [normalized(name), value]));
  for (const candidate of candidates) {
    const value = byNormalizedName.get(normalized(candidate));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function dateKey(value) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function isPending(item) {
  const status = normalized(fieldValue(item, STATUS_FIELDS));
  return !status || PENDING_STATUS.test(status);
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let source = String(value || "").replace(/[^0-9,.-]/g, "");
  if (!source) return 0;
  if (source.includes(",")) source = source.replaceAll(".", "").replace(",", ".");
  const parsed = Number(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricItems(sources, definition) {
  return sources
    .filter(source => definition.entityIds.includes(source.entityId) && (source.state === "ready" || source.state === "partial"))
    .flatMap(source => source.items || []);
}

function metricState(sources, definition) {
  const relevant = sources.filter(source => definition.entityIds.includes(source.entityId));
  const ready = relevant.filter(source => source.state === "ready");
  const failed = relevant.filter(source => source.state !== "ready");
  if (!relevant.length) return { state: "missing", diagnostic: "Fonte não configurada no catálogo do portal." };
  if (ready.length && failed.length) {
    return { state: "partial", diagnostic: failed.map(source => `${source.title}: ${source.diagnostic}`).join(" ") };
  }
  if (ready.length) return { state: "ready", diagnostic: "" };
  const first = failed[0];
  return { state: first?.state || "unavailable", diagnostic: first?.diagnostic || "A fonte não pôde ser consultada." };
}

function calculateMetric(definition, items, today) {
  if (definition.kind === "due-today") {
    return items.filter(item => isPending(item) && dateKey(fieldValue(item, DATE_FIELDS)) === today).length;
  }
  if (definition.kind === "overdue") {
    return items.filter(item => {
      const due = dateKey(fieldValue(item, DATE_FIELDS));
      return isPending(item) && due && due < today;
    }).length;
  }
  if (definition.kind === "pending-value") {
    return items.filter(isPending).reduce((total, item) => total + numberValue(fieldValue(item, VALUE_FIELDS)), 0);
  }
  return items.length;
}

export function buildDashboardMetrics(sources = [], options = {}) {
  const today = String(options.today || new Date().toISOString().slice(0, 10));
  return Object.freeze(DASHBOARD_METRIC_DEFINITIONS.map(definition => {
    const sourceState = metricState(sources, definition);
    return Object.freeze({
      ...definition,
      value: calculateMetric(definition, metricItems(sources, definition), today),
      ...sourceState,
    });
  }));
}

function boundedInteger(value, fallback, maximum) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) return fallback;
  return Math.min(candidate, maximum);
}

function diagnosticFor(state, entity, error) {
  if (state === "forbidden") return `Sua conta não tem permissão para consultar ${entity.title}.`;
  if (state === "missing") return `A lista de ${entity.title} não foi localizada no SharePoint.`;
  const code = String(error?.code || "").trim();
  return `Não foi possível consultar ${entity.title} agora.${code ? ` Código: ${code}.` : ""}`;
}

async function loadSource(repository, entity, options) {
  const batchSize = boundedInteger(options.batchSize, 100, 200);
  const maxPages = boundedInteger(options.maxPages, 25, 50);
  try {
    const list = await repository.resolveList(entity.siteKey, entity.listNames, { signal: options.signal });
    if (list?.status !== "resolved") {
      return Object.freeze({ entityId: entity.id, title: entity.title, state: "missing", items: Object.freeze([]), pageCount: 0, diagnostic: diagnosticFor("missing", entity) });
    }
    if (typeof repository.getItemsPage !== "function") {
      if (typeof repository.getItems !== "function") throw new TypeError("O repositório não oferece leitura para o painel.");
      const fallbackItems = await repository.getItems(entity.siteKey, list.id, `$expand=fields&$top=${batchSize}`);
      return Object.freeze({
        entityId: entity.id,
        title: entity.title,
        moduleId: entity.moduleId,
        state: "ready",
        items: Object.freeze([...(fallbackItems || [])]),
        pageCount: fallbackItems?.length ? 1 : 0,
        diagnostic: "",
      });
    }
    const items = new Map();
    let cursor = "";
    let pageCount = 0;
    let hasMore = true;
    while (hasMore && pageCount < maxPages) {
      pageCount += 1;
      const page = await repository.getItemsPage(entity.siteKey, list.id, `$expand=fields&$top=${batchSize}`, {
        cursor,
        pageNumber: pageCount,
        maxPages,
        signal: options.signal,
      });
      for (const item of page?.items || []) {
        const id = String(item?.id ?? item?.fields?.ID ?? "").trim();
        if (id) items.set(id, item);
      }
      cursor = String(page?.nextLink || "");
      hasMore = page?.hasMore === true && Boolean(cursor);
    }
    const complete = !hasMore;
    return Object.freeze({
      entityId: entity.id,
      title: entity.title,
      moduleId: entity.moduleId,
      state: complete ? "ready" : "partial",
      items: Object.freeze([...items.values()]),
      pageCount,
      diagnostic: complete ? "" : `Consulta parcial: limite de ${maxPages} páginas atingido.`,
    });
  } catch (error) {
    if (error?.name === "AbortError" || options.signal?.aborted) throw error;
    const state = classifyEntityAvailability(error);
    return Object.freeze({ entityId: entity.id, title: entity.title, moduleId: entity.moduleId, state, items: Object.freeze([]), pageCount: 0, diagnostic: diagnosticFor(state, entity, error) });
  }
}

export async function loadDashboardSources(repository, entities = [], options = {}) {
  if (!repository || typeof repository.resolveList !== "function") throw new TypeError("O painel requer um repositório SharePoint autorizado.");
  return Object.freeze(await Promise.all((entities || []).map(entity => loadSource(repository, entity, options))));
}

export function dashboardRecords(sources = []) {
  return Object.freeze((sources || []).flatMap(source => (source.items || []).map(item => Object.freeze({
    ...item,
    sourceId: source.entityId,
    sourceTitle: source.title,
    status: normalized(fieldValue(item, STATUS_FIELDS)) || "NÃO INFORMADO",
    actor: item.lastModifiedBy?.user?.displayName || item.createdBy?.user?.displayName || "NÃO INFORMADO",
  }))));
}
