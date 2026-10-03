const key = value => String(value ?? "").replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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

function rawField(item, columns, ...aliases) {
  const wanted = new Set(aliases.map(key));
  const column = (columns || []).find(entry => wanted.has(key(entry?.displayName)) || wanted.has(key(entry?.name)));
  const fields = item?.fields || {};
  if (column && fields[column.name] != null) return fields[column.name];
  const direct = Object.entries(fields).find(([name, value]) => wanted.has(key(name)) && value != null);
  return direct?.[1];
}

const field = (item, columns, ...aliases) => scalar(rawField(item, columns, ...aliases));

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = scalar(value).replace(/[^\d.,-]/g, "");
  if (!raw || raw === "-") return null;
  const comma = raw.lastIndexOf(","); const dot = raw.lastIndexOf(".");
  const normalized = comma > dot ? raw.replaceAll(".", "").replace(",", ".")
    : comma >= 0 ? raw.replaceAll(",", "")
      : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw;
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

const same = (a, b) => key(a) === key(b);
const selected = (value, filter) => !filter || same(value, filter);
const inRange = (date, { startDate, endDate } = {}) => (!startDate || !!date && date >= startDate) && (!endDate || !!date && date <= endDate);
const sortText = (a, b) => String(a).localeCompare(String(b), "pt-BR");
const sumComplete = (rows, accessor = row => row.dailyValue) => rows.every(row => Number.isFinite(accessor(row)))
  ? rows.reduce((total, row) => total + accessor(row), 0) : null;
const percent = (part, whole) => whole ? Math.round(part / whole * 1000) / 10 : 0;
const shiftMinutes = (start, finish) => {
  if (!/^\d{2}:\d{2}$/.test(start || "") || !/^\d{2}:\d{2}$/.test(finish || "")) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = finish.split(":").map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  return minutes >= 0 ? minutes : null;
};
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function normalizeRhSupplier(item, columns = []) {
  const get = (...aliases) => field(item, columns, ...aliases);
  const getNumber = (...aliases) => number(rawField(item, columns, ...aliases));
  return Object.freeze({
    id: scalar(item?.id || get("ID")), name: get("CADASTRO"), branch: get("FILIAL"),
    property: get("IMOVEL", "IMÓVEL"), profession: get("PROFISSAO", "PROFISSÃO"),
    paymentMethod: get("FORMA PGTO", "FORMA DE PAGAMENTO"), paymentType: get("FORMA PGTO", "FORMA DE PAGAMENTO"), dailyValue: getNumber("VLR DIARIO", "VLR DIÁRIO"),
    status: get("STATUS"), contractor: same(get("EMPREITEIRO"), "SIM"), stage: get("DESCRITIVOETAPA ATUAL", "ETAPA ATUAL"),
    activity: get("ATIVIDADE EXERCIDA"), measurement: get("MEDIÇÃOATUAL", "MEDICAOATUAL"),
    hours: getNumber("HORASTRABALHO", "HORAS TRABALHO"),
  });
}

export function normalizeRhPresence(item, columns = []) {
  const get = (...aliases) => field(item, columns, ...aliases);
  const getNumber = (...aliases) => number(rawField(item, columns, ...aliases));
  return Object.freeze({
    id: scalar(item?.id || get("ID")), date: dateOnly(get("DATA")), branch: get("FILIAL"),
    property: get("IMOVEL", "IMÓVEL"), supplier: get("FORNECEDOR"),
    profession: get("PROFISSAO", "PROFISSÃO"), stage: get("ETAPA"),
    presence: get("PRESENCA", "PRESENÇA"), status: get("STATUS"),
    dailyValue: getNumber("VLORDIARIO", "VALOR DIÁRIO", "VALOR DIARIO"),
    activity: get("ATIVIDADEEXECUTADA", "ATIVIDADE EXECUTADA"),
    motivation: get("MOTIVACAO", "MOTIVAÇÃO"), observation: get("OBS", "OBSERVAÇÃO", "OBSERVACAO"),
    paymentId: get("IDPGTO", "ID PGTO"),
    entry1: get("HORÁRIO", "HORARIO"), exit1: get("HORARIOSAIDA1"),
    entry2: get("HORARIOENTRADA2"), exit2: get("HORARIOSAIDA2"),
  });
}

