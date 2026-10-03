import { bindSearchableFilterSelects } from "./searchable-filter-selects.js";
import { contractorReport, documentCell, formatReportDate, formatReportMoney } from "../chat/contractor-report-model.js";
import { createPresencePaymentReportView } from "./presence-payment-report-view.js";
import { REPORT_LAUNCH_BUTTONS } from "./report-launch-button-assets.js";

const FILTERS = [
  ["id", "NÚMERO CONTRATO"], ["branch", "FILIAL"], ["supplier", "FORNECEDOR"],
  ["stage", "ETAPA"], ["activity", "ATIVIDADE"], ["status", "STATUS"],
];
const MAIN_COLUMNS = [
  ["id", "ID"], ["startDate", "DATA INÍCIO"], ["endDate", "DATA FIM"],
  ["branch", "FILIAL"], ["supplier", "FORNECEDOR"], ["measurementType", "TIPO MEDIÇÃO"],
  ["activity", "ATIVIDADE EXECUTADA"], ["contractDocumentId", "ID CONTRATO"],
  ["estimateDocumentId", "ID ESTIMATIVA"], ["globalEstimatedValue", "VALOR GLOBAL ESTIMADO"],
  ["totalValue", "VALOR TOTAL"], ["totalMeasurements", "TOTAL MEDIÇÕES"], ["status", "STATUS"],
];
const PAGE_SIZE = 25;
const REPORT_NAMES = [
  "Controle de empreiteiros", "Presenças por pedido / IDPGTO", "Fornecedores e atividades",
  "Presenças e ausências", "Pagamentos pendentes", "Etapas e atividades",
  "Diários de obras pendentes", "Tarefas pessoais", "Resumo gerencial de gastos",
  "Despesas recorrentes", "Cotações e orçamentos", "Depreciação do imobilizado",
  "Controle de documentos", "Indicadores comerciais", "Último andamento por imóvel",
  "Pendências comerciais", "Aluguéis em aberto",
];

function safeError(error) {
  const message = String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
  return `Não foi possível carregar o relatório: ${message}`;
}

