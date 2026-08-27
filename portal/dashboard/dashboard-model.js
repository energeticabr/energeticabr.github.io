import { classifyEntityAvailability } from "../data/attachments.js";

const DATE_FIELDS = Object.freeze([
  "DATA PREVISTO PGTO",
  "DATA PGTO PREVISTO",
  "DATAPGTOPREVISTO",
  "DATA_PGTO_PREVISTO",
  "DATA VENCIMENTO",
  "DATAVENCIMENTO",
  "VENCIMENTO",
]);
const STATUS_FIELDS = Object.freeze(["STATUS", "SITUACAO", "SITUAÇÃO", "CONCLUIDO", "CONCLUÍDO"]);
const PAYMENT_DATE_FIELDS = Object.freeze(["DATA PGTO EFETUADO", "DATAPGTOEFETUADO", "DATA_PGTO_EFETUADO"]);
const PRESENCE_FIELDS = Object.freeze(["PRESENCA", "PRESENÇA"]);
const DAILY_VALUE_FIELDS = Object.freeze(["VLORDIARIO", "VLR DIARIO", "VALOR DIARIO", "VALOR DIÁRIO"]);
const TASK_STATUS_FIELDS = Object.freeze(["CONCLUÍDO", "CONCLUIDO", "CONCLU_x00cd_DO", "STATUS"]);
const COMMERCIAL_DOCUMENT_FIELDS = Object.freeze([
  "SEGURO",
  "IDPROPOSTA",
  "IDCONTRATOCAIXA",
  "IDESCRITURA",
  "IDDOCUMENTOCORRETAGEM",
  "IDDOCFISCAL",
]);

function metric(id, label, entityIds, kind = "count") {
  return Object.freeze({ id, label, entityIds: Object.freeze(entityIds), kind });
}

export const DASHBOARD_METRIC_DEFINITIONS = Object.freeze([
  metric("vencimentos-hoje", "Vencimentos hoje", ["provisoes-de-pagamento"], "due-today"),
  metric("vencidos", "Vencidos", ["provisoes-de-pagamento"], "overdue"),
  metric("auditoria", "Auditoria", ["notas-pendentes"], "pending-audit"),
  metric("cotacoes", "Cotações", ["novas-cotacoes"], "active-quotation"),
  metric("documentos", "Documentos", ["documentos-operacionais"], "pending-document"),
  metric("contratos", "Contratos", ["empreiteiros"], "active-contract"),
  metric("valores-pendentes", "Valores pendentes", ["descricoes-de-presenca"], "pending-presence-value"),
  metric("diarios", "Diários", ["diarios-de-obras"], "pending-diary"),
  metric("documentacao-comercial", "Documentação comercial", ["imoveis"], "missing-commercial-documents"),
  metric("patologias", "Patologias", ["patologias-sac"], "active-pathology"),
  metric("tarefas", "Tarefas", ["lancamentos-de-tarefas", "tarefas-delegadas"], "pending-task"),
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

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
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
    return items.filter(item => isBlank(fieldValue(item, PAYMENT_DATE_FIELDS)) && dateKey(fieldValue(item, DATE_FIELDS)) === today).length;
  }
  if (definition.kind === "overdue") {
    return items.filter(item => {
      const due = dateKey(fieldValue(item, DATE_FIELDS));
      return isBlank(fieldValue(item, PAYMENT_DATE_FIELDS)) && due && due < today;
    }).length;
  }
  if (definition.kind === "pending-audit") {
    return items.filter(item => normalized(fieldValue(item, STATUS_FIELDS)) === "PENDENTE AUDITORIA").length;
  }
  if (definition.kind === "active-quotation") {
    return items.filter(item => ["ATIVA", "ATIVO"].includes(normalized(fieldValue(item, STATUS_FIELDS)))).length;
  }
  if (definition.kind === "pending-document" || definition.kind === "pending-diary") {
    return items.filter(item => normalized(fieldValue(item, STATUS_FIELDS)) === "PENDENTE").length;
  }
  if (definition.kind === "active-contract" || definition.kind === "active-pathology") {
    return items.filter(item => normalized(fieldValue(item, STATUS_FIELDS)) === "ATIVO").length;
  }
  if (definition.kind === "pending-presence-value") {
    return items
      .filter(item => normalized(fieldValue(item, PRESENCE_FIELDS)) === "PRESENTE"
        && normalized(fieldValue(item, STATUS_FIELDS)) !== "PAGO")
      .reduce((total, item) => total + numberValue(fieldValue(item, DAILY_VALUE_FIELDS)), 0);
  }
  if (definition.kind === "missing-commercial-documents") {
    return items.reduce((total, item) => {
      const filial = fieldValue(item, ["FILIAL"]);
      const imovel = normalized(fieldValue(item, ["IMOVEL", "IMÓVEL"]));
      if (isBlank(filial) || !imovel || imovel === "TODOS" || imovel.startsWith("ESCRITÓRIO")) return total;
      return total + COMMERCIAL_DOCUMENT_FIELDS.filter(field => isBlank(fieldValue(item, [field]))).length;
    }, 0);
  }
  if (definition.kind === "pending-task") {
    return items.filter(item => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(normalized(fieldValue(item, TASK_STATUS_FIELDS)))).length;
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
