import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { provisionDateKey } from "./pending-provision-dates.js";

const MAX_PAGES = 100;

function fieldKey(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scalar(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const key of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title"])
      if (value[key] != null) return scalar(value[key]);
    return "";
  }
  return String(value).trim();
}

function calendarDate(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError('Campo DATA inválido na consulta de diários pendentes.');
  const raw = value.trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    // Date.parse can roll an impossible timestamp day into the following month.
    if (!provisionDateKey(raw.slice(0, 10))
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(raw)) return '';
  }
  return provisionDateKey(raw);
}

function validatePendingDiaryRows(rows) {
  const seen = new Map();
  for (const { id: rawId, date, branch, status } of rows) {
    const id = Number(rawId);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1) {
      throw new TypeError("ID inválido na consulta de diários pendentes.");
    }
    const normalized = { date: calendarDate(date), branch, status: status.toUpperCase() };
    const previous = seen.get(id);
    if (previous && (previous.date !== normalized.date || previous.branch !== branch || previous.status !== normalized.status)) {
      throw new TypeError("ID duplicado com campos conflitantes na consulta de diários pendentes.");
    }
    seen.set(id, normalized);
  }
}

export function createPendingConstructionDiaryData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES, strictReport = false,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("A consulta dos diários requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function loadSnapshot({ signal, includeDateMetadata = false } = {}) {
    const check = () => { if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError"); };
    check();
    const options = signal ? { signal } : {};
    const list = await repository.resolveList("personal", ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS"], options);
    if (list?.status !== "resolved" || !list.id) throw new Error("A lista DIÁRIO DE OBRAS não está disponível nesta conta.");
    const columns = await repository.getColumns("personal", list.id, options);
    const column = (aliases, required = false) => {
      const keys = aliases.map(fieldKey);
      const matches = [...new Set((Array.isArray(columns) ? columns : [])
        .filter(c => keys.includes(fieldKey(c.name)) || keys.includes(fieldKey(c.displayName))).map(c => c.name).filter(Boolean))];
      if (required && (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0])))
        throw new Error(`Não foi possível identificar com segurança a coluna ${aliases[0]} dos diários.`);
      return matches.length === 1 ? matches[0] : "";
    };
    const status = column(["STATUS"], true), date = column(["DATA"], strictReport), branch = column(["FILIAL"], strictReport);
    const responsible = column(["RESPONSAVELTECNICO", "RESPONSÁVEL TÉCNICO", "RESPONSAVEL"]);
    const query = `$expand=fields&$top=100&$filter=fields/${status} eq 'PENDENTE'`;
    const rows = new Map();
    // Validate the complete source before filtering or deduplicating rows.
    const rawRows = [];
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      check();
      const page = await repository.getItemsPage("personal", list.id, query, {
        ...options, pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
        ...(cursor ? { cursor } : {}),
      });
      check();
      if (strictReport && (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
        || page.complete === false || page.partial || page.incomplete || page.truncated || page.error
        || (!page.hasMore && page.nextLink))) throw new Error('Página de diários inválida ou incompleta.');
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        const rawId = String(item?.id || "").trim(), id = strictReport ? String(Number(rawId)) : rawId, fields = item?.fields || {};
        if (strictReport) {
          if ([status,date,branch].some(name => !Object.hasOwn(fields,name))) throw new Error('Registro de diário incompleto.');
          rawRows.push({id:rawId,date:scalar(fields[date]),branch:scalar(fields[branch]),status:scalar(fields[status])});
        }
        if (!/^[1-9]\d*$/.test(id) || scalar(fields[status]).toUpperCase() !== "PENDENTE") continue;
        rows.set(id, Object.freeze({ id, status: "PENDENTE", date: scalar(fields[date]), branch: scalar(fields[branch]), responsible: scalar(fields[responsible]) }));
      }
      if (page?.hasMore !== true) {
        if (strictReport) validatePendingDiaryRows(rawRows);
        const sorted = [...rows.values()].sort((a, b) => (provisionDateKey(a.date) || "9999").localeCompare(provisionDateKey(b.date) || "9999") || Number(a.id) - Number(b.id));
        return Object.freeze({ rows: Object.freeze(sorted), count: sorted.length,
          ...(includeDateMetadata ? { dateColumn: columns.find(column => column.name === date) } : {}),
        });
      }
      if (!page.nextLink) throw new Error("A paginação dos diários não retornou o próximo cursor.");
      cursor = page.nextLink;
    }
    throw new Error("Os diários excederam o limite seguro de páginas; a consulta não foi truncada.");
  }

  return Object.freeze({ loadSnapshot });
}
