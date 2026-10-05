import Decimal from "decimal.js";
import { provisionDateKey, provisionDayOffset } from "./pending-provision-dates.js";

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
  for (const alias of aliases) {
    const wanted = key(alias);
    const column = columns.find(entry => key(entry?.displayName) === wanted || key(entry?.name) === wanted);
    if (column && fields[column.name] != null) return fields[column.name];
    const direct = Object.entries(fields).find(([name, value]) => key(name) === wanted && value != null);
    if (direct) return direct[1];
  }
  return undefined;
}

function amount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = scalar(value).replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!/^-?[\d.,]+$/.test(raw)) return null;
  const comma = raw.lastIndexOf(","), dot = raw.lastIndexOf(".");
  const normalized = comma > dot ? raw.replaceAll(".", "").replace(",", ".")
    : dot > comma && comma >= 0 ? raw.replaceAll(",", "") : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function finiteTotal(value) {
  const number = value.toNumber();
  return Number.isFinite(number) ? number : null;
}

function dateISO(value) {
  const raw = scalar(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || /^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return provisionDateKey(raw);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return "";
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function normalizeProvisionReportRow(item, columns = []) {
  const read = (...aliases) => valueFor(item, columns, aliases);
  const get = (...aliases) => scalar(read(...aliases));
  const rawPrice = read("VALOR TOTAL", "VALORTOTAL");
  const price = scalar(rawPrice) === "" ? 0 : amount(rawPrice);
  const rawQuantity = read("QTD", "QUANTIDADE"), rawFreight = read("FRETE");
  // The report's PowerFx formula defaults QTD to zero; other provision screens default it to one.
  const quantity = scalar(rawQuantity) === "" ? 0 : amount(rawQuantity);
  const freight = scalar(rawFreight) === "" ? 0 : amount(rawFreight);
  const rawSchedule = read("PGTOAGENDADO", "PGTO AGENDADO");
  return Object.freeze({
    id: scalar(item?.id ?? read("ID")), recurrenceId: get("IDRECORRENCIA", "ID RECORRENCIA"),
    branch: get("FILIAL", "Title"), supplier: get("FORNECEDOR"), product: get("PRODUTO", "DESCRICAOPGTO"),
    observation: get("OBS", "OBSERVAÇÃO", "OBSERVACAO"), property: get("IMOVEL", "IMÓVEL"),
    dueDate: provisionDateKey(get("DATA PREVISTO PGTO", "DATAPGTOPREVISTO")),
    paidDate: provisionDateKey(get("DATA PGTO EFETUADO", "DATAPGTOEFETUADO")),
    schedule: typeof rawSchedule === "boolean" ? (rawSchedule ? "AGENDADO" : "PENDENTE") : scalar(rawSchedule),
    scheduledDate: provisionDateKey(get("DATAPGTOAGENDADO", "DATA PGTO AGENDADO")),
    executionDate: provisionDateKey(get("DATAEXECUCAOAGENDAMENTO", "DATA EXECUÇÃO AGENDAMENTO")),
    status: get("STATUS"),
    total: price == null || quantity == null || freight == null ? null
      : finiteTotal(new Decimal(price).times(quantity).plus(freight)),
  });
}

export function normalizeProvisionReportRecurrence(item, columns = []) {
  const get = (...aliases) => scalar(valueFor(item, columns, aliases));
  return Object.freeze({
    id: scalar(item?.id ?? get("ID")), branch: get("FILIAL"), supplier: get("FORNECEDOR"),
    product: get("EQUIPAMENTO", "PRODUTO"), property: get("IMOVEL", "IMÓVEL"), status: get("STATUS"),
    startDate: provisionDateKey(get("DATAINICIO", "DATA INÍCIO")),
    modified: dateISO(get("Modificado", "Modified") || item?.lastModifiedDateTime),
  });
}

const equals = (left, right) => scalar(left).toLocaleLowerCase("pt-BR") === scalar(right).toLocaleLowerCase("pt-BR");
const unpaid = row => !scalar(row.paidDate);
const byDueDate = (left, right) => (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31")
  || scalar(left.id).localeCompare(scalar(right.id), "pt-BR", { numeric: true });
const monthOf = value => Number(String(value || "").slice(5, 7));

function matches(row, filters) {
  return ["branch", "supplier", "product"].every(field => !scalar(filters[field]) || equals(row[field], filters[field]));
}

function completeSum(rows) {
  return rows.every(row => Number.isFinite(row.total))
    ? finiteTotal(rows.reduce((sum, row) => sum.plus(row.total), new Decimal(0))) : null;
}

function nextDate(maxDueDate) {
  const [year, month, day] = maxDueDate.split("-").map(Number);
  // PowerFx DateAdd by months clamps at the end of the target month before subtracting days.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const nextMonth = new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
  return provisionDayOffset(nextMonth, -31);
}

function annualGroup(rows, recurrence, inactivePending) {
  const pending = rows.filter(unpaid), paid = rows.filter(row => !unpaid(row));
  const startDate = recurrence.startDate || "";
  const maxDueDate = rows.map(row => row.dueDate).filter(Boolean).sort().at(-1);
  const markerMonth = pending.length === 0 && maxDueDate ? monthOf(maxDueDate) % 12 + 1 : 0;
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return Object.freeze({ month,
      paid: Object.freeze(paid.filter(row => monthOf(row.paidDate) === month)),
      pending: Object.freeze(pending.filter(row => monthOf(row.dueDate) === month)),
      ...(monthOf(startDate) === month ? { startDate } : {}),
      ...(markerMonth === month ? { nextDate: nextDate(maxDueDate) } : {}),
    });
  });
  return Object.freeze({ recurrenceId: scalar(rows[0].recurrenceId), supplier: rows[0].supplier,
    property: rows[0].property, inactivePending, startDate, months: Object.freeze(months), paidTotal: completeSum(paid) });
}

/** Build the three independently filtered sections from normalized, untruncated arrays. */
export function buildProvisionReport(snapshot, filters = {}, today = provisionDateKey(new Date())) {
  const provisions = snapshot?.provisions || [], recurrences = snapshot?.recurrences || [];
  const base = provisions.filter(row => matches(row, filters));
  const rows = base.filter(row => !scalar(filters.paymentStatus) || equals(row.status, filters.paymentStatus)).sort(byDueDate);
  const pending = rows.filter(unpaid);
  const byId = new Map(recurrences.map(row => [scalar(row.id), row]));
  // Inactive inclusion and badges inspect all provisions, independently of every report filter.
  const unpaidIds = new Set(provisions.filter(unpaid).map(row => scalar(row.recurrenceId)).filter(Boolean));
  const recurrenceStatus = scalar(filters.recurrenceStatus).toUpperCase();
  const groups = new Map();
  for (const row of base) {
    const id = scalar(row.recurrenceId), linked = byId.get(id);
    if (!id || !linked) continue;
    const status = scalar(linked.status).toUpperCase();
    const inactivePending = status === "INATIVO" && unpaidIds.has(id);
    const include = !recurrenceStatus || recurrenceStatus === "ATIVO"
      ? status === "ATIVO" || inactivePending : status === recurrenceStatus;
    if (!include) continue;
    const groupKey = JSON.stringify([id, row.supplier, row.property]);
    if (!groups.has(groupKey)) groups.set(groupKey, { rows: [], recurrence: linked, inactivePending });
    groups.get(groupKey).rows.push(row);
  }
  const annual = [...groups.values()].map(group => {
    const sorted = [...group.rows].sort(byDueDate);
    const priority = sorted.find(row => unpaid(row) && row.dueDate)?.dueDate || "9999-12-31";
    return { priority, value: annualGroup(sorted, group.recurrence, group.inactivePending) };
  }).sort((left, right) => left.priority.localeCompare(right.priority)).map(group => group.value);

  const inactive = recurrences.filter(row => matches(row, filters) && equals(row.status, "INATIVO"));
  const cutoff = provisionDayOffset(today, -30);
  // Today() in the spec is midnight in the app's Brazilian calendar, not UTC midnight.
  const inactiveRecent = inactive.filter(row => {
    const modifiedDay = provisionDateKey(row.modified);
    return cutoff && modifiedDay && modifiedDay >= cutoff;
  }).sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  return Object.freeze({ rows: Object.freeze(rows), pendingTotal: completeSum(pending), pendingCount: pending.length,
    annual: Object.freeze(annual), annualCount: new Set(annual.map(group => group.recurrenceId)).size,
    inactiveRecent: Object.freeze(inactiveRecent), inactiveCount: inactive.length,
    incompleteCount: rows.filter(row => !Number.isFinite(row.total)).length });
}
