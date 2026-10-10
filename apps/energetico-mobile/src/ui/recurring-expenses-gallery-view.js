import { placeGalleryQuickSearch } from './gallery-quick-search.js';
import { matchesGallerySearch } from '../chat/gallery-quick-search.js';
import { applyScreenNavigation } from "./screen-navigation.js";
import { attachGalleryRefreshButton } from './gallery-refresh.js';
import { attachGalleryCreateShortcut } from './gallery-create-shortcut.js';
import { createGalleryLoadingScreen } from './gallery-loading-screen.js';
import { createGalleryRecordActions } from './gallery-record-actions.js';
import { bindAutoFilterForm } from './auto-filter-form.js';
import { createGalleryAttachmentCounts, knownGalleryAttachmentCount } from './gallery-attachment-counts.js';

const PAGE_SIZES = [10, 20, 50, 100];
const DATE_FIELD = /(data|date|criad|created|modific|modified|prox|agend|in[ií]cio|fim)/i;
const MONEY_FIELDS = new Set(["VALORMENSAL", "VALORARBITRADO", "VALORTOTALESPERADO"]);
const RECURRENCES = new Map([
  ["DAY", "Diário"], ["DAILY", "Diário"], ["DIARIO", "Diário"],
  ["WEEK", "Semanal"], ["WEEKLY", "Semanal"], ["SEMANAL", "Semanal"],
  ["MONTH", "Mensal"], ["MONTHLY", "Mensal"], ["MENSAL", "Mensal"],
  ["YEAR", "Anual"], ["YEARLY", "Anual"], ["ANUAL", "Anual"],
]);
const ICON_PATHS = Object.freeze({
  back: ["m15 18-6-6 6-6"],
  home: ["m3 10 9-7 9 7", "M5 9v12h14V9", "M9 21v-7h6v7"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m17 17 4 4"],
  filter: ["M3 4h18l-7 8v6l-4 2v-8L3 4Z"],
  supplier: ["M4 21V5l8-2v18", "M12 8h8v13", "M2 21h20", "M7 8h2", "M7 12h2", "M7 16h2", "M16 12h2", "M16 16h2"],
  product: ["m12 2 9 5-9 5-9-5 9-5Z", "M3 7v10l9 5 9-5V7", "M12 12v10"],
  property: ["m3 10 9-7 9 7", "M5 9v12h14V9", "M9 21v-7h6v7"],
  branch: ["M12 22s7-7 7-13a7 7 0 1 0-14 0c0 6 7 13 7 13Z", "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  money: ["M8 3h8l-2 5h-4L8 3Z", "M9 8c-3 3-5 6-5 9a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3-2-6-5-9H9Z", "M12 11v8", "M10 13h4a1.5 1.5 0 0 1 0 3h-4"],
  calendar: ["M4 5h16v16H4z", "M8 2v6", "M16 2v6", "M4 10h16"],
  person: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 22v-2a8 8 0 0 1 16 0v2"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 10v7", "M12 7h.01"],
});
const FILTERS = Object.freeze([
  ["id", "ID", ["ID"]],
  ["property", "Imóvel", ["IMOVEL", "IMÓVEL"]],
  ["branch", "Filial", ["FILIAL"]],
  ["supplier", "Fornecedor", ["FORNECEDOR"]],
  ["product", "Produto/equipamento", ["EQUIPAMENTO", "PRODUTO"]],
  ["responsible", "Responsável pagamento", ["RESPONSAVEL LOCACAO", "RESPONSÁVEL LOCAÇÃO"]],
  ["paymentMethod", "Forma de pagamento", ["FORMAPGTO", "FORMA PGTO", "FORMA DE PAGAMENTO"]],
  ["status", "Status", ["STATUS"]],
  ["recurrence", "Recorrência", ["RECORRENCIA", "RECORRÊNCIA", "RECORRENCIADIAS"]],
]);

function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}

