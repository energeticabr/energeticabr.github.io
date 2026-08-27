import { classifyEntityAvailability } from "../data/attachments.js";

const DEFAULT_MAX_PAGES = 25;
const MAX_MAX_PAGES = 50;
const DEFAULT_MAX_ITEMS = 5000;
const MAX_MAX_ITEMS = 5000;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const PAGE_SIZE = 200;

function boundedInteger(value, fallback, maximum) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1) return fallback;
  return Math.min(candidate, maximum);
}

function abortError() {
  const error = new Error("A carga analítica foi cancelada.");
  error.name = "AbortError";
  error.code = "analytics_aborted";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function isAbort(error, signal) {
  return signal?.aborted
    || error?.name === "AbortError"
    || error?.code === "request_aborted"
    || error?.code === "analytics_aborted";
}

function sourceIds(definition) {
  const values = Array.isArray(definition?.sourceEntityIds) ? definition.sourceEntityIds : [];
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
}

function catalogMap(catalog) {
  return new Map((Array.isArray(catalog) ? catalog : [])
    .filter(entity => entity?.id)
    .map(entity => [String(entity.id), entity]));
}

function isAllowed(entity) {
  return entity?.available !== false && entity?.capabilities?.view !== false;
}

function hasPhysicalSource(entity) {
  return Boolean(String(entity?.siteKey || "").trim())
    && Array.isArray(entity?.listNames)
    && entity.listNames.some(name => String(name || "").trim());
}

function diagnostic(sourceId, state, values = {}) {
  return Object.freeze({
    sourceId,
    state,
    complete: values.complete === true,
    loadedCount: Number(values.loadedCount) || 0,
    pageCount: Number(values.pageCount) || 0,
    partialReason: String(values.partialReason || ""),
    message: String(values.message || ""),
  });
}

function failureMessage(state, entity, error) {
  if (state === "missing") return `A lista de ${entity.title || entity.id} não foi localizada no SharePoint.`;
  if (state === "forbidden") return `A conta atual não pode consultar ${entity.title || entity.id}.`;
  return `Não foi possível consultar ${entity.title || entity.id}.${error?.code ? ` Código: ${error.code}.` : ""}`;
}

function recordFrom(item, sourceId) {
  const id = String(item?.id ?? item?.fields?.ID ?? "").trim();
  if (!id) throw new TypeError(`A fonte ${sourceId} retornou um registro sem identificador.`);
  return Object.freeze({
    id,
    sourceId,
    fields: Object.freeze({ ...(item?.fields || {}) }),
  });
}

function progressUpdate(onProgress, values) {
  onProgress?.(Object.freeze({ ...values }));
}

async function loadSource(repository, entity, limits, progress) {
  const signal = limits.signal;
  const sourceId = String(entity.id);
  try {
    throwIfAborted(signal);
    const list = await repository.resolveList(entity.siteKey, entity.listNames, { signal });
    throwIfAborted(signal);
    if (list?.status !== "resolved") {
      return Object.freeze({
        records: Object.freeze([]),
        diagnostic: diagnostic(sourceId, "missing", {
          message: failureMessage("missing", entity),
        }),
      });
    }

    const records = new Map();
    let cursor = "";
    let pageCount = 0;
    let complete = false;
    let partialReason = "";

    while (!complete && !partialReason) {
      throwIfAborted(signal);
      pageCount += 1;
      const page = await repository.getItemsPage(
        entity.siteKey,
        list.id,
        `$expand=fields&$top=${PAGE_SIZE}`,
        { cursor, pageNumber: pageCount, maxPages: limits.maxPages, signal },
      );
      throwIfAborted(signal);

      let omittedByLimit = false;
      for (const item of page?.items || []) {
        const record = recordFrom(item, sourceId);
        if (!records.has(record.id) && records.size >= limits.maxItems) {
          omittedByLimit = true;
          break;
        }
        records.set(record.id, record);
      }

      const nextLink = String(page?.nextLink || "").trim();
      if (page?.hasMore === true && !nextLink) {
        throw new TypeError(`A fonte ${sourceId} indicou continuação sem cursor Graph.`);
      }
      complete = !nextLink && !omittedByLimit;
      if (!complete && (omittedByLimit || records.size >= limits.maxItems)) partialReason = "max-items";
      else if (!complete && pageCount >= limits.maxPages) partialReason = "max-pages";

      progress({
        sourceId,
        loadedCount: records.size,
        pageCount,
        complete,
        partialReason,
      });
      throwIfAborted(signal);
      cursor = nextLink;
    }

    const message = partialReason === "max-items"
      ? `Limite de ${limits.maxItems} registros atingido.`
      : partialReason === "max-pages"
        ? `Limite de ${limits.maxPages} páginas atingido.`
        : "";
    return Object.freeze({
      records: Object.freeze([...records.values()]),
      diagnostic: diagnostic(sourceId, partialReason ? "partial" : "ready", {
        complete,
        loadedCount: records.size,
        pageCount,
        partialReason,
        message,
      }),
    });
  } catch (error) {
    if (isAbort(error, signal)) throw abortError();
    const state = classifyEntityAvailability(error);
    return Object.freeze({
      records: Object.freeze([]),
      diagnostic: diagnostic(sourceId, state, {
        message: failureMessage(state, entity, error),
      }),
    });
  }
}

export async function loadAnalyticsData(repository, definition, catalog, options = {}) {
  if (!repository
    || typeof repository.resolveList !== "function"
    || typeof repository.getItemsPage !== "function") {
    throw new TypeError("A carga analítica requer um repositório SharePoint com paginação incremental.");
  }

  const signal = options.signal;
  throwIfAborted(signal);
  const limits = Object.freeze({
    maxPages: boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES),
    maxItems: boundedInteger(options.maxItems, DEFAULT_MAX_ITEMS, MAX_MAX_ITEMS),
    concurrency: boundedInteger(options.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
    signal,
  });
  const byId = catalogMap(catalog);
  const requestedIds = sourceIds(definition);
  const results = new Array(requestedIds.length);
  const loadable = [];

  for (const [index, sourceId] of requestedIds.entries()) {
    const entity = byId.get(sourceId);
    if (!entity) {
      results[index] = Object.freeze({
        records: Object.freeze([]),
        diagnostic: diagnostic(sourceId, "unknown", {
          message: "A fonte não está presente no catálogo do portal.",
        }),
      });
    } else if (!isAllowed(entity)) {
      results[index] = Object.freeze({
        records: Object.freeze([]),
        diagnostic: diagnostic(sourceId, "forbidden", {
          message: "A fonte não está liberada para consulta no catálogo do portal.",
        }),
      });
    } else if (!hasPhysicalSource(entity)) {
      results[index] = Object.freeze({
        records: Object.freeze([]),
        diagnostic: diagnostic(sourceId, "invalid", {
          message: "A fonte não possui site e aliases físicos válidos no catálogo do portal.",
        }),
      });
    } else {
      loadable.push({ index, entity });
    }
  }

  let nextIndex = 0;
  let completedSources = results.filter(Boolean).length;
  const report = values => progressUpdate(options.onProgress, {
    ...values,
    completedSources,
    totalSources: requestedIds.length,
  });
  const worker = async () => {
    while (true) {
      throwIfAborted(signal);
      const position = nextIndex;
      nextIndex += 1;
      const task = loadable[position];
      if (!task) return;
      results[task.index] = await loadSource(repository, task.entity, limits, report);
      completedSources += 1;
      report({
        sourceId: task.entity.id,
        loadedCount: results[task.index].diagnostic.loadedCount,
        pageCount: results[task.index].diagnostic.pageCount,
        complete: results[task.index].diagnostic.complete,
        partialReason: results[task.index].diagnostic.partialReason,
      });
    }
  };

  const workerCount = Math.min(limits.concurrency, loadable.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  throwIfAborted(signal);

  const diagnostics = Object.freeze(results.map(result => result.diagnostic));
  const records = Object.freeze(results.flatMap(result => result.records));
  return Object.freeze({
    records,
    diagnostics,
    complete: diagnostics.every(item => item.complete),
  });
}
