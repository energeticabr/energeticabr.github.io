import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";

const SITE = "personal";
const PAGE_WINDOW = 100;
const MAX_TOTAL_PAGES = 1000;
const LISTS = Object.freeze({
  properties: ["IMOVEL CADASTRADO", "IMÓVEL CADASTRADO"],
  contracts: ["LANCAMENTOCOMPRAS", "LANCAMENTO COMPRAS"],
  clients: ["CADASTRO CLIENTE_1", "CADASTRO CLIENTE", "CADASTROCLIENTE_1"],
  receipts: ["LANÇAMENTORECEITA", "LANCAMENTORECEITA", "LANCAMENTO RECEITA"],
  milestones: ["APONTAMENTOSCOMERCIAIS"],
});
const REQUIRED = Object.freeze({
  properties: [["FILIAL"], ["IMOVEL", "IMÓVEL"], ["STATUSVISUAL", "STATUS VISUAL"]],
  contracts: [["FILIAL"], ["IMOVEL", "IMÓVEL"], ["NOME"], ["STATUS"], ["TOTAL"]],
  clients: [["FILIAL"], ["IMÓVEL ADQUIRIDO", "IMOVELADQUIRIDO"], ["NOME"], ["DEFINITIVO"]],
  receipts: [["FILIAL"], ["IMOVEL", "IMÓVEL"], ["IDCONTRATO", "ID CONTRATO"], ["VALORTOTAL", "VALOR TOTAL"], ["DATAPGTOEFETUADO", "DATA PGTO EFETUADO"]],
  milestones: [["FILIAL"], ["IMOVEL", "IMÓVEL"], ["DATAINICIO", "DATA INÍCIO"], ["DATAFIM", "DATA FIM"], ["TIPOMARCO", "TIPO MARCO"], ["STATUS"]],
});
const decode = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
const key = value => decode(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const scalar = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const date = value => {
  const raw = scalar(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
};
const amount = value => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = scalar(value).replace(/[^\d.,-]/g, "");
  if (!raw || raw === "-") return null;
  const comma = raw.lastIndexOf(","); const dot = raw.lastIndexOf(".");
  const normalized = comma > dot ? raw.replaceAll(".", "").replace(",", ".")
    : dot > comma && comma >= 0 ? raw.replaceAll(",", "")
      : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw;
  const valueNumber = Number(normalized);
  return Number.isFinite(valueNumber) ? valueNumber : null;
};

function get(item, columns, ...aliases) {
  const wanted = new Set(aliases.map(key));
  const column = columns.find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  const fields = item?.fields || {};
  if (column && Object.hasOwn(fields, column.name)) return scalar(fields[column.name]);
  const direct = Object.entries(fields).find(([name]) => wanted.has(key(name)));
  return scalar(direct?.[1]);
}

function checkColumns(kind, columns) {
  if (!Array.isArray(columns)) throw new Error(`As colunas de ${LISTS[kind][0]} são inválidas.`);
  for (const aliases of REQUIRED[kind]) {
    const wanted = new Set(aliases.map(key));
    if (!columns.some(column => wanted.has(key(column?.name)) || wanted.has(key(column?.displayName)))) {
      throw new Error(`Coluna ${aliases[0]} ausente na lista ${LISTS[kind][0]}.`);
    }
  }
}

function normalize(kind, item, columns) {
  const read = (...aliases) => get(item, columns, ...aliases);
  const base = { id: scalar(item?.id || read("ID")), branch: read("FILIAL"), property: read("IMOVEL", "IMÓVEL") };
  if (kind === "properties") return Object.freeze({ ...base, visualStatus: read("STATUSVISUAL", "STATUS VISUAL"),
    saleStatus: read("STATUS"), brokerage: read("CORRETAGEM"), invoice: read("NF/RECIBO", "NF RECIBO"), fiscal: read("FISCAL") });
  if (kind === "contracts") return Object.freeze({ ...base, buyer: read("NOME"), status: read("STATUS"),
    total: amount(read("TOTAL")), saleDate: date(read("DATA VENDA", "DATAVENDA")), broker: read("CORRETOR") });
  if (kind === "clients") return Object.freeze({ ...base, property: read("IMÓVEL ADQUIRIDO", "IMOVELADQUIRIDO"),
    name: read("NOME"), definitive: read("DEFINITIVO") });
  if (kind === "receipts") return Object.freeze({ ...base, contractId: read("IDCONTRATO", "ID CONTRATO"),
    buyer: read("FORNECEDOR"), amount: amount(read("VALORTOTAL", "VALOR TOTAL")),
    paidDate: date(read("DATAPGTOEFETUADO", "DATA PGTO EFETUADO")), dueDate: date(read("DATAPGTOPREVISTO", "DATA PGTO PREVISTO")),
    directBroker: read("PGTO DIR. CORRETOR", "PGTO DIR CORRETOR"), description: read("DESCRIÇÃO", "DESCRICAO", "PRODUTO"),
    paymentMethod: read("FORMAPGTO", "FORMA PGTO"), account: read("CONTA") });
  return Object.freeze({ ...base, contractId: read("IDCONTRATO", "ID CONTRATO"), buyer: read("NOME"),
    type: read("TIPOMARCO", "TIPO MARCO"), description: read("DESCRICAO", "DESCRIÇÃO"),
    startDate: date(read("DATAINICIO", "DATA INÍCIO")), endDate: date(read("DATAFIM", "DATA FIM")),
    dueDate: date(read("DATAFATAL", "DATA FATAL")), status: read("STATUS") });
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError");
}

export function createCommercialProgressReportsData({
  tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES,
} = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("Os relatórios requerem a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function loadList(kind, signal) {
    abortIfNeeded(signal);
    const resolved = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
    const columns = await repository.getColumns(SITE, resolved.id, signal ? { signal } : {});
    abortIfNeeded(signal); checkColumns(kind, columns);
    const rows = []; let cursor = ""; const seenCursors = new Set(); const seenIds = new Set();
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    for (let pageIndex = 1; pageIndex <= MAX_TOTAL_PAGES; pageIndex++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, resolved.id, query, {
        ...(signal ? { signal } : {}), pageNumber: (pageIndex - 1) % PAGE_WINDOW + 1, maxPages: PAGE_WINDOW,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items) || typeof page.hasMore !== "boolean") throw new Error(`A página da lista ${LISTS[kind][0]} está incompleta.`);
      for (const item of page.items) {
        const id = scalar(item?.id);
        if (!id || seenIds.has(id)) throw new Error(`A lista ${LISTS[kind][0]} retornou ID vazio ou repetido na paginação.`);
        seenIds.add(id);
      }
      rows.push(...page.items);
      if (!page.hasMore) return Object.freeze(rows.map(item => normalize(kind, item, columns)));
      if (!page.nextLink) throw new Error(`A paginação da lista ${LISTS[kind][0]} não informou a próxima página.`);
      if (seenCursors.has(page.nextLink)) throw new Error(`A lista ${LISTS[kind][0]} retornou cursor repetido na paginação.`);
      seenCursors.add(page.nextLink);
      cursor = page.nextLink;
    }
    throw new Error(`A lista ${LISTS[kind][0]} excedeu o limite de paginação; nenhum total parcial foi exibido.`);
  }

  async function loadSnapshot({ reportNumber, signal } = {}) {
    if (reportNumber !== 14 && reportNumber !== 15) throw new RangeError("Relatório comercial desconhecido.");
    abortIfNeeded(signal);
    const kinds = reportNumber === 14 ? ["properties", "contracts", "clients", "receipts"] : ["properties", "milestones"];
    const entries = await Promise.all(kinds.map(async kind => [kind, await loadList(kind, signal)]));
    abortIfNeeded(signal);
    return Object.freeze({ properties: Object.freeze([]), contracts: Object.freeze([]), clients: Object.freeze([]),
      receipts: Object.freeze([]), milestones: Object.freeze([]), ...Object.fromEntries(entries) });
  }

  return Object.freeze({ loadSnapshot });
}
