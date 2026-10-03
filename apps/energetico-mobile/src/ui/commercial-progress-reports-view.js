import { buildCommercialReport14, buildCommercialReport15 } from "../chat/commercial-progress-reports-model.js";

const FILTERS = [
  ["branch", "FILIAL", [14, 15]], ["property", "IMÓVEL", [14, 15]],
  ["contractId", "CONTRATO", [14, 15]], ["buyer", "COMPRADOR", [14, 15]],
  ["contractStatus", "STATUS DO CONTRATO", [14]], ["visualStatus", "STATUS DO IMÓVEL", [15]],
  ["milestoneStatus", "STATUS DO MARCO", [15]],
];
const money = value => value == null ? "INCOMPLETO" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const display = value => String(value ?? "").trim() || "NÃO INFORMADO";
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "NÃO INDICADO";
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const safeError = error => String(error?.message || "Falha na consulta ao SharePoint.")
  .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint").replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
  .replace(/[\r\n]+/g, " ").slice(0, 240);

export function createCommercialProgressReportsView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadSnapshot !== "function") throw new TypeError("Os relatórios 14 e 15 requerem documento e fonte de dados.");
  const make = (tag, className = "", content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const element = make("section", "cpr-report"); element.hidden = true;
  const stylesheet = make("link"); stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./commercial-progress-reports.css", import.meta.url).href;
  element.append(stylesheet);
  const brand = make("div", "cpr-brand");
  const logo = make("img"); logo.src = new URL("../../../../assets/logo-energetica-oficial.png", import.meta.url).href;
  logo.alt = "Energética Construtora"; brand.append(logo); element.append(brand);
  const heading = make("header", "cpr-heading");
  const title = make("h2", "cpr-title"); const refresh = button("cpr-button cpr-refresh", "Atualizar");
  heading.append(title, refresh); element.append(heading);
  const filters = make("div", "cpr-filters"); const controls = new Map();
  for (const [name, label, reports] of FILTERS) {
    const wrapper = make("label", "cpr-filter"); wrapper.dataset.reports = reports.join(",");
    wrapper.append(make("span", "cpr-filter-label", label));
    const select = make("select", "cpr-select"); select.name = name;
    select.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    wrapper.append(select); filters.append(wrapper); controls.set(name, select);
  }
  filters.prepend(refresh);
  element.insertBefore(filters, brand);
  const metricsTitle = make("h3", "cpr-metrics-title", "📊 INDICADORES DO RESULTADO"); element.append(metricsTitle);
  const metrics = make("dl", "cpr-metrics"); element.append(metrics);
  const notice = make("div", "cpr-notice"); notice.hidden = true; element.append(notice);
  const content = make("div", "cpr-content"); element.append(content);
  const pager = make("nav", "cpr-pager"); pager.setAttribute("aria-label", "Páginas do relatório comercial");
  const previous = button("cpr-button cpr-previous", "Anterior"); const pageLabel = make("span", "cpr-page-label");
  const next = button("cpr-button cpr-next", "Próxima"); pager.append(previous, pageLabel, next); element.append(pager);
  let snapshot = null; let controller = null; let revision = 0; let page = 1; let reportNumber = null; let destroyed = false;

  function showNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.setAttribute("role", retry ? "alert" : "status");
    notice.append(make("p", "", message));
    if (retry) { const retryButton = button("cpr-button cpr-retry", "Tentar novamente");
      retryButton.addEventListener("click", () => { void load(); }); notice.append(retryButton); }
  }

  function field(parent, label, value) {
    const item = make("div", "cpr-field");
    item.dataset.field = label;
    item.append(make("span", "cpr-field-label", label), make("strong", "cpr-field-value", display(value)));
    parent.append(item);
  }
  function metric(label, value, tone = "neutral") {
    const card = make("div", "cpr-metric"); card.dataset.tone = tone;
    card.append(make("dt", "", label), make("dd", "", value)); metrics.append(card);
  }
  function statusMetric(active, inactive) {
    const card = make("div", "cpr-metric cpr-status-metric"); card.dataset.tone = "status";
    card.append(make("dt", "", "STATUS DOS IMÓVEIS"));
    const counts = make("dd", "cpr-status-counts");
    counts.append(make("span", "cpr-status-active", `ATIVOS: ${active}`),
      make("span", "cpr-status-inactive", `INATIVOS: ${inactive}`));
    card.append(counts); metrics.append(card);
  }
  function propertyStatusMetric(status) {
    const normalized = String(status || "").trim().toLocaleUpperCase("pt-BR");
    const card = make("div", "cpr-metric cpr-status-metric");
    card.dataset.tone = normalized === "ATIVO" ? "paid" : normalized === "INATIVO" ? "total" : "status";
    card.append(make("dt", "", "📌 STATUS DO IMÓVEL"),
      make("dd", "cpr-status-single", normalized === "ATIVO" ? "🟢 ATIVO" : normalized === "INATIVO" ? "🔴 INATIVO" : "⚪ NÃO INFORMADO"));
    metrics.append(card);
  }
  function table(headers, rows) {
    const table = make("table", "cpr-table"); const thead = make("thead"); const headingRow = make("tr");
    for (const label of headers) headingRow.append(make("th", "", label));
    thead.append(headingRow); table.append(thead);
    const tbody = make("tbody");
    for (const cells of rows) {
      const row = make("tr"); for (const value of cells) row.append(make("td", "", display(value)));
      tbody.append(row);
    }
    table.append(tbody); return table;
  }
  function options(name) {
    if (!snapshot) return [];
    if (name === "branch" || name === "property") return (reportNumber === 14 ? snapshot.properties : snapshot.milestones).map(row => row[name]);
    if (name === "contractStatus") return snapshot.contracts.map(row => row.status);
    if (name === "visualStatus") return snapshot.properties.map(row => row.visualStatus);
    if (name === "milestoneStatus") return snapshot.milestones.map(row => row.status);
    if (name === "contractId") return (reportNumber === 14 ? snapshot.contracts : snapshot.milestones).map(row => row.id && reportNumber === 14 ? row.id : row.contractId);
    return (reportNumber === 14 ? snapshot.contracts : snapshot.milestones).map(row => row.buyer);
  }
  function populateFilters() {
    for (const [name] of FILTERS) {
      const control = controls.get(name); const current = control.value;
      const values = [...new Set(options(name).map(value => String(value ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
      control.replaceChildren(Object.assign(make("option", "", "Todos"), { value: "" }));
      for (const value of values) control.append(Object.assign(make("option", "", value), { value }));
      control.value = values.includes(current) ? current : "";
    }
  }
  const selectedFilters = () => Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));

  function setPages(groups) {
    const count = Math.max(1, Math.ceil(groups.length / 8)); page = Math.min(page, count);
    pager.hidden = groups.length <= 8; previous.disabled = page <= 1; next.disabled = page >= count;
    pageLabel.textContent = `Página ${page} de ${count} · ${groups.length} filial(is)`;
    return groups.slice((page - 1) * 8, page * 8);
  }
  function propertyCard(row, report) {
    const card = make("article", "cpr-property");
    card.append(make("h4", "cpr-property-title", row.property));
    const fields = make("div", "cpr-fields");
    if (report === 14) {
      field(fields, "COMPRADOR", row.buyer); field(fields, "PAGO", money(row.paid));
      field(fields, "CONTRATOS ANTERIORES", money(row.formerContracts));
      field(fields, "PAGO CORRETOR", money(row.brokerPaid)); field(fields, "PENDENTE", money(row.pending));
      field(fields, "TOTAL", money(row.total)); field(fields, "% PAGO", `${Math.round(row.paidPercentage)}%`);
      field(fields, "STATUS", row.saleStatus); field(fields, "NF CORRETOR", row.invoice); field(fields, "FISCAL", row.fiscal);
    } else {
      field(fields, "ID DO REGISTRO", row.id);
      field(fields, "COMPRADOR", row.buyer); field(fields, "ID CONTRATO", row.contractId);
      field(fields, "ÚLTIMO TIPO MARCO", row.type); field(fields, "DESCRIÇÃO", row.description);
      field(fields, "INÍCIO", date(row.startDate));
      field(fields, "DATA FIM", date(row.endDate));
      field(fields, "DIAS DE ANDAMENTO", row.daysInProgress == null ? "NÃO INDICADO" : String(row.daysInProgress));
      field(fields, "DATA FATAL", date(row.dueDate));
      field(fields, "PRAZO", row.daysToDue == null ? "NÃO INDICADO" : row.daysToDue < 0 ? `VENCIDA HÁ ${-row.daysToDue} DIA(S)`
        : row.daysToDue === 0 ? "VENCE HOJE" : `${row.daysToDue} DIA(S) PARA A FATAL`);
      field(fields, "STATUS", row.status); field(fields, "STATUS DO IMÓVEL", row.visualStatus);
    }
    card.append(fields); return card;
  }

  function renderBranches(result, report) {
    if (!result.branches.length) { content.append(make("p", "cpr-empty", "Nenhum imóvel corresponde aos filtros.")); pager.hidden = true; return; }
    for (const branch of setPages(result.branches)) {
      const section = make("section", "cpr-branch"); section.append(make("h3", "cpr-branch-title", `FILIAL ${branch.name}`));
      if (report === 14) {
        const summary = make("div", "cpr-fields cpr-branch-summary");
        field(summary, "TOTAL", money(branch.total)); field(summary, "PAGO", money(branch.paid));
        field(summary, "ANTERIORES", money(branch.formerContracts)); field(summary, "CORRETOR", money(branch.brokerPaid));
        field(summary, "PENDENTE", money(branch.pending)); field(summary, "% PAGO", `${Math.round(branch.paidPercentage)}%`);
        section.append(summary);
        section.append(table(["IMÓVEL", "PAGO", "CONTRATOS ANTERIORES", "PAGO CORRETOR", "PENDENTE", "TOTAL", "% PAGO", "STATUS", "FISCAL"],
          branch.properties.map(row => [row.property, money(row.paid), money(row.formerContracts), money(row.brokerPaid),
            money(row.pending), money(row.total), `${Math.round(row.paidPercentage)}%`, row.saleStatus, row.fiscal])));
      } else {
        section.append(table(["FILIAL", "IMÓVEL", "COMPRADOR", "ID CONTRATO", "ÚLTIMO TIPO MARCO", "DESCRIÇÃO", "INÍCIO", "DATA FATAL", "STATUS"],
          branch.properties.map(row => [row.branch, row.property, row.buyer, row.contractId, row.type, row.description,
            row.daysInProgress == null ? date(row.startDate) : `${date(row.startDate)}\n${row.daysInProgress} DIA(S) DE ANDAMENTO`,
            date(row.dueDate), row.status])));
        section.append(make("p", "cpr-branch-footer", `TOTAL DE IMÓVEIS NA FILIAL: ${branch.count}`));
      }
      const cards = make("div", "cpr-card-list");
      for (const row of branch.properties) cards.append(propertyCard(row, report));
      section.append(cards); content.append(section);
    }
  }
  function renderFourteen(result, filtersSelected) {
    metric("VALOR TOTAL", money(result.indicators.total), "total"); metric("VALOR PAGO", money(result.indicators.paid), "paid");
    metric("VALOR PENDENTE", money(result.indicators.pending), "pending");
    const specific = filtersSelected.contractId || filtersSelected.buyer || filtersSelected.property;
    const propertyCount = result.branches.reduce((count, branch) => count + branch.properties.length, 0);
    if (specific && propertyCount === 1) propertyStatusMetric(result.branches[0].properties[0].visualStatus);
    else statusMetric(result.indicators.active, result.indicators.inactive);
    if (!specific) content.append(make("p", "cpr-detail-hint", "🔎 SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR UM CONTRATO EM ESPECÍFICO"));
    content.append(make("h3", "cpr-section-title", "🏠 RESUMO POR IMÓVEL")); renderBranches(result, 14);
    const payments = make("section", "cpr-detail"); payments.append(make("h3", "cpr-section-title", "PAGAMENTOS PREVISTOS (PENDENTES)"));
    if (!result.pendingPayments.length) payments.append(make("p", "cpr-empty", "Nenhum pagamento pendente corresponde aos filtros."));
    for (const row of result.pendingPayments) {
      const card = make("article", "cpr-subcard"); card.append(make("h4", "cpr-subtitle", `${row.branch} · ${row.property} · CONTRATO ${display(row.contractId)}`));
      const fields = make("div", "cpr-fields"); field(fields, "COMPRADOR", row.buyer); field(fields, "DATA PREVISTA", date(row.dueDate));
      field(fields, "DESCRIÇÃO", row.description); field(fields, "VALOR", money(row.amount));
      field(fields, "STATUS", !row.dueDate ? "SEM DATA" : row.dueDate < today() ? "ATRASADO" : "A VENCER");
      card.append(fields); payments.append(card);
    }
    content.append(payments);
    if (filtersSelected.contractId || filtersSelected.buyer || filtersSelected.property) {
      const contracts = make("section", "cpr-detail"); contracts.append(make("h3", "cpr-section-title", "DETALHAMENTO DOS CONTRATOS"));
      for (const row of result.contracts) {
        const card = make("article", "cpr-subcard"); card.append(make("h4", "cpr-subtitle", `CONTRATO ${row.id} · ${row.buyer}`));
        const fields = make("div", "cpr-fields"); field(fields, "FILIAL", row.branch); field(fields, "IMÓVEL", row.property);
        field(fields, "STATUS", row.status); field(fields, "DATA VENDA", date(row.saleDate));
        field(fields, "CORRETOR", row.broker); field(fields, "TOTAL DO CONTRATO", money(row.total));
        card.append(fields);
        const launches = result.receipts.filter(receipt => String(receipt.contractId) === String(row.id));
        for (const receipt of launches) {
          const item = make("div", "cpr-receipt");
          const receiptFields = make("div", "cpr-fields");
          field(receiptFields, "ID", receipt.id); field(receiptFields, "DATA PREVISTA", date(receipt.dueDate));
          field(receiptFields, "DATA PAGA", receipt.paidDate ? date(receipt.paidDate) : "PENDENTE PGTO");
          field(receiptFields, "DESCRIÇÃO", receipt.description); field(receiptFields, "VALOR", money(receipt.amount));
          field(receiptFields, "FORMA PGTO", receipt.paymentMethod);
          field(receiptFields, "CONTA", `${display(receipt.account)}${receipt.directBroker === "SIM" ? " (PAGO DIRETO AO CORRETOR)" : ""}`);
          item.append(receiptFields);
          card.append(item);
        }
        contracts.append(card);
      }
      content.append(contracts);
    }
  }
  function renderFifteen(result) {
    content.append(make("h3", "cpr-section-title", "ÚLTIMO ANDAMENTO POR IMÓVEL"));
    content.append(make("p", "cpr-intro", "UM REGISTRO POR IMÓVEL — CONSIDERANDO A DATA DE INÍCIO MAIS RECENTE, INDEPENDENTEMENTE DO CONTRATO OU COMPRADOR"));
    if (!result.detail) content.append(make("p", "cpr-detail-hint", "🔎 FILTRE CONTRATO, COMPRADOR OU IMÓVEL PARA DETALHAR TODO O CONTRATO E VISUALIZAR TODOS OS TIPOMARCO"));
    renderBranches(result, 15);
    if (result.detail) {
      const history = make("section", "cpr-detail"); history.append(make("h3", "cpr-section-title", "HISTÓRICO COMPLETO DE TIPOMARCO"));
      for (const row of result.history) {
        const card = make("article", "cpr-subcard"); card.append(make("h4", "cpr-subtitle", `${row.branch} · ${row.property} · ${display(row.type)}`));
        const fields = make("div", "cpr-fields"); field(fields, "ID DO REGISTRO", row.id);
        field(fields, "COMPRADOR", row.buyer); field(fields, "CONTRATO", row.contractId);
        field(fields, "DESCRIÇÃO", row.description); field(fields, "INÍCIO", date(row.startDate));
        field(fields, "DATA FIM", date(row.endDate));
        field(fields, "DATA FATAL", date(row.dueDate)); field(fields, "STATUS", row.status);
        card.append(fields); history.append(card);
      }
      content.append(history);
    }
  }
  function render() {
    metrics.replaceChildren(); content.replaceChildren(); pager.hidden = true;
    if (!snapshot) return;
    showNotice("");
    try {
      const filtersSelected = selectedFilters();
      if (reportNumber === 14) renderFourteen(buildCommercialReport14(snapshot, filtersSelected), filtersSelected);
      else renderFifteen(buildCommercialReport15(snapshot, filtersSelected, today()));
    } catch (error) {
      metrics.replaceChildren(); content.replaceChildren(); pager.hidden = true;
      showNotice(`Não foi possível calcular o relatório: ${safeError(error)}`, true);
    }
  }
  async function load() {
    controller?.abort(); const current = ++revision; controller = new AbortController();
    snapshot = null; render(); showNotice("Carregando dados do SharePoint…"); element.setAttribute("aria-busy", "true");
    try {
      const loaded = await data.loadSnapshot({ reportNumber, signal: controller.signal });
      if (destroyed || element.hidden || controller.signal.aborted || current !== revision) return;
      snapshot = loaded; populateFilters(); render();
    } catch (error) {
      if (destroyed || element.hidden || controller.signal.aborted || current !== revision) return;
      render(); showNotice(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) element.setAttribute("aria-busy", "false");
    }
  }
  for (const control of controls.values()) control.addEventListener("change", () => { page = 1; render(); });
  refresh.addEventListener("click", () => { void load(); });
  previous.addEventListener("click", () => { if (page > 1) { page--; render(); } });
  next.addEventListener("click", () => { page++; render(); });

  return Object.freeze({ element,
    open(number) {
      if (destroyed) throw new Error("A visualização comercial foi encerrada.");
      if (number !== 14 && number !== 15) throw new RangeError("Relatório comercial desconhecido.");
      reportNumber = number; page = 1; element.hidden = false;
      element.dataset.report = String(number);
      title.textContent = number === 14 ? "INDICADORES COMERCIAIS POR IMÓVEL" : "ÚLTIMO ANDAMENTO POR IMÓVEL";
      metricsTitle.hidden = number === 15;
      for (const wrapper of filters.querySelectorAll(".cpr-filter")) wrapper.hidden = !wrapper.dataset.reports.split(",").includes(String(number));
      return load();
    },
    close() { controller?.abort(); revision++; snapshot = null; reportNumber = null; element.hidden = true;
      metrics.replaceChildren(); content.replaceChildren(); showNotice(""); pager.hidden = true; element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; this.close(); destroyed = true; element.remove(); },
  });
}
