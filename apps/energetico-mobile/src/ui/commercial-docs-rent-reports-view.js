import { selectCommercialDocsReport, selectOpenRentsReport } from "../chat/commercial-docs-rent-reports-data.js";

const TITLES = { 16: "DOCUMENTOS COMERCIAIS POR IMÓVEL", 17: "ALUGUÉIS EM ABERTO" };
const EMPTY = "—";
const PAGE_SIZE = 25;
const currency = cents => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const shown = value => String(value ?? "").trim() || EMPTY;
const formatDate = key => /^\d{4}-\d{2}-\d{2}$/.test(String(key)) ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : EMPTY;
const safeError = error => String(error?.message || "Falha na consulta ao SharePoint.")
  .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
  .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
  .replace(/[\r\n]+/g, " ").slice(0, 240);

export function createCommercialDocsRentReportsView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadReport !== "function") throw new TypeError("Os relatórios 16–17 requerem documento e fonte de dados.");
  const make = (tag, className = "", value) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const element = make("section", "cdr-report"); element.hidden = true;
  const heading = make("div", "cdr-heading");
  const title = make("h2", "cdr-title");
  const refresh = button("cdr-button cdr-refresh", "Atualizar");
  heading.append(title, refresh); element.append(heading);
  const filters = make("div", "cdr-filters"); element.append(filters);
  const metrics = make("dl", "cdr-metrics"); element.append(metrics);
  const notice = make("div", "cdr-notice"); notice.hidden = true; element.append(notice);
  const results = make("div", "cdr-results"); element.append(results);
  let number = null, snapshot = null, controller = null, revision = 0, active = false, destroyed = false;
  let selected = Object.create(null);
  let visibleCount = PAGE_SIZE, searchTimer = null;

  function message(value, error = false) {
    notice.replaceChildren(); notice.hidden = !value;
    if (!value) return;
    notice.setAttribute("role", error ? "alert" : "status");
    notice.append(make("p", "", value));
    if (error) {
      const retry = button("cdr-button cdr-retry", "Tentar novamente");
      retry.addEventListener("click", () => { void load(); });
      notice.append(retry);
    }
  }

  function metric(key, label, value) {
    const card = make("div", "cdr-metric");
    const term = make("dt", "", label), content = make("dd", "", value);
    content.dataset.metric = key; card.append(term, content); metrics.append(card);
  }

  function renderMetrics(result) {
    metrics.replaceChildren();
    const summary = result?.summary;
    if (number === 16) {
      metric("properties", "IMÓVEIS", summary ? String(summary.properties) : EMPTY);
      metric("idPending", "PENDÊNCIAS DE IDs E ESTADOS", summary ? String(summary.idPending) : EMPTY);
      metric("fieldsPending", "CAMPOS EM BRANCO", summary ? String(summary.fieldsPending) : EMPTY);
      metric("totalPending", "TOTAL DE PENDÊNCIAS", summary ? String(summary.totalPending) : EMPTY);
    } else {
      metric("open", "ALUGUÉIS EM ABERTO", summary ? String(summary.open) : EMPTY);
      metric("overdue", "VENCIDOS", summary ? String(summary.overdue) : EMPTY);
      metric("today", "VENCEM HOJE", summary ? String(summary.today) : EMPTY);
      metric("totalCents", "VALOR EM ABERTO", summary ? currency(summary.totalCents) : EMPTY);
    }
  }

  function select(name, label, values) {
    const wrapper = make("label", "cdr-filter"); wrapper.append(make("span", "cdr-filter-label", label));
    const control = make("select", "cdr-filter-input"); control.name = name;
    control.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    for (const value of [...new Set(values.map(String).map(text => text.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")))
      control.append(Object.assign(make("option", "", value), { value }));
    control.value = selected[name] || "";
    if (control.value !== selected[name]) selected[name] = "";
    control.addEventListener("change", () => { selected[name] = control.value; visibleCount = PAGE_SIZE; render(); });
    wrapper.append(control); filters.append(wrapper);
  }

  function search() {
    const wrapper = make("label", "cdr-filter"); wrapper.append(make("span", "cdr-filter-label", "PESQUISAR IMÓVEL OU INQUILINO"));
    const input = make("input", "cdr-filter-input"); input.type = "search"; input.name = "search"; input.value = selected.search || "";
    input.addEventListener("input", () => {
      if (searchTimer) clearTimeout(searchTimer);
      const value = input.value;
      searchTimer = setTimeout(() => {
        searchTimer = null;
        if (!active || destroyed) return;
        selected.search = value; visibleCount = PAGE_SIZE; render();
      }, 160);
    });
    wrapper.append(input); filters.append(wrapper);
  }

  function buildFilters() {
    filters.replaceChildren();
    if (number === 16) {
      select("branch", "FILIAL", snapshot.rows.map(row => row.branch));
      select("property", "IMÓVEL", snapshot.rows.map(row => row.property));
      select("buyer", "COMPRADOR", snapshot.rows.flatMap(row => (row.contracts || []).map(contract => contract.buyer)));
      select("contract", "Nº CONTRATO", snapshot.rows.flatMap(row => (row.contracts || []).map(contract => contract.id)));
      select("status", "STATUS", snapshot.rows.map(row => row.status));
    } else {
      select("property", "IMÓVEL", snapshot.rows.map(row => row.property));
      select("tenant", "INQUILINO", snapshot.rows.map(row => row.tenant));
      select("dueState", "VENCIMENTO", ["overdue", "today", "upcoming"]);
      select("paymentMethod", "FORMA DE PAGAMENTO", snapshot.rows.map(row => row.paymentMethod));
      search();
      for (const option of filters.querySelector('[name="dueState"]').options) {
        if (option.value === "overdue") option.textContent = "Vencidos";
        if (option.value === "today") option.textContent = "Vencem hoje";
        if (option.value === "upcoming") option.textContent = "A vencer";
      }
    }
  }

  function field(parent, label, value) {
    const wrapper = make("div", "cdr-field");
    wrapper.append(make("span", "cdr-field-label", label), make("strong", "cdr-field-value", shown(value)));
    parent.append(wrapper);
  }

  function documentCell(entry) {
    const cell = make("div", "cdr-document-cell"); cell.dataset.pending = String(entry.pending);
    cell.append(make("span", "cdr-document-label", entry.label), make("strong", "cdr-document-value", shown(entry.value) === EMPTY && entry.pending ? "Pendente" : shown(entry.value)));
    if (entry.pending && shown(entry.value) !== EMPTY) cell.append(make("span", "cdr-pending-label", "Pendente"));
    return cell;
  }

  function propertyCard(row) {
    const card = make("article", "cdr-property-card");
    const top = make("div", "cdr-card-top");
    top.append(make("h3", "cdr-card-title", row.property), make("span", "cdr-badge", `${row.totalPending} pendência${row.totalPending === 1 ? "" : "s"}`));
    card.append(top);
    const identity = make("div", "cdr-identity"); field(identity, "Filial", row.branch); field(identity, "Status", row.status); field(identity, "Situação fiscal", row.fiscal); card.append(identity);
    card.append(make("h4", "cdr-subtitle", "Documentos e IDs"));
    const documents = make("div", "cdr-document-grid");
    for (const entry of row.documents) documents.append(documentCell(entry));
    card.append(documents);
    card.append(make("h4", "cdr-subtitle", "Estados exigidos"));
    const states = make("div", "cdr-document-grid");
    for (const entry of row.stateChecks) states.append(documentCell(entry));
    card.append(states);
    card.append(make("h4", "cdr-subtitle", "Campos comerciais"));
    const commercial = make("div", "cdr-document-grid");
    for (const entry of row.otherFields) commercial.append(documentCell(entry));
    card.append(commercial);
    const contracts = make("div", "cdr-contracts");
    contracts.append(make("h4", "cdr-subtitle", "Contratos de compra"));
    if (!(row.contracts || []).length) contracts.append(make("p", "cdr-empty", "Nenhum contrato encontrado para este imóvel."));
    else for (const contract of row.contracts) contracts.append(make("div", "cdr-contract", `Contrato #${contract.id} · ${shown(contract.buyer)}`));
    card.append(contracts);
    return card;
  }

  function rentCard(row) {
    const card = make("article", "cdr-rent-card"); card.dataset.dueState = row.dueState;
    const top = make("div", "cdr-card-top");
    top.append(make("h3", "cdr-card-title", row.property), make("strong", "cdr-rent-amount", currency(row.amountCents)));
    card.append(top);
    const identity = make("div", "cdr-identity");
    field(identity, "Inquilino", row.tenant); field(identity, "Vencimento", formatDate(row.dueDate));
    field(identity, "Forma de pagamento", row.paymentMethod); field(identity, "Contrato", `#${row.contractId}`);
    card.append(identity);
    const dueLabel = row.dueState === "overdue" ? `Vencido há ${row.days} dia${row.days === 1 ? "" : "s"}` : row.dueState === "today" ? "Vence hoje" : `A vencer em ${row.days} dia${row.days === 1 ? "" : "s"}`;
    card.append(make("p", "cdr-due-status", dueLabel));
    return card;
  }

  function fieldTotals(parent, totals) {
    for (const [category, heading] of [["documents", "Documentos e IDs"], ["states", "Estados exigidos"], ["fields", "Campos em branco"]]) {
      const section = make("section", "cdr-total-category");
      section.append(make("h4", "cdr-subtitle", heading));
      const grid = make("div", "cdr-field-total-grid");
      for (const entry of totals[category]) {
        const cell = make("div", "cdr-field-total"); cell.dataset.field = `${category}:${entry.key}`;
        cell.append(make("span", "cdr-field-label", entry.label), make("strong", "", String(entry.count)));
        grid.append(cell);
      }
      section.append(grid); parent.append(section);
    }
  }

  function commercialSummary(result) {
    const wrapper = make("div", "cdr-commercial-summary");
    wrapper.append(make("p", "cdr-detail-hint", "Selecione um imóvel, comprador ou número de contrato para detalhar por imóvel."));
    const totals = make("section", "cdr-overall-totals");
    totals.append(make("h3", "cdr-summary-title", "Pendências por campo"));
    fieldTotals(totals, result.summary.fieldTotals); wrapper.append(totals);
    const branches = make("div", "cdr-branch-list");
    for (const branch of result.summary.branches) {
      const card = make("section", "cdr-branch-summary");
      card.append(make("h3", "cdr-summary-title", `Filial: ${branch.branch}`));
      const figures = make("div", "cdr-branch-figures");
      field(figures, "Imóveis", branch.properties);
      field(figures, "IDs e estados pendentes", branch.idPending);
      field(figures, "Campos em branco", branch.fieldsPending);
      field(figures, "Total da filial", branch.totalPending);
      card.append(figures);
      const detail = make("details", "cdr-branch-fields");
      detail.append(make("summary", "", "Pendências por campo nesta filial"));
      fieldTotals(detail, branch.fieldTotals); card.append(detail);
      branches.append(card);
    }
    wrapper.append(branches);
    return wrapper;
  }

  function render() {
    results.replaceChildren();
    if (!snapshot) { renderMetrics(null); return; }
    const result = number === 16 ? selectCommercialDocsReport(snapshot.rows, selected) : selectOpenRentsReport(snapshot.rows, selected);
    renderMetrics(result);
    if (!result.rows.length) { results.append(make("p", "cdr-empty", "Nenhum registro encontrado para os filtros selecionados.")); return; }
    if (number === 16) {
      if (!result.detailMode) results.append(commercialSummary(result));
      else for (const row of result.rows) results.append(propertyCard(row));
      return;
    }
    const count = Math.min(visibleCount, result.rows.length);
    results.append(make("p", "cdr-page-status", `Exibindo ${count} de ${result.rows.length} aluguéis em aberto`));
    for (const row of result.rows.slice(0, count)) results.append(rentCard(row));
    if (count < result.rows.length) {
      const more = button("cdr-button cdr-more", "Mostrar mais aluguéis");
      more.addEventListener("click", () => { visibleCount += PAGE_SIZE; render(); });
      results.append(more);
    }
  }

  async function load() {
    controller?.abort(); controller = new AbortController();
    const current = ++revision, reportNumber = number;
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    visibleCount = PAGE_SIZE;
    snapshot = null; filters.replaceChildren(); render(); message("Carregando dados do SharePoint…");
    element.setAttribute("aria-busy", "true");
    try {
      const result = await data.loadReport(reportNumber, { signal: controller.signal });
      if (destroyed || !active || controller.signal.aborted || current !== revision) return;
      if (!result || !Array.isArray(result.rows)) throw new Error("O relatório retornou dados incompletos.");
      snapshot = result; buildFilters(); message(""); render();
    } catch (error) {
      if (destroyed || !active || controller.signal.aborted || current !== revision) return;
      snapshot = null; render(); message(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) element.setAttribute("aria-busy", "false");
    }
  }

  refresh.addEventListener("click", () => { if (active) void load(); });
  return Object.freeze({
    element,
    open(reportNumber) {
      if (destroyed) throw new Error("A visualização foi encerrada.");
      if (![16, 17].includes(reportNumber)) throw new RangeError("Escolha o relatório 16 ou 17.");
      if (number !== reportNumber) selected = Object.create(null);
      number = reportNumber; title.textContent = TITLES[number]; active = true; element.hidden = false;
      return load();
    },
    close() { active = false; controller?.abort(); if (searchTimer) clearTimeout(searchTimer); searchTimer = null; revision++; element.hidden = true; element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; active = false; controller?.abort(); if (searchTimer) clearTimeout(searchTimer); searchTimer = null; revision++; destroyed = true; element.remove(); },
  });
}
