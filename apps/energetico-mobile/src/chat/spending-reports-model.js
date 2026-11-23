import { provisionDateKey, provisionTotal, provisionNumericValue } from "./pending-provision-dates.js";
import Decimal from 'decimal.js';

function key(value) {
  return String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function scalar(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "Title", "title", "LookupId"]) {
      if (value[name] != null) return scalar(value[name]);
    }
    return "";
  }
  return String(value).trim();
}

function valueFor(item, columns, aliases) {
  const fields = item?.fields || {};
  const wanted = new Set(aliases.map(key));
  const column = (columns || []).find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  if (column && fields[column.name] != null) return scalar(fields[column.name]);
  const direct = Object.entries(fields).find(([name, value]) => wanted.has(key(name)) && value != null);
  return direct ? scalar(direct[1]) : "";
}

function amount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = scalar(value).replace(/[^\d.,-]/g, "");
  if (!raw || raw === "-") return null;
  const comma = raw.lastIndexOf(","); const dot = raw.lastIndexOf(".");
  const normalized = comma > dot ? raw.replaceAll(".", "").replace(",", ".")
    : dot > comma && comma >= 0 ? raw.replaceAll(",", "") : raw;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function dateOnly(value) {
  const raw = scalar(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}

export function normalizeSpendingLaunch(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  const unit = amount(get("VALOR UNITÁRIO", "VALORUNITARIO", "field_9"));
  const quantity = amount(get("QUANTIDADE", "field_8"));
  const freight = amount(get("FRETE", "field_10"));
  return Object.freeze({
    id: scalar(item?.id || get("ID")), date: dateOnly(get("DATA", "field_2")),
    paymentDate: dateOnly(get("DATA PGTO EFETUADO", "DATAPGTOEFETUADO", "field_4")),
    expectedPaymentDate: dateOnly(get("DATA PGTO PREVISTO", "DATAPGTOPREVISTO", "DATAPREVISTOPGTO", "field_3")),
    supplier: get("FORNECEDOR", "field_5"), product: get("PRODUTO", "field_7"),
    branch: get("FILIAL", "Title"), disbursement: get("GERADESEMBOLSO", "GERA DESEMBOLSO"),
    order: get("AGRUPAR"), stage: get("ETAPA", "field_6"), account: get("CONTA", "field_14"),
    description: get("DESCRIÇÃO", "DESCRICAO", "field_16"),
    unit, quantity, freight: freight ?? 0,
    total: unit == null || quantity == null ? null : new Decimal(unit).times(quantity).plus(freight ?? 0).toNumber(),
  });
}

export function normalizeSpendingProduct(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  return Object.freeze({ product: get("PRODUTO"), expenseType: get("TIPODESPESA", "TIPO DE DESPESA"),
    disbursement: normalizeDisbursement(get("GERADESEMBOLSO")) });
}

export function normalizeSpendingRecurrence(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  return Object.freeze({ id: scalar(item?.id || get("ID")), status: get("STATUS"),
    branch: get("FILIAL"), supplier: get("FORNECEDOR"), product: get("EQUIPAMENTO", "PRODUTO") });
}

export function normalizeSpendingProvision(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  const fields = item?.fields || {};
  const scheduleKey = (columns || []).find(column => key(column?.name) === "PGTOAGENDADO"
    || key(column?.displayName) === "PGTOAGENDADO")?.name
    || Object.keys(fields).find(name => key(name) === "PGTOAGENDADO");
  const rawSchedule = scheduleKey ? fields[scheduleKey] : undefined;
  const price = get("VALOR TOTAL", "VALORTOTAL");
  const total = amount(price);
  const due = scalar(fields.DATAPREVISTOPGTO) || get("DATA PREVISTO PGTO") || get("DATAPGTOPREVISTO");
  // The payroll workflow serializes a calendar date as midnight UTC.
  const dueDate = provisionDateKey(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?Z$/i.test(due) ? due.slice(0, 10) : due);
  return Object.freeze({ id: scalar(item?.id || get("ID")), recurrenceId: get("IDRECORRENCIA"),
    branch: get("FILIAL"), supplier: get("FORNECEDOR"), product: get("PRODUTO", "DESCRICAOPGTO"),
    dueDate,
    scheduledDate: provisionDateKey(get("DATAPGTOAGENDADO", "DATA EXECUÇÃO AGENDAMENTO", "DATAEXECUCAOAGENDAMENTO")),
    paidDate: provisionDateKey(get("DATA PGTO EFETUADO", "DATAPGTOEFETUADO")),
    schedule: typeof rawSchedule === "boolean" ? (rawSchedule ? "AGENDADO" : "PENDENTE") : get("PGTOAGENDADO"),
    status: get("STATUS"), total });
}

function normalizeDisbursement(value) {
  if (value === "true") return "SIM";
  if (value === "false") return "NÃO";
  return value;
}

export function normalizeManagementProvision(item, columns) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  const provision = normalizeSpendingProvision(item, columns);
  const total = provisionTotal(get("VALORTOTAL"), get("QTD", "QUANTIDADE"), get("FRETE"));
  const numeric = value => { const number = provisionNumericValue(value); return Number.isFinite(number) ? number : null; };
  const quantity = get("QTD", "QUANTIDADE"), freight = get("FRETE");
  return Object.freeze({ ...provision, branch: provision.branch || get("Title"), stage: get("ETAPA"),
    disbursement: normalizeDisbursement(get("GERADESEMBOLSO")), order: get("IDPEDIDO"),
    date: dateOnly(get("DATA")), unit: numeric(get("VALORTOTAL")),
    quantity: quantity === "" ? 1 : numeric(quantity), freight: freight === "" ? 0 : numeric(freight),
    total: Number.isFinite(total) ? total : null });
}

