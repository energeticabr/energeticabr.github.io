import { createLoadingIndicator } from "./loading-indicator.js";
import { createGalleryRecordActions } from './gallery-record-actions.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { REGISTRATION_GALLERY_MODELS, registrationFieldKey, registrationRawField, registrationNumber, registrationDateKey, sortRegistrationRows } from "../chat/registration-gallery-data.js";
import Decimal from "decimal.js";

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

function normalizedFieldName(value) {
  return registrationFieldKey(value);
}

function computedValue(fields, calculation, model) {
  const raw = field => valueText(registrationRawField(fields, field, model));
  const dateMillis = value => /^\d{4}-\d{2}-\d{2}$/.test(registrationDateKey(value)) ? Date.parse(registrationDateKey(value)) : NaN;
  if (calculation.priorityScore) {
    const product = calculation.priorityScore.reduce((value, { field, weights }) => value * (weights[raw(field)] ?? 1), 1);
    const score = Math.round(Math.cbrt(product) * 10) / 10;
    return { Value: score, tone: score <= 2.5 ? "success" : score <= 4 ? "warning" : "danger" };
  }
  if (calculation.deadlineNotice || calculation.taskElapsed) {
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const days = (start, end) => Math.floor((dateMillis(end) - dateMillis(start)) / 86400000);
    if (calculation.deadlineNotice) {
      const [dueField, completionField] = calculation.deadlineNotice;
      if (raw(completionField)) return null;
      const remaining = days(localToday, raw(dueField));
      if (!Number.isFinite(remaining)) return null;
      return { Value: remaining < 0 ? `VENCIDO HÁ ${Math.abs(remaining)} DIAS` : remaining === 0 ? "VENCE HOJE" : remaining === 1 ? "VENCE AMANHÃ" : `VENCE EM ${remaining} DIAS`,
        tone: remaining < 0 ? "danger" : remaining === 0 ? "today" : remaining < 5 ? "warning" : "success" };
    }
    const [startField, identifiedField, completionField] = calculation.taskElapsed;
    const completed = raw(completionField);
    const elapsed = days(raw(completed ? identifiedField : startField), completed || localToday);
    if (!Number.isFinite(elapsed)) return null;
    const date = registrationDateKey(completed).split("-").reverse().join("/");
    return { Value: completed ? `CONCLUÍDO EM ${date} (${elapsed} DIAS GASTOS)` : `CRIADO HÁ: ${elapsed} DIAS`, tone: completed ? "success" : "danger" };
  }
  if (calculation.when) {
    const condition = calculation.when;
    return computedValue(fields, valueText(registrationRawField(fields, condition.field, model)) === condition.equals ? condition.then : condition.else, model);
  }
  if (calculation.elapsedDays) {
    const [startField, endField] = calculation.elapsedDays;
    const start = Date.parse(registrationDateKey(valueText(registrationRawField(fields, startField, model))));
    const endValue = valueText(registrationRawField(fields, endField, model));
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const end = Date.parse(registrationDateKey(endValue || localToday));
    return Number.isFinite(start) && Number.isFinite(end) ? Math.floor((end - start) / 86400000) : null;
  }
  const names = calculation.subtract || calculation.multiply || calculation.ratio;
  const numbers = names.map(field => registrationNumber(valueText(registrationRawField(fields, field, model))));
  if (numbers.some(number => number == null)) return null;
  const values = numbers.map(number => calculation.roundInputs == null ? new Decimal(number) : new Decimal(number).toDecimalPlaces(calculation.roundInputs));
  if (calculation.subtract) return values[0].minus(values[1]).toNumber();
  if (calculation.ratio) return values[1].isZero() ? null : values[0].dividedBy(values[1]).toNumber();
  return values.reduce((product, value) => product.times(value), new Decimal(1)).toNumber();
}

