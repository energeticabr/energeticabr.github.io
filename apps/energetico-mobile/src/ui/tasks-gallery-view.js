import { bindAutoFilterForm } from './auto-filter-form.js';

const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_STATUS_FILTER = "__ATIVIDADE_CRIADA_OU_EM_ATENDIMENTO__";
const DEFAULT_STATUS_LABEL = "ATIVIDADE CRIADA OU EM ATENDIMENTO";
const DEFAULT_TASK_STATUSES = ["ATIVIDADE CRIADA", "EM ATENDIMENTO"];
const DATE_FIELD = /(data|date|criad|created|modific|modified|conclus|fatal|identifica|in[ií]cio)/i;

function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}

function field(fields, aliases) {
  const accepted = new Set(aliases.map(key));
  return Object.entries(fields || {}).find(([name, value]) => accepted.has(key(name)) && value != null)?.[1];
}

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title", "Email", "email"]) {
      if (value[name] != null) return text(value[name]);
    }
    return "";
  }
  return String(value);
}

function normalized(value) { return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR"); }
function truthy(value) { return value === true || value === 1 || /^(true|yes|sim|1|conclu[ií]do|conclu[ií]da)$/i.test(text(value).trim()); }

function localDateParts(value) {
  const raw = text(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return { year: Number(br[3]), month: Number(br[2]), day: Number(br[1]) };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function dateKey(value) {
  const parts = localDateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
}

function formatDate(name, value) {
  if (!DATE_FIELD.test(name) || value == null || value === "") return null;
  const parts = localDateParts(value);
  return parts ? `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}` : null;
}

function formatValue(name, value) {
  const date = formatDate(name, value);
  return date || text(value) || "—";
}

function completion(fields) { return truthy(field(fields, ["CONCLUÍDO", "CONCLUIDO"])); }
function priority(fields) { return truthy(field(fields, ["PRIORITÁRIA", "PRIORITARIA"])); }
function charge(fields) { return truthy(field(fields, ["COBRAR"])); }
function dueDate(fields) { return field(fields, ["DATA FATAL", "DATAFATAL", "field_7"]); }
function startDate(fields) { return field(fields, ["DATA INÍCIO", "DATA INICIO"]); }
function createdDate(fields, row) { return field(fields, ["DATA CRIAÇÃO", "DATA CRIACAO", "CRIADO", "CREATED"]) ?? row?.createdDateTime; }
function taskInProgress(fields, todayKey) {
  const start = dateKey(startDate(fields));
  return Boolean(start && start <= todayKey);
}

function status(fields, todayKey) {
  const explicit = text(field(fields, ["STATUS"])).trim();
  if (explicit) return explicit;
  if (completion(fields)) return "CONCLUÍDA";
  const due = dateKey(dueDate(fields));
  if (due && due < todayKey) return "ATRASADA";
  return taskInProgress(fields, todayKey) ? "EM ATENDIMENTO" : "NÃO INICIADA";
}

function safeFailure(error, fallback) {
  const message = String(error?.message || fallback).replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]").replace(/[\r\n]+/g, " ").slice(0, 240);
  return `${fallback}: ${message}. Verifique a conexão e tente novamente.`;
}

export function createTasksGallery({ document: documentRef = globalThis.document, data, openMediaCollection, onClose, onHome, now = () => new Date() } = {}) {
  if (!documentRef?.body || typeof data?.loadSnapshot !== "function") throw new TypeError("Documento e serviço da Galeria de Tarefas são obrigatórios.");
  const doc = documentRef;
  const el = (tag, className, label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  let opened = false; let destroyed = false; let session = 0; let returnFocus = null;
  let rows = []; let filteredRows = []; let page = 1; let pageSize = 10; let listLoading = false; let attachmentLoading = false;
  let filterValues = Object.create(null); let sortValue = "fatal-asc"; let controller = null; let detailsSession = 0;

  const root = el("section", "og-overlay tg-overlay");
  root.hidden = true; root.tabIndex = -1; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Galeria Tarefas"); root.setAttribute("aria-busy", "false");
  const header = el("header", "og-header");
  const closeButton = el("button", "og-button", "Voltar"); closeButton.type = "button";
  const title = el("h1", "og-title", "GALERIA TAREFAS");
  const homeButton = el("button", "og-button", "Início"); homeButton.type = "button";
  header.append(closeButton, title, homeButton);
  const content = el("main", "og-content");
  const filterDisclosure = el("details", "og-filters");
  filterDisclosure.append(el("summary", "og-filter-toggle", "Filtros e ordenação"));
  const form = el("form", "og-filter-form");
  form.setAttribute("aria-label", "Filtros da G7 — Histórico Tarefas");
  const grid = el("div", "og-filter-grid");
  const controls = new Map();

  function addControl(name, label, tag = "select", type = "text") {
    const wrapper = el("label", "og-field"); wrapper.append(el("span", "og-label", label));
    const control = el(tag, "og-input"); control.name = name;
    if (tag === "input") control.type = type;
    if (tag === "select") { const all = el("option", "", "Todos"); all.value = ""; control.append(all); }
    controls.set(name, control); wrapper.append(control); grid.append(wrapper); return control;
  }
  addControl("search", "Descrição, ID ou responsável", "input", "search").placeholder = "Pesquisar tarefa…";
  const statusControl = addControl("status", "Status");
  statusControl.append(Object.assign(el("option", "", DEFAULT_STATUS_LABEL), { value: DEFAULT_STATUS_FILTER }));
  statusControl.value = DEFAULT_STATUS_FILTER;
  for (const name of ["priority", "charge"]) {
    const control = addControl(name, name === "priority" ? "Prioritária" : "Cobrar");
    for (const value of ["SIM", "NÃO"]) { const option = el("option", "", value); option.value = value; control.append(option); }
  }
  addControl("branch", "Filial");
  addControl("association", "Associação");
  addControl("identificationDate", "Data de identificação", "input", "date");
  const sort = addControl("sort", "Ordenar por");
  for (const [value, label] of [["fatal-asc", "Data fatal (mais próxima)"], ["id-desc", "ID (maior primeiro)"], ["created-desc", "Criação (mais recente)"]]) {
    const option = el("option", "", label); option.value = value; sort.append(option);
  }
  sort.value = sortValue;
  const pageSizeControl = addControl("pageSize", "Itens por página");
  for (const value of PAGE_SIZES) { const option = el("option", "", String(value)); option.value = String(value); pageSizeControl.append(option); }
  pageSizeControl.value = String(pageSize);
  const actions = el("div", "og-actions");
  const clearButton = el("button", "og-button", "Limpar filtros"); clearButton.type = "button";
  actions.append(clearButton); form.append(grid, actions); filterDisclosure.append(form);
  const metrics = el("section", "og-metrics tg-metrics"); metrics.setAttribute("aria-label", "Resumo de tarefas");
  const notice = el("p", "og-notice"); notice.hidden = true;
  const listStatus = el("p", "og-list-status tg-list-status"); listStatus.setAttribute("aria-live", "polite");
  const cards = el("div", "og-cards tg-cards"); cards.setAttribute("aria-label", "Tarefas");
  const pagination = el("nav", "og-pagination"); pagination.setAttribute("aria-label", "Páginas de tarefas");
  const previous = el("button", "og-button", "Página anterior"); previous.type = "button";
  const pageLabel = el("span", "og-page-label");
  const next = el("button", "og-button", "Próxima página"); next.type = "button";
  pagination.append(previous, pageLabel, next);
  const detail = el("section", "og-detail tg-detail"); detail.hidden = true; detail.tabIndex = -1;
  detail.setAttribute("role", "dialog"); detail.setAttribute("aria-modal", "true"); detail.setAttribute("aria-label", "Detalhes da tarefa");
  content.append(filterDisclosure, metrics, notice, listStatus, cards, pagination); root.append(header, content, detail); doc.body.append(root);

  function updateBusy() {
    const busy = opened && (listLoading || attachmentLoading);
    root.setAttribute("aria-busy", String(Boolean(busy)));
    for (const button of root.querySelectorAll("button")) {
      if (button === closeButton || button === homeButton) continue;
      button.disabled = busy || button.dataset.baseDisabled === "true";
    }
    previous.disabled = listLoading || page <= 1;
    next.disabled = listLoading || page >= Math.max(1, Math.ceil(filteredRows.length / pageSize));
  }

  function sortRows(items) {
    return [...items].sort((a, b) => {
      if (sortValue === "id-desc") return Number(b.id) - Number(a.id);
      if (sortValue === "created-desc") return (Date.parse(text(createdDate(b.fields, b))) || 0) - (Date.parse(text(createdDate(a.fields, a))) || 0);
      const left = dateKey(dueDate(a.fields)) || "9999-99-99";
      const right = dateKey(dueDate(b.fields)) || "9999-99-99";
      const byDueDate = left.localeCompare(right);
      if (byDueDate) return byDueDate;
      if (priority(a.fields) !== priority(b.fields)) return priority(a.fields) ? -1 : 1;
      return Number(b.id) - Number(a.id);
    });
  }

  function filterOptions() {
    for (const [name, aliases] of [["status", ["STATUS"]], ["branch", ["FILIAL"]], ["association", ["ASSOCIAÇÃO", "ASSOCIACAO", "field_10"]]]) {
      const control = controls.get(name); const current = control.value;
      const rowValues = rows.map(row => name === "status" ? status(row.fields, dateKey(now())) : text(field(row.fields, aliases)).trim()).filter(Boolean);
      const values = [...new Set(name === "status" ? [...DEFAULT_TASK_STATUSES, ...rowValues] : rowValues)]
        .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
      const options = [Object.assign(el("option", "", "Todos"), { value: "" })];
      if (name === "status") options.push(Object.assign(el("option", "", DEFAULT_STATUS_LABEL), { value: DEFAULT_STATUS_FILTER }));
      control.replaceChildren(...options, ...values.map(value => Object.assign(el("option", "", value), { value })));
      if (current === DEFAULT_STATUS_FILTER || values.includes(current)) control.value = current;
    }
  }

  function updateMetrics() {
    const today = dateKey(now());
    const done = rows.filter(row => completion(row.fields)).length;
    const pending = rows.length - done;
    const inProgress = rows.filter(row => !completion(row.fields) && taskInProgress(row.fields, today)).length;
    const notStarted = rows.filter(row => !completion(row.fields) && !taskInProgress(row.fields, today)).length;
    const createdToday = rows.filter(row => dateKey(createdDate(row.fields, row)) === today).length;
    const dueToday = rows.filter(row => !completion(row.fields) && dateKey(dueDate(row.fields)) === today).length;
    const overdue = rows.filter(row => !completion(row.fields) && dateKey(dueDate(row.fields)) && dateKey(dueDate(row.fields)) < today).length;
    const values = [["Total", rows.length], ["Concluídas", done], ["Pendentes", pending], ["Em atendimento", inProgress], ["Não iniciadas", notStarted], ["Criadas hoje", createdToday], ["Vencem hoje", dueToday], ["Atrasadas", overdue]];
    metrics.replaceChildren(...values.map(([label, value]) => {
      const item = el("div", "og-metric"); item.append(el("dt", "", label), el("dd", "", String(value))); return item;
    }));
  }

  function showNotice(message, error = false) {
    notice.textContent = message; notice.hidden = !message; notice.setAttribute("role", error ? "alert" : "status"); notice.classList.toggle("og-error", error);
  }

  function applyLocalFilters() {
    filterValues = Object.fromEntries([...controls].map(([name, control]) => [name, control.value.trim()]));
    sortValue = filterValues.sort || "fatal-asc";
    pageSize = PAGE_SIZES.includes(Number(filterValues.pageSize)) ? Number(filterValues.pageSize) : 10;
    page = 1;
    const query = normalized(filterValues.search); const today = dateKey(now());
    filteredRows = sortRows(rows.filter(row => {
      const fields = row.fields || {};
      const values = Object.values(fields).map(text);
      if (query && !normalized([row.id, ...values].join(" ")).includes(query)) return false;
      const taskStatus = status(fields, today);
      if (filterValues.status === DEFAULT_STATUS_FILTER) {
        if (!DEFAULT_TASK_STATUSES.some(value => normalized(value) === normalized(taskStatus))) return false;
      } else if (filterValues.status && normalized(taskStatus) !== normalized(filterValues.status)) return false;
      if (filterValues.priority && String(priority(fields)) !== String(filterValues.priority === "SIM")) return false;
      if (filterValues.charge && String(charge(fields)) !== String(filterValues.charge === "SIM")) return false;
      if (filterValues.branch && normalized(field(fields, ["FILIAL"])) !== normalized(filterValues.branch)) return false;
      if (filterValues.association && normalized(field(fields, ["ASSOCIAÇÃO", "ASSOCIACAO", "field_10"])) !== normalized(filterValues.association)) return false;
      if (filterValues.identificationDate && dateKey(field(fields, ["DATA IDENTIFICAÇÃO", "DATA IDENTIFICACAO"])) !== filterValues.identificationDate) return false;
      return true;
    }));
    renderList();
  }

  function renderCard(row) {
    const fields = row.fields || {};
    const id = String(field(fields, ["ID 2", "ID"]) ?? row.id);
    const task = text(field(fields, ["TAREFA", "Title"])) || "Tarefa sem descrição";
    const hasAttachmentControl = row.hasAttachments !== false;
    const card = el("article", `og-card tg-card${hasAttachmentControl ? " og-card--with-attachments" : ""}`); card.dataset.itemId = row.id;
    const main = el("div", "og-card-main");
    const heading = el("header", "og-card-heading"); heading.append(el("span", "og-card-id", id), el("h2", "", task));
    const statusText = status(fields, dateKey(now()));
    const statusPill = el("span", `og-status${/pendente|atrasad|não iniciad/i.test(statusText) ? " og-status--pending" : ""}`, statusText);
    const cardFields = el("dl", "og-card-fields");
    const summaries = [
      ["PRIORITÁRIA", field(fields, ["PRIORITÁRIA", "PRIORITARIA"])], ["COBRAR", field(fields, ["COBRAR"])],
      ["FILIAL", field(fields, ["FILIAL"])], ["REFERENTE", field(fields, ["REFERENTE"])], ["ASSOCIAÇÃO", field(fields, ["ASSOCIAÇÃO", "ASSOCIACAO", "field_10"])],
      ["CRIADO POR", field(fields, ["CRIADO POR", "AUTHOR", "CREATED BY"]) ?? row?.createdBy?.user?.displayName],
      ["DATA CRIAÇÃO", createdDate(fields, row)], ["DATA IDENTIFICAÇÃO", field(fields, ["DATA IDENTIFICAÇÃO", "DATA IDENTIFICACAO"])],
      ["DATA INÍCIO", startDate(fields)], ["DATA FATAL", dueDate(fields)], ["DATA CONCLUSÃO", field(fields, ["DATA CONCLUSÃO", "DATA CONCLUSAO"])],
      ["GRAU URGÊNCIA", field(fields, ["GRAU URGÊNCIA", "GRAU URGENCIA", "URGÊNCIA", "URGENCIA"])],
      ["ANEXOS", field(fields, ["QUANTIDADE DE ANEXOS", "QUANTIDADEANEXOS"]) ?? (row.hasAttachments ? "Disponíveis" : "Nenhum")],
    ];
    for (const [name, value] of summaries) {
      if (value == null || value === "") continue;
      const display = name === "PRIORITÁRIA" || name === "COBRAR" ? truthy(value) ? "SIM" : "NÃO" : formatValue(name, value);
      const pair = el("div", "og-card-field"); pair.append(el("dt", "", name), el("dd", "", display)); cardFields.append(pair);
    }
    const actions = el("div", "og-card-actions");
    const detailsButton = el("button", "og-button og-button--detail", "Detalhes"); detailsButton.type = "button"; detailsButton.dataset.action = "details"; detailsButton.addEventListener("click", () => openDetails(row));
    actions.append(detailsButton); main.append(heading, statusPill, cardFields, actions);
    if (hasAttachmentControl) {
      const attachmentButton = el("button", "og-button og-card-attachment-rail"); attachmentButton.type = "button"; attachmentButton.dataset.action = "attachments";
      attachmentButton.setAttribute("aria-label", `Abrir anexos da tarefa ${id}`);
      const count = text(field(fields, ["QUANTIDADE DE ANEXOS", "QUANTIDADEANEXOS"]));
      attachmentButton.append(el("span", "og-card-attachment-icon", "📎"), el("span", "og-card-attachment-label", count ? `ANEXOS (${count})` : "ANEXOS"));
      attachmentButton.addEventListener("click", () => openAttachments(row)); card.append(attachmentButton);
    }
    card.append(main); return card;
  }

  function renderList() {
    const pageCount = Math.ceil(filteredRows.length / pageSize); page = Math.min(page, Math.max(1, pageCount));
    const start = (page - 1) * pageSize; cards.replaceChildren(...filteredRows.slice(start, start + pageSize).map(renderCard));
    listStatus.textContent = filteredRows.length ? `${filteredRows.length} tarefa(s)` : "Nenhuma tarefa encontrada para estes filtros.";
    pageLabel.textContent = `Página ${pageCount ? page : 0} de ${pageCount}`; updateBusy();
  }

  function renderDetailsTable(row) {
    const table = el("table", "og-data-table"); const body = el("tbody");
    const entries = Object.entries(row.fields || {});
    if (!entries.some(([name]) => ["ID", "ID2"].includes(key(name)))) entries.unshift(["ID", row.id]);
    for (const [name, value] of entries) {
      const tr = el("tr");
      const label = key(name) === "FIELD7" ? "DATA FATAL" : key(name) === "FIELD10" ? "ASSOCIAÇÃO" : name;
      tr.append(el("th", "", label), el("td", "", formatValue(label, value)));
      body.append(tr);
    }
    table.append(body); return table;
  }

  function openDetails(row) {
    const current = ++detailsSession; detail.hidden = false;
    const heading = el("header", "og-detail-heading"); heading.append(el("h2", "", `Tarefa #${text(field(row.fields, ["ID 2", "ID"]) ?? row.id)}`));
    const close = el("button", "og-button", "Fechar detalhes"); close.type = "button";
    close.addEventListener("click", () => { if (current === detailsSession) { detail.hidden = true; detail.replaceChildren(); } });
    heading.append(close); detail.replaceChildren(heading, renderDetailsTable(row)); detail.focus({ preventScroll: true });
  }

  async function openAttachments(row) {
    if (attachmentLoading || !opened || destroyed) return;
    const current = session; attachmentLoading = true; showNotice(""); updateBusy();
    try {
      const attachments = await data.listAttachments(row.id);
      if (!opened || destroyed || current !== session) return;
      if (!attachments.length) { showNotice(`A tarefa ${text(field(row.fields, ["ID 2", "ID"]) ?? row.id)} não possui anexos.`); return; }
      if (typeof openMediaCollection !== "function") throw new Error("O visualizador de anexos não está disponível neste aparelho.");
      await openMediaCollection(attachments.map(item => ({ fileName: item.fileName, source: data.downloadAttachment(row.id, item.fileName) })));
    } catch (error) {
      if (opened && !destroyed && current === session) showNotice(safeFailure(error, "Não foi possível abrir os anexos da tarefa"), true);
    } finally {
      if (opened && !destroyed && current === session) { attachmentLoading = false; updateBusy(); }
    }
  }

  async function loadSnapshot() {
    if (!opened || destroyed) return false;
    const current = session; controller?.abort(); controller = new AbortController(); listLoading = true;
    showNotice(""); listStatus.textContent = "Carregando tarefas…"; cards.replaceChildren(); updateBusy();
    try {
      const result = await data.loadSnapshot({ signal: controller.signal });
      if (!opened || destroyed || current !== session) return false;
      if (!Array.isArray(result?.rows)) throw new Error("A consulta não retornou uma lista de tarefas válida.");
      rows = sortRows(result.rows.filter(row => /^\d{1,15}$/.test(String(row?.id || ""))));
      filterOptions(); updateMetrics(); applyLocalFilters(); return true;
    } catch (error) {
      if (!opened || destroyed || current !== session || error?.name === "AbortError") return false;
      listStatus.textContent = safeFailure(error, "Não foi possível carregar tarefas");
      const retry = el("button", "og-button og-button--primary", "Tentar novamente"); retry.type = "button"; retry.addEventListener("click", () => { void loadSnapshot(); }); cards.replaceChildren(retry); return false;
    } finally { if (opened && !destroyed && current === session) { listLoading = false; updateBusy(); } }
  }

  const autoFilters = bindAutoFilterForm(form, applyLocalFilters);
  clearButton.addEventListener("click", () => { for (const [name, control] of controls) control.value = name === "status" ? DEFAULT_STATUS_FILTER : name === "sort" ? "fatal-asc" : name === "pageSize" ? "10" : ""; sortValue = "fatal-asc"; pageSize = 10; autoFilters.apply(); });
  previous.addEventListener("click", () => { if (page > 1) { page -= 1; renderList(); } });
  next.addEventListener("click", () => { if (page < Math.ceil(filteredRows.length / pageSize)) { page += 1; renderList(); } });
  closeButton.addEventListener("click", () => { close(); onClose?.(); }); homeButton.addEventListener("click", () => { close(); onHome?.(); });

  async function open() {
    if (destroyed) throw new Error("A Galeria de Tarefas foi encerrada.");
    if (opened) return;
    opened = true; session += 1; returnFocus = doc.activeElement; root.hidden = false; root.focus({ preventScroll: true }); await loadSnapshot();
  }
  function close() {
    if (!opened) return;
    autoFilters.cancelPending();
    opened = false; session += 1; controller?.abort(); controller = null; listLoading = false; attachmentLoading = false;
    detail.hidden = true; detail.replaceChildren(); root.hidden = true; updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); returnFocus = null;
  }
  function destroy() { if (destroyed) return; autoFilters.destroy(); close(); destroyed = true; root.remove(); }
  return Object.freeze({ open, close, destroy, reload: loadSnapshot });
}
