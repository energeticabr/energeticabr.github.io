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
  let normalized = raw;
  if (comma > dot) normalized = raw.replaceAll(".", "").replace(",", ".");
  else if (dot > comma && comma >= 0) normalized = raw.replaceAll(",", "");
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

function canonicalId(value) {
  const raw = scalar(value);
  return /^\d+$/.test(raw) ? BigInt(raw).toString() : raw;
}

function equals(left, right) {
  return scalar(left).toLocaleLowerCase("pt-BR") === scalar(right).toLocaleLowerCase("pt-BR");
}

function sortIdsDescending(left, right) {
  const a = String(left ?? ""); const b = String(right ?? "");
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a); const y = BigInt(b);
    return x === y ? 0 : x > y ? -1 : 1;
  }
  return b.localeCompare(a, "pt-BR", { numeric: true });
}

export function normalizePresencePaymentRow(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  return Object.freeze({
    id: scalar(item?.id || get("ID")), paymentId: canonicalId(get("IDPGTO", "ID PGTO")),
    date: dateOnly(get("DATA")), branch: get("FILIAL"), property: get("IMOVEL", "IMÓVEL"),
    supplier: get("FORNECEDOR"), stage: get("ETAPA"), activity: get("ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"),
    presence: get("PRESENCA", "PRESENÇA"), dailyValue: amount(get("VLORDIARIO", "VALOR DIÁRIO", "VALOR DIARIO")),
    observation: get("OBS", "OBSERVAÇÃO", "OBSERVACAO"), motivation: get("MOTIVACAO", "MOTIVAÇÃO"),
  });
}

export function normalizePaymentLaunchRow(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  const unit = amount(get("VALOR UNITÁRIO", "VALORUNITARIO", "field_9"));
  const quantity = amount(get("QUANTIDADE", "field_8"));
  const freight = amount(get("FRETE", "field_10"));
  return Object.freeze({
    id: canonicalId(item?.id || get("ID")), order: get("AGRUPAR"), date: dateOnly(get("DATA", "field_2")),
    supplier: get("FORNECEDOR", "field_5"), branch: get("FILIAL", "Title"), stage: get("ETAPA", "field_6"),
    description: get("DESCRIÇÃO", "DESCRICAO", "field_16"), product: get("PRODUTO", "field_7"), account: get("CONTA", "field_14"),
    total: unit == null || quantity == null ? null : unit * quantity + (freight || 0),
  });
}

export function normalizeSupplierStatusRow(item, columns = []) {
  const get = (...aliases) => valueFor(item, columns, aliases);
  return Object.freeze({ name: get("CADASTRO"), status: get("STATUS") });
}

export function buildPresencePaymentReport(snapshot, filters = {}) {
  const statuses = new Map(Object.entries(snapshot?.supplierStatusByName || {}).map(([name, status]) => [name.trim().toLocaleLowerCase("pt-BR"), status]));
  const launches = snapshot?.launchesById || {};
  const selected = (snapshot?.presences || []).filter(row => {
    if (!scalar(row.paymentId)) return false;
    if (filters.startDate && (!row.date || row.date < filters.startDate)) return false;
    if (filters.endDate && (!row.date || row.date > filters.endDate)) return false;
    for (const [filter, field] of [["branch", "branch"], ["property", "property"], ["supplier", "supplier"], ["stage", "stage"]]) {
      if (filters[filter] && !equals(row[field], filters[filter])) return false;
    }
    const status = statuses.get(scalar(row.supplier).toLocaleLowerCase("pt-BR")) || "";
    return !filters.status || equals(status, filters.status);
  });

  const byPayment = new Map();
  for (const row of selected) {
    const id = canonicalId(row.paymentId);
    if (!byPayment.has(id)) byPayment.set(id, []);
    byPayment.get(id).push(row);
  }

  const byOrder = new Map();
  for (const [paymentId, rows] of byPayment) {
    const launch = launches[paymentId] || null;
    const order = scalar(launch?.order) || "SEM PEDIDO";
    const orderKey = launch?.order ? `PEDIDO:${order}` : `SEM:${paymentId}`;
    const valuesComplete = rows.every(row => Number.isFinite(row.dailyValue));
    const partialPresencesTotal = rows.reduce((sum, row) => sum + (Number.isFinite(row.dailyValue) ? row.dailyValue : 0), 0);
    const presencesTotal = valuesComplete ? partialPresencesTotal : null;
    const launchTotal = Number.isFinite(launch?.total) ? launch.total : null;
    const difference = presencesTotal == null || launchTotal == null ? null : launchTotal - presencesTotal;
    const presences = rows.map(row => Object.freeze({ ...row,
      supplierStatus: statuses.get(scalar(row.supplier).toLocaleLowerCase("pt-BR")) || "",
      supplierMismatch: Boolean(launch?.supplier && row.supplier && !equals(launch.supplier, row.supplier)),
    })).sort((a, b) => a.date.localeCompare(b.date) || sortIdsDescending(b.id, a.id));
    const dates = presences.map(row => row.date).filter(Boolean);
    const group = Object.freeze({ paymentId, launch, order, count: rows.length,
      firstDate: dates[0] || "", lastDate: dates.at(-1) || "", presencesTotal, partialPresencesTotal, launchTotal, difference,
      balanced: difference != null && Math.round(difference * 100) === 0,
      presences: Object.freeze(presences),
    });
    if (!byOrder.has(orderKey)) byOrder.set(orderKey, { key: orderKey, order, groups: [] });
    byOrder.get(orderKey).groups.push(group);
  }

  const orders = [...byOrder.values()].map(value => {
    value.groups.sort((a, b) => sortIdsDescending(a.paymentId, b.paymentId));
    const complete = value.groups.every(group => group.launchTotal != null);
    return Object.freeze({ key: value.key, order: value.order,
      totalValue: complete ? value.groups.reduce((sum, group) => sum + group.launchTotal, 0) : null,
      groups: Object.freeze(value.groups), maxPaymentId: value.groups[0]?.paymentId || "",
    });
  }).sort((a, b) => {
    const missingA = a.key.startsWith("SEM:"); const missingB = b.key.startsWith("SEM:");
    if (missingA !== missingB) return missingA ? 1 : -1;
    return missingA ? sortIdsDescending(a.maxPaymentId, b.maxPaymentId)
      : sortIdsDescending(a.order, b.order) || sortIdsDescending(a.maxPaymentId, b.maxPaymentId);
  });
  const complete = selected.every(row => Number.isFinite(row.dailyValue));
  const partialDaily = selected.reduce((sum, row) => sum + (Number.isFinite(row.dailyValue) ? row.dailyValue : 0), 0);
  return Object.freeze({
    metrics: Object.freeze({ paymentIds: byPayment.size, presences: selected.length,
      totalDaily: complete ? partialDaily : null, partialDaily, complete }),
    orders: Object.freeze(orders),
  });
}
