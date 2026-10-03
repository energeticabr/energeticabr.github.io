import { createLoadingIndicator } from "./loading-indicator.js";
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { createGalleryRecordActions } from './gallery-record-actions.js';
import { bindAutoFilterForm } from './auto-filter-form.js';
import { createGalleryAttachmentCounts, knownGalleryAttachmentCount } from './gallery-attachment-counts.js';
import { provisionTotal } from '../chat/pending-provision-dates.js';

const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_STATUS = "PAGAMENTO PREVISTO";
const DATE_FIELD = /(data|date|criad|created|modific|modified|previst|agend|execu)/i;
const FILTERS = Object.freeze([
  ["recurrenceId", "ID recorrência", ["IDRECORRENCIA"]],
  ["type", "Tipo", ["TIPO", "TIPOPGTO", "TIPO DE PAGAMENTO"]],
  ["product", "Produto", ["PRODUTO", "DESCRICAOPGTO", "DESCRIÇÃO PGTO"]],
  ["supplier", "Fornecedor", ["FORNECEDOR"]],
  ["status", "Status", ["STATUS"]],
  ["branch", "Filial", ["FILIAL"]],
  ["property", "Imóvel", ["IMOVEL", "IMÓVEL"]],
]);

function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const name of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title", "Email", "email"]) {
      if (value[name] != null) return text(value[name]);
    }
    return value instanceof Date ? value.toISOString() : "";
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
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return { year: Number(br[3]), month: Number(br[2]), day: Number(br[1]) };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo" }).formatToParts(date);
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

