import Decimal from "decimal.js";

const Money = Decimal.clone({ precision: 40 });
const text = value => String(value ?? "").trim();
const key = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
const matches = (value, filter) => !text(filter) || key(filter) === "TODOS" || key(value) === key(filter);
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function dateFilter(value) {
  if (value == null || value === "") return "";
  const raw = text(value); const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : raw;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new RangeError("Data inválida no período ou registro do relatório.");
  }
  return iso;
}

function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Money(value);
}
function numeric(value) {
  const number = value.toNumber();
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : null;
}
function sum(rows, accessor = row => row.dailyValue) {
  let total = new Money(0);
  for (const row of rows) {
    const value = amount(accessor(row));
    if (value === null) return null;
    total = total.plus(value);
  }
  return numeric(total);
}
const add = (a, b) => a == null || b == null ? null : numeric(new Money(a).plus(b));
const ordered = (a, b) => a.date.localeCompare(b.date) || new Money(a.id).comparedTo(b.id);
const paymentId = value => {
  const raw = text(value);
  // Match PowerFx IfError(Value(IDPGTO); Blank()): descriptive legacy values
  // do not abort the report and must not become guessed payment identities.
  if (!/^\d+$/.test(raw) || new Money(raw).lte(0)) return "";
  return new Money(raw).toFixed(0);
};

function validateRows(rows, kind) {
  const ids = new Set();
  for (const row of rows) {
    const contractor = row?.contractor === true || key(row?.contractor) === "SIM";
    const core = kind === "suppliers" ? contractor ? ["name", "branch", "status"] : []
      : kind === "presences" ? ["date", "branch", "supplier", "presence", "status"] : ["date"];
    if (!row || !/^[1-9]\d*$/.test(String(row.id)) || core.some(name => typeof row[name] !== "string" || !text(row[name]))) {
      throw new TypeError(`Registro inválido no snapshot de ${kind}.`);
    }
    if (kind === "suppliers" && !(typeof row.contractor === "boolean" || typeof row.contractor === "string" && ["", "SIM", "NAO"].includes(key(row.contractor)))) {
      throw new TypeError("Cadastro com identidade EMPREITEIRO inválida no snapshot.");
    }
    if (kind === "launches" && ["supplier", "branch"].some(name => typeof row[name] !== "string")) {
      throw new TypeError("Lançamento com fornecedor ou filial inválido no snapshot.");
    }
    if (ids.has(String(row.id))) throw new TypeError(`ID duplicado no snapshot de ${kind}.`);
    ids.add(String(row.id));
    if (kind !== "suppliers") dateFilter(row.date);
    if (kind === "presences") {
      if (!["PRESENTE", "PENDENTE", "AUSENTE"].includes(key(row.presence))) throw new TypeError("Presença inválida no snapshot.");
    }
  }
}

function supplierIndex(suppliers) {
  const result = new Map();
  for (const supplier of suppliers) {
    const name = key(supplier.name);
    const relevant = supplier.contractor === true || key(supplier.contractor) === "SIM";
    if (!name && !relevant) continue;
    // Presence/payment records identify the supplier by name, so filtering a
    // conflicting registry first would silently assign another identity's debt.
    const identity = JSON.stringify([key(supplier.branch), key(supplier.property), key(supplier.status),
      supplier.contractor === true || key(supplier.contractor) === "SIM", key(supplier.paymentMethod || supplier.paymentType),
      supplier.dailyValue ?? null, supplier.hours ?? null, supplier.hoursInvalid === true, key(supplier.measurement)]);
    const existing = result.get(name);
    if (existing) {
      existing.ambiguous ||= existing.identity !== identity;
      existing.relevant ||= relevant;
      if (relevant) existing.supplier = supplier;
    } else result.set(name, { supplier, identity, relevant, ambiguous: false });
  }
  for (const [name, entry] of result) {
    if (!entry.relevant) result.delete(name);
    else if (entry.ambiguous) throw new TypeError(`Fornecedor ambíguo no cadastro: ${entry.supplier.name}.`);
  }
  return result;
}

function indexBySupplier(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = key(row.supplier);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

function shiftMinutes(start, end) {
  if (!text(start) || !text(end)) return 0;
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59 || eh * 60 + em < sh * 60 + sm) return null;
  return eh * 60 + em - sh * 60 - sm;
}

