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
  const value = valueText(entry?.[1]);
  if (!["data", "datavalidade", "datasubmetido", "criado", "modificado"].includes(normalized(name))) return value;
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  return date ? `${date[3]}/${date[2]}/${date[1]}` : value;
}

export function createRegistrationGallery({ document: doc = globalThis.document, kind, data, onHome, openMediaCollection } = {}) {
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
  const filterFields = model.filterFields || ["STATUS"];
  if (model.filterFields) toolbar.classList.add("rg-toolbar--documents");
  const searchLabel = el("label", "rg-field", "Pesquisar");
  const search = el("input", "rg-input");
  search.type = "search";
  search.placeholder = model.searchPlaceholder || "Pesquisar cadastro ou ID";
  searchLabel.append(search);
  const filterControls = new Map();
  for (const field of filterFields) {
    const label = el("label", "rg-field", fieldLabel(field));
    const control = el("select", "rg-input");
    control.dataset.filterField = field;
    control.setAttribute("aria-label", `Filtrar por ${fieldLabel(field)}`);
    control.append(option("Todos", ""));
    label.append(control);
    toolbar.append(label);
    filterControls.set(field, control);
  }
  const refresh = el("button", "rg-button", "Atualizar");
  refresh.type = "button";
  toolbar.prepend(searchLabel);
  toolbar.append(refresh);
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
  let attachmentRequest = 0;
  let attachmentLoading = false;
  let attachmentNotice = "";

  function fieldLabel(field) {
    return ({ TIPOHOMOLOGACAO: "Tipo de homologação", PESSOARELACIONADA: "Pessoa relacionada", TIPODOCUMENTO: "Tipo de documento", STATUS: "Status", FILIAL: "Filial", IMOVEL: "Imóvel", ETAPA: "Etapa", TIPOMARCO: "Tipo marco", ID: "ID" })[field] || field;
  }

  function rowFieldValue(row, field) {
    return field === "ID" ? String(row.id || "") : fieldValue(row.fields, field, model);
  }

  function populateFilters() {
    for (const [field, control] of filterControls) {
      const selectedValue = control.value;
      const values = [...new Set(rows.map(row => rowFieldValue(row, field)).filter(Boolean))];
      values.sort((left, right) => field === "ID"
        ? Number(right) - Number(left)
        : left.localeCompare(right, "pt-BR", { sensitivity: "base", numeric: true }));
      control.replaceChildren(option("Todos", ""), ...values.map(value => option(value, value)));
      control.value = values.includes(selectedValue) ? selectedValue : "";
    }
  }

  function filteredRows() {
    const query = search.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return rows.filter(row => {
      for (const [field, control] of filterControls) {
        if (control.value && rowFieldValue(row, field) !== control.value) return false;
      }
      if (!query) return true;
      const haystack = [row.id, ...model.fields.map(field => rowFieldValue(row, field))]
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
      const card = el("article", model.showAttachments ? "rg-row rg-row--documents" : "rg-row");
      card.dataset.registrationRow = row.id;
      card.setAttribute("role", "listitem");
      const primary = fieldValue(row.fields, model.fields[0], model) || `ID ${row.id}`;
      const title = el("strong", "rg-row-title", primary);
      const details = el("dl", "rg-details");
      for (const field of model.fields) {
        const value = field === "ID" ? row.id : fieldValue(row.fields, field, model);
        if (!value || field === model.fields[0]) continue;
        const pair = el("div", "rg-detail");
        pair.append(el("dt", "", field), el("dd", "", value));
        details.append(pair);
      }
      if (model.showAttachments) {
        const layout = el("div", "rg-row-layout");
        const fileRail = el("aside", "rg-row-file");
        if (row.hasAttachments !== false) {
          const attachments = el("button", "rg-button rg-row-attachment", "📎");
          attachments.type = "button";
          attachments.dataset.action = "registration-attachments";
          attachments.setAttribute("aria-label", `Abrir anexos do documento ${row.id}`);
          attachments.title = "Abrir anexos";
          attachments.disabled = attachmentLoading;
          attachments.addEventListener("click", () => { void openAttachments(row); });
          fileRail.append(attachments);
        }
        fileRail.append(el("span", "rg-row-file__label", row.hasAttachments === false ? "SEM ANEXOS" : "ANEXOS"));
        const main = el("div", "rg-row-main");
        main.append(title, details);
        layout.append(fileRail, main);
        card.append(layout);
      } else {
        card.append(title, details);
      }
      list.append(card);
    }
    feedback.textContent = loadFailed
      ? `Não foi possível carregar ${model.title.toLowerCase()}. Tente atualizar.`
      : attachmentNotice || (filtered.length ? `${filtered.length} registro(s)` : "Nenhum registro encontrado.");
    pageText.textContent = `Página ${page} de ${pages}`;
    previous.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  async function openAttachments(row) {
    if (attachmentLoading || root.hidden || destroyed) return;
    const current = ++attachmentRequest;
    attachmentLoading = true;
    attachmentNotice = "";
    render();
    try {
      if (typeof data.listAttachments !== "function" || typeof data.downloadAttachment !== "function") {
        throw new Error("A consulta de anexos não está disponível.");
      }
      const attachments = await data.listAttachments(row.id);
      if (destroyed || root.hidden || current !== attachmentRequest) return;
      if (!attachments.length) {
        attachmentNotice = `O documento ${row.id} não possui anexos.`;
        return;
      }
      if (typeof openMediaCollection !== "function") throw new Error("O visualizador de anexos não está disponível neste aparelho.");
      await openMediaCollection(attachments.map(item => ({
        fileName: item.fileName,
        source: data.downloadAttachment(row.id, item.fileName),
      })));
    } catch {
      if (!destroyed && !root.hidden && current === attachmentRequest) {
        attachmentNotice = `Não foi possível abrir os anexos do documento ${row.id}. Tente novamente.`;
      }
    } finally {
      if (!destroyed && current === attachmentRequest) {
        attachmentLoading = false;
        render();
      }
    }
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
      populateFilters();
      const status = filterControls.get("STATUS");
      if (status && !model.filterFields) {
        const statuses = [...new Set(rows.map(row => fieldValue(row.fields, "STATUS", model)).filter(Boolean))].sort();
        status.replaceChildren(option("Todos", ""), ...statuses.map(value => option(value, value)));
        status.value = hasLoaded && statuses.includes(status.value)
          ? status.value : !hasLoaded && statuses.includes("ATIVO") ? "ATIVO" : "";
      }
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

  function hide() { root.hidden = true; request += 1; attachmentRequest += 1; attachmentLoading = false; returnFocus?.focus?.(); }
  close.addEventListener("click", hide);
  refresh.addEventListener("click", load);
  search.addEventListener("input", () => { page = 1; attachmentNotice = ""; render(); });
  for (const control of filterControls.values()) control.addEventListener("change", () => { page = 1; attachmentNotice = ""; render(); });
  previous.addEventListener("click", () => { page -= 1; render(); });
  next.addEventListener("click", () => { page += 1; render(); });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { hide(); return; }
    if (event.key !== "Tab" || root.hidden) return;
    const focusable = [...root.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
    if (!focusable.length) { event.preventDefault(); root.focus(); return; }
    const current = focusable.indexOf(doc.activeElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
    event.preventDefault();
    focusable[next].focus();
  });
  return {
    async open() { if (destroyed) return; attachmentRequest += 1; attachmentLoading = false; returnFocus = doc.activeElement; root.hidden = false; root.focus(); await load(); },
    destroy() { destroyed = true; request += 1; root.remove(); },
  };
}