function text(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title", "Name", "name", "Email", "email"]) {
      if (value[name] != null) return text(value[name]);
    }
    return "";
  }
  return String(value);
}

function field(fields, aliases) {
  const accepted = new Set(aliases.map(key));
  return Object.entries(fields || {}).find(([name, value]) => accepted.has(key(name)) && value != null)?.[1];
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

function dateParts(value) {
  const raw = text(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return { year: Number(br[3]), month: Number(br[2]), day: Number(br[1]) };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function dateKey(value) {
  const parts = dateParts(value);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
}

function formatDate(name, value) {
  if (!DATE_FIELD.test(name) || value == null || value === "") return null;
  const parts = dateParts(value);
  return parts ? `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}` : null;
}

function formatDateTime(value) {
  const raw = text(value).trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return text(formatDate("Criado", value) || value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function numericValue(value) {
  if (typeof value === "number") return value;
  let raw = text(value).trim().replace(/[^\d,.-]/g, "");
  if (!raw) return NaN;
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const number = Number(raw);
  return Number.isFinite(number) ? number : NaN;
}

function recurrenceValue(fields) {
  const recurrence = text(field(fields, ["RECORRENCIA", "RECORRÊNCIA"])).trim();
  if (recurrence) return RECURRENCES.get(key(recurrence)) || recurrence;
  return text(field(fields, ["RECORRENCIADIAS", "RECORRÊNCIA DIAS"])) || "—";
}

function displayValue(name, value) {
  if (key(name) === "RECORRENCIA") return RECURRENCES.get(key(value)) || text(value) || "—";
  const date = formatDate(name, value);
  if (date) return date;
  if (MONEY_FIELDS.has(key(name))) {
    const amount = numericValue(value);
    if (Number.isFinite(amount)) return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return text(value) || "—";
}

function filterValue(fields, name, aliases) {
  const value = field(fields, aliases);
  if (name === "recurrence") return recurrenceValue(fields) === "—" ? "" : recurrenceValue(fields);
  return value == null ? "" : text(value).trim();
}

function safeFailure(error, fallback) {
  const message = String(error?.message || fallback)
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
  return `${fallback}: ${message}. Verifique a conexão e tente novamente.`;
}

export function createRecurringExpensesGallery({
  document: documentRef = globalThis.document,
  data,
  openMediaCollection,
  onClose,
  onHome,
  onCreate,
  now = () => new Date(),
} = {}) {
  if (!documentRef?.body || typeof data?.loadSnapshot !== "function") {
    throw new TypeError("Documento e serviço da Galeria de Despesas Recorrentes são obrigatórios.");
  }
  const doc = documentRef;
  const el = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const icon = (name, className = "") => {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    for (const d of ICON_PATHS[name] || []) {
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  };
  let opened = false;
  let destroyed = false;
  let session = 0;
  let rows = [];
  let filteredRows = [];
  let page = 1;
  let pageSize = 10;
  let sortValue = "id-desc";
  let listLoading = false;
  let attachmentLoading = false;
  let controller = null;
  let returnFocus = null;
  let detailReturnFocus = null;

  const root = el("section", "og-overlay re-overlay");
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Galeria Despesas Recorrentes");
  root.setAttribute("aria-busy", "false");

  const header = el("header", "og-header re-header");
  const closeButton = el("button", "og-button", "Voltar"); closeButton.type = "button";
  const title = el("h1", "og-title", "GALERIA DESPESAS RECORRENTES");
  const homeButton = el("button", "og-button", "Início"); homeButton.type = "button";
  applyScreenNavigation({ header, back: closeButton, home: homeButton, title });

  const content = el("main", "og-content");
  const form = el("form", "og-filter-form re-filter-form");
  form.setAttribute("aria-label", "Filtros da Galeria de Despesas Recorrentes G19");
  const grid = el("div", "og-filter-grid re-filter-grid");
  const controls = new Map();

  function addControl(name, label, tag = "select", type = "text") {
    const wrapper = el("label", "og-field");
    wrapper.append(el("span", "og-label", label));
    const control = el(tag, "og-input");
    control.name = name;
    if (tag === "input") control.type = type;
    if (tag === "select") {
      const all = el("option", "", "Todos"); all.value = ""; control.append(all);
    }
    controls.set(name, control);
    wrapper.append(control);
    grid.append(wrapper);
    return control;
  }

  addControl("search", "Pesquisar", "input", "search").placeholder = "Buscar despesa, fornecedor ou produto...";
  for (const [name, label] of FILTERS) addControl(name, label);
  const sort = addControl("sort", "Ordenar por");
  for (const [value, label] of [["start-date-desc", "Início ↓"], ["start-date-asc", "Início ↑"], ["id-desc", "Maior ID"], ["id-asc", "Menor ID"], ["next-date-asc", "Próximo agendamento"], ["monthly-value-desc", "Maior valor mensal"], ["modified-desc", "Modificado recentemente"]]) {
    const option = el("option", "", label); option.value = value; sort.append(option);
  }
  sortValue = "start-date-desc";
  sort.value = sortValue;
  const pageSizeControl = addControl("pageSize", "Itens por página");
  for (const value of PAGE_SIZES) { const option = el("option", "", String(value)); option.value = String(value); pageSizeControl.append(option); }
  pageSizeControl.value = String(pageSize);

  const actions = el("div", "og-actions");
  const clearButton = el("button", "og-button", "Limpar filtros"); clearButton.type = "button";
  const refreshButton = el("button", "og-button", "Atualizar dados"); refreshButton.type = "button";
  actions.append(clearButton);
  const toolbar = el("div", "re-toolbar");
  const searchBar = el("div", "re-search-bar");
  searchBar.append(icon("search"), controls.get("search").parentElement);
  const filterButton = el("button", "og-button re-filter-button");
  filterButton.type = "button";
  filterButton.setAttribute("aria-expanded", "false");
  filterButton.setAttribute("aria-controls", "re-filter-panel");
  const filterCount = el("span", "re-filter-count");
  filterCount.hidden = true;
  filterButton.append(icon("filter"), el("span", "", "Filtros"), filterCount);
  toolbar.append(searchBar, filterButton);
  placeGalleryQuickSearch({ input: controls.get("search"), toolbar, container: searchBar });
  const createShortcut = attachGalleryCreateShortcut({ document: doc, root, toolbar, filterToggle: filterButton, onCreate, close,
    label: 'Adicionar uma nova despesa recorrente', action: 'create-recurring-expense',
    isAvailable: () => opened && !destroyed && !listLoading && !attachmentLoading });
  let pendingMutations = 0;
  const refreshShortcut = attachGalleryRefreshButton({ document: doc, root, container: toolbar, button: refreshButton,
    onRefresh: () => loadSnapshot({ refresh: true }),
    isAvailable: () => opened && !destroyed && !listLoading && !attachmentLoading && !pendingMutations });
  async function runMutation(operation) {
    pendingMutations++; refreshShortcut.sync();
    try { return await createShortcut.runMutation(operation); }
    finally { pendingMutations--; refreshShortcut.sync(); }
  }
  const filterPanel = el("div", "re-filter-panel");
  filterPanel.id = "re-filter-panel";
  filterPanel.hidden = true;
  filterPanel.append(grid, actions);

  const notice = el("p", "og-notice re-notice"); notice.hidden = true;
  const listStatus = el("p", "og-list-status re-list-status"); listStatus.setAttribute("aria-live", "polite");
  const listToolbar = el("div", "re-list-toolbar");
  const sortField = sort.parentElement;
  sortField.classList.add("re-sort-field");
  listToolbar.append(listStatus, sortField);
  form.append(toolbar, filterPanel, listToolbar);
  const cards = el("div", "og-cards re-cards"); cards.setAttribute("aria-label", "Despesas recorrentes");
  const pagination = el("nav", "og-pagination"); pagination.setAttribute("aria-label", "Páginas de despesas recorrentes");
  const previous = el("button", "og-button", "Página anterior"); previous.type = "button";
  const pageLabel = el("span", "og-page-label");
  const next = el("button", "og-button", "Próxima página"); next.type = "button";
  pagination.append(previous, pageLabel, next);
  const detail = el("section", "og-detail re-detail");
  detail.hidden = true;
  detail.tabIndex = -1;
  detail.setAttribute("role", "dialog");
  detail.setAttribute("aria-modal", "true");
  detail.setAttribute("aria-label", "Detalhes da despesa recorrente");
  content.append(form, notice, cards, pagination);
  root.append(header, content, detail);
  doc.body.append(root);
  const loadingScreen = createGalleryLoadingScreen({ root, header, label: 'Carregando despesas recorrentes…' });
  const recordActions = createGalleryRecordActions({
    document: doc, host: root,
    loadEditor: (id, options) => data.loadEditor(id, options),
    saveEditor: (context, fields) => runMutation(() => data.saveEditor(context, fields)),
    deleteItem: (id, options) => runMutation(() => data.deleteItem(id, options)),
    onChanged: () => {
      detail.hidden = true; detail.replaceChildren();
      return loadSnapshot();
    },
  });
  const attachmentCounts = createGalleryAttachmentCounts({
    loadAttachments: row => data.listAttachments(row.id, { refresh: true }),
    onChange: updateAttachmentCount,
  });

  function actualAttachmentCount(row) {
    return attachmentCounts.attachmentsFor(row)?.length ?? knownGalleryAttachmentCount(row) ?? Number(row.hasAttachments === true);
  }

  function renderAttachmentRail(row) {
    const id = text(field(row.fields, ["ID"]) ?? row.id);
    const label = attachmentCounts.label(row);
    const button = el("button", "og-button og-card-attachment-rail");
    button.type = "button";
    button.dataset.action = "attachments";
    button.setAttribute("aria-label", `Abrir anexos da despesa recorrente ${id}: ${label}`);
    button.append(el("span", "og-card-attachment-icon", "📎"), el("span", "og-card-attachment-label", "ANEXOS"),
      el("span", "og-card-attachment-count", label));
    button.addEventListener("click", () => openAttachments(row));
    return button;
  }

  function updateAttachmentCount(row) {
    if (!opened || destroyed) return;
    const card = [...cards.children].find(node => String(node.dataset.itemId) === String(row.id));
    if (!card) return;
    const main = card.querySelector(".og-card-main");
    let retry = main.querySelector('[data-action="retry-attachments"]');
    if (attachmentCounts.hasError(row) && actualAttachmentCount(row) < 1) {
      if (!retry) {
        retry = el("button", "og-button re-attachment-retry", "Falha ao consultar anexos. Tentar novamente");
        retry.type = "button";
        retry.dataset.action = "retry-attachments";
        retry.addEventListener("click", () => {
          retry.disabled = true;
          retry.textContent = "Consultando anexos…";
          void attachmentCounts.load(row, { force: true }).catch(() => null);
        });
        main.append(retry);
      }
      retry.textContent = "Falha ao consultar anexos. Tentar novamente";
      retry.disabled = listLoading || attachmentLoading;
    } else retry?.remove();
    let rail = card.querySelector('.og-card-attachment-rail');
    if (actualAttachmentCount(row) < 1) {
      rail?.remove();
      card.classList.remove("og-card--with-attachments", "re-card--attachments");
      return;
    }
    if (!rail) {
      rail = renderAttachmentRail(row);
      card.insertBefore(rail, card.querySelector(".og-card-main"));
      card.classList.add("og-card--with-attachments", "re-card--attachments");
    }
    const label = attachmentCounts.label(row);
    rail.querySelector('.og-card-attachment-count').textContent = label;
    const id = text(field(row.fields, ["ID"]) ?? row.id);
    rail.setAttribute("aria-label", `Abrir anexos da despesa recorrente ${id}: ${label}`);
    rail.disabled = listLoading || attachmentLoading;
  }

  function updateBusy() {
    loadingScreen.sync(opened && listLoading);
    const busy = opened && (listLoading || attachmentLoading);
    root.setAttribute("aria-busy", String(Boolean(busy)));
    for (const button of root.querySelectorAll("button")) {
      if (button.closest(".gallery-record-dialog")) continue;
      if (button === refreshShortcut.button) continue;
      if (button !== closeButton && button !== homeButton) button.disabled = Boolean(busy);
    }
    previous.disabled = listLoading || page <= 1;
    next.disabled = listLoading || page >= Math.max(1, Math.ceil(filteredRows.length / pageSize));
    createShortcut.sync();
    refreshShortcut.sync();
  }

  function setNotice(message, isError = false) {
    notice.textContent = message;
    notice.hidden = !message;
    notice.setAttribute("role", isError ? "alert" : "status");
    notice.classList.toggle("og-error", isError);
  }

  function populateFilters() {
    for (const [name, , aliases] of FILTERS) {
      const control = controls.get(name);
      const current = control.value;
      const values = [...new Set(rows.map(row => filterValue(row.fields, name, aliases)).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true, sensitivity: "base" }));
      if (current && !values.includes(current)) values.push(current);
      const all = el("option", "", "Todos"); all.value = "";
      control.replaceChildren(all, ...values.map(value => { const option = el("option", "", value); option.value = value; return option; }));
      if (values.includes(current)) control.value = current;
    }
  }

  function sortRows(items) {
    return [...items].sort((left, right) => {
      if (sortValue === "start-date-desc" || sortValue === "start-date-asc") {
        const leftDate = dateKey(field(left.fields, ["DATAINICIO", "DATA INÍCIO"]));
        const rightDate = dateKey(field(right.fields, ["DATAINICIO", "DATA INÍCIO"]));
        if (leftDate && rightDate && leftDate !== rightDate) {
          return sortValue === "start-date-desc" ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate);
        }
        if (leftDate !== rightDate) return leftDate ? -1 : 1;
      }
      if (sortValue === "id-asc") return Number(left.id) - Number(right.id);
      if (sortValue === "monthly-value-desc") {
        const amount = numericValue(field(right.fields, ["VALOR MENSAL"])) - numericValue(field(left.fields, ["VALOR MENSAL"]));
        if (Number.isFinite(amount) && amount) return amount;
      }
      if (sortValue === "modified-desc") {
        const leftDate = Date.parse(text(field(left.fields, ["Modificado", "Modified"])));
        const rightDate = Date.parse(text(field(right.fields, ["Modificado", "Modified"])));
        if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return rightDate - leftDate;
      }
      if (sortValue === "next-date-asc") {
        const leftDate = dateKey(field(left.fields, ["DATAFIM", "DATA PRÓX AGENDAMENTO", "DATAPROXAGENDAMENTO"]));
        const rightDate = dateKey(field(right.fields, ["DATAFIM", "DATA PRÓX AGENDAMENTO", "DATAPROXAGENDAMENTO"]));
        if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        if (leftDate !== rightDate) return leftDate ? -1 : 1;
      }
      return Number(right.id) - Number(left.id);
    });
  }

  function renderList() {
    const pages = Math.ceil(filteredRows.length / pageSize);
    page = Math.min(page, Math.max(1, pages));
    const start = (page - 1) * pageSize;
    const visible = filteredRows.slice(start, start + pageSize);
    cards.replaceChildren(...visible.map(renderCard));
    for (const row of visible) if (attachmentCounts.hasError(row)) updateAttachmentCount(row);
    void attachmentCounts.request(visible);
    const count = filteredRows.length;
    listStatus.textContent = count
      ? `${count} despesa${count === 1 ? "" : "s"} recorrente${count === 1 ? "" : "s"}`
      : "Nenhuma despesa recorrente encontrada para estes filtros.";
    pageLabel.textContent = `Página ${pages ? page : 0} de ${pages}`;
    updateBusy();
  }

  function applyFilters() {
    const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value.trim()]));
    sortValue = values.sort || "start-date-desc";
    const activeCount = FILTERS.reduce((count, [name]) => count + Number(Boolean(values[name])), 0);
    filterCount.textContent = String(activeCount);
    filterCount.hidden = activeCount === 0;
    pageSize = PAGE_SIZES.includes(Number(values.pageSize)) ? Number(values.pageSize) : 10;
    const query = normalized(values.search);
    filteredRows = sortRows(rows.filter(row => {
      const fields = row.fields || {};
      for (const [name, , aliases] of FILTERS) {
        if (values[name] && normalized(filterValue(fields, name, aliases)) !== normalized(values[name])) return false;
      }
      if (query && !matchesGallerySearch(query, [row.id, recurrenceValue(fields),
        ...Object.entries(fields).flatMap(([name, value]) => [value, displayValue(name, value)])])) return false;
      return true;
    }));
    page = 1;
    renderList();
  }

  function appendField(list, label, value, iconName, className = "") {
    if (value == null || value === "") return;
    const pair = el("div", `og-card-field re-card-field${className ? ` ${className}` : ""}`);
    pair.append(icon(iconName, "re-field-icon"), el("dt", "", label), el("dd", "", displayValue(label, value)));
    list.append(pair);
  }

  function appendMetadata(meta, fields) {
    const creator = text(field(fields, ["Criado por", "Author", "Created By"]));
    const createdAt = field(fields, ["Criado", "Created"]);
    const modifiedBy = text(field(fields, ["Modificado por", "Editor", "Modified By"]));
    const modifiedAt = field(fields, ["Modificado", "Modified"]);
    if (!creator && !createdAt && !modifiedAt) return;
    meta.append(icon("info", "re-meta-icon"));
    const lines = el("div", "re-meta-lines");
    if (creator || createdAt) {
      lines.append(el("p", "re-meta-line re-meta-creator", `Adicionado por: ${creator || "—"}`));
      if (createdAt) lines.append(el("p", "re-meta-line re-meta-date", `Em ${formatDateTime(createdAt)}`));
    }
    if (!modifiedAt || !createdAt || Math.abs(Date.parse(text(modifiedAt)) - Date.parse(text(createdAt))) <= 5_000) {
      if (createdAt) lines.append(el("p", "re-meta-line re-meta-modified", "✏️ Sem modificações após criação"));
    } else {
      lines.append(el("p", "re-meta-line re-meta-modified", `✏️ Modificado por: ${modifiedBy || "—"} em ${formatDateTime(modifiedAt)}`));
    }
    meta.append(lines);
  }

  function renderCard(row) {
    const fields = row.fields || {};
    const id = text(field(fields, ["ID"]) ?? row.id);
    const hasAttachmentControl = actualAttachmentCount(row) > 0;
    const card = el("article", `og-card re-card${hasAttachmentControl ? " og-card--with-attachments re-card--attachments" : ""}`);
    card.dataset.itemId = row.id;
    const main = el("div", "og-card-main");
    const product = text(field(fields, ["EQUIPAMENTO", "PRODUTO"]));
    const description = text(field(fields, ["DESCRICAOPGTO", "DESCRIÇÃO PGTO"]));
    const titleText = product || description || "Despesa recorrente";
    const heading = el("header", "og-card-heading re-card-heading");
    const headingText = el("div", "re-heading-text");
    headingText.append(el("h2", "", titleText));
    const statusText = text(field(fields, ["STATUS"]) || "Status não informado");
    const inactive = /inativo|inativa|cancelad/i.test(statusText);
    const status = el("span", `og-status re-status${inactive ? " re-status--inactive" : " re-status--active"}`, statusText);
    headingText.append(status);
    heading.append(el("span", "og-card-id", id), headingText);
    const summary = el("dl", "og-card-fields re-card-fields");
    appendField(summary, "FORNECEDOR", field(fields, ["FORNECEDOR"]), "supplier");
    if (description && normalized(description) !== normalized(titleText)) appendField(summary, "DESCRIÇÃO", description, "product", "re-card-description");
    appendField(summary, "IMÓVEL", field(fields, ["IMOVEL", "IMÓVEL"]), "property");
    appendField(summary, "FILIAL", field(fields, ["FILIAL"]), "branch");
    const valueBand = el("dl", "re-value-band");
    appendField(valueBand, "VALOR MENSAL", field(fields, ["VALOR MENSAL"]), "money", "re-card-field--value");
    appendField(valueBand, "RECORRÊNCIA", recurrenceValue(fields), "calendar", "re-card-field--recurrence");
    const secondary = el("dl", "re-secondary-fields");
    appendField(secondary, "RESPONSÁVEL PGTO", field(fields, ["RESPONSAVEL LOCACAO", "RESPONSÁVEL LOCAÇÃO"]), "person");
    appendField(secondary, "FORMA PGTO", field(fields, ["FORMAPGTO", "FORMA PGTO", "FORMA DE PAGAMENTO"]), "money");
    const dates = el("dl", "re-date-row");
    appendField(dates, "DATA INÍCIO", field(fields, ["DATAINICIO", "DATA INÍCIO"]), "calendar", "re-card-field--start");
    appendField(dates, "PRÓX. AGENDAMENTO", field(fields, ["DATAFIM", "DATA PRÓX AGENDAMENTO", "DATAPROXAGENDAMENTO"]), "calendar", "re-card-field--next");
    const meta = el("div", "re-metadata");
    appendMetadata(meta, fields);

    main.append(heading, summary);
    if (valueBand.childNodes.length) main.append(valueBand);
    if (secondary.childNodes.length) main.append(secondary);
    if (dates.childNodes.length) main.append(dates);
    if (meta.childNodes.length) main.append(meta);
    card.classList.add('gallery-record-card');
    if (hasAttachmentControl) card.append(renderAttachmentRail(row));
    card.append(main, recordActions.render(row));
    return card;
  }

  function renderDetailsTable(row) {
    const table = el("table", "og-data-table");
    const body = el("tbody");
    const entries = Object.entries(row.fields || {});
    if (!entries.some(([name]) => key(name) === "ID")) entries.unshift(["ID", row.id]);
    for (const [name, value] of entries) {
      const tr = el("tr");
      tr.append(el("th", "", name), el("td", "", displayValue(name, name === "RECORRENCIA" ? recurrenceValue(row.fields) : value)));
      body.append(tr);
    }
    if (!entries.some(([name]) => key(name) === "ANEXOS" || key(name) === "TEMANEXOS")) {
      const tr = el("tr");
      tr.append(el("th", "", "ANEXOS"), el("td", "", row.hasAttachments ? "Disponíveis" : "Nenhum"));
      body.append(tr);
    }
    table.append(body);
    return table;
  }

  function closeDetails() {
    detail.hidden = true;
    detail.replaceChildren();
    if (detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
    detailReturnFocus = null;
  }

  function openDetails(row) {
    detailReturnFocus = doc.activeElement;
    const heading = el("header", "og-detail-heading");
    const detailTitle = el("h2", "", `Despesa recorrente ${row.id}`);
    const close = el("button", "og-button", "Fechar detalhes"); close.type = "button";
    close.addEventListener("click", closeDetails);
    heading.append(detailTitle, close);
    detail.replaceChildren(heading, renderDetailsTable(row));
    detail.hidden = false;
    detail.focus({ preventScroll: true });
  }

  async function openAttachments(row) {
    if (attachmentLoading || typeof data.listAttachments !== "function" || typeof data.downloadAttachment !== "function") return;
    const requestSession = session;
    attachmentLoading = true;
    setNotice("");
    updateBusy();
    try {
      const attachments = await attachmentCounts.load(row, { force: true });
      if (!opened || requestSession !== session) return;
      if (!attachments) throw new Error("A consulta de anexos não está disponível.");
      if (!attachments.length) { setNotice("Este item não possui anexos."); return; }
      const items = attachments.map(attachment => ({
        fileName: attachment.fileName,
        source: data.downloadAttachment(row.id, attachment.fileName),
      }));
      if (typeof openMediaCollection === "function") await openMediaCollection(items);
    } catch (error) {
      if (opened && requestSession === session) setNotice(safeFailure(error, "Não foi possível abrir os anexos"), true);
    } finally {
      attachmentLoading = false;
      if (opened && requestSession === session) updateBusy();
    }
  }

  async function loadSnapshot({ refresh = false } = {}) {
    if (!opened || destroyed || listLoading) return;
    attachmentCounts.reset();
    const requestSession = session;
    controller?.abort();
    controller = new AbortController();
    listLoading = true;
    setNotice("");
    listStatus.textContent = '';
    updateBusy();
    try {
      const snapshot = await data.loadSnapshot({ signal: controller.signal, refresh });
      if (!opened || destroyed || !root.isConnected || requestSession !== session) return;
      rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      populateFilters();
      applyFilters();
    } catch (error) {
      if (!opened || destroyed || !root.isConnected || requestSession !== session) return;
      setNotice(safeFailure(error, "Não foi possível carregar as despesas recorrentes"), true);
      listStatus.textContent = "Não foi possível carregar a lista.";
      cards.replaceChildren();
      pageLabel.textContent = "Página 0 de 0";
    } finally {
      if (opened && !destroyed && root.isConnected && requestSession === session) {
        listLoading = false;
        updateBusy();
      }
    }
  }

  const autoFilters = bindAutoFilterForm(form, applyFilters);
  clearButton.addEventListener("click", () => {
    controls.get("search").value = "";
    for (const [name] of FILTERS) controls.get(name).value = "";
    controls.get("sort").value = "start-date-desc";
    controls.get("pageSize").value = "10";
    autoFilters.apply();
  });
  filterButton.addEventListener("click", () => {
    filterPanel.hidden = !filterPanel.hidden;
    filterButton.setAttribute("aria-expanded", String(!filterPanel.hidden));
  });
  previous.addEventListener("click", () => { if (page > 1) { page -= 1; renderList(); } });
  next.addEventListener("click", () => {
    if (page < Math.ceil(filteredRows.length / pageSize)) { page += 1; renderList(); }
  });
  closeButton.addEventListener("click", () => { close(); onClose?.(); });
  homeButton.addEventListener("click", () => { close(); onHome?.(); });
  root.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!detail.hidden) closeDetails();
    else { close(); onClose?.(); }
  });

  async function open() {
    if (destroyed) throw new Error("A Galeria de Despesas Recorrentes foi encerrada.");
    if (opened) return;
    opened = true;
    session += 1;
    returnFocus = doc.activeElement;
    root.hidden = false;
    root.focus({ preventScroll: true });
    await loadSnapshot();
  }

  function close() {
    if (!opened) return;
    recordActions.close();
    autoFilters.cancelPending();
    opened = false;
    session += 1;
    controller?.abort();
    controller = null;
    listLoading = false;
    attachmentLoading = false;
    closeDetails();
    root.hidden = true;
    updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function destroy() {
    if (destroyed) return;
    loadingScreen.destroy();
    createShortcut.destroy();
    refreshShortcut.destroy();
    recordActions.destroy(); autoFilters.destroy();
    close();
    destroyed = true;
    attachmentCounts.destroy();
    root.remove();
  }

  return Object.freeze({ open, close, destroy, reload: loadSnapshot });
}