const equals = (left, right) => scalar(left).toLocaleLowerCase("pt-BR") === scalar(right).toLocaleLowerCase("pt-BR");
const completeSum = (rows, field, formatValue = value => value) => rows.every(row => Number.isFinite(row[field]))
  ? rows.reduce((sum, row) => sum.plus(formatValue(row[field])), new Decimal(0)).toNumber() : null;
const percentage = (part, whole) => part == null || whole == null ? null : whole === 0 ? 0 : part / whole * 100;
const byValue = (left, right) => (right.total ?? -Infinity) - (left.total ?? -Infinity)
  || left.name.localeCompare(right.name, "pt-BR");

function selectedRows(launches, filters, periodDate = row => row.date) {
  return (launches || []).filter(row => {
    for (const field of ["supplier", "product", "branch", "disbursement", "stage"]) {
      if (filters[field] && !equals(row[field], filters[field])) return false;
    }
    if (filters.order && !(equals(row.order, filters.order)
      || Number.isFinite(Number(row.order)) && Number(row.order) === Number(filters.order))) return false;
    const date = periodDate(row);
    if (!date || date < "1900-01-01" || date >= "2100-01-01") return false;
    if (filters.year && date.slice(0, 4) !== String(filters.year)) return false;
    if (filters.year && filters.month && Number(date.slice(5, 7)) !== Number(filters.month)) return false;
    return true;
  });
}

function groupRows(rows, nameOf, keyOf = name => name) {
  const groups = new Map();
  for (const row of rows) {
    const name = scalar(nameOf(row)) || "-";
    const groupKey = keyOf(name);
    if (!groups.has(groupKey)) groups.set(groupKey, [name, []]);
    groups.get(groupKey)[1].push(row);
  }
  return [...groups.values()];
}

function grouped(rows, field, whole, limit = Infinity) {
  return groupRows(rows, row => row[field]).map(([name, values]) => {
    const total = completeSum(values, "total");
    return Object.freeze({ name, count: values.length, quantity: completeSum(values, "quantity"), total,
      percentage: percentage(total, whole), rows: Object.freeze(values) });
  }).sort(byValue).slice(0, limit);
}