function decoratePresence(row, supplier) {
  const first = shiftMinutes(row.entry1, row.exit1); const second = shiftMinutes(row.entry2, row.exit2);
  const workedHours = first === null || second === null ? null : (first + second) / 60;
  const expectedHours = supplier.hoursInvalid || supplier.hours != null && (!Number.isFinite(supplier.hours) || supplier.hours < 0)
    ? null : supplier.hours == null || supplier.hours === 0 ? 8 : supplier.hours;
  const blank = row.dailyValueBlank ?? (row.dailyValue == null || row.dailyValue === "");
  const isMeasurement = blank || row.dailyValue === 0;
  const registered = amount(supplier.dailyValue); const daily = amount(row.dailyValue);
  const equivalentMeasurement = (blank && (supplier.dailyValue == null || supplier.dailyValue === 0))
    || (row.dailyValue === 0 && supplier.dailyValue == null);
  const moneyDiscrepancy = !equivalentMeasurement && daily !== null && registered !== null && !daily.eq(registered)
    || !equivalentMeasurement && blank && registered !== null && !registered.isZero()
    || !equivalentMeasurement && daily !== null && supplier.dailyValue == null;
  const shortHours = workedHours !== null && expectedHours !== null
    && new Money(workedHours).toDecimalPlaces(2).lt(new Money(expectedHours).toDecimalPlaces(2));
  return { ...row, presence: key(row.presence), status: key(row.status), workedHours, expectedHours, isMeasurement,
    valueIncomplete: key(row.presence) !== "AUSENTE" && daily === null,
    hoursWarning: workedHours === null || expectedHours === null ? "Horas incompletas ou horário inválido." : "",
    hasDiscrepancy: Boolean(shortHours || moneyDiscrepancy) };
}

function decoratePayment(row) {
  const payerIncomplete = !text(row.supplier);
  if (Object.hasOwn(row, "unitValue") || Object.hasOwn(row, "quantity")) {
    const unit = amount(row.unitValue); const quantity = amount(row.quantity);
    return { ...row, payerIncomplete, total: unit === null || quantity === null ? null : numeric(unit.times(quantity)) };
  }
  return { ...row, payerIncomplete, total: amount(row.total) === null ? null : row.total };
}

/** Complete readonly PowerFx model. Date/presence filters affect detail only.
 * Defaults: current local month through today, supplierStatus ATIVO (status alias).
 * Null sums mean VALOR INCOMPLETO; blank/zero daily tags use CONFORME MEDIÇÃO.
 * General validation includes all PENDENTE; pending validation only unpaid ones.
 */
