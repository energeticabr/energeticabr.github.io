const PAGE_SIZES = [10, 20, 50, 100];
const SORTS = [
  ["id-desc", "MAIOR ID"],
  ["payment-desc", "DATA DE PAGAMENTO (RECENTE)"],
  ["invoice-asc", "NOTA FISCAL (A–Z)"],
  ["created-asc", "CRIADO MAIS ANTIGO"],
  ["created-desc", "CRIADO MAIS RECENTE"],
  ["modified-desc", "MODIFICADO MAIS RECENTE"],
];
const FILTERS = [
  ["branch", "Filial", "FILIAL"],
  ["supplier", "Fornecedor", "FORNECEDOR"],
  ["status", "Status", "STATUS"],
  ["paymentForm", "Forma de pagamento", "FORMAPGTO"],
  ["invoice", "Nota fiscal", "NOTA FISCAL"],
];
const DATE_FIELD = /(data|date|criad|modific|modified|pagamento|pgto|liquid|venc|audit)/i;
const FIELD_ALIASES = Object.freeze({
  branch: ["FILIAL"], supplier: ["FORNECEDOR"], status: ["STATUS"], total: ["VALORTOTAL", "VALOR TOTAL"],
  paymentForm: ["FORMAPGTO", "FORMA PGTO", "FORMA DE PAGAMENTO"], invoice: ["NOTA FISCAL"],
  paymentDate: ["DATAPGTOEFETUADO", "DATA PGTO EFETUADO"], created: ["CRIADO", "CREATED"],
  modified: ["MODIFICADO", "MODIFIED"],
});