function paymentAmounts(rows) {
  return {
    paid: completeSum(rows.filter(row => row.paymentDate), "total"),
    forecast: completeSum(rows.filter(row => !row.paymentDate), "total"),
  };
}

const roundCurrency = amount => amount == null ? null : new Decimal(amount).toDecimalPlaces(2).toNumber();
const roundPaymentAmounts = ({ paid, forecast }) => ({ paid: roundCurrency(paid), forecast: roundCurrency(forecast) });

function withPaymentTotal({ paid, forecast }) {
  return { paid, forecast, total: completeSum([{ total: paid }, { total: forecast }], "total") };
}

function paymentTotals(rows) {
  return withPaymentTotal(roundPaymentAmounts(paymentAmounts(rows)));
}

function expenseProducts(items, expenseTotals, branchTotal) {
  const raw = groupRows(items, row => scalar(row.product) || "SEM PRODUTO", name => name.toLocaleLowerCase("pt-BR"))
    .map(([name, rows]) => ({ name, ...paymentAmounts(rows) }));
  const products = raw.map(product => ({ name: product.name, ...roundPaymentAmounts(product) }));
  // Preserve the existing subtotal. When products round in the same direction,
  // assign the difference to those with the largest remainder in the other direction.
  for (const field of ["paid", "forecast"]) {
    if (expenseTotals[field] == null) continue;
    const correction = new Decimal(expenseTotals[field]).minus(completeSum(products, field)).times(100).toNumber();
    if (!correction) continue;
    const direction = Math.sign(correction);
    const residuals = products.map((product, index) => ({
      product, remainder: new Decimal(raw[index][field]).minus(product[field]),
    })).sort((a, b) => direction * b.remainder.cmp(a.remainder)
      || a.product.name.localeCompare(b.product.name, "pt-BR"));
    for (const { product } of residuals.slice(0, Math.abs(correction))) {
      product[field] = new Decimal(product[field]).plus(direction / 100).toNumber();
    }
  }
  return products.map(product => {
    const amounts = withPaymentTotal(product);
    return Object.freeze({ name: product.name, ...amounts, percentage: percentage(amounts.total, branchTotal) });
  }).sort(byValue);
}

function selectedExpenses(snapshot, filters) {
  const paidRows = selectedRows(snapshot?.launches, filters, row => row.paymentDate);
  const forecastRows = selectedRows(snapshot?.provisions, filters, row => row.dueDate)
    .filter(row => !row.paidDate && key(row.schedule) !== "PAGO" && key(row.status) !== "PAGAMENTOEFETUADO");
  return [...paidRows, ...forecastRows];
}

// The period picker must use the same paid/unpaid rules as the expense totals.
export function managementExpensePeriods(snapshot, filters = {}) {
  return [...new Set(selectedExpenses(snapshot, filters)
    .filter(row => row.total !== 0)
    .map(row => (row.paymentDate || row.dueDate).slice(0, 7)))].sort();
}

function expenseBranchesFor(rows, expenseType) {
  const nameKey = name => scalar(name).toLocaleLowerCase("pt-BR");
  return groupRows(rows, row => row.branch, nameKey).map(([name, values]) => {
    const totals = paymentTotals(values);
    const expenseTypes = groupRows(values, expenseType, nameKey).map(([name, items]) => {
      const amounts = paymentTotals(items);
      const products = expenseProducts(items, amounts, totals.total);
      return Object.freeze({ name, ...amounts, percentage: percentage(amounts.total, totals.total),
        products: Object.freeze(products) });
    }).sort(byValue);
    return Object.freeze({ name, ...totals, percentage: percentage(totals.total, totals.total),
      expenseTypes: Object.freeze(expenseTypes) });
  }).sort(byValue);
}

function monthChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : Math.sign(current) * Infinity;
  return new Decimal(current).minus(previous).div(new Decimal(previous).abs()).times(100).toNumber();
}

