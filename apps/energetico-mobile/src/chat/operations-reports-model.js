const text = value => String(value ?? "").trim();
const normalized = value => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR");
const same = (left, right) => normalized(left) === normalized(right);

export function dateKey(value) {
  const raw = text(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}

export function formatOperationsDate(value) {
  const date = dateKey(value);
  return date ? `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "—";
}

export function calendarDays(from, to) {
  const start = dateKey(from), end = dateKey(to);
  if (!start || !end) return null;
  const utc = value => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((utc(end) - utc(start)) / 86400000);
}

const matches = (row, filters, names) => names.every(name => !filters[name] || same(row[name], filters[name]));

// A etapa mostra o lançamento de início mais recente; em empate, o maior ID.
function compareStageLaunches(left, right) {
  return dateKey(right.startDate ?? right.start).localeCompare(dateKey(left.startDate ?? left.start))
    || Number(right.id || 0) - Number(left.id || 0);
}

export function selectStageLaunch(launches, status = "") {
  return [...(launches || [])].filter(launch => !status || same(launch.status, status))
    .sort(compareStageLaunches)[0] || null;
}

export function buildStageReport(snapshot, filters = {}, today = new Date().toISOString().slice(0, 10)) {
  const activities = (snapshot?.activities || []).filter(row => matches(row, filters, ["branch", "stage", "activity", "status", "supplier"]));
  const launches = snapshot?.launches || [];
  const groups = new Map();
  for (const row of activities) {
    const key = `${normalized(row.branch)}\u0000${normalized(row.stage)}`;
    if (!groups.has(key)) groups.set(key, { branch: row.branch, stage: row.stage, rows: [] });
    groups.get(key).rows.push(row);
  }
  const visibleBranches = new Set(activities.map(row => normalized(row.branch)));
  const hasActivityFilter = ["activity", "status", "supplier"].some(name => Boolean(filters[name]));
  for (const row of launches) {
    if (hasActivityFilter || !text(row.stage) || !matches(row, filters, ["branch", "stage"])) continue;
    if (!visibleBranches.has(normalized(row.branch)) && !same(filters.branch, row.branch) && !same(filters.stage, row.stage)) continue;
    const key = `${normalized(row.branch)}\u0000${normalized(row.stage)}`;
    if (!groups.has(key)) groups.set(key, { branch: row.branch, stage: row.stage, rows: [] });
  }
  const stages = [];
  for (const group of groups.values()) {
    const stageLaunches = launches.filter(row => same(row.branch, group.branch) && same(row.stage, group.stage))
      .sort(compareStageLaunches);
    const launch = selectStageLaunch(stageLaunches, filters.launchStatus);
    if (filters.launchStatus && !launch) continue;
    const end = same(launch?.status, "FINALIZADO") ? launch?.endDate : today;
    stages.push({
      ...group, launches: stageLaunches, startDate: launch?.startDate || "", endDate: launch?.endDate || "",
      status: launch?.status || "", percent: launch?.percent ?? null,
      days: launch?.startDate ? calendarDays(launch.startDate, end) : null,
      rows: [...group.rows].sort((a, b) => dateKey(a.executionDate).localeCompare(dateKey(b.executionDate)) || Number(a.id) - Number(b.id)),
    });
  }
  stages.sort((a, b) => dateKey(b.startDate).localeCompare(dateKey(a.startDate)) || a.stage.localeCompare(b.stage, "pt-BR"));
  return { stages, count: activities.length };
}

export function buildTaskReport(snapshot, filters = {}, today = new Date().toISOString().slice(0, 10)) {
  const source = snapshot?.rows || [];
  const selected = source.filter(row => {
    if (filters.search && !normalized(row.task).includes(normalized(filters.search))) return false;
    return matches(row, filters, ["status", "difficulty", "association", "priority"]);
  }).sort((a, b) => dateKey(b.identifiedDate).localeCompare(dateKey(a.identifiedDate)) || Number(b.id) - Number(a.id)).slice(0, 2000);
  const byDate = new Map();
  for (const row of selected) {
    const date = dateKey(row.dueDate);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  const groups = [...byDate].sort(([a], [b]) => (a || "9999-12-31").localeCompare(b || "9999-12-31")).map(([dueDate, rows]) => {
    const pending = rows.some(row => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(normalized(row.status)));
    const tone = !dueDate ? "neutral" : dueDate < today ? pending ? "danger" : "success" : dueDate === today ? "warning" : "success";
    const byResponsible = new Map();
    for (const row of rows) {
      const name = normalized(row.responsible) || "SEM RESPONSÁVEL";
      if (!byResponsible.has(name)) byResponsible.set(name, []);
      byResponsible.get(name).push(row);
    }
    const responsibles = [...byResponsible].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([name, tasks]) => ({ name, rows: tasks }));
    return { dueDate, count: rows.length, days: dueDate ? calendarDays(today, dueDate) : null, tone, responsibles };
  });
  return { groups, summary: snapshot?.summary || { pending: 0, completed: 0, total: 0 }, limited: Boolean(snapshot?.limited || selected.length < source.length), detailCount: selected.length };
}