export function buildPendingSupplierPaymentsReport(snapshot, filters = {}, today = localDate()) {
  if (snapshot?.complete !== true || snapshot.error || snapshot.aborted || snapshot.partial || snapshot.truncated
    || ["suppliers", "presences", "launches"].some(name => !Array.isArray(snapshot[name]))) {
    throw new TypeError("O relatório exige um snapshot completo, sem erros ou cancelamento.");
  }
  const day = dateFilter(today);
  if (!day) throw new RangeError("Data atual inválida no relatório.");
  const startDate = dateFilter(filters.startDate === undefined ? `${day.slice(0, 7)}-01` : filters.startDate);
  const endDate = dateFilter(filters.endDate === undefined ? day : filters.endDate);
  if (startDate && endDate && startDate > endDate) throw new RangeError("Período inválido: data inicial posterior à final.");
  const supplierStatus = filters.supplierStatus !== undefined ? filters.supplierStatus : filters.status === undefined ? "ATIVO" : filters.status;
  const effectiveFilters = { ...filters, startDate, endDate, supplierStatus };
  for (const name of ["suppliers", "presences", "launches"]) validateRows(snapshot[name], name);
  const registry = supplierIndex(snapshot.suppliers);
  const presences = indexBySupplier(snapshot.presences);
  const payments = indexBySupplier(snapshot.launches);
  const paymentById = new Map(snapshot.launches.map(row => [String(row.id), row]));
  const recent = new Date(`${day}T12:00:00Z`); recent.setUTCDate(recent.getUTCDate() - 14);
  const recentCutoff = recent.toISOString().slice(0, 10);
  const inPeriod = row => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate);
  const rows = [];
  const warnings = new Set(Array.isArray(snapshot.warnings) ? snapshot.warnings : []);
  const knownNames = new Set(snapshot.suppliers.map(supplier => key(supplier.name)).filter(Boolean));
  let unresolvedUnpaidCount = 0;
  for (const [name, records] of presences) {
    if (knownNames.has(name)) continue;
    const unpaid = records.filter(row => key(row.status) === "PENDENTE PGTO");
    if (!unpaid.length) continue;
    unresolvedUnpaidCount += unpaid.length;
    warnings.add(`Fornecedor ${unpaid[0].supplier}: ${unpaid.length} presença(s) não paga(s) sem cadastro correspondente. Totais gerais indisponíveis até conferir a identidade.`);
  }
  for (const { supplier } of registry.values()) {
    if (!(supplier.contractor === true || key(supplier.contractor) === "SIM") || !matches(supplier.branch, filters.branch)
      || !matches(supplier.name, filters.supplier) || !matches(supplier.status, supplierStatus)) continue;
    const name = key(supplier.name); const all = presences.get(name) || [];
    const unpaid = all.filter(row => key(row.status) === "PENDENTE PGTO");
    const approvedValue = sum(unpaid.filter(row => key(row.presence) === "PRESENTE"));
    const validationValue = sum(all.filter(row => key(row.presence) === "PENDENTE"));
    const pendingValidationValue = sum(unpaid.filter(row => key(row.presence) === "PENDENTE"));
    const timelineRows = all.filter(row => key(row.status) === "PENDENTE PGTO"
      || key(row.presence) === "AUSENTE" && row.date >= recentCutoff).sort(ordered).map(row => decoratePresence(row, supplier));
    const periodPresences = all.filter(inPeriod);
    const presenceRows = periodPresences.filter(row => matches(row.branch, filters.branch) && matches(row.presence, filters.presence))
      .sort(ordered).map(row => decoratePresence(row, supplier));
    const linkedElsewhere = [];
    for (const row of periodPresences) {
      if (text(row.paymentId) && !paymentId(row.paymentId)
        && !(key(row.presence) === "AUSENTE" && key(row.paymentId) === "AUSENTE")) {
        warnings.add(`Presença ${row.id}: IDPGTO não contém uma referência única válida. Conteúdo original preservado; confira os pagamentos no detalhamento.`);
      }
    }
    // PowerFx derives distinct links from all period rows, independently of its
    // presence select. The linked launch date may fall outside that period.
    for (const id of new Set(periodPresences.map(row => paymentId(row.paymentId)).filter(Boolean))) {
      const payment = paymentById.get(id);
      if (payment && key(payment.supplier) !== name) linkedElsewhere.push(decoratePayment(payment));
      if (payment && !text(payment.supplier)) warnings.add(`Pagamento ${id} referenciado por ${supplier.name}: fornecedor não informado.`);
      if (!payment) warnings.add(`Pagamento ${id} referenciado por ${supplier.name} não encontrado.`);
    }
    for (const row of timelineRows) if (row.hoursWarning) warnings.add(`${supplier.name}: ${row.hoursWarning}`);
    const totalValue = add(approvedValue, validationValue); const pendingTotalValue = add(approvedValue, pendingValidationValue);
    rows.push({ ...supplier, approved: approvedValue, validation: validationValue, total: totalValue,
      approvedValue, validationValue, totalValue, pendingValidationValue, pendingTotalValue,
      pendingCount: unpaid.length, pendingRows: unpaid.slice().sort((a, b) => ordered(b, a)),
      pendingDates: unpaid.slice().sort(ordered), timelineRows, presenceRows, occurrences: presenceRows.length,
      payments: (payments.get(name) || []).filter(inPeriod).sort(ordered).map(decoratePayment), linkedElsewhere: linkedElsewhere.sort(ordered) });
  }
  const pending = rows.filter(row => row.pendingCount > 0).sort((a, b) => a.approvedValue === null ? b.approvedValue === null ? 0 : 1
    : b.approvedValue === null ? -1 : new Money(b.approvedValue).comparedTo(a.approvedValue) || a.name.localeCompare(b.name, "pt-BR"));
  const details = rows.filter(row => row.occurrences > 0).sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name, "pt-BR"));
  const approvedTotal = unresolvedUnpaidCount ? null : sum(pending, row => row.approvedValue);
  const validationTotal = unresolvedUnpaidCount ? null : sum(pending, row => row.pendingValidationValue);
  const total = add(approvedTotal, validationTotal);
  return { pending, suppliers: pending, details, approvedTotal, validationTotal, total, unresolvedUnpaidCount, filters: effectiveFilters,
    warnings: [...warnings], metrics: { approvedValue: approvedTotal, validationValue: validationTotal, totalValue: total } };
}
