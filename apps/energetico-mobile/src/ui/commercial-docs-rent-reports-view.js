import { selectCommercialDocsReport, selectRentDashboard } from "../chat/commercial-docs-rent-reports-data.js";
import { bindSearchableFilterSelects } from "./searchable-filter-selects.js";

const TITLES = { 16: "DOCUMENTOS COMERCIAIS POR IMÓVEL", 17: "ALUGUÉIS EM ABERTO" };
const EMPTY = "—";
const PAGE_SIZE = 25;
const LOGO_URL = new URL("../../../../assets/logo-energetica-oficial.png", import.meta.url).href;
const DOCUMENT_METRICS = [
  ["SEGURO", "🛡️ SEGURO"], ["IDPROPOSTA", "📄 ID PROPOSTA"],
  ["IDCONTRATOCAIXA", "🏦 ID CONTRATO CAIXA"], ["IDESCRITURA", "🖋️ ID ESCRITURA"],
  ["IDDOCUMENTOCORRETAGEM", "🤝 ID DOC. CORRETAGEM"],
  ["IDPGTOCORRETAGEM", "💳 ID PGTO. CORRETAGEM"],
  ["IDDOCFISCAL", "🧾 ID DOC. FISCAL"],
];
const DOCUMENT_COLUMNS = [
  ["property", "🏠 IMÓVEL"], ["totalPending", "❌ PENDÊNCIAS"], ["fiscal", "👮 SITUAÇÃO FISCAL"],
  ["IDDOCFISCAL", "ID DOC. FISCAL"], ["IDPGTOFISCAL", "ID PGTO. FISCAL"],
  ["status", "📌 COMERCIAL"], ["IDPGTOCORRETAGEM", "ID PGTO. CORRETAGEM"],
  ["IDDOCUMENTOCORRETAGEM", "ID DOC. CORRETAGEM"], ["SEGURO", "🛡️ SEGURO"],
  ["IDPROPOSTA", "ID PROPOSTA"], ["IDCONTRATOCAIXA", "ID CONTRATO CAIXA"], ["IDESCRITURA", "ID ESCRITURA"],
];
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
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
  const logo = make("img", "cdr-logo"); logo.src = LOGO_URL; logo.alt = "Logo Energética";
  const title = make("h2", "cdr-title");
  const refresh = button("cdr-button cdr-refresh", "Atualizar");
  heading.append(logo, title, refresh);
  const filters = make("div", "cdr-filters"); element.append(filters, heading);
  const detailHint = make("p", "cdr-detail-hint", "🔎 SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR POR IMÓVEL");
  const metricsArea = make("div", "cdr-metrics-area");
  const metricsTitle = make("h3", "cdr-metrics-title", "🆔 PENDÊNCIAS POR CAMPO DE ID");
  const metrics = make("dl", "cdr-metrics");
  const metricsFold = make("details", "cdr-metrics-fold");
  metricsFold.append(make("summary", "", "Resumo dos aluguéis"));
  metricsArea.append(metricsTitle, metrics);
  element.append(detailHint, metricsArea);
  const notice = make("div", "cdr-notice"); notice.hidden = true; element.append(notice);
  const results = make("div", "cdr-results"); element.append(results);
  let number = null, snapshot = null, controller = null, revision = 0, active = false, destroyed = false;
  let selected = Object.create(null);
  let searchableFilters = null;
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
    if (number === 16) card.dataset.tone = Number(value) > 0 ? "pending" : "clear";
    const term = make("dt", "", label), content = make("dd", "", value);
    content.dataset.metric = key; card.append(term, content); metrics.append(card);
  }

  function renderMetrics(result) {
    metrics.replaceChildren();
    const summary = result?.summary;
    if (number === 16) {
      for (const [key, label] of DOCUMENT_METRICS) {
        const count = summary?.fieldTotals.documents.find(entry => entry.key === key)?.count;
        metric(key, label, count == null ? EMPTY : String(count));
      }
      metric("totalMeasures", "📏 TOTAL (MEDIDAS)", summary ? String(summary.idPending) : EMPTY);
    } else {
      metric("open", "ALUGUÉIS EM ABERTO", summary ? String(summary.open) : EMPTY);
      metric("overdue", "VENCIDOS", summary ? String(summary.overdue) : EMPTY);
      metric("today", "VENCEM HOJE", summary ? String(summary.today) : EMPTY);
      metric("totalCents", "VALOR EM ABERTO", summary ? currency(summary.totalCents) : EMPTY);
    }
  }

  function select(name, label, values, emptyLabel = "Todos") {
    const wrapper = make("label", "cdr-filter"); wrapper.append(make("span", "cdr-filter-label", label));
    const control = make("select", "cdr-filter-input"); control.name = name;
    control.append(Object.assign(make("option", "", emptyLabel), { value: "" }));
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
    searchableFilters?.destroy(); searchableFilters = null;
    filters.replaceChildren(refresh);
    if (number === 16) {
      select("branch", "FILIAL", snapshot.rows.map(row => row.branch));
      select("property", "IMÓVEL", snapshot.rows.map(row => row.property));
      select("buyer", "COMPRADOR", snapshot.rows.flatMap(row => (row.contracts || []).map(contract => contract.buyer)));
      select("contract", "Nº CONTRATO", snapshot.rows.flatMap(row => (row.contracts || []).map(contract => contract.id)));
      select("status", "STATUS", snapshot.rows.map(row => row.status));
    } else {
      select("year", "ANO", [...(snapshot.sourceRows || []).map(row => (row.paidDate || row.dueDate).slice(0, 4)), snapshot.year].filter(Boolean), "Ano atual");
      select("property", "IMÓVEL", snapshot.contracts.map(row => row.property));
      select("tenant", "INQUILINO", snapshot.contracts.map(row => row.tenant));
      select("dueState", "VENCIMENTO", ["overdue", "today", "upcoming"]);
      select("paymentMethod", "FORMA DE PAGAMENTO", snapshot.contracts.map(row => row.paymentMethod));
      select("status", "STATUS", snapshot.contracts.map(row => row.status));
      search();
      for (const option of filters.querySelector('[name="dueState"]').options) {
        if (option.value === "overdue") option.textContent = "Vencidos";
        if (option.value === "today") option.textContent = "Vencem hoje";
        if (option.value === "upcoming") option.textContent = "A vencer";
      }
    }
    searchableFilters = bindSearchableFilterSelects(filters, { report: true });
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
    const totals = make("section", "cdr-overall-totals");
    totals.append(make("h3", "cdr-summary-title", "Pendências por campo"));
    fieldTotals(totals, result.summary.fieldTotals); wrapper.append(totals);
    return wrapper;
  }

  function documentValue(row, key) {
    if (key === "property" || key === "totalPending" || key === "fiscal" || key === "status") return row[key];
    return row.documents.find(entry => entry.key === key)?.value || "PENDENTE";
  }

  function commercialBranches(result) {
    const wrapper = make("div", "cdr-branch-list");
    for (const branch of result.summary.branches) {
      const section = make("section", "cdr-branch-summary");
      section.append(make("h3", "cdr-summary-title", `🏢 FILIAL: ${branch.branch}`));
      const table = make("table", "cdr-branch-table");
      const thead = make("thead"), header = make("tr");
      for (const [, label] of DOCUMENT_COLUMNS) header.append(make("th", "", label));
      thead.append(header); table.append(thead);
      const tbody = make("tbody");
      const cards = make("div", "cdr-mobile-cards");
      if (result.detailMode) cards.classList.add("cdr-detail-cards");
      for (const row of result.rows.filter(item => item.branch === branch.branch)) {
        const tr = make("tr");
        for (const [key] of DOCUMENT_COLUMNS) {
          const cell = make("td", "", shown(documentValue(row, key)));
          if (key === "totalPending") cell.dataset.state = row.totalPending ? "pending" : "clear";
          else if (key === "fiscal" || key === "status")
            cell.dataset.state = row.stateChecks.find(entry => entry.key === (key === "fiscal" ? "FISCAL" : "STATUS"))?.pending === false ? "clear" : "pending";
          else if (key !== "property") cell.dataset.state = row.documents.find(entry => entry.key === key)?.pending === false ? "clear" : "pending";
          tr.append(cell);
        }
        tbody.append(tr); cards.append(propertyCard(row));
      }
      table.append(tbody); section.append(table, cards);
      section.append(make("p", "cdr-branch-total", `TOTAL DA FILIAL: ${branch.totalPending} pendência(s)`));
      wrapper.append(section);
    }
    return wrapper;
  }

  function reportTable(className, columns, rows, cellText) {
    const table = make("table", className);
    const head = make("thead"), heading = make("tr");
    for (const label of columns) heading.append(make("th", "", label));
    head.append(heading); table.append(head);
    const body = make("tbody");
    for (const row of rows) {
      const line = make("tr");
      for (let index = 0; index < columns.length; index++) line.append(make("td", "", cellText(row, index)));
      body.append(line);
    }
    table.append(body); return table;
  }

  function rentalSection(titleText, className) {
    const section = make("section", `cdr-rental-section ${className}`);
    section.append(make("h3", "cdr-rental-title", titleText));
    return section;
  }

  function simpleCards(rows, columns, values) {
    const list = make("div", "cdr-mobile-cards");
    for (const row of rows) {
      const card = make("article", "cdr-data-card");
      columns.forEach((label, index) => field(card, label, values(row, index)));
      list.append(card);
    }
    return list;
  }

  function rentSections(result) {
    const open = rentalSection("⚠️ ALUGUÉIS EM ABERTO", "cdr-open-section");
    const openColumns = ["IMÓVEL", "INQUILINO", "VENC.", "PGTO", "VALOR", "ATRASO"];
    const openValue = (row, index) => [row.property, row.tenant, formatDate(row.dueDate), row.paymentMethod,
      currency(row.amountCents), row.dueState === "overdue" ? `VENCIDO há ${row.days} dias` : row.dueState === "today" ? "VENCE HOJE" : `VENCE EM ${row.days} dias`][index];
    const count = Math.min(visibleCount, result.rows.length);
    const visibleRows = result.rows.slice(0, count);
    open.append(reportTable("cdr-rent-table", openColumns, visibleRows, openValue), simpleCards(visibleRows, openColumns, openValue));
    open.append(make("p", "cdr-page-status", `Exibindo ${count} de ${result.rows.length} aluguéis em aberto`));
    if (count < result.rows.length) {
      const more = button("cdr-button cdr-more", "Mostrar mais aluguéis");
      more.addEventListener("click", () => { visibleCount += PAGE_SIZE; render(); });
      open.append(more);
    }
    if (!result.rows.length) open.append(make("p", "cdr-empty", "Nenhum aluguel em aberto para os filtros selecionados."));
    results.append(open);

    const annual = rentalSection("📊 RELATÓRIO ANUAL DE ALUGUÉIS", "cdr-annual-section");
    const annualRows = [...result.annualRows, { property: "TOTAL", months: result.monthlyTotals, totalCents: result.annualTotalCents }];
    const annualColumns = ["IMÓVEL", ...MONTHS, "TOTAL"];
    const annualValue = (row, index) => index === 0 ? row.property : index === 13 ? currency(row.totalCents) : currency(row.months[index - 1]);
    annual.append(reportTable("cdr-annual-table", annualColumns, annualRows, annualValue), simpleCards(annualRows, annualColumns, annualValue));
    results.append(annual);

    const adjustments = rentalSection("📅 TABELA DE REAJUSTE", "cdr-adjustment-section");
    const adjustmentColumns = ["IMÓVEL", "INQUILINO", "DATA REAJUSTE", "ÍNDICE"];
    const adjustmentValue = (row, index) => [row.property, row.tenant, formatDate(row.date), row.index][index];
    adjustments.append(reportTable("cdr-adjustment-table", adjustmentColumns, result.adjustments, adjustmentValue),
      simpleCards(result.adjustments, adjustmentColumns, adjustmentValue));
    results.append(adjustments);

    const expirations = rentalSection("📅 TABELA DE VENCIMENTO DOS CONTRATOS", "cdr-expiration-section");
    const expirationColumns = ["IMÓVEL", "INQUILINO", "VENCIMENTO"];
    const expirationValue = (row, index) => [row.property, row.tenant, formatDate(row.date)][index];
    expirations.append(reportTable("cdr-expiration-table", expirationColumns, result.expirations, expirationValue),
      simpleCards(result.expirations, expirationColumns, expirationValue));
    results.append(expirations);
  }

  function render() {
    results.replaceChildren();
    if (!snapshot) { renderMetrics(null); return; }
    const result = number === 16 ? selectCommercialDocsReport(snapshot.rows, selected) : selectRentDashboard(snapshot, selected);
    renderMetrics(result);
    if (number === 16) {
      if (!result.rows.length) { results.append(make("p", "cdr-empty", "Nenhum registro encontrado para os filtros selecionados.")); return; }
      results.append(commercialBranches(result));
      if (!result.detailMode) results.append(commercialSummary(result));
      return;
    }
    rentSections(result);
  }

  async function load() {
    searchableFilters?.destroy(); searchableFilters = null;
    controller?.abort(); controller = new AbortController();
    const current = ++revision, reportNumber = number;
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    visibleCount = PAGE_SIZE;
    snapshot = null; filters.replaceChildren(refresh); render(); message("Carregando dados do SharePoint…");
    element.setAttribute("aria-busy", "true");
    try {
      const result = await data.loadReport(reportNumber, { signal: controller.signal });
      if (destroyed || !active || controller.signal.aborted || current !== revision) return;
      if (!result || !Array.isArray(result.rows) || (number === 17 && (!Array.isArray(result.sourceRows) || !Array.isArray(result.contracts)))) throw new Error("O relatório retornou dados incompletos.");
      snapshot = result;
      if (number === 17) {
        if (selected.year === undefined) selected.year = result.year;
        if (selected.status === undefined && result.contracts.some(row => row.status === "ATIVO")) selected.status = "ATIVO";
      }
      buildFilters(); message(""); render();
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
      detailHint.hidden = number !== 16;
      metricsTitle.hidden = number !== 16;
      if (number === 17) {
        metricsFold.append(metrics);
        metricsArea.append(metricsFold);
        element.append(metricsArea);
      } else {
        metricsFold.remove();
        metricsArea.append(metrics);
        element.insertBefore(metricsArea, notice);
      }
      return load();
    },
    close() { searchableFilters?.close(); active = false; controller?.abort(); if (searchTimer) clearTimeout(searchTimer); searchTimer = null; revision++; element.hidden = true; element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; this.close(); searchableFilters?.destroy(); searchableFilters = null; destroyed = true; element.remove(); },
  });
}