export function createContractorReportsView({ document: doc = globalThis.document, data, presenceData, extraReports = [], onHome } = {}) {
  if (!doc?.body || typeof data?.loadOverview !== "function" || typeof data?.loadDetails !== "function") {
    throw new TypeError("A tela de relatórios requer documento e fonte de dados.");
  }
  const make = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  let destroyed = false; let opened = false; let mode = "hub"; let overview = null; let page = 1;
  let defaultStatusApplied = false;
  let overviewController = null; let detailController = null; let overviewRevision = 0; let detailRevision = 0;
  let returnFocus = null;
  const extraViews = new Map();
  for (const group of extraReports) {
    if (!group?.view?.element || typeof group.view.open !== "function") continue;
    for (const id of group.ids || []) {
      if (Number.isInteger(id) && id >= 3 && id <= 17) extraViews.set(id, group.view);
    }
  }
  const uniqueExtraViews = [...new Set(extraViews.values())];

  const root = make("section", "og-overlay cr-overlay");
  root.hidden = true; root.tabIndex = -1; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Relatórios Energético");
  const header = make("header", "og-header cr-header");
  const back = button("og-button", "Voltar");
  const title = make("h1", "og-title", "RELATÓRIOS");
  const home = button("og-button", "Início");
  header.append(back, title, home);
  const content = make("main", "og-content cr-content");
  root.append(header, content);

  const hub = make("section", "cr-hub");
  hub.append(make("h2", "cr-hub-title", "Relatórios Energético"));
  hub.append(make("p", "cr-hub-intro", "Selecione um quadrado para consultar o relatório."));
  const hubGrid = make("div", "cr-hub-grid");
  for (let number = 1; number <= REPORT_NAMES.length; number++) {
    const available = number === 1 || (number === 2 && typeof presenceData?.loadSnapshot === "function") || extraViews.has(number);
    const mascot = REPORT_LAUNCH_BUTTONS[number];
    const tile = button(`cr-report-tile ${available ? "cr-report-tile--active" : ""}${mascot ? " cr-report-tile--mascot" : ""}`);
    if (mascot) {
      tile.style.setProperty("--report-fill", mascot.color);
      tile.dataset.reportGroup = mascot.group;
      const image = make("img", "cr-report-tile-image");
      image.src = mascot.imageUrl; image.alt = ""; image.loading = "lazy";
      tile.append(image);
    }
    tile.append(make("span", "cr-report-tile-copy", `${number} · ${REPORT_NAMES[number - 1]}`));
    tile.dataset.reportId = String(number);
    tile.disabled = !available;
    if (!available) tile.title = "Relatório ainda não definido";
    else if (number === 1) tile.addEventListener("click", () => { void showReport(); });
    else if (number === 2) tile.addEventListener("click", () => { void showPresenceReport(); });
    else tile.addEventListener("click", () => { void showExtraReport(number); });
    hubGrid.append(tile);
  }
  hub.append(hubGrid);

  const report = make("section", "cr-report"); report.hidden = true;
  const reportHeading = make("div", "cr-report-heading");
  const refresh = button("og-button cr-refresh", "Atualizar");
  reportHeading.append(make("h2", "cr-report-title", "CONTROLE DE EMPREITEIROS"), refresh);
  report.append(reportHeading);
  const filterGrid = make("div", "cr-filters");
  const controls = new Map();
  for (const [name, label] of FILTERS) {
    const wrapper = make("label", "cr-filter");
    wrapper.append(make("span", "cr-filter-label", label));
    const control = make("select", "og-input cr-filter-input"); control.name = name;
    control.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    wrapper.append(control); filterGrid.append(wrapper); controls.set(name, control);
  }
  report.append(filterGrid);
  const metrics = make("dl", "cr-metrics");
  for (const [name, label] of [
    ["active", "QTD ATIVOS"], ["inactive", "QTD INATIVOS"],
    ["contracts", "QTD TOTAL CONTRATOS"], ["activeGlobalValue", "VALOR TOTAL GLOBAL ATIVOS"],
  ]) {
    const card = make("div", `cr-metric cr-metric--${name}`);
    card.append(make("dt", "", label));
    const value = make("dd", "", name === "activeGlobalValue" ? "R$ 0,00" : "0"); value.dataset.metric = name;
    card.append(value); metrics.append(card);
  }
  report.append(metrics);
  const note = make("p", "cr-note", "Ao filtrar por ID, será apresentado o detalhamento do contrato.");
  report.append(note);
  const notice = make("div", "cr-notice"); notice.hidden = true;
  const mainTableWrap = make("div", "cr-table-scroll"); mainTableWrap.tabIndex = 0;
  mainTableWrap.setAttribute("role", "region"); mainTableWrap.setAttribute("aria-label", "Controle de empreiteiros");
  const mainTable = make("table", "cr-table cr-main-table");
  const thead = make("thead"); const headRow = make("tr");
  MAIN_COLUMNS.forEach(([, label]) => headRow.append(make("th", "", label)));
  thead.append(headRow); mainTable.append(thead, make("tbody")); mainTableWrap.append(mainTable);
  report.append(notice, make("p", "cr-scroll-hint", "No computador, deslize a tabela para consultar as colunas."), mainTableWrap);
  const pager = make("nav", "cr-pager"); pager.setAttribute("aria-label", "Páginas do relatório");
  const previous = button("og-button", "Anterior"); const pageLabel = make("span", "cr-page-label"); const next = button("og-button", "Próxima");
  pager.append(previous, pageLabel, next); report.append(pager);
  const detail = make("section", "cr-detail"); detail.hidden = true; report.append(detail);
  const presenceReport = presenceData ? createPresencePaymentReportView({ document: doc, data: presenceData }) : null;
  content.append(hub, report); if (presenceReport) content.append(presenceReport.element);
  for (const view of uniqueExtraViews) content.append(view.element);
  doc.body.append(root);
  const pickers = bindSearchableFilterSelects(filterGrid);

  function setNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.append(make("p", "", message));
    if (retry) {
      notice.setAttribute("role", "alert");
      const retryButton = button("og-button cr-retry", "Tentar novamente");
      retryButton.addEventListener("click", () => { void loadOverview(); }); notice.append(retryButton);
    } else notice.removeAttribute("role");
  }

  function populateFilters(rows) {
    for (const [name] of FILTERS) {
      const control = controls.get(name);
      const current = control.value;
      control.replaceChildren(Object.assign(make("option", "", "Todos"), { value: "" }));
      const values = [...new Set(rows.map(row => row[name]).filter(Boolean))]
        .sort((a, b) => name === "id" ? Number(a) - Number(b) : a.localeCompare(b, "pt-BR"));
      for (const value of values) control.append(Object.assign(make("option", "", value), { value }));
      control.value = name === "status" && !defaultStatusApplied
        ? values.find(value => value.trim().toUpperCase() === "ATIVO") || ""
        : values.includes(current) ? current : "";
      if (name === "status") defaultStatusApplied = true;
    }
    pickers.sync();
  }

  function appendCell(tr, column, value, tone = "neutral", label = "") {
    const cell = make("td"); cell.dataset.column = column; cell.dataset.tone = tone;
    if (label) {
      cell.dataset.label = label;
      cell.append(make("span", "cr-cell-label", label), make("span", "cr-cell-value", value));
    } else cell.textContent = value;
    tr.append(cell);
  }

  function statusTone(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "ATIVO" ? "success" : normalized === "INATIVO" ? "danger" : "neutral";
  }

  function renderMain() {
    if (!overview) {
      for (const value of metrics.querySelectorAll("[data-metric]")) value.textContent = "—";
      pageLabel.textContent = "Dados não carregados";
      previous.disabled = true; next.disabled = true;
      mainTable.tBodies[0].replaceChildren();
      return;
    }
    const filters = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
    const view = contractorReport(overview.rows || [], filters);
    for (const [name, value] of Object.entries(view.metrics)) {
      metrics.querySelector(`[data-metric="${name}"]`).textContent = name === "activeGlobalValue" ? formatReportMoney(value) : String(value);
    }
    const pages = Math.max(1, Math.ceil(view.rows.length / PAGE_SIZE));
    page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${view.rows.length} registro(s)`;
    previous.disabled = page <= 1; next.disabled = page >= pages;
    const body = mainTable.tBodies[0]; body.replaceChildren();
    for (const row of view.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const tr = make("tr"); tr.dataset.rowId = row.id;
      for (const [name, label] of MAIN_COLUMNS) {
        let value = row[name], tone = "neutral";
        if (name === "contractDocumentId" || name === "estimateDocumentId") {
          const document = documentCell(value, overview?.documentStatuses?.[value]);
          value = document.text; tone = document.tone;
        } else if (["globalEstimatedValue", "totalValue", "totalMeasurements"].includes(name)) {
          value = formatReportMoney(value);
        } else if (["startDate", "endDate"].includes(name)) {
          value = formatReportDate(value);
        } else {
          value = String(value ?? "").trim() || "PENDENTE";
          if (name === "status") tone = statusTone(value);
        }
        if (value === "PENDENTE") tone = "pending";
        appendCell(tr, name, value, tone, label);
      }
      body.append(tr);
    }
    if (!view.rows.length && overview) {
      const tr = make("tr"); const td = make("td", "cr-empty", "Nenhum empreiteiro corresponde aos filtros.");
      td.colSpan = MAIN_COLUMNS.length; tr.append(td); body.append(tr);
    }
  }

  function detailTable(titleText, headings, rows, values, emptyText) {
    const section = make("section", "cr-detail-section"); section.append(make("h3", "", titleText));
    if (!rows.length) { section.append(make("p", "cr-empty", emptyText)); return section; }
    const wrapper = make("div", "cr-table-scroll"); wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region"); wrapper.setAttribute("aria-label", titleText);
    const table = make("table", "cr-table cr-detail-table"); const thead = make("thead"); const tr = make("tr");
    headings.forEach(label => tr.append(make("th", "", label))); thead.append(tr); table.append(thead);
    const body = make("tbody");
    for (const row of rows) {
      const line = make("tr");
      values(row).forEach(([value, tone], index) => appendCell(line, String(index), value || "PENDENTE", tone || (value ? "neutral" : "pending"), headings[index]));
      body.append(line);
    }
    table.append(body); wrapper.append(table); section.append(wrapper); return section;
  }

  async function loadDetail(id) {
    detailController?.abort(); detailRevision += 1;
    const revision = detailRevision;
    detail.replaceChildren(); detail.hidden = !id;
    if (!id) return;
    detail.append(make("h2", "", `CONTRATO ID ${id}`), make("p", "", "Carregando lançamentos e medições vinculados…"));
    const controller = new AbortController(); detailController = controller;
    try {
      const dataSet = await data.loadDetails(id, { signal: controller.signal });
      if (destroyed || controller.signal.aborted || revision !== detailRevision) return;
      detail.replaceChildren(make("h2", "", `CONTRATO ID ${id}`));
      detail.append(detailTable(`LANÇAMENTOS VINCULADOS AO CONTRATO ID ${id}`,
        ["ID", "DATA", "FORNECEDOR", "CONTRATO", "VALOR TOTAL", "STATUS"], dataSet.launches || [], row => [
          [row.id], [formatReportDate(row.date)], [row.supplier], [row.contract], [formatReportMoney(row.total)], [row.paymentStatus, row.paymentTone],
        ], "Nenhum lançamento vinculado ao contrato."));
      detail.append(detailTable(`MEDIÇÕES VINCULADAS AO CONTRATO ID ${id}`,
        ["ID", "FORNECEDOR", "Nº CONTRATO", "STATUS"], dataSet.measurements || [], row => [
          [row.id], [row.supplier], [row.contract], [row.status, row.statusTone],
        ], "Nenhuma medição vinculada ao contrato."));
    } catch (error) {
      if (destroyed || controller.signal.aborted || revision !== detailRevision) return;
      detail.replaceChildren(make("h2", "", `CONTRATO ID ${id}`), make("p", "cr-detail-error", safeError(error)));
      const retry = button("og-button", "Tentar novamente"); retry.addEventListener("click", () => { void loadDetail(id); }); detail.append(retry);
    }
  }

  async function loadOverview() {
    overviewController?.abort(); overviewRevision += 1;
    detailController?.abort(); detailRevision += 1;
    const revision = overviewRevision;
    const controller = new AbortController(); overviewController = controller;
    overview = null; detail.hidden = true; setNotice("Carregando controle de empreiteiros…");
    root.setAttribute("aria-busy", "true"); renderMain();
    try {
      const snapshot = await data.loadOverview({ signal: controller.signal });
      if (destroyed || controller.signal.aborted || revision !== overviewRevision) return;
      overview = snapshot; populateFilters(snapshot.rows || []); setNotice(snapshot.warnings?.join(" ") || "");
      renderMain();
      const id = controls.get("id").value;
      if (id) void loadDetail(id);
    } catch (error) {
      if (destroyed || controller.signal.aborted || revision !== overviewRevision) return;
      setNotice(safeError(error), true);
    } finally {
      if (revision === overviewRevision) root.setAttribute("aria-busy", "false");
    }
  }

  async function showReport() {
    if (destroyed) return;
    presenceReport?.close();
    uniqueExtraViews.forEach(view => view.close?.());
    mode = "report"; hub.hidden = true; report.hidden = false; title.textContent = "RELATÓRIO 1";
    await loadOverview();
  }

  async function showPresenceReport() {
    if (destroyed || !presenceReport) return;
    overviewController?.abort(); overviewRevision++;
    detailController?.abort(); detailRevision++;
    uniqueExtraViews.forEach(view => view.close?.());
    mode = "report2"; hub.hidden = true; report.hidden = true; title.textContent = "RELATÓRIO 2";
    await presenceReport.open();
  }

  async function showExtraReport(number) {
    const view = extraViews.get(number);
    if (destroyed || !view) return;
    overviewController?.abort(); overviewRevision++;
    detailController?.abort(); detailRevision++;
    presenceReport?.close();
    uniqueExtraViews.forEach(extraView => extraView.close?.());
    mode = `report${number}`; hub.hidden = true; report.hidden = true;
    title.textContent = `RELATÓRIO ${number}`;
    await view.open(number);
  }

  function close() {
    overviewController?.abort(); detailController?.abort(); overviewRevision++; detailRevision++;
    presenceReport?.close();
    uniqueExtraViews.forEach(view => view.close?.());
    opened = false; root.hidden = true; pickers.close(); returnFocus?.focus?.();
  }

  for (const [name, control] of controls) control.addEventListener("change", () => {
    if (name === "id") void loadDetail(control.value);
    page = 1; renderMain();
  });
  previous.addEventListener("click", () => { if (page > 1) { page--; renderMain(); } });
  next.addEventListener("click", () => { page++; renderMain(); });
  refresh.addEventListener("click", () => { void loadOverview(); });
  back.addEventListener("click", () => {
    if (mode !== "hub") {
      overviewController?.abort(); overviewRevision++;
      detailController?.abort(); detailRevision++; presenceReport?.close();
      uniqueExtraViews.forEach(view => view.close?.());
      mode = "hub"; report.hidden = true; hub.hidden = false; title.textContent = "RELATÓRIOS";
    } else close();
  });
  home.addEventListener("click", () => { close(); void onHome?.(); });

  return Object.freeze({
    close,
    async open() {
      if (destroyed) throw new Error("A tela de relatórios foi encerrada.");
      returnFocus = doc.activeElement; opened = true; root.hidden = false;
      mode = "hub"; hub.hidden = false; report.hidden = true; presenceReport?.close();
      uniqueExtraViews.forEach(view => view.close?.()); title.textContent = "RELATÓRIOS";
      root.focus(); return opened;
    },
    destroy() {
      if (destroyed) return;
      close(); destroyed = true; pickers.destroy(); presenceReport?.destroy();
      uniqueExtraViews.forEach(view => view.destroy?.()); root.remove();
    },
  });
}