function compareExpenses(current, previous, level = 0) {
  const child = ["expenseTypes", "products"][level];
  const nameKey = name => scalar(name).toLocaleLowerCase("pt-BR");
  const old = new Map(previous.map(item => [nameKey(item.name), item]));
  const currentNames = new Set(current.map(item => nameKey(item.name)));
  const all = [...current, ...previous.filter(item => !currentNames.has(nameKey(item.name))).map(item => ({
    name: item.name, paid: 0, forecast: 0, total: 0, percentage: 0, ...(child ? { [child]: [] } : {}),
  }))];
  return all.map(item => {
    const prior = old.get(nameKey(item.name));
    const previousTotal = prior ? prior.total : 0;
    return Object.freeze({ ...item, previousTotal, change: monthChange(item.total, previousTotal),
      ...(child ? { [child]: Object.freeze(compareExpenses(item[child], prior?.[child] || [], level + 1)) } : {}),
    });
  }).filter(item => child || item.total !== 0 || item.previousTotal !== 0).sort(byValue);
}

const monthPeriod = (year, month) =>
  `${new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2020, Number(month) - 1, 1))}/${year}`;

function asYearMonth(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1]}-${match[2]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A data final da análise do produto é inválida.");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(year, month, offset) {
  const date = new Date(Number(year), Number(month) - 1 - offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildManagementProductPurchaseAnalytics(snapshot, { branch, product, matchesGroup, asOfDate }) {
  const endKey = asYearMonth(asOfDate);
  const [endYear, endMonth] = endKey.split("-");
  const keys = Array.from({ length: 12 }, (_, index) => previousMonthKey(endYear, endMonth, 11 - index));
  const monthly = new Map(keys.map(key => [key, []]));
  const launches = (snapshot?.launches || []).filter(row =>
    matchesGroup(scalar(row.branch) || "-", branch)
    && matchesGroup(scalar(row.product) || "-", product)
    && monthly.has(String(row.date || "").slice(0, 7)));
  for (const row of launches) monthly.get(row.date.slice(0, 7)).push(row);
  const months = keys.map(key => {
    const [year, month] = key.split("-");
    const rows = monthly.get(key);
    const monthDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const label = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthDate).replace(/\.$/, "");
    return Object.freeze({ key, label, period: monthPeriod(year, month),
      total: rows.length ? completeSum(rows, "total") : 0,
      quantity: rows.length ? completeSum(rows, "quantity") : 0,
      count: rows.length });
  });
  const suppliers = groupRows(launches, row => row.supplier).map(([name, rows]) => Object.freeze({
    name, total: completeSum(rows, "total"), quantity: completeSum(rows, "quantity"), count: rows.length,
  })).sort(byValue);
  return Object.freeze({ startPeriod: months[0].period, endPeriod: months.at(-1).period,
    months: Object.freeze(months), suppliers: Object.freeze(suppliers) });
}

function monthSection(rows, period, previous = false) {
  const subtotal = Object.freeze({
    quantity: completeSum(rows, "quantity"),
    // Add the cent values displayed in the detail rows.
    total: completeSum(rows, "total", roundCurrency),
  });
  return Object.freeze({ period, previous, rows: Object.freeze(rows), subtotal });
}

function detailMonths(rows, dateOf) {
  return groupRows(rows, row => dateOf(row).slice(0, 7))
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, monthRows]) => {
      const [year, month] = key.split("-");
      return monthSection(monthRows, monthPeriod(year, month));
    });
}

export function buildManagementRankingBreakdown(group, section) {
  return grouped(group.rows, section === "stages" ? "product" : "supplier", group.total);
}

export function buildManagementRankingLaunchMonths(rows) {
  const sorted = [...rows].sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date)
    || scalar(a.id).localeCompare(scalar(b.id), "pt-BR", { numeric: true }));
  return detailMonths(sorted, row => row.date);
}

