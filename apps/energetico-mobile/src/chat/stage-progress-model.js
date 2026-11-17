import { buildStageReport, stageReportGroupKey } from "./operations-reports-model.js";

/** Preserve the source calendar day, including SharePoint timestamps with offsets.
 * Blank is unknown; invalid dates reject rather than rolling over into durations.
 */
export function normalizeStageProgressDate(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError("Data inválida no relatório de etapas.");
  const raw = value.trim();
  if (!raw) return "";
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(raw);
  const date = br ? `${br[3]}-${br[2]}-${br[1]}` : iso ? raw.slice(0, 10) : "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!date || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || iso && raw.length > 10 && !Number.isFinite(Date.parse(raw))) {
    throw new RangeError("Data inválida no relatório de etapas.");
  }
  return date;
}

function normalizeRows(rows, kind) {
  const strings = kind === "activities" ? ["branch", "stage", "activity", "property", "supplier", "status"]
    : ["branch", "stage", "status"];
  const dates = kind === "activities" ? ["executionDate", "plannedDate"] : ["startDate", "endDate"];
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !["string", "number"].includes(typeof row.id) || !/^[1-9]\d*$/.test(String(row.id))
      || !Number.isSafeInteger(Number(row.id)) || strings.some(name => typeof row[name] !== "string")) {
      throw new TypeError("Registro ou ID inválido no snapshot de etapas.");
    }
    const id = String(row.id);
    if (ids.has(id)) throw new TypeError("ID duplicado no snapshot de etapas.");
    ids.add(id);
    const normalized = { ...row, id };
    for (const name of dates) normalized[name] = normalizeStageProgressDate(row[name]);
    if (kind === "launches") {
      const percent = row.percent ?? null;
      if (percent !== null && (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100)) {
        throw new TypeError("Percentual inválido no snapshot de etapas.");
      }
      normalized.percent = percent;
    }
    return normalized;
  });
}

export function summarizeStageCompletion(activities) {
  return {
    ready: activities.length > 0 && activities.every(row => row.status.trim().toUpperCase() === "ATIVIDADE FINALIZADA"),
    latestDate: activities.reduce((latest, row) => row.plannedDate > latest ? row.plannedDate : latest, ""),
  };
}

/** UI supplies its own defaults. Grouping, zero-activity cards and latest-launch
 * selection remain the shared operations report behavior, isolated per branch.
 */
export function buildStageProgress(snapshot, filters = {}, today, { includeAllLaunches = false, launchType = '' } = {}) {
  if (snapshot?.complete !== true || snapshot.error || snapshot.aborted || snapshot.partial || snapshot.truncated
    || !Array.isArray(snapshot.activities) || !Array.isArray(snapshot.launches)) {
    throw new TypeError("O relatório exige um snapshot completo, sem erros ou cancelamento.");
  }
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw new TypeError("Filtros inválidos no relatório de etapas.");
  const selected = {};
  for (const name of ["branch", "supplier", "stage", "launchStatus", "activity", "status"]) {
    if (filters[name] != null && typeof filters[name] !== "string") throw new TypeError("Filtros inválidos no relatório de etapas.");
    selected[name] = filters[name]?.trim() || "";
  }
  const date = today === undefined ? undefined : normalizeStageProgressDate(today);
  if (date === "") throw new RangeError("Data de hoje inválida no relatório de etapas.");
  let activities = normalizeRows(snapshot.activities, "activities");
  let launches = normalizeRows(snapshot.launches, "launches");
  if (launchType) {
    launches = launches.filter(row => row.type?.trim().toUpperCase() === launchType);
    const groups = new Set(launches.map(stageReportGroupKey));
    // Demonstrativos inherit their classification from LANCAMENTOOBRA.
    activities = activities.filter(row => groups.has(stageReportGroupKey(row)));
  }
  const linked = new Map();
  for (const row of activities) {
    const key = stageReportGroupKey(row);
    if (!linked.has(key)) linked.set(key, []);
    linked.get(key).push(row);
  }
  const completion = new Map([...linked].map(([key, rows]) => [key, summarizeStageCompletion(rows)]));
  // Keep a stage accessible after its last started activity leaves the initial filter.
  const includeGroups = selected.status.toUpperCase() === "ATIVIDADE INICIADA"
    ? activities.filter(row => completion.get(stageReportGroupKey(row)).ready) : [];
  const report = buildStageReport({ activities, launches }, selected, date, { includeGroups, includeAllLaunches });
  return { ...report, stages: report.stages.map(stage => ({
    ...stage, completion: completion.get(stageReportGroupKey(stage)) ?? summarizeStageCompletion([]),
  })) };
}

function ganttRange(start, end, status, today) {
  const state = status.trim().toUpperCase();
  const finished = state === "FINALIZADO" || state === "ATIVIDADE FINALIZADA";
  const ongoing = state === "INICIADO" || state === "ATIVIDADE INICIADA";
  const throughToday = ongoing && !end;
  const displayedEnd = throughToday ? today : end;
  if ((!finished && !ongoing) || !start || !displayedEnd || displayedEnd < start) return null;
  return { start, end: displayedEnd, throughToday, tone: finished ? "finished" : "ongoing" };
}

export function buildStageGantt(snapshot, today) {
  const day = normalizeStageProgressDate(today);
  const { stages } = buildStageProgress(snapshot, {}, day, {
    includeAllLaunches: true, launchType: 'ATIVIDADE COMUM',
  });
  return stages.filter(stage => stage.stage.trim()).map(stage => ({
    name: stage.launch?.stage || stage.stage,
    branch: stage.launch?.branch || stage.branch,
    start: stage.startDate,
    end: stage.endDate,
    finished: stage.status.trim().toUpperCase() === 'FINALIZADO',
    range: ganttRange(stage.startDate, stage.endDate, stage.status, day),
    children: stage.rows.map(row => ({
      name: row.activity || "Atividade sem descrição",
      property: row.property,
      supplier: row.supplier,
      start: row.executionDate,
      end: row.plannedDate,
      finished: row.status.trim().toUpperCase() === 'ATIVIDADE FINALIZADA',
      range: ganttRange(row.executionDate, row.plannedDate, row.status, day),
    })),
  }));
}
