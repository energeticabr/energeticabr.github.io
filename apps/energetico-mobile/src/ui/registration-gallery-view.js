import { REGISTRATION_GALLERY_MODELS } from "../chat/registration-gallery-data.js";

const PAGE_SIZE = 20;

function valueText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    for (const key of ["LookupValue", "Value", "value", "DisplayName", "displayName", "Title", "title"]) {
      if (value[key] != null) return valueText(value[key]);
    }
    return "";
  }
  return String(value);
}

function fieldValue(fields, name, model) {
  const normalized = key => String(key || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const accepted = [name, ...(model.fieldAliases?.[name] || [])].map(normalized);
  const entry = Object.entries(fields || {}).find(([key]) => accepted.includes(normalized(key)));
  return valueText(entry?.[1]);
}

export function createRegistrationGallery({ document: doc = globalThis.document, kind, data, onHome } = {}) {
  const model = REGISTRATION_GALLERY_MODELS[kind];
  if (!model || !doc?.body || typeof data?.loadSnapshot !== "function") {
    throw new TypeError("Galeria de cadastro, documento e serviço de dados são obrigatórios.");
  }
  const el = (tag, className, label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const option = (label, value) => {
    const node = el("option", "", label);
    node.value = value;
    return node;
  };
  const root = el("section", "rg-overlay");
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", model.title);
  const header = el("header", "rg-header");
  const close = el("button", "rg-button", "Voltar");
  close.type = "button";
  close.dataset.action = "registration-close";
  const title = el("h1", "rg-title", model.title);
  header.append(close, title);
  if (onHome) {
    const home = el("button", "rg-button", "Início");
    home.type = "button";
    home.addEventListener("click", async () => { hide(); await onHome(); });
    header.append(home);
  }
  const toolbar = el("div", "rg-toolbar");
  const searchLabel = el("label", "rg-field", "Pesquisar");
  const search = el("input", "rg-input");
  search.type = "search";
  search.placeholder = "Pesquisar cadastro ou ID";
  searchLabel.append(search);
  const statusLabel = el("label", "rg-field", "Status");
  const status = el("select", "rg-input");
  status.append(option("Todos", ""));
  statusLabel.append(status);
  const refresh = el("button", "rg-button", "Atualizar");
  refresh.type = "button";
  toolbar.append(searchLabel, statusLabel, refresh);
  const feedback = el("p", "rg-feedback");
  feedback.setAttribute("role", "status");
  const list = el("div", "rg-list");
  list.setAttribute("role", "list");
  const pagination = el("div", "rg-pagination");
  const previous = el("button", "rg-button", "Anterior"); previous.type = "button";
  const pageText = el("span", "", "Página 1");
  const next = el("button", "rg-button", "Próxima"); next.type = "button";
  pagination.append(previous, pageText, next);
  root.append(header, toolbar, feedback, list, pagination);
  doc.body.append(root);

  let rows = [];
  let page = 1;
  let request = 0;
  let destroyed = false;
  let hasLoaded = false;
  let loadFailed = false;
  let returnFocus = null;

  function filteredRows() {
    const query = search.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return rows.filter(row => {
      if (status.value && fieldValue(row.fields, "STATUS", model) !== status.value) return false;
      if (!query) return true;
      const haystack = [row.id, ...model.fields.map(field => fieldValue(row.fields, field, model))]
        .join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return haystack.includes(query);
    });
  }

  function render() {
    if (destroyed) return;
    const filtered = filteredRows();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages);
    list.replaceChildren();
    for (const row of filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const card = el("article", "rg-row");
      card.dataset.registrationRow = row.id;
      card.setAttribute("role", "listitem");
      const primary = fieldValue(row.fields, model.fields[0], model) || `ID ${row.id}`;
      card.append(el("strong", "rg-row-title", primary));
      const details = el("dl", "rg-details");
      for (const field of model.fields) {
        const value = field === "ID" ? row.id : fieldValue(row.fields, field, model);
        if (!value || field === model.fields[0]) continue;
        const pair = el("div", "rg-detail");
        pair.append(el("dt", "", field), el("dd", "", value));
        details.append(pair);
      }
      card.append(details);
      list.append(card);
    }
    feedback.textContent = loadFailed
      ? `Não foi possível carregar ${model.title.toLowerCase()}. Tente atualizar.`
      : filtered.length ? `${filtered.length} registro(s)` : "Nenhum registro encontrado.";
    pageText.textContent = `Página ${page} de ${pages}`;
    previous.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  async function load() {
    const current = ++request;
    loadFailed = false;
    root.setAttribute("aria-busy", "true");
    feedback.textContent = "Carregando registros…";
    try {
      const snapshot = await data.loadSnapshot();
      if (destroyed || current !== request) return;
      rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      const statuses = [...new Set(rows.map(row => fieldValue(row.fields, "STATUS", model)).filter(Boolean))].sort();
      const selectedStatus = status.value;
      status.replaceChildren(option("Todos", ""), ...statuses.map(value => option(value, value)));
      status.value = hasLoaded && statuses.includes(selectedStatus)
        ? selectedStatus : !hasLoaded && statuses.includes("ATIVO") ? "ATIVO" : "";
      hasLoaded = true;
      page = 1;
      render();
    } catch (error) {
      if (destroyed || current !== request) return;
      loadFailed = true;
      rows = [];
      page = 1;
      render();
    } finally {
      if (current === request) root.setAttribute("aria-busy", "false");
    }
  }

  function hide() { root.hidden = true; request += 1; returnFocus?.focus?.(); }
  close.addEventListener("click", hide);
  refresh.addEventListener("click", load);
  search.addEventListener("input", () => { page = 1; render(); });
  status.addEventListener("change", () => { page = 1; render(); });
  previous.addEventListener("click", () => { page -= 1; render(); });
  next.addEventListener("click", () => { page += 1; render(); });
  root.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
  return {
    async open() { if (destroyed) return; returnFocus = doc.activeElement; root.hidden = false; root.focus(); await load(); },
    destroy() { destroyed = true; request += 1; root.remove(); },
  };
}
