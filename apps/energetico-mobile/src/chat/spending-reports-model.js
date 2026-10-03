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
    paymentDate: dateOnly(get("DATA PGTO EFETUADO", "DATAPGTOEFETUADO")),
    supplier: get("FORNECEDOR", "field_5"), product: get("PRODUTO", "field_7"),
    branch: get("FILIAL", "Title"), disbursement: get("GERADESEMBOLSO", "GERA DESEMBOLSO"),
    order: get("AGRUPAR"), stage: get("ETAPA", "field_6"), account: get("CONTA", "field_14"),
    description: get("DESCRIÇÃO", "DESCRICAO", "field_16"),
    unit, quantity, freight: freight ?? 0,
    total: unit == null || quantity == null ? null : unit * quantity + (freight ?? 0),
  });
}

export function normalizeSpendingProduct(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  return Object.freeze({ product: get("PRODUTO"), expenseType: get("TIPODESPESA", "TIPO DE DESPESA") });
}

const equals = (left, right) => scalar(left).toLocaleLowerCase("pt-BR") === scalar(right).toLocaleLowerCase("pt-BR");
const completeSum = (rows, field) => rows.every(row => Number.isFinite(row[field]))
  ? rows.reduce((sum, row) => sum + row[field], 0) : null;
const percentage = (part, whole) => part == null || whole == null ? null : whole === 0 ? 0 : part / whole * 100;
const byValue = (left, right) => (right.total ?? -Infinity) - (left.total ?? -Infinity)
  || left.name.localeCompare(right.name, "pt-BR");

function selectedRows(launches, filters, reportNumber) {
  return (launches || []).filter(row => {
    for (const field of ["supplier", "product", "branch", "disbursement"]) {
      if (filters[field] && !equals(row[field], filters[field])) return false;
    }
    if (filters.order && !(equals(row.order, filters.order)
      || Number.isFinite(Number(row.order)) && Number(row.order) === Number(filters.order))) return false;
    if (reportNumber === 9) {
      if (!row.date || row.date < "1900-01-01" || row.date >= "2100-01-01") return false;
      if (filters.year && row.date.slice(0, 4) !== String(filters.year)) return false;
      if (filters.year && filters.month && Number(row.date.slice(5, 7)) !== Number(filters.month)) return false;
    } else {
      if (filters.startDate && (!row.date || row.date < filters.startDate)) return false;
      if (filters.endDate && (!row.date || row.date > filters.endDate)) return false;
    }
    return true;
  });
}

function grouped(rows, field, whole, limit = Infinity) {
  const groups = new Map();
  for (const row of rows) {
    const name = scalar(row[field]) || "-";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups].map(([name, values]) => {
    const total = completeSum(values, "total");
    return Object.freeze({ name, count: values.length, quantity: completeSum(values, "quantity"), total,
      percentage: percentage(total, whole) });
  }).sort(byValue).slice(0, limit);
}

export function buildSpendingReport9(snapshot, filters = {}) {
  const rows = selectedRows(snapshot?.launches, filters, 9);
  const total = completeSum(rows, "total");
  const productTypes = new Map();
  for (const row of snapshot?.productTypes || []) {
    const product = scalar(row.product).toLocaleLowerCase("pt-BR");
    if (product && !productTypes.has(product)) productTypes.set(product, scalar(row.expenseType));
  }
  const byBranch = new Map();
  for (const row of rows) {
    const name = scalar(row.branch) || "-";
    if (!byBranch.has(name)) byBranch.set(name, []);
    byBranch.get(name).push(row);
  }
  const branches = [...byBranch].map(([name, values]) => {
    const branchTotal = completeSum(values, "total");
    const classified = values.map(row => ({ ...row, expenseType: !row.product ? "SEM PRODUTO"
      : productTypes.get(row.product.toLocaleLowerCase("pt-BR")) || "SEM TIPO DE DESPESA" }));
    return Object.freeze({ name, count: values.length, quantity: completeSum(values, "quantity"),
      total: branchTotal, percentage: percentage(branchTotal, total),
      expenseTypes: grouped(classified, "expenseType", branchTotal),
      products: grouped(values, "product", total, 15), stages: grouped(values, "stage", total, 15),
      suppliers: grouped(values, "supplier", total, 15), accounts: grouped(values, "account", total),
    });
  }).sort(byValue);
  return Object.freeze({ count: rows.length, total, incompleteCount: rows.filter(row => !Number.isFinite(row.total)).length,
    branches: Object.freeze(branches) });
}

export function buildSpendingReport10(snapshot, filters = {}) {
  const rows = selectedRows(snapshot?.launches, filters, 10);
  const unitValues = rows.map(row => row.unit).filter(Number.isFinite);
  const completeUnits = unitValues.length === rows.length;
  const dates = new Map();
  for (const row of rows) {
    const date = row.paymentDate || "";
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date).push(row);
  }
  const days = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
    const suppliers = new Map();
    for (const row of values) {
      const name = scalar(row.supplier) || "-";
      if (!suppliers.has(name)) suppliers.set(name, []);
      suppliers.get(name).push(row);
    }
    return Object.freeze({ date, count: values.length, total: completeSum(values, "total"),
      suppliers: Object.freeze([...suppliers].sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
        .map(([name, supplierRows]) => Object.freeze({ name, total: completeSum(supplierRows, "total"),
          rows: Object.freeze([...supplierRows].sort((a, b) => a.branch.localeCompare(b.branch, "pt-BR")
            || a.account.localeCompare(b.account, "pt-BR") || b.id.localeCompare(a.id, "pt-BR", { numeric: true }))) }))),
    });
  });
  return Object.freeze({ count: rows.length, total: completeSum(rows, "total"), quantity: completeSum(rows, "quantity"),
    supplierCount: new Set(rows.map(row => row.supplier).filter(Boolean)).size,
    productCount: new Set(rows.map(row => row.product).filter(Boolean)).size,
    unitMin: completeUnits ? unitValues.length ? Math.min(...unitValues) : 0 : null,
    unitAverage: completeUnits ? unitValues.length ? unitValues.reduce((sum, value) => sum + value, 0) / unitValues.length : 0 : null,
    unitMax: completeUnits ? unitValues.length ? Math.max(...unitValues) : 0 : null,
    incompleteCount: rows.filter(row => !Number.isFinite(row.total)).length, days: Object.freeze(days) });
}