export function normalizeRhLaunch(item, columns = []) {
  const get = (...aliases) => field(item, columns, ...aliases);
  const getNumber = (...aliases) => number(rawField(item, columns, ...aliases));
  const unit = getNumber("VALOR UNITÁRIO", "VALOR UNITARIO", "VALORUNITARIO", "field_9");
  const quantity = getNumber("QUANTIDADE", "field_8");
  return Object.freeze({
    id: scalar(item?.id || get("ID")), date: dateOnly(get("DATA", "field_2")),
    supplier: get("FORNECEDOR", "field_5"), branch: get("FILIAL", "Title"),
    total: unit == null || quantity == null ? null : unit * quantity,
    advance: get("ADIANTAMENTO"),
  });
}

export function buildRhReport3(snapshot, filters = {}, today = localToday()) {
  const thirtyDaysAgo = new Date(`${today}T12:00:00Z`);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
  const presences = (snapshot.presences || []).filter(row => inRange(row.date, filters)
    && selected(row.branch, filters.branch) && selected(row.property, filters.property)
    && selected(row.supplier, filters.supplier) && selected(row.stage, filters.stage));
  const hasDateFilter = Boolean(filters.startDate || filters.endDate);
  const suppliers = (snapshot.suppliers || []).filter(row => (row.contractor === true || same(row.contractor, "SIM"))
    && selected(row.status, filters.status) && selected(row.branch, filters.branch)
    && selected(row.property, filters.property) && selected(row.name, filters.supplier)
    && (!hasDateFilter || presences.some(presence => same(presence.supplier, row.name))));
  const branches = [...new Set(suppliers.map(row => row.branch))].sort(sortText).map(branch => {
    const inBranch = suppliers.filter(row => row.branch === branch);
    const properties = [...new Set(inBranch.map(row => row.property))].sort(sortText).map(property => {
      const rows = inBranch.filter(row => row.property === property);
      const daily = rows.filter(row => same(row.paymentMethod || row.paymentType, "DIÁRIA"));
      const professions = [...new Set(rows.map(row => row.profession || "SEM PROFISSÃO"))].sort(sortText).map(name => {
        const professionRows = rows.filter(row => (row.profession || "SEM PROFISSÃO") === name);
        const professionDaily = professionRows.filter(row => same(row.paymentMethod || row.paymentType, "DIÁRIA"));
        return { name, count: professionRows.length, dailyCount: professionDaily.length,
          measurementCount: professionRows.filter(row => same(row.paymentMethod || row.paymentType, "MEDIÇÃO")).length,
          globalCount: professionRows.filter(row => same(row.paymentMethod || row.paymentType, "VALOR GLOBAL")).length,
          dailyAmount: sumComplete(professionDaily), suppliers: professionRows.map(row => {
          const history = presences.filter(presence => same(presence.supplier, row.name)).sort((a, b) => a.date.localeCompare(b.date));
          const present = history.filter(presence => same(presence.presence, "PRESENTE"));
          const last30 = present.filter(presence => presence.date >= cutoff);
          const recentHistory = history.filter(presence => presence.date >= cutoff);
          return { ...row, firstDate: history[0]?.date || "", lastPresentDate: present.at(-1)?.date || "",
            presentCount: present.length, presenceCount: history.length,
            attendance: { last30Present: last30.length, last30Records: recentHistory.length,
              last30Rate: percent(last30.length, recentHistory.length), historyRate: percent(present.length, history.length),
              present: present.length, records: history.length } };
        }) };
      });
      return { name: property, count: rows.length, dailyCount: daily.length,
        measurementCount: rows.filter(row => same(row.paymentMethod || row.paymentType, "MEDIÇÃO")).length,
        globalCount: rows.filter(row => same(row.paymentMethod || row.paymentType, "VALOR GLOBAL")).length,
        dailyTotal: sumComplete(daily), dailyAmount: sumComplete(daily), professions };
    });
    return { name: branch, properties };
  });
  return { branches, groups: branches, supplierCount: suppliers.length, metrics: { suppliers: suppliers.length } };
}

