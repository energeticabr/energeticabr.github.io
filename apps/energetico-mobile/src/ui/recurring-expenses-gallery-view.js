import { bindAutoFilterForm } from './auto-filter-form.js';
import { createGalleryAttachmentCounts } from './gallery-attachment-counts.js';

const PAGE_SIZES = [10, 20, 50, 100];
const DATE_FIELD = /(data|date|criad|created|modific|modified|prox|agend|in[ií]cio|fim)/i;
const MONEY_FIELDS = new Set(["VALORMENSAL", "VALORARBITRADO", "VALORTOTALESPERADO"]);
const RECURRENCES = new Map([
  ["DAY", "Diário"], ["DAILY", "Diário"], ["DIARIO", "Diário"],
  ["WEEK", "Semanal"], ["WEEKLY", "Semanal"], ["SEMANAL", "Semanal"],
  ["MONTH", "Mensal"], ["MONTHLY", "Mensal"], ["MENSAL", "Mensal"],
  ["YEAR", "Anual"], ["YEARLY", "Anual"], ["ANUAL", "Anual"],
]);
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

  const header = el("header", "og-header");
  const closeButton = el("button", "og-button", "Voltar"); closeButton.type = "button";
  const title = el("h1", "og-title", "GALERIA DESPESAS RECORRENTES");
  const homeButton = el("button", "og-button", "Início"); homeButton.type = "button";
  header.append(closeButton, title, homeButton);

  const content = el("main", "og-content");
  const filterDisclosure = el("details", "og-filters re-filters");
  filterDisclosure.open = true;
  filterDisclosure.append(el("summary", "og-filter-toggle", "Filtros da G19"));
  const form = el("form", "og-filter-form");
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

  addControl("search", "Pesquisar", "input", "search").placeholder = "Descrição, fornecedor, produto ou ID…";
  for (const [name, label] of FILTERS) addControl(name, label);
  const sort = addControl("sort", "Ordenar por");
  for (const [value, label] of [["id-desc", "Maior ID"], ["id-asc", "Menor ID"], ["next-date-asc", "Próximo agendamento"], ["monthly-value-desc", "Maior valor mensal"], ["modified-desc", "Modificado recentemente"]]) {
    const option = el("option", "", label); option.value = value; sort.append(option);
  }
  sort.value = sortValue;
  const pageSizeControl = addControl("pageSize", "Itens por página");
  for (const value of PAGE_SIZES) { const option = el("option", "", String(value)); option.value = String(value); pageSizeControl.append(option); }
  pageSizeControl.value = String(pageSize);

  const actions = el("div", "og-actions");
  const clearButton = el("button", "og-button", "Limpar filtros"); clearButton.type = "button";
  const refreshButton = el("button", "og-button", "Atualizar dados"); refreshButton.type = "button";
  actions.append(clearButton, refreshButton);
  form.append(grid, actions);
  filterDisclosure.append(form);

  const notice = el("p", "og-notice re-notice"); notice.hidden = true;
  const listStatus = el("p", "og-list-status re-list-status"); listStatus.setAttribute("aria-live", "polite");
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
  content.append(filterDisclosure, notice, listStatus, cards, pagination);
  root.append(header, content, detail);
  doc.body.append(root);
  const attachmentCounts = createGalleryAttachmentCounts({
    loadAttachments: row => data.listAttachments(row.id, { refresh: true }),
    onChange: updateAttachmentCount,
  });

  function updateAttachmentCount(row) {
    if (!opened || destroyed) return;
    const card = [...cards.children].find(node => String(node.dataset.itemId) === String(row.id));
    const count = card?.querySelector('.og-card-attachment-count');
    const label = attachmentCounts.label(row);
    if (count) count.textContent = label;
    const id = text(field(row.fields, ["ID"]) ?? row.id);
    card?.querySelector('.og-card-attachment-rail')?.setAttribute("aria-label", `Abrir anexos da despesa recorrente ${id}: ${label}`);
  }

  function updateBusy() {
    const busy = opened && (listLoading || attachmentLoading);
    root.setAttribute("aria-busy", String(Boolean(busy)));
    for (const button of root.querySelectorAll("button")) {
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
    }
  }

  function sortRows(items) {
    return [...items].sort((left, right) => {
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
    sortValue = values.sort || "id-desc";
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

  function appendField(list, label, value) {
    if (value == null || value === "") return;
    const pair = el("div", "og-card-field re-card-field");
    pair.append(el("dt", "", label), el("dd", "", displayValue(label, value)));
    list.append(pair);
  }

  function metadata(fields) {
    const creator = text(field(fields, ["Criado por", "Author", "Created By"]));
    const createdAt = field(fields, ["Criado", "Created"]);
    const modifiedBy = text(field(fields, ["Modificado por", "Editor", "Modified By"]));
    const modifiedAt = field(fields, ["Modificado", "Modified"]);
    const lines = [];
    if (creator || createdAt) lines.push(`🕒 ADICIONADO POR: ${creator || "—"}${createdAt ? ` EM ${formatDateTime(createdAt)}` : ""}`);
    if (!modifiedAt || !createdAt || Math.abs(Date.parse(text(modifiedAt)) - Date.parse(text(createdAt))) <= 5_000) {
      if (createdAt) lines.push("✏️ SEM MODIFICAÇÕES APÓS CRIAÇÃO");
    } else {
      lines.push(`✏️ MODIFICADO POR: ${modifiedBy || "—"} EM ${formatDateTime(modifiedAt)}`);
    }
    return lines;
  }

  function renderCard(row) {
    const fields = row.fields || {};
    const id = text(field(fields, ["ID"]) ?? row.id);
    const hasAttachmentControl = row.hasAttachments !== false;
    const card = el("article", `og-card re-card${hasAttachmentControl ? " og-card--with-attachments re-card--attachments" : ""}`);
    card.dataset.itemId = row.id;
    const main = el("div", "og-card-main");
    const titleText = text(field(fields, ["DESCRICAOPGTO", "DESCRIÇÃO PGTO"]) || field(fields, ["EQUIPAMENTO", "PRODUTO"]) || "Despesa recorrente");
    const heading = el("header", "og-card-heading re-card-heading");
    heading.append(el("span", "og-card-id", id), el("h2", "", titleText));
    const statusText = text(field(fields, ["STATUS"]) || "Status não informado");
    const inactive = /inativo|inativa|cancelad/i.test(statusText);
    const status = el("span", `og-status re-status${inactive ? " re-status--inactive" : " re-status--active"}`, statusText);
    const summary = el("dl", "og-card-fields re-card-fields");
    appendField(summary, "FORNECEDOR", field(fields, ["FORNECEDOR"]));
    appendField(summary, "PRODUTO/EQUIPAMENTO", field(fields, ["EQUIPAMENTO", "PRODUTO"]));
    appendField(summary, "IMÓVEL", field(fields, ["IMOVEL", "IMÓVEL"]));
    appendField(summary, "FILIAL", field(fields, ["FILIAL"]));
    appendField(summary, "VALOR MENSAL", field(fields, ["VALOR MENSAL"]));
    appendField(summary, "FORMA PGTO", field(fields, ["FORMAPGTO", "FORMA PGTO", "FORMA DE PAGAMENTO"]));
    appendField(summary, "RESPONSÁVEL PGTO", field(fields, ["RESPONSAVEL LOCACAO", "RESPONSÁVEL LOCAÇÃO"]));
    appendField(summary, "RECORRÊNCIA", field(fields, ["RECORRENCIA", "RECORRÊNCIA"]) ?? field(fields, ["RECORRENCIADIAS"]));
    appendField(summary, "DATA INÍCIO", field(fields, ["DATAINICIO", "DATA INÍCIO"]));
    appendField(summary, "PRÓX. AGENDAMENTO", field(fields, ["DATAFIM", "DATA PRÓX AGENDAMENTO", "DATAPROXAGENDAMENTO"]));
    const meta = el("div", "re-metadata");
    for (const line of metadata(fields)) meta.append(el("p", "re-meta-line", line));

    const actions = el("div", "og-card-actions re-card-actions");
    const detailsButton = el("button", "og-button og-button--detail", "Detalhes");
    detailsButton.type = "button";
    detailsButton.dataset.action = "details";
    detailsButton.addEventListener("click", () => openDetails(row));
    actions.append(detailsButton);
    main.append(heading, status, summary);
    if (meta.childNodes.length) main.append(meta);
    main.append(actions);
    if (hasAttachmentControl) {
      const attachmentButton = el("button", "og-button og-card-attachment-rail");
      attachmentButton.type = "button";
      attachmentButton.dataset.action = "attachments";
      attachmentButton.setAttribute("aria-label", `Abrir anexos da despesa recorrente ${id}: ${attachmentCounts.label(row)}`);
      attachmentButton.append(el("span", "og-card-attachment-icon", "📎"), el("span", "og-card-attachment-label", "ANEXOS"),
        el("span", "og-card-attachment-count", attachmentCounts.label(row)));
      attachmentButton.addEventListener("click", () => openAttachments(row));
      card.append(attachmentButton);
    }
    card.append(main);
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

  async function loadSnapshot() {
    if (!opened || listLoading) return;
    attachmentCounts.reset();
    const requestSession = session;
    controller?.abort();
    controller = new AbortController();
    listLoading = true;
    setNotice("");
    listStatus.textContent = "Carregando despesas recorrentes…";
    updateBusy();
    try {
      const snapshot = await data.loadSnapshot({ signal: controller.signal });
      if (!opened || requestSession !== session) return;
      rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      populateFilters();
      applyFilters();
    } catch (error) {
      if (!opened || requestSession !== session) return;
      setNotice(safeFailure(error, "Não foi possível carregar as despesas recorrentes"), true);
      listStatus.textContent = "Não foi possível carregar a lista.";
      cards.replaceChildren();
      pageLabel.textContent = "Página 0 de 0";
    } finally {
      if (opened && requestSession === session) {
        listLoading = false;
        updateBusy();
      }
    }
  }

  const autoFilters = bindAutoFilterForm(form, applyFilters);
  clearButton.addEventListener("click", () => {
    controls.get("search").value = "";
    for (const [name] of FILTERS) controls.get(name).value = "";
    controls.get("sort").value = "id-desc";
    controls.get("pageSize").value = "10";
    autoFilters.apply();
  });
  refreshButton.addEventListener("click", () => { if (!listLoading) void loadSnapshot(); });
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
    autoFilters.destroy();
    close();
    destroyed = true;
    attachmentCounts.destroy();
    root.remove();
  }

  return Object.freeze({ open, close, destroy, reload: loadSnapshot });
}