export function buildManagementExpenseTypeDashboard(snapshot, filters = {},
  { branch, expenseType, now = new Date() } = {}) {
  const productTypes = new Map();
  for (const row of snapshot?.productTypes || []) {
    const product = scalar(row.product).toLocaleLowerCase("pt-BR");
    if (product && !productTypes.has(product)) productTypes.set(product, scalar(row.expenseType));
  }
  const typeFor = row => !row.product ? "SEM PRODUTO"
    : productTypes.get(scalar(row.product).toLocaleLowerCase("pt-BR")) || "SEM TIPO DE DESPESA";
  // This view analyzes the full selected type; the report's date and ranking filters
  // must not silently truncate the twelve-month trend or its category shares.
  const rows = selectedExpenses(snapshot, { ...filters, year: "", month: "", branch: "", product: "", supplier: "", stage: "", order: "" })
    .filter(row => equals(scalar(row.branch) || "-", branch) && equals(typeFor(row), expenseType));
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - 11 + index, 1);
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const monthRows = rows.filter(row => (row.paymentDate || row.dueDate || "").slice(0, 7) === period);
    const paid = completeSum(monthRows.filter(row => row.paymentDate), "total");
    const forecast = completeSum(monthRows.filter(row => !row.paymentDate), "total");
    return Object.freeze({ period, paid, forecast,
      total: paid == null || forecast == null ? null : new Decimal(paid).plus(forecast).toNumber() });
  });
  const inRange = new Set(months.map(item => item.period));
  const trendRows = rows.filter(row => inRange.has((row.paymentDate || row.dueDate || "").slice(0, 7)));
  const total = completeSum(trendRows, "total");
  const breakdown = field => Object.freeze(grouped(trendRows, field, total, 8).map(item => Object.freeze(item)));
  return Object.freeze({ branch, expenseType, total, months: Object.freeze(months),
    products: breakdown("product"), suppliers: breakdown("supplier"), stages: breakdown("stage") });
}

export function buildManagementProductDetail(snapshot, filters = {}, { branch, product, kind = "expense", asOfDate = new Date() } = {}) {
  const expense = kind === "expense";
  const matchesGroup = expense ? equals : (left,right) => scalar(left) === scalar(right);
  function detailRows(selected) {
    const source = expense ? selectedExpenses(snapshot, selected) : selectedRows(snapshot?.launches, selected);
    return source.filter(row => matchesGroup(scalar(row.branch) || "-", branch)
      && matchesGroup(scalar(row.product) || (expense ? "SEM PRODUTO" : "-"), product))
      .map(row => Object.freeze({
        id: row.id, date: row.date || "", paymentDate: row.paymentDate || row.paidDate || "",
        dueDate: row.dueDate || "", supplier: scalar(row.supplier),
        quantity: row.quantity ?? null, unit: row.unit ?? null, freight: row.freight ?? 0, total: row.total ?? null,
        source: row.paymentDate ? "paid" : expense ? "forecast" : "launch",
      })).sort((a,b) => (b.paymentDate || b.dueDate || b.date).localeCompare(a.paymentDate || a.dueDate || a.date)
        || String(a.id ?? "").localeCompare(String(b.id ?? ""), "pt-BR", { numeric:true }));
  }
  const rows = detailRows(filters);
  const sections = [];
  if (filters.year && filters.month) {
    sections.push(monthSection(rows, monthPeriod(filters.year, filters.month)));
    if (expense) {
      const month = Number(filters.month) === 1 ? 12 : Number(filters.month) - 1;
      const year = Number(filters.year) - (Number(filters.month) === 1 ? 1 : 0);
      const previous = detailRows({ ...filters, year: String(year), month: String(month) });
      if (previous.length) sections.push(monthSection(previous, monthPeriod(year, month), true));
    }
  } else if (rows.length) {
    const dateOf = expense ? row => row.paymentDate || row.dueDate : row => row.date;
    sections.push(...detailMonths(rows, dateOf));
  } else {
    const period = filters.year ? `Ano de ${filters.year}` : "Todos os períodos";
    sections.push(Object.freeze({ period, previous: false, rows: Object.freeze(rows), subtotal: null }));
  }
  const analytics = buildManagementProductPurchaseAnalytics(snapshot, { branch, product, matchesGroup, asOfDate });
  return Object.freeze({ product, branch, sections:Object.freeze(sections), analytics });
}

