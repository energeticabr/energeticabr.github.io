import { buildQuotationReport, buildDepreciationReport, buildDocumentReport, formatAuditDate, formatAuditMoney } from "../chat/audit-reports-live-model.js";

const TITLES = Object.freeze({
  11: "COTAÇÕES E ORÇAMENTOS", 12: "CONTROLE DE DEPRECIAÇÃO DO IMOBILIZADO", 13: "CONTROLE DE DOCUMENTOS",
});
const FILTERS = Object.freeze({
  11: [],
  12: [["assetNumber", "Nº patrimônio"], ["asset", "Imobilizado"], ["branch", "Filial"]],
  13: [["branch", "Filial"], ["homologation", "Tipo homologação"], ["person", "Pessoa relacionada"],
    ["documentType", "Tipo documento"], ["stage", "Etapa"], ["property", "Imóvel"], ["status", "Status"]],
});
const PAGE_SIZE = 25;
const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const partial = (value, known) => value == null ? `${formatAuditMoney(known)} · PARCIAL` : formatAuditMoney(value);

function safeError(error) {
  return String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]").replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createAuditReportsView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadReport !== "function") throw new TypeError("Relatórios de auditoria requerem documento e fonte de dados.");
  const make = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const section = make("section", "ar-report"); section.hidden = true;
  const heading = make("div", "ar-heading");
  const title = make("h2", "ar-title");
  const refresh = button("og-button ar-refresh", "Atualizar");
  heading.append(title, refresh);
  const notice = make("div", "ar-notice"); notice.hidden = true;
  const filters = make("div", "ar-filters");
  const metrics = make("dl", "ar-metrics");
  const content = make("div", "ar-content");
  const pager = make("nav", "ar-pager"); pager.hidden = true; pager.setAttribute("aria-label", "Páginas do relatório");
  const previous = button("og-button", "Anterior"); const pageLabel = make("span"); const next = button("og-button", "Próxima");
  pager.append(previous, pageLabel, next);
  section.append(heading, notice, filters, metrics, content, pager);
  let reportNumber = 0; let snapshot = null; let controller = null; let revision = 0; let destroyed = false; let page = 1;
  const controls = new Map();

  function field(label, value, tone = "") {
    const wrapper = make("div", "ar-field");
    if (tone) wrapper.dataset.tone = tone;
    wrapper.append(make("dt", "", label), make("dd", "", value === "" || value == null ? "—" : String(value)));
    return wrapper;
  }
  function fields(entries) {
    const list = make("dl", "ar-fields");
    for (const [label, value, tone] of entries) list.append(field(label, value, tone));
    return list;
  }
  function metric(name, label, value, tone = "") {
    const card = make("div", "ar-metric");
    if (tone) card.dataset.tone = tone;
    const amount = make("dd", "", String(value)); amount.dataset.metric = name;
    card.append(make("dt", "", label), amount);
    metrics.append(card);
  }
  function emptyMetrics() {
    metrics.replaceChildren();
    const labels = reportNumber === 11 ? [["active", "Cotações ativas"], ["inactive", "Cotações inativas"], ["total", "Total de cotações"], ["pendingRequests", "Pendente solicitação"]]
      : reportNumber === 12 ? [["records", "Total de registros"], ["active", "Registros ativos"], ["branches", "Filiais"], ["total", "Valor total"], ["toDepreciate", "Valor a depreciar"], ["depreciated", "Valor depreciado"], ["current", "Valor atual"]]
        : [["submitted", "Documentos submetidos"], ["pending", "Documentos pendentes"], ["total", "Documentos totais"], ["expired", "Documentos vencidos"], ["expiring15", "A vencer em 15 dias"]];
    for (const [name, label] of labels) metric(name, label, "—");
  }
  function option(value, label = value) { const node = make("option", "", label); node.value = value; return node; }
  function currentFilters() { return Object.fromEntries([...controls].map(([name, select]) => [name, select.value])); }
  function updateFilters() {
    filters.replaceChildren(); controls.clear();
    const rows = reportNumber === 11 ? [] : snapshot?.rows || [];
    for (const [name, label] of FILTERS[reportNumber]) {
      const wrapper = make("label", "ar-filter"); wrapper.append(make("span", "", label));
      const select = make("select", "og-input"); select.name = name;
      select.append(option("", "Todos"));
      const values = [...new Set(rows.map(row => row[name]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      for (const value of values) select.append(option(value));
      select.addEventListener("change", () => { page = 1; render(); });
      wrapper.append(select); filters.append(wrapper); controls.set(name, select);
    }
    if (reportNumber === 13) {
      const wrapper = make("label", "ar-filter"); wrapper.append(make("span", "", "Ordenação"));
      const select = make("select", "og-input"); select.name = "order";
      select.append(option("validityDate", "Vencimento"), option("id", "Maior ID"), option("branch", "Filial"));
      select.addEventListener("change", () => { page = 1; render(); });
      wrapper.append(select); filters.append(wrapper); controls.set("order", select);
    }
    filters.hidden = !controls.size;
  }
  function renderQuotations() {
    const report = buildQuotationReport(snapshot);
    metric("active", "Cotações ativas", report.metrics.active, "success");
    metric("inactive", "Cotações inativas", report.metrics.inactive);
    metric("total", "Total de cotações", report.metrics.total, "info");
    metric("pendingRequests", "Pendente solicitação", report.metrics.pendingRequests, "danger");
    if (!report.quotes.length) { content.append(make("p", "ar-empty", "Nenhuma cotação encontrada.")); return; }
    for (const quote of report.quotes) {
      const card = make("article", "ar-card");
      card.dataset.quotationId = quote.id;
      card.append(make("h3", "ar-card-title", `COTAÇÃO Nº ${quote.id} · ${quote.budgetCount} orçamento(s)`));
      card.append(fields([["Filial", quote.branch], ["Etapa", quote.stage], ["Fornecedores vinculados", quote.supplierCount],
        ["Status", quote.status || "—"], ["Descrição", quote.description]]));
      const list = make("div", "ar-card-list");
      list.append(make("h4", "", `Orçamentos vinculados (${quote.budgetCount})`));
      if (!quote.groups.length) list.append(make("p", "ar-empty", "Nenhum orçamento vinculado."));
      for (const group of quote.groups) {
        const groupNode = make("section", "ar-group");
        groupNode.append(make("h4", "ar-group-title", `${group.branch} · ${group.stage} · ${group.budgets.length} orçamento(s)`));
        for (const budget of group.budgets) {
          const row = make("article", "ar-subcard"); row.dataset.budgetId = budget.id;
          row.append(make("h5", "", `ORÇAMENTO Nº ${budget.id}`));
          row.append(fields([["Filial", budget.branch], ["Etapa", budget.stage], ["Fornecedor", budget.supplier],
            ["Data finalizado", formatAuditDate(budget.completedDate)], ["Valor total", formatAuditMoney(budget.total)],
            ["Status", budget.status], ["Observação", budget.observation]]));
          groupNode.append(row);
        }
        list.append(groupNode);
      }
      card.append(list); content.append(card);
    }
    if (report.unlinkedBudgets.length) setNotice(`${report.unlinkedBudgets.length} orçamento(s) sem cotação correspondente nesta consulta.`);
  }
  function renderDepreciation() {
    const selected = snapshot.rows.filter(row => ["assetNumber", "asset", "branch"].every(name => !controls.get(name)?.value || row[name] === controls.get(name).value));
    const report = buildDepreciationReport({ rows: selected }, localToday());
    metric("records", "Total de registros", report.metrics.records);
    metric("active", "Registros ativos", report.metrics.active, "success");
    metric("branches", "Filiais", report.metrics.branches);
    metric("total", "Valor total", partial(report.metrics.total, report.metrics.partialTotal), "info");
    metric("toDepreciate", "Valor a depreciar", partial(report.metrics.toDepreciate, report.metrics.partialToDepreciate), "warning");
    metric("depreciated", "Valor depreciado", partial(report.metrics.depreciated, report.metrics.partialDepreciated), "danger");
    metric("current", "Valor atual", partial(report.metrics.current, report.metrics.partialCurrent), "success");
    const subtitle = make("p", "ar-subtitle", `Itens com depreciação prevista até ${formatAuditDate(report.deadline)}`);
    content.append(subtitle);
    if (!report.groups.length) { content.append(make("p", "ar-empty", "Nenhum item a depreciar até essa data com os filtros selecionados.")); return; }
    for (const branch of report.groups) {
      const group = make("section", "ar-group");
      group.append(make("h3", "ar-group-title", `FILIAL: ${branch.branch} · ${branch.rows.length} registro(s)`));
      group.append(make("p", "ar-group-summary", `Valor total: ${partial(branch.metrics.total, branch.metrics.partialTotal)}`));
      const list = make("div", "ar-card-list");
      for (const row of branch.rows) {
        const card = make("article", "ar-subcard");
        card.dataset.assetId = row.id;
        card.append(make("h4", "", `${row.assetNumber || "SEM Nº PATRIM."} · ${row.asset || "IMOBILIZADO NÃO INFORMADO"}`));
        const total = row.estimated == null || row.quantity == null ? null : row.estimated * row.quantity;
        const current = row.residual == null || row.quantity == null ? null : row.residual * row.quantity;
        card.append(fields([["Data depreciação", formatAuditDate(row.depreciationDate)], ["Grupo", row.group],
          ["% depreciação", row.percent == null ? "PENDENTE" : `${row.percent.toLocaleString("pt-BR")}%`],
          ["Valor unitário", formatAuditMoney(row.estimated)], ["Quantidade", row.quantity ?? "PENDENTE"],
          ["Valor total", formatAuditMoney(total)], ["Valor depreciado", total == null || current == null ? "PENDENTE" : formatAuditMoney(total - current)],
          ["Valor atual", formatAuditMoney(current)],
          ["A depreciar", row.percent == null || current == null ? "PENDENTE" : formatAuditMoney(row.percent * current / 100)]]));
        list.append(card);
      }
      group.append(list); content.append(group);
    }
  }
  function renderDocuments() {
    const report = buildDocumentReport(snapshot, currentFilters(), localToday());
    metric("submitted", "Documentos submetidos", report.metrics.submitted, "success");
    metric("pending", "Documentos pendentes", report.metrics.pending, "warning");
    metric("total", "Documentos totais", report.metrics.total, "info");
    metric("expired", "Documentos vencidos", report.metrics.expired, "danger");
    metric("expiring15", "A vencer em 15 dias", report.metrics.expiring15, "warning");
    if (!report.rows.length) { content.append(make("p", "ar-empty", "Nenhum documento corresponde aos filtros.")); return; }
    const pages = Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE)); page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${report.rows.length} documento(s)`;
    previous.disabled = page === 1; next.disabled = page === pages; pager.hidden = pages < 2;
    for (const row of report.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const card = make("article", "ar-card");
      card.dataset.documentId = row.id;
      card.append(make("h3", "ar-card-title", `DOCUMENTO ID ${row.id} · ${row.status || "STATUS NÃO INFORMADO"}`));
      card.append(fields([["Data submetido", formatAuditDate(row.submittedDate)], ["Data emitido", formatAuditDate(row.issuedDate)],
        ["Data vencimento", formatAuditDate(row.validityDate), row.daysToExpiry == null ? "" : row.daysToExpiry < 0 ? "expired" : row.daysToExpiry <= 15 ? "due" : ""],
        ["Prazo", row.daysToExpiry == null ? "PENDENTE" : row.daysToExpiry < 0 ? `Vencido há ${-row.daysToExpiry} dia(s)` : row.daysToExpiry === 0 ? "Vence hoje" : `Vence em ${row.daysToExpiry} dia(s)`],
        ["Filial", row.branch], ["Homologação", row.homologation], ["Tipo documento", row.documentType], ["Pessoa relacionada", row.person],
        ["Etapa", row.stage], ["Imóvel", row.property], ["Status", row.status]]));
      content.append(card);
    }
  }
  function render() {
    metrics.replaceChildren(); content.replaceChildren(); pager.hidden = true;
    if (!snapshot) return;
    if (reportNumber === 11) renderQuotations();
    else if (reportNumber === 12) renderDepreciation();
    else renderDocuments();
  }
  function setNotice(message, error = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) { notice.removeAttribute("role"); return; }
    notice.append(make("p", "", message));
    if (error) {
      notice.setAttribute("role", "alert");
      const retry = button("og-button", "Tentar novamente"); retry.addEventListener("click", () => { void open(reportNumber); });
      notice.append(retry);
    } else notice.removeAttribute("role");
  }
  async function open(number) {
    number = Number(number);
    if (destroyed || !TITLES[number]) throw new RangeError("Relatório de auditoria desconhecido.");
    controller?.abort(); const current = ++revision; controller = new AbortController();
    reportNumber = number; snapshot = null; page = 1; section.hidden = false;
    title.textContent = TITLES[number]; filters.replaceChildren(); emptyMetrics(); content.replaceChildren();
    setNotice("Carregando dados do SharePoint…"); section.setAttribute("aria-busy", "true");
    try {
      const loaded = await data.loadReport(number, { signal: controller.signal });
      if (destroyed || controller.signal.aborted || current !== revision) return;
      snapshot = loaded; updateFilters(); setNotice(""); render();
    } catch (error) {
      if (destroyed || controller.signal.aborted || current !== revision) return;
      setNotice(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) section.setAttribute("aria-busy", "false");
    }
  }
  function close() { controller?.abort(); revision++; snapshot = null; metrics.replaceChildren(); content.replaceChildren(); section.hidden = true; section.setAttribute("aria-busy", "false"); }
  function destroy() { if (destroyed) return; close(); destroyed = true; section.remove(); }
  refresh.addEventListener("click", () => { if (reportNumber) void open(reportNumber); });
  previous.addEventListener("click", () => { if (page > 1) { page--; render(); } });
  next.addEventListener("click", () => { page++; render(); });
  return Object.freeze({ element: section, open, close, destroy });
}