export function buildRhReport4(snapshot, filters = {}) {
  const rows = (snapshot.presences || []).filter(row => inRange(row.date, filters)
    && ["PRESENTE", "PENDENTE", "AUSENTE"].some(status => same(row.presence, status))
    && selected(row.branch, filters.branch) && selected(row.supplier, filters.supplier)
    && selected(row.presence, filters.presence === "TODOS" ? "" : filters.presence));
  const present = rows.filter(row => same(row.presence, "PRESENTE"));
  const pending = rows.filter(row => same(row.presence, "PENDENTE"));
  const absent = rows.filter(row => same(row.presence, "AUSENTE"));
  const professionRows = rows.filter(row => !same(row.presence, "AUSENTE"));
  const professions = [...new Set(professionRows.map(row => row.profession || "SEM PROFISSÃO"))].map(name => {
    const group = professionRows.filter(row => (row.profession || "SEM PROFISSÃO") === name);
    const pendingApproval = group.filter(row => same(row.presence, "PENDENTE") && !same(row.status, "PAGO"));
    const approved = group.filter(row => same(row.presence, "PRESENTE") && !same(row.status, "PAGO"));
    const paid = group.filter(row => same(row.status, "PAGO"));
    const suppliers = [...new Set(group.map(row => row.supplier || "SEM FORNECEDOR"))].map(supplier => {
      const records = group.filter(row => (row.supplier || "SEM FORNECEDOR") === supplier);
      const supplierApproved = records.filter(row => same(row.presence, "PRESENTE") && !same(row.status, "PAGO"));
      const supplierValidation = records.filter(row => same(row.presence, "PENDENTE") && !same(row.status, "PAGO"));
      const supplierPaid = records.filter(row => same(row.status, "PAGO"));
      return { name: supplier, count: records.length,
        present: records.filter(row => same(row.presence, "PRESENTE")).length,
        pending: records.filter(row => same(row.presence, "PENDENTE")).length,
        paid: supplierPaid.length, approvedValue: sumComplete(supplierApproved),
        validationValue: sumComplete(supplierValidation), paidValue: sumComplete(supplierPaid),
        totalValue: sumComplete(records),
        situation: supplierPaid.length === records.length ? "PAGO"
          : supplierValidation.length === records.length ? "PENDENTE" : "MISTO" };
    }).sort((a, b) => b.count - a.count || sortText(a.name, b.name));
    return { name, count: group.length, professionals: new Set(group.map(row => key(row.supplier))).size,
      pendingValue: sumComplete(pendingApproval), validationValue: sumComplete(pendingApproval), approvedValue: sumComplete(approved), paidValue: sumComplete(paid),
      suppliers, rows: group.slice().sort((a, b) => a.date.localeCompare(b.date)) };
  }).sort((a, b) => b.count - a.count || sortText(a.name, b.name));
  const dates = [...new Set(rows.map(row => row.date).filter(Boolean))].sort(sortText);
  const days = dates.reverse().map(date => {
    const onDate = rows.filter(row => row.date === date);
    return { date, branches: [...new Set(onDate.map(row => row.branch))].sort(sortText).map(name => {
      const group = onDate.filter(row => row.branch === name);
      const presentRows = group.filter(row => same(row.presence, "PRESENTE"));
      const professionCounts = [...new Set(presentRows.map(row => row.profession || "SEM PROFISSÃO"))]
        .sort(sortText).map(profession => ({ name: profession,
          count: presentRows.filter(row => (row.profession || "SEM PROFISSÃO") === profession).length }));
      return { name, present: presentRows.length, dailyTotal: sumComplete(presentRows), professionCounts,
        pending: group.filter(row => same(row.presence, "PENDENTE")).length,
        absent: group.filter(row => same(row.presence, "AUSENTE")).length, rows: group };
    }) };
  });
  return { metrics: { present: present.length, pending: pending.length, absent: absent.length,
    presentValue: sumComplete(present) }, professions, days };
}