export function buildSpendingReport9(snapshot, filters = {}) {
  const rows = selectedRows(snapshot?.launches, filters);
  const expenseRows = selectedExpenses(snapshot, filters);
  const total = completeSum(rows, "total");
  const productTypes = new Map();
  for (const row of snapshot?.productTypes || []) {
    const product = scalar(row.product).toLocaleLowerCase("pt-BR");
    if (product && !productTypes.has(product)) productTypes.set(product, scalar(row.expenseType));
  }
  const branchName = row => row.branch;
  const branches = groupRows(rows, branchName).map(([name, values]) => {
    const branchTotal = completeSum(values, "total");
    return Object.freeze({ name, count: values.length, quantity: completeSum(values, "quantity"),
      total: branchTotal, percentage: percentage(branchTotal, total),
      products: grouped(values, "product", total, 15), stages: grouped(values, "stage", total, 15),
      suppliers: grouped(values, "supplier", total, 15), accounts: grouped(values, "account", total),
    });
  }).sort(byValue);
  const expenseType = row => !row.product ? "SEM PRODUTO"
    : productTypes.get(row.product.toLocaleLowerCase("pt-BR")) || "SEM TIPO DE DESPESA";
  let expenseBranches = expenseBranchesFor(expenseRows, expenseType);
  const summary = withPaymentTotal({ paid: completeSum(expenseBranches, "paid"),
    forecast: completeSum(expenseBranches, "forecast") });
  let comparisonPeriod = "", previousRows = [];
  if (filters.year && filters.month) {
    const previousMonth = Number(filters.month) === 1 ? 12 : Number(filters.month) - 1;
    const previousYear = Number(filters.month) === 1 ? Number(filters.year) - 1 : Number(filters.year);
    comparisonPeriod = monthPeriod(previousYear, previousMonth);
    previousRows = selectedExpenses(snapshot, { ...filters, year: String(previousYear), month: String(previousMonth) });
    const previousBranches = expenseBranchesFor(previousRows, expenseType);
    summary.previousTotal = completeSum(previousBranches, "total");
    summary.change = monthChange(summary.total, summary.previousTotal);
    expenseBranches = compareExpenses(expenseBranches, previousBranches);
  }
  const period = filters.year ? filters.month
    ? monthPeriod(filters.year, filters.month)
    : `Ano de ${filters.year}` : "Todos os períodos";
  const incompleteCount = new Set([...rows, ...expenseRows, ...previousRows].filter(row => !Number.isFinite(row.total))).size;
  return Object.freeze({ count: rows.length, total, summary: Object.freeze(summary), period, comparisonPeriod, incompleteCount,
    branches: Object.freeze(branches), expenseBranches: Object.freeze(expenseBranches) });
}

export function buildSpendingReport10(snapshot, filters = {}) {
  const recurrences = new Map((snapshot?.recurrences || []).map(row => [scalar(row.id), row]));
  const rows = (snapshot?.provisions || []).filter(row => {
    const linked = scalar(row.recurrenceId).split(/[,;\r\n]+/).map(id => id.trim()).filter(Boolean);
    const recurring = linked.map(id => recurrences.get(id)).find(item => item
      && (!filters.status || equals(item.status, filters.status)));
    if (!recurring) return false;
    if (filters.paymentStatus && !equals(row.status, filters.paymentStatus)) return false;
    for (const field of ["branch", "supplier", "product"]) {
      if (filters[field] && !equals(row[field] || recurring[field], filters[field])) return false;
    }
    return true;
  }).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
    || scalar(a.id).localeCompare(scalar(b.id), "pt-BR", { numeric: true }));
  return Object.freeze({ count: rows.length, total: completeSum(rows, "total"),
    incompleteCount: rows.filter(row => !Number.isFinite(row.total)).length, rows: Object.freeze(rows) });
}