function numericValue(value) {
  if (typeof value === "number") return value;
  const raw = text(value).trim().replace(/[^\d,.-]/g, "");
  if (!raw) return NaN;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function paymentTotal(fields) {
  return provisionTotal(text(field(fields, ["VALOR TOTAL", "VALORTOTAL"])),
    text(field(fields, ["QTD", "QUANTIDADE"])), text(field(fields, ["FRETE"])));
}

function displayValue(name, value) {
  const date = formatDate(name, value);
  if (date) return date;
  if (key(name) === "VALORTOTAL") {
    const amount = numericValue(value);
    if (Number.isFinite(amount)) return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (key(name) === "PGTOAGENDADO" && typeof value === "boolean") return value ? "AGENDADO" : "PENDENTE";
  return text(value) || "—";
}

function filterValue(fields, name, aliases) {
  const value = field(fields, aliases);
  if (value != null) return text(value).trim();
  if (name === "type") {
    const scheduled = field(fields, ["PGTOAGENDADO"]);
    if (typeof scheduled === "boolean") return scheduled ? "AGENDADO" : "NÃO AGENDADO";
    const scheduleStatus = normalized(scheduled);
    if (scheduleStatus === "pendente") return "NÃO AGENDADO";
    if (scheduleStatus === "pagamento agendado") return "AGENDADO";
    if (scheduleStatus === "pago") return "PAGO";
    if (text(scheduled).trim()) return text(scheduled).trim();
  }
  return "";
}

function paymentTiming(fields, now) {
  const paidAt = field(fields, ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO"]);
  if (paidAt) return `PAGO EM ${formatDate("DATA PGTO EFETUADO", paidAt)}`;
  const due = dateKey(field(fields, ["DATA PREVISTO PGTO", "DATAPGTOPREVISTO"]));
  const today = dateKey(now);
  if (!due || !today) return "";
  const difference = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (difference < 0) {
    const days = Math.abs(difference);
    return `VENCIDO HÁ ${days} ${days === 1 ? "DIA" : "DIAS"}`;
  }
  if (difference === 0) return "VENCE HOJE";
  return `VENCE EM ${difference} ${difference === 1 ? "DIA" : "DIAS"}`;
}

function paymentScheduleSummary(fields) {
  const rawStatus = field(fields, ["PGTOAGENDADO"]);
  const status = typeof rawStatus === "boolean" ? (rawStatus ? "AGENDADO" : "PENDENTE") : text(rawStatus).trim();
  const scheduledAt = formatDate("DATAPGTOAGENDADO", field(fields, ["DATAPGTOAGENDADO"]));
  const executionAt = formatDate("DATAEXECUCAOAGENDAMENTO", field(fields, ["DATAEXECUCAOAGENDAMENTO"]));
  const hasStatus = Boolean(status);

  const scheduleStatus = normalized(status);
  if (scheduleStatus === "pendente") return "PGTO NÃO AGENDADO";
  if (scheduleStatus === "pago") return "PGTO PAGO";
  if (hasStatus && scheduledAt && executionAt) return `PGTO AGENDADO EM ${scheduledAt} PARA PGTO EM ${executionAt}`;
  if (scheduledAt && executionAt) return `AGENDAMENTO REALIZADO EM ${scheduledAt} PARA PGTO EM ${executionAt}`;
  if (hasStatus && scheduledAt) return `PGTO AGENDADO EM ${scheduledAt}`;
  if (hasStatus && executionAt) return `PGTO AGENDADO PARA PGTO EM ${executionAt}`;
  if (scheduledAt) return `AGENDAMENTO REALIZADO EM ${scheduledAt}`;
  if (executionAt) return `PGTO PREVISTO PARA ${executionAt}`;
  return hasStatus ? "PGTO AGENDADO" : "PGTO NÃO AGENDADO";
}

function safeFailure(error, fallback) {
  const message = String(error?.message || fallback)
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
  return `${fallback}: ${message}. Verifique a conexão e tente novamente.`;
}

export function createPaymentProgrammingGallery({
  document: documentRef = globalThis.document,
  data,
  openMediaCollection,
  onClose,
  onHome,
  now = () => new Date(),
} = {}) {
  if (!documentRef?.body || typeof data?.loadSnapshot !== "function") {
    throw new TypeError("Documento e serviço da Galeria de Programação de Pagamentos são obrigatórios.");
  }
  const doc = documentRef;
  const el = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  let opened = false;
  let destroyed = false;
  let session = 0;
  let detailSession = 0;
  let controller = null;
  let returnFocus = null;
  let rows = [];
  let filteredRows = [];
  let page = 1;
  let pageSize = 10;
  let sortValue = "due-asc";
  let listLoading = false;
  let attachmentLoading = false;

  const root = el("section", "og-overlay pg-overlay");
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Galeria Programação de Pagamentos");
  root.setAttribute("aria-busy", "false");

  const header = el("header", "og-header");
  const closeButton = el("button", "og-button", "Voltar"); closeButton.type = "button";
  const title = el("h1", "og-title", "GALERIA PROGRAMAÇÃO DE PAGAMENTOS");
  const homeButton = el("button", "og-button", "Início"); homeButton.type = "button";
  header.append(closeButton, title, homeButton);

  const content = el("main", "og-content");
  const filterDisclosure = el("details", "og-filters pg-filters");
  const filterToggle = el("summary", "og-filter-toggle", "Filtros");
  const filterIcon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  filterIcon.setAttribute("viewBox", "0 0 24 24");
  filterIcon.setAttribute("fill", "none");
  filterIcon.setAttribute("stroke", "currentColor");
  filterIcon.setAttribute("stroke-width", "2.5");
  filterIcon.setAttribute("aria-hidden", "true");
  const filterPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  filterPath.setAttribute("d", "M3 5h18M6 10h12l-5 6v4l-2-1v-3l-5-6Z");
  filterIcon.append(filterPath);
  filterToggle.prepend(filterIcon);
  filterDisclosure.append(filterToggle);
  const form = el("form", "og-filter-form");
  form.setAttribute("aria-label", "Filtros da Galeria de Programação de Pagamentos G28");
  const grid = el("div", "og-filter-grid pg-filter-grid");
  const controls = new Map();
  let filtersPopulated = false;

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

  addControl("search", "Pesquisar na descrição", "input", "search").placeholder = "Descrição, fornecedor ou ID…";
  for (const [name, label] of FILTERS) addControl(name, label);
  const sort = addControl("sort", "Ordenar por");
  for (const [value, label] of [["due-asc", "Vencimento mais próximo"], ["due-desc", "Vencimento mais distante"], ["id-desc", "Maior ID"], ["modified-desc", "Modificado recentemente"]]) {
    const option = el("option", "", label); option.value = value; sort.append(option);
  }
  sort.value = sortValue;
  const sortField = sort.parentElement;
  sortField.classList.add("pg-sort-field");
  const pageSizeControl = addControl("pageSize", "Itens por página");
  for (const value of PAGE_SIZES) { const option = el("option", "", String(value)); option.value = String(value); pageSizeControl.append(option); }
  pageSizeControl.value = String(pageSize);

  const actions = el("div", "og-actions");
  const clearButton = el("button", "og-button", "Limpar filtros"); clearButton.type = "button";
  const refreshButton = el("button", "og-button", "Atualizar dados"); refreshButton.type = "button";
  actions.append(clearButton, refreshButton);
  form.append(grid, actions);
  filterDisclosure.append(form);

  const notice = el("p", "og-notice pg-notice"); notice.hidden = true;
  const listStatus = el("p", "og-list-status pg-list-status"); listStatus.setAttribute("aria-live", "polite");
  const listToolbar = el("div", "pg-list-toolbar");
  listToolbar.append(listStatus, sortField);
  const cards = el("div", "og-cards pg-cards"); cards.setAttribute("aria-label", "Programação de pagamentos");
  const pagination = el("nav", "og-pagination"); pagination.setAttribute("aria-label", "Páginas de programação de pagamentos");
  const previous = el("button", "og-button", "Página anterior"); previous.type = "button";
  const pageLabel = el("span", "og-page-label");
  const next = el("button", "og-button", "Próxima página"); next.type = "button";
  pagination.append(previous, pageLabel, next);
  const detail = el("section", "og-detail pg-detail");
  detail.hidden = true;
  detail.tabIndex = -1;
  detail.setAttribute("role", "dialog");
  detail.setAttribute("aria-modal", "true");
  detail.setAttribute("aria-label", "Detalhes do pagamento previsto");
  content.append(filterDisclosure, notice, listToolbar, cards, pagination);
  root.append(header, content, detail);
  doc.body.append(root);
  const searchableSort = bindSearchableFilterSelects(listToolbar);
  const recordActions = createGalleryRecordActions({
    document: doc, host: root,
    loadEditor: (id, options) => data.loadEditor(id, options),
    saveEditor: (context, fields) => data.saveEditor(context, fields),
    deleteItem: (id, options) => data.deleteItem(id, options),
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
    const attachments = attachmentCounts.attachmentsFor(row);
    return attachments ? attachments.length : knownGalleryAttachmentCount(row) ?? (row.hasAttachments === true ? 1 : 0);
  }

  function renderAttachmentRail(row) {
    const id = text(field(row.fields, ["ID"]) ?? row.id);
    const rail = el("button", "og-button og-card-attachment-rail pg-attachment-rail");
    rail.type = "button";
    rail.dataset.action = "attachments";
    rail.setAttribute("aria-label", `Abrir anexos do pagamento ${id}: ${attachmentCounts.label(row)}`);
    rail.append(el("span", "og-card-attachment-icon", "📎"), el("span", "og-card-attachment-label", "ANEXOS"),
      el("span", "og-card-attachment-count", attachmentCounts.label(row)));
    rail.addEventListener("click", () => openAttachments(row));
    return rail;
  }

  function updateAttachmentCount(row) {
    if (!opened || destroyed) return;
    const card = [...cards.children].find(node => String(node.dataset.itemId) === String(row.id));
    if (!card) return;
    const main = card.querySelector(".og-card-main");
    let retry = main.querySelector('[data-action="retry-attachments"]');
    if (attachmentCounts.hasError(row) && actualAttachmentCount(row) < 1) {
      if (!retry) {
        retry = el("button", "og-button pg-attachment-retry", "Falha ao consultar anexos. Tentar novamente");
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
    let rail = card.querySelector(".pg-attachment-rail");
    if (actualAttachmentCount(row) < 1) {
      rail?.remove();
      card.classList.remove("og-card--with-attachments", "pg-card--attachments");
      return;
    }
    if (!rail) {
      rail = renderAttachmentRail(row);
      card.insertBefore(rail, main);
      card.classList.add("og-card--with-attachments", "pg-card--attachments");
    }
    const label = attachmentCounts.label(row);
    rail.querySelector('.og-card-attachment-count').textContent = label;
    const id = text(field(row.fields, ["ID"]) ?? row.id);
    rail.setAttribute("aria-label", `Abrir anexos do pagamento ${id}: ${label}`);
    rail.disabled = listLoading || attachmentLoading;
  }

  function updateBusy() {
    const busy = opened && (listLoading || attachmentLoading);
    root.setAttribute("aria-busy", String(Boolean(busy)));
    for (const button of root.querySelectorAll("button")) {
      if (button.closest(".gallery-record-dialog")) continue;
      if (button !== closeButton && button !== homeButton) button.disabled = Boolean(busy);
    }
    previous.disabled = listLoading || page <= 1;
    next.disabled = listLoading || page >= Math.max(1, Math.ceil(filteredRows.length / pageSize));
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
      const all = el("option", "", "Todos"); all.value = "";
      control.replaceChildren(all, ...values.map(value => { const option = el("option", "", value); option.value = value; return option; }));
      if (values.includes(current)) control.value = current;
      else if (name === "status" && (!filtersPopulated || current)) {
        control.value = values.find(value => key(value) === key(DEFAULT_STATUS)) || "";
      }
    }
    filtersPopulated = true;
  }

  function sortRows(items) {
    return [...items].sort((left, right) => {
      if (sortValue === "id-desc") return Number(right.id) - Number(left.id);
      if (sortValue === "modified-desc") {
        const leftDate = Date.parse(text(field(left.fields, ["Modificado", "Modified"])));
        const rightDate = Date.parse(text(field(right.fields, ["Modificado", "Modified"])));
        if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return rightDate - leftDate;
      } else {
        const leftDue = dateKey(field(left.fields, ["DATA PREVISTO PGTO", "DATAPGTOPREVISTO"]));
        const rightDue = dateKey(field(right.fields, ["DATA PREVISTO PGTO", "DATAPGTOPREVISTO"]));
        if (leftDue && rightDue && leftDue !== rightDue) return sortValue === "due-desc" ? rightDue.localeCompare(leftDue) : leftDue.localeCompare(rightDue);
        if (leftDue !== rightDue) return leftDue ? -1 : 1;
      }
      return Number(left.id) - Number(right.id);
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
    const defaultStatusSelected = key(controls.get("status").value) === key(DEFAULT_STATUS);
    listStatus.textContent = filteredRows.length ? `${filteredRows.length} pagamento(s)${defaultStatusSelected ? " previsto(s)" : ""}` : "Nenhum pagamento encontrado para estes filtros.";
    pageLabel.textContent = `Página ${pages ? page : 0} de ${pages}`;
    updateBusy();
  }

  function applyFilters() {
    const values = Object.fromEntries([...controls].map(([name, control]) => [name, control.value.trim()]));
    sortValue = values.sort || "due-asc";
    pageSize = PAGE_SIZES.includes(Number(values.pageSize)) ? Number(values.pageSize) : 10;
    const query = normalized(values.search);
    filteredRows = sortRows(rows.filter(row => {
      const fields = row.fields || {};
      if (query && !normalized([row.id, ...Object.values(fields).map(text)].join(" ")).includes(query)) return false;
      for (const [name, , aliases] of FILTERS) {
        if (values[name] && normalized(filterValue(fields, name, aliases)) !== normalized(values[name])) return false;
      }
      return true;
    }));
    page = 1;
    renderList();
  }

  function appendSummaryField(list, label, value, icon, { wide = false } = {}) {
    const pair = el("div", `og-card-field pg-card-field pg-summary-field${wide ? " pg-summary-field--wide" : ""}${label === "OBS" ? " pg-observation" : ""}`);
    pair.dataset.field = label;
    const symbol = el("span", "pg-summary-icon", icon);
    symbol.setAttribute("aria-hidden", "true");
    const visibleLabel = {
      "DATA PREVISTA PGTO": "Data prevista pgto", "VALOR TOTAL": "Valor total", QTD: "Qtd.",
      FILIAL: "Filial", "IMÓVEL": "Imóvel", AGENDAMENTO: "Agendamento",
    }[label] || label;
    pair.append(symbol, el("dt", "", visibleLabel), el("dd", "", displayValue(label, value)));
    list.append(pair);
  }

  function renderCard(row) {
    const fields = row.fields || {};
    const id = text(field(fields, ["ID"]) ?? row.id);
    const hasAttachments = actualAttachmentCount(row) > 0;
    const card = el("article", `og-card pg-card${hasAttachments ? " og-card--with-attachments pg-card--attachments" : ""}`);
    card.dataset.itemId = row.id;
    const main = el("div", "og-card-main");
    const heading = el("header", "og-card-heading pg-card-heading");
    const headingCopy = el("div", "pg-heading-copy");
    headingCopy.append(el("h2", "", text(field(fields, ["FORNECEDOR"]) || "Fornecedor não informado")));
    heading.append(el("span", "og-card-id", id), headingCopy);
    const statusText = text(field(fields, ["STATUS"]) || "Status não informado");
    const paid = /pago|efetuado|quitado/i.test(statusText);
    const pending = /pendente|previst/i.test(statusText);
    const status = el("span", `og-status pg-status${pending ? " og-status--pending" : paid ? " pg-status--paid" : ""}`, statusText);
    const timingText = paymentTiming(fields, now());
    const timing = timingText ? el("p", `pg-deadline${timingText.startsWith("VENCIDO") ? " pg-deadline--overdue" : timingText === "VENCE HOJE" ? " pg-deadline--today" : ""}`, timingText) : null;
    if (timing) headingCopy.append(timing);
    if (!timing || key(statusText) !== key(DEFAULT_STATUS)) headingCopy.append(status);
    const description = text(field(fields, ["DESCRICAOPGTO", "DESCRIÇÃO PGTO", "PRODUTO"]) || "").trim();
    const descriptionBand = description ? el("div", "pg-description") : null;
    if (descriptionBand) descriptionBand.append(el("span", "pg-description-label", "Descrição"), el("strong", "", description));
    const summary = el("dl", "og-card-fields pg-card-fields pg-card-grid");
    appendSummaryField(summary, "DATA PREVISTA PGTO", field(fields, ["DATA PREVISTO PGTO", "DATAPGTOPREVISTO"]), "▣");
    appendSummaryField(summary, "VALOR TOTAL", paymentTotal(fields), "$");
    appendSummaryField(summary, "QTD", field(fields, ["QTD", "QUANTIDADE"]), "◇");
    appendSummaryField(summary, "FILIAL", field(fields, ["FILIAL"]), "▦");
    appendSummaryField(summary, "IMÓVEL", field(fields, ["IMOVEL", "IMÓVEL"]), "⌂");
    appendSummaryField(summary, "AGENDAMENTO", paymentScheduleSummary(fields), "◷");
    const observation = text(field(fields, ["OBS", "OBSERVACAO", "OBSERVAÇÃO"]) || "").trim();
    main.append(heading);
    if (descriptionBand) main.append(descriptionBand);
    main.append(summary);
    const extra = el("dl", "pg-card-extra");
    const paidAt = field(fields, ["DATA PGTO EFETUADO", "DATAPGTOEFETUADO"]);
    if (paidAt) appendSummaryField(extra, "DATA DO PAGAMENTO", paidAt, "▣");
    if (observation) appendSummaryField(extra, "OBS", observation, "▤", { wide: true });
    if (extra.children.length) main.append(extra);
    card.classList.add('gallery-record-card');
    card.append(main, recordActions.render(row));
    if (hasAttachments) card.insertBefore(renderAttachmentRail(row), main);
    return card;
  }

  function renderDetailsTable(row) {
    const table = el("table", "og-data-table");
    const body = el("tbody");
    const entries = Object.entries(row.fields || {});
    if (!entries.some(([name]) => key(name) === "ID")) entries.unshift(["ID", row.id]);
    for (const [name, value] of entries) {
      const tr = el("tr");
      const isTotal = key(name) === "VALORTOTAL";
      tr.append(el("th", "", name), el("td", "", displayValue(name, isTotal ? paymentTotal(row.fields) : value)));
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

  function openDetails(row) {
    const current = ++detailSession;
    const heading = el("header", "og-detail-heading");
    heading.append(el("h2", "", `Pagamento previsto #${text(field(row.fields, ["ID"]) ?? row.id)}`));
    const closeButton = el("button", "og-button", "Fechar detalhes"); closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      if (current !== detailSession) return;
      detail.hidden = true;
      detail.replaceChildren();
    });
    heading.append(closeButton);
    detail.replaceChildren(heading, renderDetailsTable(row));
    detail.hidden = false;
    detail.focus({ preventScroll: true });
  }

  async function openAttachments(row) {
    if (attachmentLoading || !opened || destroyed) return;
    const current = session;
    attachmentLoading = true;
    setNotice("");
    updateBusy();
    try {
      const attachments = await attachmentCounts.load(row, { force: true });
      if (!opened || destroyed || current !== session) return;
      if (!attachments) throw new Error("A consulta de anexos não está disponível.");
      if (!attachments.length) { setNotice(`O pagamento previsto #${row.id} não possui anexos.`); return; }
      if (typeof openMediaCollection !== "function") throw new Error("O visualizador de anexos não está disponível neste aparelho.");
      await openMediaCollection(attachments.map(item => ({ fileName: item.fileName, source: data.downloadAttachment(row.id, item.fileName) })));
    } catch (error) {
      if (opened && !destroyed && current === session) setNotice(safeFailure(error, `Não foi possível abrir os anexos do pagamento #${row.id}`), true);
    } finally {
      if (opened && !destroyed && current === session) { attachmentLoading = false; updateBusy(); }
    }
  }

  async function loadSnapshot() {
    if (!opened || destroyed) return false;
    attachmentCounts.reset();
    const current = session;
    controller?.abort();
    controller = new AbortController();
    listLoading = true;
    setNotice("");
    listStatus.replaceChildren(createLoadingIndicator(doc, "Carregando programação de pagamentos…"));
    cards.replaceChildren();
    updateBusy();
    try {
      const result = await data.loadSnapshot({ signal: controller.signal });
      if (!opened || destroyed || current !== session) return false;
      if (!Array.isArray(result?.rows)) throw new Error("A consulta não retornou uma lista de pagamentos válida.");
      rows = result.rows.filter(row => /^\d{1,15}$/.test(String(row?.id || "")));
      populateFilters();
      autoFilters.sync();
      applyFilters();
      return true;
    } catch (error) {
      if (!opened || destroyed || current !== session || error?.name === "AbortError") return false;
      setNotice(safeFailure(error, "Não foi possível carregar a programação de pagamentos"), true);
      listStatus.textContent = "Não foi possível carregar a programação de pagamentos.";
      const retry = el("button", "og-button og-button--primary", "Tentar novamente");
      retry.type = "button";
      retry.addEventListener("click", () => { void loadSnapshot(); });
      cards.replaceChildren(retry);
      return false;
    } finally {
      if (opened && !destroyed && current === session) { listLoading = false; updateBusy(); }
    }
  }

  const autoFilters = bindAutoFilterForm(form, applyFilters);
  sort.addEventListener("change", () => autoFilters.apply());
  clearButton.addEventListener("click", () => {
    for (const [name, control] of controls) control.value = name === "status" ? DEFAULT_STATUS : name === "sort" ? "due-asc" : name === "pageSize" ? "10" : "";
    sortValue = "due-asc";
    pageSize = 10;
    autoFilters.apply();
    searchableSort.sync();
  });
  refreshButton.addEventListener("click", () => { void loadSnapshot(); });
  previous.addEventListener("click", () => { if (page > 1) { page -= 1; renderList(); } });
  next.addEventListener("click", () => { if (page < Math.ceil(filteredRows.length / pageSize)) { page += 1; renderList(); } });
  closeButton.addEventListener("click", () => { close(); onClose?.(); });
  homeButton.addEventListener("click", () => { close(); onHome?.(); });

  async function open() {
    if (destroyed) throw new Error("A Galeria de Programação de Pagamentos foi encerrada.");
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
    searchableSort.close();
    autoFilters.cancelPending();
    opened = false;
    session += 1;
    controller?.abort();
    controller = null;
    listLoading = false;
    attachmentLoading = false;
    detail.hidden = true;
    detail.replaceChildren();
    root.hidden = true;
    updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function destroy() {
    if (destroyed) return;
    recordActions.destroy(); searchableSort.destroy(); autoFilters.destroy();
    close();
    destroyed = true;
    attachmentCounts.destroy();
    root.remove();
  }

  return Object.freeze({ open, close, destroy, reload: loadSnapshot });
}
