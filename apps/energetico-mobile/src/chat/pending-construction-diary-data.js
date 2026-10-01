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

export function createPendingConstructionDiaryData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("A consulta dos diários requer a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function loadSnapshot({ signal } = {}) {
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
        throw new Error("Não foi possível identificar com segurança a coluna STATUS dos diários.");
      return matches.length === 1 ? matches[0] : "";
    };
    const status = column(["STATUS"], true), date = column(["DATA"]), branch = column(["FILIAL"]);
    const responsible = column(["RESPONSAVELTECNICO", "RESPONSÁVEL TÉCNICO", "RESPONSAVEL"]);
    const query = `$expand=fields&$top=100&$filter=fields/${status} eq 'PENDENTE'`;
    const rows = new Map();
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      check();
      const page = await repository.getItemsPage("personal", list.id, query, {
        ...options, pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
        ...(cursor ? { cursor } : {}),
      });
      check();
      for (const item of Array.isArray(page?.items) ? page.items : []) {
        const id = String(item?.id || "").trim(), fields = item?.fields || {};
        if (!/^[1-9]\d*$/.test(id) || scalar(fields[status]).toUpperCase() !== "PENDENTE") continue;
        rows.set(id, Object.freeze({ id, status: "PENDENTE", date: scalar(fields[date]), branch: scalar(fields[branch]), responsible: scalar(fields[responsible]) }));
      }
      if (page?.hasMore !== true) {
        const sorted = [...rows.values()].sort((a, b) => (provisionDateKey(a.date) || "9999").localeCompare(provisionDateKey(b.date) || "9999") || Number(a.id) - Number(b.id));
        return Object.freeze({ rows: Object.freeze(sorted), count: sorted.length });
      }
      if (!page.nextLink) throw new Error("A paginação dos diários não retornou o próximo cursor.");
      cursor = page.nextLink;
    }
    throw new Error("Os diários excederam o limite seguro de páginas; a consulta não foi truncada.");
  }

  return Object.freeze({ loadSnapshot });
}