function key(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9]/g, "");
}
function field(fields, aliases) {
  const accepted = new Set(aliases.map(key));
  const entry = Object.entries(fields || {}).find(([name, value]) => accepted.has(key(name)) && value != null);
  return entry?.[1];
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
function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}
function formatDate(name, value) {
  if (!DATE_FIELD.test(name) || value == null || value === "") return null;
  const raw = text(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(instant);
}
function formatValue(name, value) {
  const date = formatDate(name, value);
  if (date) return date;
  if (/^VALORTOTAL$|^VALOR TOTAL$/i.test(key(name)) && value !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return text(value) || "—";
}
function safeFailure(error, fallback) {
  const message = String(error?.message || fallback).replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]").replace(/[\r\n]+/g, " ").slice(0, 240);
  return `${fallback}: ${message}. Verifique a conexão e tente novamente.`;
}

export function createOrdersGallery({
  document: documentRef = globalThis.document,
  data,
  openMediaCollection,
  onClose,
  onHome,
} = {}) {
  if (!documentRef?.body || typeof data?.loadSnapshot !== "function") {
    throw new TypeError("Documento e serviço de pedidos são obrigatórios.");
  }
  const doc = documentRef;
  const el = (tag, className, label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  let opened = false;
  let destroyed = false;
  let session = 0;
  let returnFocus = null;
  let rows = [];
  let filteredRows = [];
  let page = 1;
  let pageSize = 10;
  let listLoading = false;
  let attachmentLoading = false;
  let snapshotError = null;
  let filterValues = Object.create(null);
  let sortValue = "id-desc";
  let controller = null;
  let detailsSession = 0;

  const root = el("section", "og-overlay");
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Galeria Pedidos");
  root.setAttribute("aria-busy", "false");
  const header = el("header", "og-header");
  const closeButton = el("button", "og-button", "Voltar");
  closeButton.type = "button";
  const title = el("h1", "og-title", "GALERIA PEDIDOS");
  const homeButton = el("button", "og-button", "Início");
  homeButton.type = "button";
  header.append(closeButton, title, homeButton);
  const content = el("main", "og-content");
  const filterDisclosure = el("details", "og-filters");
  filterDisclosure.append(el("summary", "og-filter-toggle", "Filtros e ordenação"));
  const form = el("form", "og-filter-form");
  form.setAttribute("aria-label", "Filtros de pedidos");
  const grid = el("div", "og-filter-grid");
  const controls = new Map();

  function addControl(name, label, tag = "input", type = "text", includeAll = true) {
    const wrapper = el("label", "og-field");
    wrapper.append(el("span", "og-label", label));
    const control = el(tag, "og-input");
    control.name = name;
    if (tag === "input") control.type = type;
    if (tag === "select" && includeAll) {
      const all = el("option", "", "Todos"); all.value = "";
      control.append(all);
    }
    controls.set(name, control);
    wrapper.append(control);
    grid.append(wrapper);
    return control;
  }

  addControl("search", "Pesquisar", "input", "search").placeholder = "Fornecedor, ID, observação…";
  for (const [name, label] of FILTERS) addControl(name, label, "select");
  addControl("total", "Valor total", "input", "search").placeholder = "Valor ou faixa";
  addControl("id", "ID", "input", "search").inputMode = "numeric";
  const sort = addControl("sort", "Ordenação", "select", "text", false);
  for (const [value, label] of SORTS) { const option = el("option", "", label); option.value = value; sort.append(option); }
  sort.value = sortValue;
  const pageSizeControl = addControl("pageSize", "Itens por página", "select", "text", false);
  for (const value of PAGE_SIZES) { const option = el("option", "", String(value)); option.value = String(value); pageSizeControl.append(option); }
  pageSizeControl.value = String(pageSize);
  const actions = el("div", "og-actions");
  const applyButton = el("button", "og-button og-button--primary", "Aplicar filtros"); applyButton.type = "submit";
  const clearButton = el("button", "og-button", "Limpar filtros"); clearButton.type = "button";
  actions.append(applyButton, clearButton);
  form.append(grid, actions);
  filterDisclosure.append(form);
  const metrics = el("section", "og-metrics");
  metrics.dataset.role = "orders-metrics";
  metrics.setAttribute("aria-label", "Resumo de pedidos");
  const notice = el("p", "og-notice"); notice.hidden = true;
  const listStatus = el("p", "og-list-status"); listStatus.setAttribute("aria-live", "polite");
  const cards = el("div", "og-cards"); cards.setAttribute("aria-label", "Pedidos");
  const pagination = el("nav", "og-pagination"); pagination.setAttribute("aria-label", "Páginas de pedidos");
  const previous = el("button", "og-button", "Página anterior"); previous.type = "button";
  const pageLabel = el("span", "og-page-label");
  const next = el("button", "og-button", "Próxima página"); next.type = "button";
  pagination.append(previous, pageLabel, next);
  const detail = el("section", "og-detail"); detail.hidden = true;
  detail.tabIndex = -1; detail.setAttribute("role", "dialog"); detail.setAttribute("aria-modal", "true"); detail.setAttribute("aria-label", "Detalhes do pedido");
  content.append(filterDisclosure, metrics, notice, listStatus, cards, pagination);
  root.append(header, content, detail);
  doc.body.append(root);

  function updateBusy() {
    const busy = opened && (listLoading || attachmentLoading);
    root.setAttribute("aria-busy", String(Boolean(busy)));
    for (const button of root.querySelectorAll("button")) {
      if (button === closeButton || button === homeButton) continue;
      if (button.dataset.baseDisabled !== undefined) button.disabled = busy || button.dataset.baseDisabled === "true";
    }
    previous.disabled = listLoading || page <= 1;
    next.disabled = listLoading || page >= Math.max(1, Math.ceil(filteredRows.length / pageSize));
  }

  function filterOptions() {
    for (const [name, , fieldName] of FILTERS) {
      const control = controls.get(name);
      const current = control.value;
      const values = [...new Set(rows.map(row => text(field(row.fields, [fieldName])).trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
      control.replaceChildren(Object.assign(el("option", "", "Todos"), { value: "" }), ...values.map(value => Object.assign(el("option", "", value), { value })));
      if (values.includes(current)) control.value = current;
    }
  }

  function sortRows(items) {
    const [sortKey] = SORTS.find(([value]) => value === sortValue) || SORTS[0];
    return [...items].sort((a, b) => {
      if (sortKey === "id-desc") return Number(b.id) - Number(a.id);
      if (sortKey === "invoice-asc") return text(field(a.fields, FIELD_ALIASES.invoice)).localeCompare(text(field(b.fields, FIELD_ALIASES.invoice)), "pt-BR", { numeric: true, sensitivity: "base" });
      const aliases = sortKey === "payment-desc" ? FIELD_ALIASES.paymentDate : sortKey.startsWith("created") ? FIELD_ALIASES.created : FIELD_ALIASES.modified;
      const diff = Date.parse(text(field(a.fields, aliases)) || "") - Date.parse(text(field(b.fields, aliases)) || "");
      return sortKey === "created-asc" ? diff : -diff;
    });
  }

  function applyLocalFilters() {
    filterValues = Object.fromEntries([...controls].map(([name, control]) => [name, control.value.trim()]));
    sortValue = filterValues.sort || "id-desc";
    pageSize = PAGE_SIZES.includes(Number(filterValues.pageSize)) ? Number(filterValues.pageSize) : 10;
    page = 1;
    const query = normalized(filterValues.search);
    filteredRows = sortRows(rows.filter(row => {
      const fields = row.fields || {};
      const fieldFor = name => field(fields, FIELD_ALIASES[name] || [name]);
      if (query && !normalized([row.id, ...Object.values(fields).map(text)].join(" ")).includes(query)) return false;
      for (const [filterName, , fieldName] of FILTERS) {
        const selected = filterValues[filterName];
        if (selected && normalized(field(fields, [fieldName])) !== normalized(selected)) return false;
      }
      if (filterValues.id && !text(row.id).includes(filterValues.id)) return false;
      if (filterValues.total) {
        const actual = Number(fieldFor("total"));
        const range = filterValues.total.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*(?:-|a|até)\s*(-?\d+(?:[.,]\d+)?)\s*$/i);
        if (range) {
          const min = Number(range[1].replace(",", ".")); const max = Number(range[2].replace(",", "."));
          if (!Number.isFinite(actual) || actual < Math.min(min, max) || actual > Math.max(min, max)) return false;
        } else if (!normalized(fieldFor("total")).includes(normalized(filterValues.total))
          && !(Number.isFinite(actual) && actual === Number(filterValues.total.replace(",", ".")))) return false;
      }
      return true;
    }));
    renderList();
  }

  function updateMetrics() {
    const total = rows.length;
    const withAttachments = rows.filter(row => row.hasAttachments).length;
    const attachmentPresenceUnknown = rows.some(row => row.hasAttachments == null);
    const pending = rows.filter(row => /pendente/i.test(text(field(row.fields, FIELD_ALIASES.status)))).length;
    const edited = rows.filter(row => {
      const created = Date.parse(text(field(row.fields, FIELD_ALIASES.created)));
      const modified = Date.parse(text(field(row.fields, FIELD_ALIASES.modified)));
      return Number.isFinite(created) && Number.isFinite(modified) && modified > created;
    }).length;
    const attachmentCount = attachmentPresenceUnknown ? (withAttachments ? `≥${withAttachments}` : "—") : withAttachments;
    const values = [["Pedidos", total], ["Com anexos", attachmentCount], ["Pendentes", pending], ["Editados", edited]];
    metrics.replaceChildren(...values.map(([label, value]) => {
      const item = el("div", "og-metric"); item.append(el("dt", "", label), el("dd", "", String(value))); return item;
    }));
  }

  function showNotice(message, error = false) {
    notice.textContent = message;
    notice.hidden = !message;
    notice.setAttribute("role", error ? "alert" : "status");
    notice.classList.toggle("og-error", error);
  }

  function renderCard(row) {
    const fields = row.fields || {};
    const card = el("article", "og-card");
    card.dataset.itemId = row.id;
    const heading = el("header", "og-card-heading");
    heading.append(el("span", "og-card-id", text(field(fields, ["ID"]) ?? row.id)), el("h2", "", text(field(fields, ["FORNECEDOR"]) || "Pedido")));
    const statusText = text(field(fields, FIELD_ALIASES.status)) || "Status não informado";
    const status = el("span", `og-status${/pendente/i.test(statusText) ? " og-status--pending" : ""}`, statusText);
    const cardFields = el("dl", "og-card-fields");
    const summaries = [
      ["FILIAL", field(fields, FIELD_ALIASES.branch)],
      ["FORMA DE PAGAMENTO", field(fields, FIELD_ALIASES.paymentForm)],
      ["VALOR TOTAL", field(fields, FIELD_ALIASES.total)],
      ["OBSERVAÇÃO", field(fields, ["OBS", "OBSERVACAO"])],
      ["NOTA FISCAL", field(fields, FIELD_ALIASES.invoice)],
      ["DATA DE PAGAMENTO", field(fields, FIELD_ALIASES.paymentDate)],
      ["CRIADO", field(fields, FIELD_ALIASES.created)],
      ["CRIADO POR", field(fields, ["CRIADO POR", "AUTHOR", "CREATED BY"])],
      ["MODIFICADO", field(fields, FIELD_ALIASES.modified)],
      ["MODIFICADO POR", field(fields, ["MODIFICADO POR", "EDITOR", "MODIFIED BY"])],
    ];
    for (const [name, value] of summaries) {
      if (value == null || value === "") continue;
      const pair = el("div", "og-card-field"); pair.append(el("dt", "", name), el("dd", "", formatValue(name, value))); cardFields.append(pair);
    }
    const actions = el("div", "og-card-actions");
    const details = el("button", "og-button og-button--detail", "Detalhes"); details.type = "button"; details.addEventListener("click", () => openDetails(row));
    actions.append(details);
    if (row.hasAttachments !== false) {
      const attachments = el("button", "og-button og-button--attachments", "📎 Anexos");
      attachments.type = "button";
      attachments.dataset.action = "attachments";
      attachments.addEventListener("click", () => openAttachments(row));
      actions.append(attachments);
    }
    card.append(heading, status, cardFields, actions);
    return card;
  }

  function renderList() {
    const pageCount = Math.ceil(filteredRows.length / pageSize);
    const maxPage = Math.max(1, pageCount);
    page = Math.min(page, maxPage);
    const start = (page - 1) * pageSize;
    const visible = filteredRows.slice(start, start + pageSize);
    cards.replaceChildren(...visible.map(renderCard));
    listStatus.textContent = filteredRows.length ? `${filteredRows.length} pedido(s)` : "Nenhum pedido encontrado para estes filtros.";
    pageLabel.textContent = `Página ${pageCount ? page : 0} de ${pageCount}`;
    updateBusy();
  }

  async function loadSnapshot({ retry = false } = {}) {
    if (!opened || destroyed) return false;
    const currentSession = session;
    if (controller) controller.abort();
    controller = new AbortController();
    listLoading = true;
    snapshotError = null;
    showNotice("");
    listStatus.textContent = "Carregando pedidos…";
    cards.replaceChildren();
    updateBusy();
    try {
      const result = await data.loadSnapshot({ signal: controller.signal });
      if (!opened || destroyed || currentSession !== session) return false;
      if (!Array.isArray(result?.rows)) throw new Error("A consulta não retornou uma lista de pedidos válida");
      rows = sortRows(result.rows.filter(row => /^\d{1,15}$/.test(String(row?.id || ""))));
      filterOptions();
      updateMetrics();
      applyLocalFilters();
      return true;
    } catch (error) {
      if (!opened || destroyed || currentSession !== session || error?.name === "AbortError") return false;
      snapshotError = error;
      listStatus.textContent = safeFailure(error, "Não foi possível carregar pedidos");
      const retryButton = el("button", "og-button og-button--primary", "Tentar novamente");
      retryButton.type = "button";
      retryButton.addEventListener("click", () => { void loadSnapshot({ retry: true }); });
      cards.replaceChildren(retryButton);
      return false;
    } finally {
      if (opened && !destroyed && currentSession === session) { listLoading = false; updateBusy(); }
    }
  }

  function renderDetailsTable(row) {
    const table = el("table", "og-data-table");
    const body = el("tbody");
    const entries = Object.entries(row.fields || {});
    if (!entries.some(([name]) => key(name) === "ID")) entries.unshift(["ID", row.id]);
    for (const [name, value] of entries) {
      const tr = el("tr"); tr.append(el("th", "", name), el("td", "", formatValue(name, value))); body.append(tr);
    }
    table.append(body);
    return table;
  }

  function openDetails(row) {
    const currentDetailsSession = ++detailsSession;
    detail.hidden = false;
    const heading = el("header", "og-detail-heading");
    heading.append(el("h2", "", `Pedido #${row.id}`));
    const close = el("button", "og-button", "Fechar detalhes"); close.type = "button";
    close.addEventListener("click", () => {
      if (currentDetailsSession !== detailsSession) return;
      detail.hidden = true; detail.replaceChildren();
    });
    heading.append(close);
    detail.replaceChildren(heading, renderDetailsTable(row));
    detail.focus({ preventScroll: true });
  }

  async function openAttachments(row) {
    if (attachmentLoading || !opened || destroyed) return;
    const currentSession = session;
    attachmentLoading = true;
    showNotice("");
    updateBusy();
    try {
      const attachments = await data.listAttachments(row.id);
      if (!opened || destroyed || currentSession !== session) return;
      if (!attachments.length) { showNotice(`O pedido #${row.id} não possui anexos.`); return; }
      if (typeof openMediaCollection !== "function") throw new Error("O visualizador de anexos não está disponível neste aparelho.");
      const items = attachments.map(item => ({
        fileName: item.fileName,
        source: data.downloadAttachment(row.id, item.fileName),
      }));
      await openMediaCollection(items);
    } catch (error) {
      if (opened && !destroyed && currentSession === session) showNotice(safeFailure(error, `Não foi possível abrir os anexos do pedido #${row.id}`), true);
    } finally {
      if (opened && !destroyed && currentSession === session) { attachmentLoading = false; updateBusy(); }
    }
  }

  function applyFilters() { applyLocalFilters(); }
  form.addEventListener("submit", event => { event.preventDefault(); applyFilters(); });
  clearButton.addEventListener("click", () => {
    for (const [name, control] of controls) control.value = name === "sort" ? "id-desc" : name === "pageSize" ? "10" : "";
    sortValue = "id-desc"; pageSize = 10; applyFilters();
  });
  previous.addEventListener("click", () => { if (page > 1) { page -= 1; renderList(); } });
  next.addEventListener("click", () => { if (page < Math.ceil(filteredRows.length / pageSize)) { page += 1; renderList(); } });
  closeButton.addEventListener("click", () => { close(); onClose?.(); });
  homeButton.addEventListener("click", () => { close(); onHome?.(); });

  async function open() {
    if (destroyed) throw new Error("A galeria foi encerrada.");
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
    opened = false;
    session += 1;
    controller?.abort(); controller = null;
    listLoading = false; attachmentLoading = false;
    detail.hidden = true; detail.replaceChildren();
    root.hidden = true;
    updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function destroy() {
    if (destroyed) return;
    close(); destroyed = true; root.remove();
  }

  return Object.freeze({ open, close, destroy, reload: () => loadSnapshot({ retry: true }) });
}
