import Decimal from "decimal.js";
import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";

const SITE = "personal";
const MAX_PAGES = 100;
const LISTS = {
  properties: ["IMOVEL CADASTRADO", "IMÓVEL CADASTRADO"],
  purchases: ["LANCAMENTOCOMPRAS", "LANÇAMENTO COMPRAS"],
  rents: ["LANCAMENTOALUGUEL", "LANÇAMENTO ALUGUEL"],
  contracts: ["CADASTRO ALUGUEL"],
};
const PROPERTY_FIELDS = [
  "FILIAL", "IMOVEL", "STATUS", "STATUSVISUAL", "FISCAL", "SEGURO", "IDPROPOSTA",
  "IDCONTRATOCAIXA", "IDESCRITURA", "IDDOCUMENTOCORRETAGEM", "IDDOCFISCAL",
  "IDPGTOFISCAL", "IDPGTOCORRETAGEM", "OBS FISCAL", "CORRETAGEM", "CORRETOR",
  "DESCRITIVO CORRETAGEM", "VLORFISCAL", "VLORCORRETAGEM",
];
const RENT_FIELDS = ["DESCRICAO", "INQUILINO", "DATA VENCIMENTO", "DATAPGTOEFETUADO", "FORMA PGTO", "NUM. CONTRATO ALUGUEL", "VALOR BRUTO"];
const CONTRACT_FIELDS = ["VALOR", "DESCRICAOIMOVEL", "INQUILINO", "FORMA DE PGTO", "STATUS", "DATA REAJUSTE", "INDEX", "DATA VENCIMENTO"];
const PURCHASE_FIELDS = ["FILIAL", "IMOVEL", "NOME"];
const DOCUMENT_FIELDS = [
  ["SEGURO", "Seguro"], ["IDPROPOSTA", "Proposta"], ["IDCONTRATOCAIXA", "Contrato Caixa"],
  ["IDESCRITURA", "Escritura"], ["IDDOCUMENTOCORRETAGEM", "Documento de corretagem"],
  ["IDDOCFISCAL", "Documento fiscal"], ["IDPGTOFISCAL", "Pagamento fiscal"],
  ["IDPGTOCORRETAGEM", "Pagamento corretagem"],
];
const OTHER_FIELDS = [
  ["STATUS", "Status"], ["FISCAL", "Fiscal"], ["OBS FISCAL", "Observação fiscal"],
  ["CORRETAGEM", "Corretagem"], ["CORRETOR", "Corretor"],
  ["DESCRITIVO CORRETAGEM", "Descritivo da corretagem"], ["VLORFISCAL", "Valor fiscal"],
  ["VLORCORRETAGEM", "Valor da corretagem"],
];
const STATE_FIELDS = [["FISCAL", "Fiscal declarado"], ["STATUS", "Imóvel vendido ou dispensado"], ["STATUSVISUAL", "Visual ativo ou dispensado"]];