export function buildRhReport5(snapshot, filters = {}, today = localToday()) {
  const fourteenDaysAgo = new Date(`${today}T12:00:00Z`);
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
  const recentCutoff = fourteenDaysAgo.toISOString().slice(0, 10);
  const suppliers = (snapshot.suppliers || []).filter(row => (row.contractor === true || same(row.contractor, "SIM"))
    && selected(row.branch, filters.branch) && selected(row.name, filters.supplier));
  const inPeriod = row => inRange(row.date, filters) && selected(row.branch, filters.branch)
    && selected(row.supplier, filters.supplier)
    && selected(row.presence, filters.presence === "TODOS" ? "" : filters.presence);
  const details = suppliers.map(supplier => {
    const all = (snapshot.presences || []).filter(row => same(row.supplier, supplier.name));
    const approved = all.filter(row => same(row.presence, "PRESENTE") && same(row.status, "PENDENTE PGTO"));
    const validation = all.filter(row => same(row.presence, "PENDENTE"));
    const pendingRows = all.filter(row => same(row.status, "PENDENTE PGTO"));
    const timelineRows = all.filter(row => same(row.status, "PENDENTE PGTO")
      || (same(row.presence, "AUSENTE") && row.date >= recentCutoff)).sort((a, b) => a.date.localeCompare(b.date))
      .map(row => {
        const firstShift = shiftMinutes(row.entry1, row.exit1);
        const secondShift = shiftMinutes(row.entry2, row.exit2);
        const workedHours = firstShift == null || secondShift == null ? null : (firstShift + secondShift) / 60;
        return { ...row, workedHours, hasDiscrepancy: Number.isFinite(workedHours)
          && Number.isFinite(supplier.hours) && supplier.hours > 0 && workedHours < supplier.hours
          || Number.isFinite(row.dailyValue) && Number.isFinite(supplier.dailyValue) && row.dailyValue !== supplier.dailyValue };
      });
    const approvedValue = sumComplete(approved); const validationValue = sumComplete(validation);
    const occurrences = all.filter(inPeriod);
    const payments = (snapshot.launches || []).filter(row => same(row.supplier, supplier.name) && inRange(row.date, filters));
    const linkedElsewhere = (snapshot.launches || []).filter(row => occurrences.some(presence => presence.paymentId === row.id)
      && !same(row.supplier, supplier.name));
    return { ...supplier, occurrences: occurrences.length, presenceRows: occurrences,
      pendingCount: pendingRows.length, pendingRows: pendingRows.slice().sort((a, b) => b.date.localeCompare(a.date)), timelineRows,
      pendingDates: pendingRows.slice().sort((a, b) => a.date.localeCompare(b.date)),
      approved: approvedValue, validation: validationValue,
      approvedValue, validationValue, totalValue: approvedValue == null || validationValue == null ? null : approvedValue + validationValue,
      total: approvedValue == null || validationValue == null ? null : approvedValue + validationValue,
      payments, linkedElsewhere };
  });
  const pending = details.filter(row => row.pendingCount > 0).sort((a, b) => (b.approved ?? -Infinity) - (a.approved ?? -Infinity));
  const approvedTotal = sumComplete(pending, row => row.approved);
  const validationTotal = sumComplete(pending, row => row.validation);
  const total = approvedTotal == null || validationTotal == null ? null : approvedTotal + validationTotal;
  return { pending, suppliers: pending, details: details.filter(row => row.occurrences > 0).sort((a, b) => b.occurrences - a.occurrences),
    approvedTotal, validationTotal, total, metrics: { approvedValue: approvedTotal, validationValue: validationTotal, totalValue: total } };
}
