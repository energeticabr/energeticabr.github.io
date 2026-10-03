import { selectStageLaunch } from "../chat/operations-reports-model.js";

const TITLES = { 6: "ETAPAS E ATIVIDADES", 7: "DIÁRIOS PENDENTES", 8: "TAREFAS PESSOAIS" };
const LABELS_6 = { branch: "FILIAL", stage: "ETAPA", activity: "ATIVIDADE", status: "STATUS DA ATIVIDADE", supplier: "FORNECEDOR", stageStatus: "STATUS DA ETAPA" };
const LABELS_8 = { status: "STATUS", difficulty: "DIFICULDADE", association: "ASSOCIAÇÃO", priority: "PRIORIDADE" };
const EMPTY = "—";

function normalize(value) { return String(value ?? "").trim().toLocaleUpperCase("pt-BR"); }
function shown(value) { return String(value ?? "").trim() || EMPTY; }
function dateKey(value) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : "";
}
function formattedDate(value) {
  const key = dateKey(value);
  return key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : EMPTY;
}
function daysBetween(start, end) {
  const first = dateKey(start), last = dateKey(end);
  if (!first || !last) return null;
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
}
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function safeError(error) {
  return String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createOperationsReportsView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadReport !== "function") throw new TypeError("Os relatórios 6–8 requerem documento e fonte de dados.");
  const make = (tag, className = "", text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const element = make("section", "or-report"); element.hidden = true;
  const header = make("div", "or-heading");
  const title = make("h2", "or-title");
  const refresh = button("og-button or-refresh", "Atualizar");
  header.append(title, refresh); element.append(header);
  const filters = make("div", "or-filters"); element.append(filters);
  const metrics = make("dl", "or-metrics"); element.append(metrics);
  const notice = make("div", "or-notice"); notice.hidden = true; element.append(notice);
  const results = make("div", "or-results"); element.append(results);
  let number = null, snapshot = null, controller = null, revision = 0, active = false, destroyed = false;
  let selected = Object.create(null);

  function message(text, error = false) {
    notice.replaceChildren(); notice.hidden = !text;
    if (!text) return;
    notice.setAttribute("role", error ? "alert" : "status");
    notice.append(make("p", "", text));
    if (error) {
      const retry = button("og-button or-retry", "Tentar novamente");
      retry.addEventListener("click", () => { void load(); });
      notice.append(retry);
    }
  }

  function addMetric(name, label, value) {
    const card = make("div", "or-metric");
    const definition = make("dt", "", label), content = make("dd", "", value);
    content.dataset.metric = name;
    card.append(definition, content); metrics.append(card);
  }

  function metricSkeleton() {
    metrics.replaceChildren();
    if (number === 7) addMetric("diaries", "DIÁRIOS PENDENTES", EMPTY);
    if (number === 8) {
      addMetric("pending", "ATIVIDADES PENDENTES", EMPTY);
      addMetric("completed", "ATIVIDADES CONCLUÍDAS", EMPTY);
      addMetric("total", "TOTAL DE ATIVIDADES", EMPTY);
    }
  }

  function field(parent, label, value) {
    const item = make("div", "or-field");
    item.append(make("span", "or-field-label", label), make("strong", "or-field-value", shown(value)));
    parent.append(item);
  }

  function selector(name, label, values) {
    const wrapper = make("label", "or-filter");
    wrapper.append(make("span", "or-filter-label", label));
    const control = make("select", "og-input or-filter-input"); control.name = name;
    control.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    for (const value of [...new Set(values.map(String).map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")))
      control.append(Object.assign(make("option", "", value), { value }));
    control.value = selected[name] || "";
    if (!control.value) selected[name] = "";
    control.addEventListener("change", () => { selected[name] = control.value; render(); });
    wrapper.append(control); filters.append(wrapper);
  }

  function buildFilters() {
    filters.replaceChildren();
    if (number === 6) {
      const stages = snapshot.stages;
      const activities = stages.flatMap(stage => stage.activities);
      const source = {
        branch: stages.map(stage => stage.branch), stage: stages.map(stage => stage.stage),
        activity: activities.map(row => row.activity), status: activities.map(row => row.status),
        supplier: activities.map(row => row.supplier),
        stageStatus: stages.flatMap(stage => stage.launches?.length ? stage.launches.map(launch => launch.status) : [stage.status]),
      };
      for (const [name, label] of Object.entries(LABELS_6)) selector(name, label, source[name]);
    }
    if (number === 8) {
      const searchWrapper = make("label", "or-filter");
      searchWrapper.append(make("span", "or-filter-label", "PESQUISAR TAREFA"));
      const search = make("input", "og-input or-filter-input"); search.name = "search"; search.type = "search";
      search.value = selected.search || "";
      search.addEventListener("input", () => { selected.search = search.value; render(); });
      searchWrapper.append(search); filters.append(searchWrapper);
      for (const [name, label] of Object.entries(LABELS_8)) selector(name, label, snapshot.rows.map(row => row[name]));
    }
  }

  function renderStageActivity(row, index) {
    const card = make("article", "or-activity-card");
    card.dataset.tone = normalize(row.status) === "ATIVIDADE FINALIZADA" ? "success" : normalize(row.status) === "ATIVIDADE INICIADA" ? "info" : "danger";
    card.append(make("h4", "or-card-title", `${index + 1}. ${shown(row.activity)}`));
    const grid = make("div", "or-fields");
    field(grid, "ID", `#${row.id}`); field(grid, "IMÓVEL", row.property); field(grid, "RESPONSÁVEL", row.supplier);
    field(grid, "INÍCIO", formattedDate(row.start)); field(grid, "FIM", formattedDate(row.end));
    const elapsed = daysBetween(row.start, normalize(row.status) === "ATIVIDADE FINALIZADA" ? row.end : todayKey());
    field(grid, "DIAS", elapsed == null ? EMPTY : `${elapsed} dias`); field(grid, "STATUS", row.status);
    card.append(grid); return card;
  }

  function renderStages() {
    const groups = snapshot.stages.filter(stage => ["branch", "stage"].every(name => !selected[name] || normalize(stage[name]) === normalize(selected[name])))
      .map(stage => {
        const launch = stage.launches?.length ? selectStageLaunch(stage.launches, selected.stageStatus)
          : !selected.stageStatus || normalize(stage.status) === normalize(selected.stageStatus) ? stage : null;
        return {
          stage: launch ? { ...stage, start: launch.startDate ?? launch.start ?? "", end: launch.endDate ?? launch.end ?? "",
            status: launch.status, percent: launch.percent } : null,
          activities: stage.activities.filter(row => ["activity", "status", "supplier"].every(name => !selected[name] || normalize(row[name]) === normalize(selected[name]))),
        };
      })
      .filter(group => group.stage && group.activities.length);
    if (!groups.length) { results.append(make("p", "or-empty", "Nenhuma etapa corresponde aos filtros.")); return; }
    for (const { stage, activities } of groups) {
      const card = make("section", "or-stage-card");
      card.dataset.tone = normalize(stage.status) === "FINALIZADO" ? "success" : normalize(stage.status) === "INICIADO" ? "info" : "danger";
      const summary = make("div", "or-stage-summary");
      summary.append(make("h3", "or-card-title", stage.stage), make("span", "or-badge", stage.percent == null ? "PERCENTUAL INDISPONÍVEL" : `${stage.percent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`));
      const summaryFields = make("div", "or-fields");
      field(summaryFields, "FILIAL", stage.branch); field(summaryFields, "INÍCIO", formattedDate(stage.start));
      field(summaryFields, "FIM", stage.end ? formattedDate(stage.end) : "HOJE");
      const elapsed = daysBetween(stage.start, normalize(stage.status) === "FINALIZADO" ? stage.end : todayKey());
      field(summaryFields, "DIAS", elapsed == null ? EMPTY : `${elapsed} dias`);
      field(summaryFields, "STATUS", stage.status);
      summary.append(summaryFields); card.append(summary);
      const list = make("div", "or-activity-list");
      activities.forEach((row, index) => list.append(renderStageActivity(row, index)));
      card.append(list, make("p", "or-group-total", `Total de registros nesta etapa: ${activities.length}`));
      results.append(card);
    }
  }

  function renderDiaries() {
    metrics.querySelector('[data-metric="diaries"]').textContent = String(snapshot.count);
    if (snapshot.limited) results.append(make("p", "or-limit", `Exibindo os 2.000 mais recentes de ${Number(snapshot.count).toLocaleString("pt-BR")} pendentes.`));
    if (!snapshot.rows.length) { results.append(make("p", "or-empty", "Nenhum diário pendente encontrado.")); return; }
    for (const row of snapshot.rows) {
      const card = make("article", "or-diary-card");
      card.append(make("h3", "or-card-title", `#${row.id}`));
      const grid = make("div", "or-fields");
      field(grid, "DATA", formattedDate(row.date)); field(grid, "FILIAL", row.branch); field(grid, "STATUS", row.status);
      card.append(grid); results.append(card);
    }
  }

  function dueDescription(due, tasks) {
    if (!due) return "SEM PRAZO DEFINIDO";
    const days = daysBetween(todayKey(), due);
    if (days == null) return "PRAZO INDISPONÍVEL";
    if (days < 0) return tasks.some(row => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(normalize(row.status))) ? `${Math.abs(days)} ${days === -1 ? "DIA" : "DIAS"} EM ATRASO` : "TODAS AS ATIVIDADES CONCLUÍDAS";
    if (days === 0) return "VENCE HOJE";
    return `${days} ${days === 1 ? "DIA" : "DIAS"} PARA O PRAZO`;
  }

  function taskTone(row) {
    if (normalize(row.status) === "CONCLUÍDO") return "success";
    if (normalize(row.priority) === "ATIVIDADE EMERGENCIAL") return "danger";
    if (normalize(row.priority) === "ATIVIDADE PRIORITÁRIA") return "warning";
    return "neutral";
  }

  function renderTasks() {
    for (const name of ["pending", "completed", "total"]) metrics.querySelector(`[data-metric="${name}"]`).textContent = String(snapshot.summary[name]);
    const filtered = snapshot.rows.filter(row => {
      if (selected.search && !row.task.toLocaleLowerCase("pt-BR").includes(selected.search.trim().toLocaleLowerCase("pt-BR"))) return false;
      return Object.keys(LABELS_8).every(name => !selected[name] || normalize(row[name]) === normalize(selected[name]));
    }).sort((a, b) => dateKey(b.identified).localeCompare(dateKey(a.identified)) || Number(b.id) - Number(a.id));
    const selectedRows = filtered.slice(0, 2000);
    if (filtered.length > 2000) results.append(make("p", "or-limit", `Detalhamento limitado aos 2.000 registros mais recentes após os filtros; ${filtered.length} registros correspondem à busca. O resumo considera toda a lista.`));
    if (!selectedRows.length) { results.append(make("p", "or-empty", "Nenhuma tarefa corresponde aos filtros.")); return; }
    const byDue = new Map();
    for (const row of selectedRows) {
      const due = dateKey(row.due);
      if (!byDue.has(due)) byDue.set(due, []);
      byDue.get(due).push(row);
    }
    for (const [due, rows] of [...byDue].sort(([a], [b]) => (a || "9999").localeCompare(b || "9999"))) {
      const group = make("section", "or-due-card");
      const pending = rows.some(row => ["ATIVIDADE CRIADA", "EM ATENDIMENTO"].includes(normalize(row.status)));
      group.dataset.tone = !due ? "neutral" : due < todayKey() && pending ? "danger" : due === todayKey() ? "warning" : "success";
      group.append(make("h3", "or-card-title", `DATA FATAL: ${due ? formattedDate(due) : "SEM DATA"}`),
        make("p", "or-due-state", dueDescription(due, rows)), make("p", "or-group-total", `Total de atividades nesta data: ${rows.length}`));
      const byPerson = new Map();
      for (const row of rows) {
        const person = row.responsibleKey || "SEM RESPONSÁVEL";
        if (!byPerson.has(person)) byPerson.set(person, []);
        byPerson.get(person).push(row);
      }
      for (const [person, entries] of [...byPerson].sort(([a], [b]) => a.localeCompare(b, "pt-BR"))) {
        const cluster = make("div", "or-person-group");
        cluster.append(make("h4", "or-person-title", `${person} · ${entries.length}`));
        const taskList = make("div", "or-task-list");
        for (const row of entries.sort((a, b) => dateKey(b.identified).localeCompare(dateKey(a.identified)) || Number(b.id) - Number(a.id))) {
          const card = make("article", "or-task-card"); card.dataset.tone = taskTone(row);
          card.append(make("h5", "or-card-title", row.task));
          const grid = make("div", "or-fields");
          field(grid, "ID", `#${row.id}`); field(grid, "DATA", formattedDate(row.identified));
          field(grid, "ASSOCIAÇÃO", row.association); field(grid, "PRIORIDADE", row.priority);
          field(grid, "DIFICULDADE", row.difficulty); field(grid, "STATUS", row.status);
          card.append(grid); taskList.append(card);
        }
        cluster.append(taskList); group.append(cluster);
      }
      results.append(group);
    }
  }

  function render() {
    results.replaceChildren();
    if (!snapshot) return;
    if (number === 6) renderStages();
    if (number === 7) renderDiaries();
    if (number === 8) renderTasks();
  }

  async function load() {
    controller?.abort();
    const current = ++revision; controller = new AbortController();
    snapshot = null; filters.replaceChildren(); metricSkeleton(); render();
    message("Carregando dados do SharePoint…"); element.setAttribute("aria-busy", "true");
    try {
      const result = await data.loadReport(number, { signal: controller.signal });
      if (destroyed || !active || controller.signal.aborted || current !== revision) return;
      snapshot = result; buildFilters(); message(""); render();
    } catch (error) {
      if (destroyed || !active || controller.signal.aborted || current !== revision) return;
      message(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) element.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => { if (active) void load(); });
  return Object.freeze({
    element,
    open(reportNumber) {
      if (destroyed) throw new Error("A visualização foi encerrada.");
      if (![6, 7, 8].includes(reportNumber)) throw new RangeError("Escolha o relatório 6, 7 ou 8.");
      selected = number === reportNumber ? selected : Object.create(null);
      number = reportNumber; title.textContent = TITLES[number]; active = true; element.hidden = false;
      return load();
    },
    close() { active = false; controller?.abort(); revision++; element.hidden = true; element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; active = false; controller?.abort(); revision++; destroyed = true; element.remove(); },
  });
}