const scalar = value => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") return scalar(value.LookupValue ?? value.Value ?? value.value ?? value.Title ?? value.LookupId);
  return String(value).trim();
};
const normalized = value => scalar(value).replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const status = value => scalar(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const abortIfNeeded = signal => { if (signal?.aborted) throw signal.reason || new DOMException("Consulta cancelada.", "AbortError"); };

function dateKey(value) {
  const raw = scalar(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) || /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  if (!match) return "";
  const key = raw.includes("/") ? `${match[3]}-${match[2]}-${match[1]}` : `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key ? "" : key;
}

function moneyCents(value, id) {
  let raw = scalar(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (raw.includes(",") && raw.includes(".")) raw = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replaceAll(".", "").replace(",", ".") : raw.replaceAll(",", "");
  else if (raw.includes(",")) raw = raw.replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`O valor do contrato ${id} está ausente ou inválido.`);
  const cents = new Decimal(raw).times(100);
  if (!cents.isInteger() || cents.greaterThan(Number.MAX_SAFE_INTEGER)) throw new Error(`O valor do contrato ${id} está fora do limite seguro.`);
  return cents.toNumber();
}

function requiredColumns(columns, names, listName) {
  if (!Array.isArray(columns)) throw new Error(`As colunas de ${listName} não foram retornadas pelo SharePoint.`);
  const resolved = new Map();
  for (const name of names) {
    const matches = columns.filter(column => [column?.displayName, column?.name].some(value => normalized(value) === normalized(name)));
    if (matches.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0]?.name || ""))
      throw new Error(`Não foi possível identificar com segurança a coluna ${name} de ${listName}.`);
    resolved.set(name, matches[0].name);
  }
  return resolved;
}

function valueFor(item, columns, name) {
  const fields = item?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error(`O item ${item?.id || "sem ID"} não possui campos SharePoint válidos.`);
  return scalar(fields[columns.get(name)]);
}

function propertyRow(item, columns) {
  const get = name => valueFor(item, columns, name);
  const documents = DOCUMENT_FIELDS.map(([key, label]) => ({ key, label, value: get(key), pending: !get(key) }));
  const otherFields = OTHER_FIELDS.map(([key, label]) => ({ key, label, value: get(key), pending: !get(key) }));
  const stateChecks = [
    { key: "FISCAL", label: "Fiscal declarado", value: get("FISCAL"), pending: status(get("FISCAL")) !== "DECLARADO" },
    { key: "STATUS", label: "Imóvel vendido ou dispensado", value: get("STATUS"), pending: !["VENDIDO", "DISPENSADO"].includes(status(get("STATUS"))) },
    { key: "STATUSVISUAL", label: "Visual ativo ou dispensado", value: get("STATUSVISUAL"), pending: !["ATIVO", "DISPENSADO"].includes(status(get("STATUSVISUAL"))) },
  ];
  const idPending = documents.filter(field => field.pending).length + stateChecks.filter(field => field.pending).length;
  const fieldsPending = otherFields.filter(field => field.pending).length;
  return { id: String(item.id), branch: get("FILIAL"), property: get("IMOVEL"), status: get("STATUS"), fiscal: get("FISCAL"), documents, stateChecks, otherFields, idPending, fieldsPending, totalPending: idPending + fieldsPending };
}

function commercialTotals(rows) {
  const fieldCounts = (definitions, name) => definitions.map(([key, label]) => ({
    key, label, count: rows.filter(row => row[name].some(field => field.key === key && field.pending)).length,
  }));
  return {
    properties: rows.length,
    idPending: rows.reduce((sum, row) => sum + row.idPending, 0),
    fieldsPending: rows.reduce((sum, row) => sum + row.fieldsPending, 0),
    totalPending: rows.reduce((sum, row) => sum + row.totalPending, 0),
    fieldTotals: {
      documents: fieldCounts(DOCUMENT_FIELDS, "documents"),
      states: fieldCounts(STATE_FIELDS, "stateChecks"),
      fields: fieldCounts(OTHER_FIELDS, "otherFields"),
    },
  };
}

export function selectCommercialDocsReport(sourceRows, filters = {}) {
  const detailMode = Boolean(filters.property || filters.buyer || filters.contract);
  const rows = sourceRows.flatMap(row => {
    if (filters.branch && row.branch !== filters.branch) return [];
    if (filters.property && row.property !== filters.property) return [];
    if (filters.status && row.status !== filters.status) return [];
    const contracts = (row.contracts || []).filter(contract =>
      (!filters.buyer || contract.buyer === filters.buyer) && (!filters.contract || contract.id === String(filters.contract)));
    if ((filters.buyer || filters.contract) && !contracts.length) return [];
    return [{ ...row, contracts }];
  });
  const summary = commercialTotals(rows);
  const byBranch = new Map();
  for (const row of rows) {
    if (!byBranch.has(row.branch)) byBranch.set(row.branch, []);
    byBranch.get(row.branch).push(row);
  }
  summary.branches = [...byBranch].map(([branch, branchRows]) => ({ branch, ...commercialTotals(branchRows) }));
  return { rows, summary, detailMode };
}

export function selectOpenRentsReport(sourceRows, filters = {}) {
  const rows = sourceRows.filter(row =>
    (!filters.property || row.property === filters.property) &&
    (!filters.tenant || row.tenant === filters.tenant) &&
    (!filters.dueState || row.dueState === filters.dueState) &&
    (!filters.paymentMethod || row.paymentMethod === filters.paymentMethod) &&
    (!filters.search || `${row.property} ${row.tenant}`.toLocaleLowerCase("pt-BR").includes(String(filters.search).toLocaleLowerCase("pt-BR"))));
  const summary = rows.reduce((sum, row) => ({ ...sum, open: sum.open + 1, [row.dueState]: sum[row.dueState] + 1, totalCents: sum.totalCents + row.amountCents }), { open: 0, overdue: 0, today: 0, upcoming: 0, totalCents: 0 });
  if (!Number.isSafeInteger(summary.totalCents)) throw new Error("O total de aluguéis excede o limite numérico seguro.");
  return { rows, summary };
}

export function selectRentDashboard(snapshot, filters = {}) {
  const { sourceRows, contracts, todayKey } = snapshot;
  if (!Array.isArray(sourceRows) || !Array.isArray(contracts) || !dateKey(todayKey)) throw new Error("A fonte do relatório anual de aluguéis está incompleta.");
  const year = String(filters.year || todayKey.slice(0, 4));
  if (!/^\d{4}$/.test(year)) throw new Error("O ano selecionado não é válido.");
  const selectedContracts = contracts.filter(row => !filters.status || row.status === filters.status);
  const selectedContractIds = new Set(selectedContracts.map(row => row.id));
  const displayedContracts = selectedContracts.filter(row =>
    (!filters.property || row.property === filters.property) &&
    (!filters.tenant || row.tenant === filters.tenant) &&
    (!filters.paymentMethod || row.paymentMethod === filters.paymentMethod));
  const matchedLaunches = sourceRows.filter(row =>
    selectedContractIds.has(row.contractId) &&
    (!filters.property || row.property === filters.property) && (!filters.tenant || row.tenant === filters.tenant) &&
    (!filters.paymentMethod || row.paymentMethod === filters.paymentMethod));
  const annualSource = matchedLaunches.filter(row => (row.paidDate || row.dueDate).startsWith(year));
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  const openRows = matchedLaunches.filter(row => !row.paidDate).map(row => {
    const difference = Math.round((Date.parse(`${row.dueDate}T00:00:00Z`) - today) / 86_400_000);
    return { ...row, amountCents: contracts.find(contract => contract.id === row.contractId).amountCents,
      dueState: difference < 0 ? "overdue" : difference === 0 ? "today" : "upcoming", days: Math.abs(difference), year };
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || Number(a.id) - Number(b.id));
  const open = selectOpenRentsReport(openRows, filters);
  const grouped = new Map();
  const monthlyTotals = Array(12).fill(0);
  for (const row of annualSource) {
    let grossCents = row.grossCents;
    if (grossCents == null) {
      try { grossCents = moneyCents(row.grossValue, row.id); }
      catch (error) {
        if (row.paidDate) throw error;
        grossCents = contracts.find(contract => contract.id === row.contractId).amountCents;
      }
    }
    const month = Number((row.paidDate || row.dueDate).slice(5, 7)) - 1;
    if (!grouped.has(row.property)) grouped.set(row.property, Array(12).fill(0));
    grouped.get(row.property)[month] += grossCents;
    monthlyTotals[month] += grossCents;
  }
  const annualRows = [...grouped].map(([property, months]) => ({ property, months, totalCents: months.reduce((sum, value) => sum + value, 0) }));
  const adjustments = displayedContracts.map(row => ({ property: row.property, tenant: row.tenant,
    date: row.adjustmentDate, index: row.index, status: row.status })).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const expirations = displayedContracts.map(row => ({ property: row.property, tenant: row.tenant,
    date: row.expiryDate, status: row.status })).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  return { ...snapshot, ...open, annualRows, monthlyTotals,
    annualTotalCents: monthlyTotals.reduce((sum, value) => sum + value, 0), adjustments, expirations, year };
}

export function createCommercialDocsRentReportsData({ tokenProvider, repository: suppliedRepository, fetchImpl = globalThis.fetch, siteConfig = SHAREPOINT_SITES, today = () => new Date() } = {}) {
  if (!suppliedRepository && typeof tokenProvider !== "function") throw new TypeError("Os relatórios requerem a sessão Microsoft ativa.");
  const repository = suppliedRepository || createSharePointRepository(createGraphClient(tokenProvider, { fetch: fetchImpl }), siteConfig);

  async function loadList(kind, signal) {
    abortIfNeeded(signal);
    const resolved = await repository.resolveList(SITE, LISTS[kind], signal ? { signal } : {});
    abortIfNeeded(signal);
    if (resolved?.status !== "resolved" || !resolved.id) throw new Error(`A lista ${LISTS[kind][0]} não está disponível nesta conta.`);
    const names = kind === "properties" ? PROPERTY_FIELDS : kind === "purchases" ? PURCHASE_FIELDS : kind === "rents" ? RENT_FIELDS : CONTRACT_FIELDS;
    const columns = requiredColumns(await repository.getColumns(SITE, resolved.id, signal ? { signal } : {}), names, LISTS[kind][0]);
    abortIfNeeded(signal);
    const query = new URLSearchParams({ $expand: "fields", $top: "100" }).toString();
    const items = [], ids = new Set(), cursors = new Set();
    let cursor = "";
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      abortIfNeeded(signal);
      const page = await repository.getItemsPage(SITE, resolved.id, query, {
        ...(signal ? { signal } : {}), pageNumber, maxPages: MAX_PAGES,
        headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" }, ...(cursor ? { cursor } : {}),
      });
      abortIfNeeded(signal);
      if (!Array.isArray(page?.items) || typeof page.hasMore !== "boolean") throw new Error("O SharePoint retornou uma página de itens inválida.");
      for (const item of page.items) {
        const id = String(item?.id ?? "");
        if (!/^[1-9]\d{0,15}$/.test(id) || ids.has(id)) throw new Error(`ID inválido ou repetido em ${LISTS[kind][0]}; totais não exibidos.`);
        ids.add(id); items.push(item);
      }
      if (!page.hasMore) return { items, columns };
      if (!page.nextLink || cursors.has(page.nextLink)) throw new Error("A paginação do relatório não informou uma próxima página válida.");
      cursors.add(page.nextLink); cursor = page.nextLink;
    }
    throw new Error("A lista excedeu o limite seguro de paginação; os totais não foram exibidos parcialmente.");
  }

  async function loadReport(number, { signal, filters } = {}) {
    abortIfNeeded(signal);
    if (number === 16) {
      const [source, purchaseSet] = await Promise.all([loadList("properties", signal), loadList("purchases", signal)]);
      abortIfNeeded(signal);
      const purchases = new Map();
      for (const item of purchaseSet.items) {
        const branch = valueFor(item, purchaseSet.columns, "FILIAL"), property = valueFor(item, purchaseSet.columns, "IMOVEL");
        const key = JSON.stringify([branch, property]);
        if (!purchases.has(key)) purchases.set(key, []);
        purchases.get(key).push({ id: String(item.id), buyer: valueFor(item, purchaseSet.columns, "NOME") });
      }
      const rows = source.items.map(item => propertyRow(item, source.columns))
        .filter(row => row.branch && row.property && status(row.property) !== "TODOS" && !status(row.property).startsWith("ESCRITORIO"))
        .map(row => ({ ...row, contracts: purchases.get(JSON.stringify([row.branch, row.property])) || [] }))
        .sort((a, b) => a.branch.localeCompare(b.branch, "pt-BR") || a.property.localeCompare(b.property, "pt-BR"));
      return selectCommercialDocsReport(rows, filters);
    }
    if (number === 17) {
      const [rentSet, contractSet] = await Promise.all([loadList("rents", signal), loadList("contracts", signal)]);
      abortIfNeeded(signal);
      const contracts = contractSet.items.map(item => {
        const get = name => valueFor(item, contractSet.columns, name);
        const adjustmentDate = get("DATA REAJUSTE"), expiryDate = get("DATA VENCIMENTO");
        if ((adjustmentDate && !dateKey(adjustmentDate)) || (expiryDate && !dateKey(expiryDate))) throw new Error(`Data de reajuste ou vencimento inválida no contrato ${item.id}.`);
        return { id: String(item.id), property: get("DESCRICAOIMOVEL"), tenant: get("INQUILINO"),
          paymentMethod: get("FORMA DE PGTO"), status: get("STATUS"), amountCents: moneyCents(get("VALOR"), item.id),
          adjustmentDate: dateKey(adjustmentDate), expiryDate: dateKey(expiryDate), index: get("INDEX") };
      });
      const contractsById = new Map(contracts.map(row => [row.id, row]));
      const current = today();
      const todayValue = current instanceof Date ? `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}` : dateKey(current);
      if (!dateKey(todayValue)) throw new Error("A data atual não é válida para calcular os vencimentos.");
      const sourceRows = rentSet.items.map(item => {
        const get = name => valueFor(item, rentSet.columns, name);
        const contractId = get("NUM. CONTRATO ALUGUEL");
        if (!/^[1-9]\d*$/.test(contractId) || !contractsById.has(contractId)) throw new Error(`O contrato do lançamento ${item.id} não foi encontrado; total não exibido.`);
        const dueDate = dateKey(get("DATA VENCIMENTO"));
        if (!dueDate) throw new Error(`O vencimento do lançamento ${item.id} está ausente ou inválido.`);
        const property = get("DESCRICAO"), tenant = get("INQUILINO");
        if (!property || !tenant) throw new Error(`O imóvel ou inquilino do lançamento ${item.id} está ausente.`);
        const paidRaw = get("DATAPGTOEFETUADO"), paidDate = dateKey(paidRaw);
        if (paidRaw && !paidDate) throw new Error(`Data de pagamento inválida no lançamento ${item.id}.`);
        return { id: String(item.id), property, tenant, dueDate, paidDate, paymentMethod: get("FORMA PGTO"),
          status: contractsById.get(contractId).status, contractId, grossValue: get("VALOR BRUTO") };
      });
      return selectRentDashboard({ sourceRows, contracts, todayKey: todayValue }, filters);
    }
    throw new RangeError("Selecione o relatório 16 ou 17.");
  }

  return Object.freeze({ loadReport });
}