function fieldValue(fields, name, model) {
  let raw = registrationRawField(fields, name, model);
  const calculation = model.computedFields?.[name];
  if (calculation) raw = computedValue(fields, calculation, model);
  if ((raw == null || raw === "") && model.fieldDefaults?.[name]) raw = model.fieldDefaults[name];
  const value = valueText(raw);
  const type = model.fieldTypes?.[name];
  if (["number", "rounded-number", "currency", "percent", "days"].includes(type)) {
    const number = registrationNumber(value);
    if (number == null) return "";
    if (type === "days") return `${number} dia(s)`;
    return new Intl.NumberFormat("pt-BR", type === "currency" ? { style: "currency", currency: "BRL" }
      : type === "percent" ? { style: "percent", maximumFractionDigits: 2 }
        : { maximumFractionDigits: type === "rounded-number" ? 2 : 6 }).format(number);
  }
  if (!["date", "weekday-date"].includes(type) && !["data", "datavalidade", "datasubmetido", "criado", "modificado"].includes(normalizedFieldName(name))) return value;
  const date = registrationDateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date) return value;
  const text = `${date[3]}/${date[2]}/${date[1]}`;
  return type === "weekday-date" ? `${text} (${new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date[1]}-${date[2]}-${date[3]}T00:00:00Z`))})` : text;
}

function identityText(identity) {
  const user = identity?.user ?? identity?.User ?? identity;
  return valueText(user?.displayName ?? user?.DisplayName ?? user?.Title ?? user?.title ?? user?.email ?? user?.EMail ?? user);
}

function usefulPersonName(value) {
  const name = String(valueText(value) || "").trim();
  return Boolean(name)
    && !/^\d+$/.test(name)
    && !/^(?:sharepoint(?: app)?|system account|app|microsoft flow|power automate)$/i.test(name);
}

function knownAttachmentCount(row) {
  if (Number.isInteger(row?.attachmentCount) && row.attachmentCount >= 0) return row.attachmentCount;
  for (const [name, value] of Object.entries(row?.fields || {})) {
    const key = normalizedFieldName(name);
    if (["quantidadedeanexos", "attachmentcount", "attachmentscount"].includes(key)) {
      const count = Number(valueText(value));
      if (Number.isInteger(count) && count >= 0) return count;
    }
    if (["anexos", "attachments"].includes(key) && Array.isArray(value)) return value.length;
  }
  if (Array.isArray(row?.attachments)) return row.attachments.length;
  if (row?.hasAttachments === false) return 0;
  return null;
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
  const filterDisclosure = el("details", "rg-filters");
  filterDisclosure.append(el("summary", "rg-filter-toggle", "Filtros"));
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
    const isDate = model.dateFilterFields?.includes(field);
    const control = el(isDate ? "input" : "select", "rg-input");
    if (isDate) control.type = "date";
    else if (model.multiSelectFilters?.includes(field)) control.multiple = true;
    control.dataset.filterField = field;
    control.setAttribute("aria-label", `Filtrar por ${fieldLabel(field)}`);
    if (!isDate) control.append(option("Todos", ""));
    label.append(control);
    toolbar.append(label);
    filterControls.set(field, control);
  }
  const dateBounds = new Map();
  if (model.dateRangeField) {
    for (const [bound, text] of [["start", "Data inicial"], ["end", "Data final"]]) {
      const label = el("label", "rg-field", text);
      const input = el("input", "rg-input");
      input.type = "date";
      input.dataset.dateBound = bound;
      input.setAttribute("aria-label", text);
      label.append(input);
      toolbar.append(label);
      dateBounds.set(bound, input);
    }
  }
  let sortControl;
  if (model.sortOptions) {
    const label = el("label", "rg-field", "Ordenar por");
    sortControl = el("select", "rg-input");
    sortControl.dataset.gallerySort = "true";
    sortControl.setAttribute("aria-label", "Ordenar por");
    sortControl.append(...model.sortOptions.map(sort => option(sort.label, sort.value)));
    if (model.defaultSort) sortControl.value = model.defaultSort;
    label.append(sortControl);
    toolbar.append(label);
  }
  const refresh = el("button", "rg-button", "Atualizar");
  refresh.type = "button";
  refresh.dataset.action = "registration-refresh";
  toolbar.prepend(searchLabel);
  toolbar.append(refresh);
  filterDisclosure.append(toolbar);
  const feedback = el("p", "rg-feedback");
  feedback.setAttribute("role", "status");
  const list = el("div", "rg-list");
  list.setAttribute("role", "list");
  const pagination = el("div", "rg-pagination");
  const previous = el("button", "rg-button", "Anterior"); previous.type = "button";
  const pageText = el("span", "", "Página 1");
  const next = el("button", "rg-button", "Próxima"); next.type = "button";
  pagination.append(previous, pageText, next);
  root.append(header, filterDisclosure, feedback, list, pagination);
  doc.body.append(root);
  const searchableFilters = bindSearchableFilterSelects(toolbar);
  const recordActions = createGalleryRecordActions({
    document: doc, host: root,
    loadEditor: (id, options) => data.loadEditor(id, options),
    saveEditor: (context, fields) => data.saveEditor(context, fields),
    deleteItem: (id, options) => data.deleteItem(id, options),
    onChanged: load,
  });

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
  let attachmentCountEpoch = 0;
  let attachmentCountWorkers = 0;
  let attachmentCountQueue = [];
  const attachmentCounts = new Map();
  let filterEpoch = 0;
  const filterRequests = new Map();
  const filterErrors = new Map();
  const filterSources = new Map([...filterControls.keys()].map(field => [field, data.getFilterSource?.(field)]).filter(([, source]) => source));

  function fieldLabel(field) {
    return model.fieldLabels?.[field] || ({ TIPOHOMOLOGACAO: "Tipo de homologação", PESSOARELACIONADA: "Pessoa relacionada", TIPODOCUMENTO: "Tipo de documento", STATUS: "Status", FILIAL: "Filial", IMOVEL: "Imóvel", ETAPA: "Etapa", TIPOMARCO: "Tipo marco", ID: "ID", IMOBILIZADO: "Imobilizado", FORNECEDOR: "Fornecedor", DEPRECIAR: "Depreciar", "INFORMAÇÕES CLIMÁTICAS": "Informações climáticas", TIPO: "Tipo" })[field] || field;
  }

  function rowFieldValue(row, field) {
    if (field === "ID") return String(row.id || "");
    if (model.nativeCard && ["Criado por", "Modificado por"].includes(field)) return documentAuthorValue(row, field);
    return fieldValue(row.fields, field, model);
  }

  function documentAuthorValue(row, field) {
    const identity = field === "Criado por" ? row?.createdBy : row?.lastModifiedBy;
    const name = identityText(identity);
    if (usefulPersonName(name)) return name;
    const stored = fieldValue(row.fields, field, model);
    if (usefulPersonName(stored)) return stored;
    return stored || identity ? "Usuário não identificado" : "";
  }

  function attachmentCountLabel(row) {
    const known = knownAttachmentCount(row);
    if (known != null) return `${known} ${known === 1 ? "anexo" : "anexos"}`;
    if (typeof data.listAttachments !== "function") return "Quantidade indisponível";
    const current = attachmentCounts.get(String(row.id));
    if (current?.state === "ready") return `${current.count} ${current.count === 1 ? "anexo" : "anexos"}`;
    if (current?.state === "error") return "Quantidade indisponível";
    return "Contando anexos…";
  }

  function requestAttachmentCounts(visibleRows) {
    if (!model.showAttachments) return;
    for (const row of visibleRows) {
      if (row.hasAttachments === false || knownAttachmentCount(row) != null) continue;
      const id = String(row.id);
      if (attachmentCounts.has(id)) continue;
      attachmentCounts.set(id, { state: "loading" });
      const epoch = attachmentCountEpoch;
      if (typeof data.listAttachments !== "function") {
        attachmentCounts.set(id, { state: "error" });
        continue;
      }
      attachmentCountQueue.push({ row, id, epoch });
    }
    pumpAttachmentCountQueue();
  }

  function pumpAttachmentCountQueue() {
    while (!destroyed && attachmentCountWorkers < 4 && attachmentCountQueue.length) {
      const { row, id, epoch } = attachmentCountQueue.shift();
      attachmentCountWorkers += 1;
      void Promise.resolve().then(() => data.listAttachments(row.id, { refresh: true })).then(items => {
        if (destroyed || epoch !== attachmentCountEpoch) return;
        attachmentCounts.set(id, { state: "ready", count: Array.isArray(items) ? items.length : 0 });
        if (!root.hidden) render();
      }).catch(() => {
        if (destroyed || epoch !== attachmentCountEpoch) return;
        attachmentCounts.set(id, { state: "error" });
        if (!root.hidden) render();
      }).finally(() => {
        attachmentCountWorkers -= 1;
        pumpAttachmentCountQueue();
      });
    }
  }

  function appendDocumentDetail(details, field, label, value, className = "", icon = "") {
    if (!value) return null;
    const pair = el("div", `rg-detail${className ? ` ${className}` : ""}`);
    pair.dataset.field = field;
    if (icon) {
      const symbol = el("span", "rg-detail__icon", icon);
      symbol.setAttribute("aria-hidden", "true");
      pair.append(symbol);
    }
    pair.append(el("dt", "", label), el("dd", "", value));
    details.append(pair);
    return pair;
  }

  function renderDocumentDetails(container, row, primary) {
    const heading = el("div", "rg-document-heading");
    heading.append(el("strong", "rg-row-title", primary), el("span", "rg-document-id", `ID ${row.id}`));
    container.append(heading);

    const details = el("dl", "rg-details rg-document-table");
    const dateGroup = el("div", "rg-document-dates");
    dateGroup.setAttribute("role", "group");
    dateGroup.setAttribute("aria-label", "Datas do documento");
    const datesTitle = el("strong", "rg-document-dates-title", "DATAS");
    const datesTitleIcon = el("span", "rg-document-dates-title-icon", "▣");
    datesTitleIcon.setAttribute("aria-hidden", "true");
    datesTitle.prepend(datesTitleIcon);
    dateGroup.append(datesTitle);
    const dates = el("dl", "rg-document-date-grid");
    for (const [field, label, className] of [
      ["DATA", "DATA", ""],
      ["DATAVALIDADE", "DATA DE VALIDADE", ""],
      ["DATASUBMETIDO", "DATA SUBMETIDO", ""],
      ["Criado", "CRIADO EM", "rg-document-date--created"],
      ["Modificado", "MODIFICADO EM", "rg-document-date--modified"],
    ]) {
      const value = fieldValue(row.fields, field, model);
      if (!value) continue;
      const pair = el("div", `rg-detail rg-document-date${className ? ` ${className}` : ""}`);
      pair.dataset.field = field;
      const symbol = el("span", "rg-detail__icon", "▣");
      symbol.setAttribute("aria-hidden", "true");
      pair.append(symbol, el("dt", "", label), el("dd", "", value));
      dates.append(pair);
    }
    dateGroup.append(dates);
    if (dates.childElementCount) details.append(dateGroup);

    const status = fieldValue(row.fields, "STATUS", model);
    if (status) {
      const normalizedStatus = normalizedFieldName(status);
      const statusClass = normalizedStatus.includes("submetido") && !normalizedStatus.includes("naosubmetido")
        ? "rg-document-status--submitted"
        : normalizedStatus.includes("pendente") ? "rg-document-status--pending" : "";
      const pair = appendDocumentDetail(details, "STATUS", "STATUS", status, "rg-document-status-cell", statusClass === "rg-document-status--submitted" ? "✓" : "!");
      pair.classList.add(statusClass || "rg-document-status--other");
      const value = pair.querySelector("dd");
      value.replaceChildren(el("strong", `rg-document-status${statusClass ? ` ${statusClass}` : ""}`, status));
    }

    const branch = fieldValue(row.fields, "FILIAL", model);
    const property = fieldValue(row.fields, "IMOVEL", model);
    appendDocumentDetail(details, "FILIAL", "FILIAL", [branch, property ? `(${property})` : ""].filter(Boolean).join(" "), "", "▥");
    for (const [field, label, icon] of [
      ["TIPODOCUMENTO", "TIPO DE DOCUMENTO", "▤"],
      ["TIPOHOMOLOGACAO", "TIPO DE HOMOLOGAÇÃO", "▤"],
      ["ETAPA", "ETAPA", "▦"],
      ["TIPOMARCO", "TIPO MARCO", "▦"],
    ]) appendDocumentDetail(details, field, label, fieldValue(row.fields, field, model), "", icon);

    for (const [field, label] of [["Criado por", "CRIADO POR"], ["Modificado por", "MODIFICADO POR"]]) {
      appendDocumentDetail(details, field, label, documentAuthorValue(row, field), field === "Modificado por" ? "rg-detail--wide" : "", field === "Criado por" ? "♙" : "✎");
    }
    appendDocumentDetail(details, "OBS", "OBS", fieldValue(row.fields, "OBS", model), "rg-detail--observation", "▧");
    container.append(details);
  }

  function renderNativeDetails(container, row, primary) {
    const heading = el("div", "rg-document-heading");
    heading.append(el("strong", "rg-row-title", primary), el("span", "rg-document-id", `ID ${row.id}`));
    container.append(heading);
    const details = el("dl", "rg-details");
    for (const field of model.fields) {
      if (field === "ID" || field === model.fields[0]) continue;
      const visibility = model.fieldVisibility?.[field];
      if (visibility) {
        const selector = valueText(registrationRawField(row.fields, visibility.field, model));
        if (visibility.equals && selector !== visibility.equals || visibility.includes && !visibility.includes.includes(selector)) continue;
      }
      const value = rowFieldValue(row, field);
      const pair = appendDocumentDetail(details, field, fieldLabel(field), value);
      const calculation = model.computedFields?.[field];
      if (pair && calculation) {
        const tone = computedValue(row.fields, calculation, model)?.tone;
        if (tone) pair.dataset.tone = tone;
      }
    }
    container.append(details);
  }

  function filterSelections() {
    return Object.fromEntries([...filterControls].map(([field, control]) => [field, control.multiple ? [...control.selectedOptions].map(option => option.value).filter(Boolean) : control.value]));
  }

  async function populateCatalogFilter(field, { refresh = false } = {}) {
    const source = filterSources.get(field), control = filterControls.get(field);
    const current = (filterRequests.get(field) || 0) + 1;
    filterRequests.set(field, current);
    const epoch = filterEpoch, filters = filterSelections(), selectedValue = control.value;
    const policy = data.getFilterPolicy?.(field);
    const fixedValue = policy?.disabled === true ? policy.defaultValue || "" : "";
    filterErrors.delete(field);
    if (source.disabledUntil?.some(parent => !filters[parent])) {
      control.replaceChildren(option("Selecione o filtro anterior", ""));
      control.disabled = true;
      return;
    }
    control.replaceChildren(option("Carregando…", fixedValue));
    control.disabled = true;
    try {
      if (typeof data.loadFilterOptions !== "function") throw new Error("Fonte de filtro indisponível.");
      const options = await data.loadFilterOptions(field, { filters, refresh });
      if (destroyed || epoch !== filterEpoch || current !== filterRequests.get(field)) return;
      if (!Array.isArray(options)) throw new Error("Opções do filtro indisponíveis.");
      control.replaceChildren(option("Todos", ""), ...options.map(item => option(item.label, String(item.value))));
      if (fixedValue && !options.some(item => String(item.value) === fixedValue)) control.append(option(fixedValue, fixedValue));
      const desiredValue = fixedValue || (!hasLoaded ? policy?.defaultValue || selectedValue : selectedValue);
      control.value = fixedValue || (options.some(item => String(item.value) === desiredValue) ? desiredValue : "");
      control.disabled = policy?.disabled === true;
    } catch {
      if (destroyed || epoch !== filterEpoch || current !== filterRequests.get(field)) return;
      control.replaceChildren(option("Indisponível", fixedValue));
      control.disabled = true;
      filterErrors.set(field, `Filtro ${fieldLabel(field)} indisponível. Tente atualizar.`);
    }
  }

  async function populateFilters({ refresh = false } = {}) {
    for (const [field, control] of filterControls) {
      if (filterSources.has(field) || model.dateFilterFields?.includes(field)) continue;
      const selectedValue = control.multiple ? [...control.selectedOptions].map(option => option.value) : control.value;
      const values = [...new Set([...(model.filterChoices?.[field] || []), ...rows.flatMap(row => {
        const value = rowFieldValue(row, field);
        return model.substringFilters?.includes(field) ? value.split(/;|\r?\n|,\s*|\s+\|\s+/).map(part => part.trim()) : [value];
      }).filter(Boolean)])];
      values.sort((left, right) => field === "ID"
        ? Number(right) - Number(left)
        : left.localeCompare(right, "pt-BR", { sensitivity: "base", numeric: true }));
      control.replaceChildren(option("Todos", ""), ...values.map(value => option(value, value)));
      if (control.multiple) {
        const selected = !hasLoaded ? model.defaultFilters?.[field] || [] : selectedValue;
        for (const option of control.options) option.selected = selected.includes(option.value);
        continue;
      }
      control.value = !hasLoaded && values.includes(model.defaultFilters?.[field]) ? model.defaultFilters[field]
        : values.includes(selectedValue) ? selectedValue : "";
    }
    await populateCatalogFilters([...filterSources.keys()], { refresh });
  }

  async function populateCatalogFilters(fields, options) {
    const pending = new Set(fields), epoch = filterEpoch;
    while (pending.size && !destroyed && epoch === filterEpoch) {
      const ready = [...pending].filter(field => ![...(filterSources.get(field).dependsOn || []), ...(filterSources.get(field).disabledUntil || [])].some(parent => pending.has(parent)));
      if (!ready.length) throw new Error("Não foi possível resolver as dependências dos filtros.");
      await Promise.all(ready.map(field => populateCatalogFilter(field, options)));
      for (const field of ready) pending.delete(field);
    }
  }

  async function refreshDependentFilters(parent) {
    const affected = new Set();
    let parents = [parent];
    while (parents.length) {
      const next = [];
      for (const [field, source] of filterSources) {
        if (affected.has(field) || ![...(source.dependsOn || []), ...(source.disabledUntil || [])].some(dependency => parents.includes(dependency))) continue;
        affected.add(field);
        filterControls.get(field).value = "";
        next.push(field);
      }
      parents = next;
    }
    const pending = populateCatalogFilters([...affected]);
    render();
    await pending;
    if (!destroyed && !root.hidden) render();
  }

  function filteredRows() {
    const query = search.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const filtered = rows.filter(row => {
      for (const [field, control] of filterControls) {
        if (control.multiple) {
          const selected = [...control.selectedOptions].map(option => option.value).filter(Boolean);
          if (selected.length && !selected.includes(rowFieldValue(row, field))) return false;
          continue;
        }
        if (!control.value) continue;
        if (model.dateFilterFields?.includes(field)) {
          if (registrationDateKey(valueText(registrationRawField(row.fields, field, model))) !== control.value) return false;
          continue;
        }
        const value = rowFieldValue(row, field);
        if (model.substringFilters?.includes(field)) {
          if (!value.toLocaleLowerCase("pt-BR").includes(control.value.toLocaleLowerCase("pt-BR"))) return false;
        } else if (value !== control.value) return false;
      }
      if (model.dateRangeField) {
        const date = registrationDateKey(valueText(registrationRawField(row.fields, model.dateRangeField, model)));
        const start = dateBounds.get("start").value, end = dateBounds.get("end").value;
        const applyRange = model.dateRangeBothRequired ? start && end : start || end;
        if (applyRange && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || start && date < start || end && date > end)) return false;
      }
      if (!query) return true;
      const haystack = (model.searchFields ? model.searchFields.map(field => rowFieldValue(row, field))
        : [row.id, ...model.fields.map(field => rowFieldValue(row, field))])
        .join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return haystack.includes(query);
    });
    return sortRegistrationRows(filtered, model, model.sortOptions?.find(sort => sort.value === sortControl.value));
  }

  function render() {
    if (destroyed) return;
    const filtered = filteredRows();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages);
    list.replaceChildren();
    const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    for (const row of visibleRows) {
      const card = el("article", model.nativeCard ? "rg-row rg-row--native" : model.showAttachments ? "rg-row rg-row--documents rg-row--document" : "rg-row");
      card.dataset.registrationRow = row.id;
      card.setAttribute("role", "listitem");
      const primary = fieldValue(row.fields, model.fields[0], model) || `ID ${row.id}`;
      if (model.showAttachments) {
        const layout = el("div", "rg-row-layout");
        const fileRail = el(row.hasAttachments === false ? "aside" : "button", "rg-row-file");
        if (row.hasAttachments !== false) {
          const countLabel = attachmentCountLabel(row);
          fileRail.type = "button";
          fileRail.dataset.action = "registration-attachments";
          fileRail.setAttribute("aria-label", `Abrir anexos d${model.recordArticle || "o"} ${model.recordLabel || "documento"} ${row.id}: ${countLabel}`);
          fileRail.title = "Abrir anexos";
          fileRail.disabled = attachmentLoading;
          fileRail.addEventListener("click", () => { void openAttachments(row); });
          const icon = el("span", "rg-row-attachment", "📎");
          icon.setAttribute("aria-hidden", "true");
          fileRail.append(icon);
        }
        fileRail.append(
          el("span", "rg-row-file__label", row.hasAttachments === false ? "SEM ANEXOS" : "ANEXOS"),
          el("span", "rg-row-file__count", attachmentCountLabel(row)),
        );
        const main = el("div", "rg-row-main");
        if (model.nativeCard) renderNativeDetails(main, row, primary);
        else renderDocumentDetails(main, row, primary);
        layout.append(fileRail, main);
        card.append(layout);
      } else {
        card.append(el("strong", "rg-row-title", primary));
        const details = el("dl", "rg-details");
        for (const field of model.fields) {
          const value = field === "ID" ? row.id : fieldValue(row.fields, field, model);
          if (!value || field === model.fields[0]) continue;
          const pair = el("div", "rg-detail");
          pair.dataset.field = field;
          pair.append(el("dt", "", field), el("dd", "", value));
          details.append(pair);
        }
        card.append(details);
      }
      const recordMain = el('div', 'gallery-record-main');
      recordMain.append(...card.childNodes);
      card.classList.add('gallery-record-card');
      card.append(recordMain, recordActions.render(row));
      list.append(card);
    }
    feedback.textContent = loadFailed
      ? `Não foi possível carregar ${model.title.toLowerCase()}. Tente atualizar.`
      : [...filterErrors.values()].join(" ") || attachmentNotice || (filtered.length ? `${filtered.length} registro(s)` : "Nenhum registro encontrado.");
    pageText.textContent = `Página ${page} de ${pages}`;
    previous.disabled = page <= 1;
    next.disabled = page >= pages;
    requestAttachmentCounts(visibleRows);
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
        attachmentNotice = `${(model.recordArticle || "o").toUpperCase()} ${model.recordLabel || "documento"} ${row.id} não possui anexos.`;
        return;
      }
      if (typeof openMediaCollection !== "function") throw new Error("O visualizador de anexos não está disponível neste aparelho.");
      await openMediaCollection(attachments.map(item => ({
        fileName: item.fileName,
        source: data.downloadAttachment(row.id, item.fileName),
      })));
    } catch {
      if (!destroyed && !root.hidden && current === attachmentRequest) {
        attachmentNotice = `Não foi possível abrir os anexos d${model.recordArticle || "o"} ${model.recordLabel || "documento"} ${row.id}. Tente novamente.`;
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
    filterEpoch += 1;
    filterErrors.clear();
    attachmentCountEpoch += 1;
    attachmentCounts.clear();
    attachmentCountQueue = [];
    loadFailed = false;
    root.setAttribute("aria-busy", "true");
    feedback.replaceChildren(createLoadingIndicator(doc, "Carregando registros…"));
    try {
      const snapshot = await data.loadSnapshot();
      if (destroyed || current !== request) return;
      rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
      await populateFilters({ refresh: hasLoaded });
      if (destroyed || current !== request) return;
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

  function hide() {
    if (root.hidden) return;
    recordActions.close();
    searchableFilters.close();
    root.hidden = true;
    request += 1;
    filterEpoch += 1;
    attachmentRequest += 1;
    attachmentLoading = false;
    if (returnFocus?.isConnected) returnFocus.focus?.();
    returnFocus = null;
  }
  close.addEventListener("click", hide);
  refresh.addEventListener("click", load);
  search.addEventListener("input", () => { page = 1; attachmentNotice = ""; render(); });
  for (const [field, control] of filterControls) control.addEventListener("change", () => { page = 1; attachmentNotice = ""; void refreshDependentFilters(field); });
  for (const control of dateBounds.values()) control.addEventListener("change", () => { page = 1; attachmentNotice = ""; render(); });
  sortControl?.addEventListener("change", () => { page = 1; render(); });
  previous.addEventListener("click", () => { page -= 1; render(); });
  next.addEventListener("click", () => { page += 1; render(); });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { hide(); return; }
    if (event.key !== "Tab" || root.hidden) return;
    const focusable = [...root.querySelectorAll("summary, button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
      .filter(node => !node.disabled && !node.closest("[hidden]")
        && (node.tagName === "SUMMARY" || !node.closest("details:not([open])")));
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
    close: hide,
    destroy() { recordActions.destroy(); searchableFilters.destroy(); destroyed = true; request += 1; filterEpoch += 1; attachmentCountQueue = []; root.remove(); },
  };
}
