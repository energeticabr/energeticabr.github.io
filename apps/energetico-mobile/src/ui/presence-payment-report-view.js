import { buildPresencePaymentReport } from "../chat/presence-payment-report-model.js";
import { formatReportDate, formatReportMoney } from "../chat/contractor-report-model.js";

const FILTERS = [
  ["branch", "FILIAL"], ["property", "IMÓVEL"], ["supplier", "FORNECEDOR"],
  ["status", "STATUS"], ["stage", "ETAPA"],
];
const PAGE_SIZE = 10;
const display = value => String(value ?? "").trim() || "PENDENTE";
const money = value => value == null ? "PENDENTE" : formatReportMoney(value);
const todayLocal = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function safeError(error) {
  return String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createPresencePaymentReportView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadSnapshot !== "function") throw new TypeError("O Relatório 2 requer documento e fonte de dados.");
  const make = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const element = make("section", "pp-report"); element.hidden = true;
  const heading = make("div", "pp-heading");
  const title = make("h2", "pp-title", "📊 PRESENÇAS VINCULADAS POR PEDIDO / IDPGTO");
  const refresh = button("og-button pp-refresh", "Atualizar"); heading.append(title, refresh); element.append(heading);
  const filters = make("div", "pp-filters");
  const controls = new Map();
  for (const [name, label] of [["startDate", "PERÍODO INICIAL"], ["endDate", "PERÍODO FINAL"], ...FILTERS]) {
    const wrapper = make("label", "pp-filter"); wrapper.append(make("span", "pp-filter-label", label));
    const control = make(name.endsWith("Date") ? "input" : "select", "og-input pp-filter-input");
    control.name = name;
    if (control.tagName === "INPUT") control.type = "date";
    else control.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    if (name === "endDate") control.value = todayLocal();
    wrapper.append(control); filters.append(wrapper); controls.set(name, control);
  }
  element.append(filters);
  const metrics = make("dl", "pp-metrics");
  for (const [name, label] of [["paymentIds", "IDPGTO LOCALIZADOS"], ["presences", "PRESENÇAS VINCULADAS"], ["totalDaily", "TOTAL DAS DIÁRIAS"]]) {
    const card = make("div", `pp-metric pp-metric--${name}`);
    card.append(make("dt", "", label));
    const value = make("dd", "", "—"); value.dataset.metric = name; card.append(value); metrics.append(card);
  }
  element.append(metrics);
  const notice = make("div", "pp-notice"); notice.hidden = true; element.append(notice);
  const orders = make("div", "pp-orders"); element.append(orders);
  const pager = make("nav", "pp-pager"); pager.setAttribute("aria-label", "Páginas do Relatório 2");
  const previous = button("og-button pp-previous", "Anterior"); const pageLabel = make("span", "pp-page-label");
  const next = button("og-button pp-next", "Próxima"); pager.append(previous, pageLabel, next); element.append(pager);
  let snapshot = null; let controller = null; let revision = 0; let page = 1; let destroyed = false; let open = false;
  let defaultStatusApplied = false;

  function showNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.setAttribute("role", retry ? "alert" : "status");
    notice.append(make("p", "", message));
    if (retry) { const retryButton = button("og-button pp-retry", "Tentar novamente"); retryButton.addEventListener("click", () => { void load(); }); notice.append(retryButton); }
  }

  function field(parent, label, value, className = "") {
    const item = make("div", `pp-field ${className}`.trim());
    item.append(make("span", "pp-field-label", label), make("strong", "pp-field-value", display(value)));
    parent.append(item); return item;
  }

  function valuesFor(name) {
    if (name === "status") return Object.values(snapshot?.supplierStatusByName || {});
    return (snapshot?.presences || []).map(row => row[name]);
  }

  function populateFilters() {
    for (const [name] of FILTERS) {
      const control = controls.get(name); const current = control.value;
      const values = [...new Set(valuesFor(name).map(value => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      control.replaceChildren(Object.assign(make("option", "", "Todos"), { value: "" }));
      for (const value of values) control.append(Object.assign(make("option", "", value), { value }));
      control.value = name === "status" && !defaultStatusApplied
        ? values.find(value => value.toUpperCase() === "ATIVO") || ""
        : values.includes(current) ? current : "";
      if (name === "status") defaultStatusApplied = true;
    }
  }

  function renderPresence(row) {
    const card = make("article", "pp-presence-card");
    card.dataset.presenceId = row.id;
    const header = make("div", "pp-presence-header");
    header.append(make("strong", "", `${formatReportDate(row.date)} · IDPRESENÇA #${row.id}`));
    const status = make("span", "pp-badge", display(row.presence));
    status.dataset.tone = row.presence.toUpperCase() === "PRESENTE" ? "success" : "danger";
    header.append(status); card.append(header);
    const grid = make("div", "pp-fields");
    field(grid, "FORNECEDOR", row.supplier, row.supplierMismatch ? "pp-field--warning" : "");
    field(grid, "FILIAL", row.branch); field(grid, "ETAPA", row.stage);
    field(grid, "ATIVIDADE", row.activity); field(grid, "IMÓVEL", row.property);
    field(grid, "DIÁRIA", money(row.dailyValue));
    const supplierStatus = field(grid, "STATUS FORNECEDOR", row.supplierStatus || "DESCONHECIDO", "pp-status-field");
    supplierStatus.dataset.tone = row.supplierStatus === "PAGO" ? "success" : row.supplierStatus === "PENDENTE PGTO" ? "pending" : "danger";
    if (row.observation) field(grid, "OBS", row.observation);
    if (row.motivation) field(grid, "MOTIVAÇÃO", row.motivation);
    card.append(grid); return card;
  }

  function renderPayment(group) {
    const card = make("section", "pp-payment-card"); card.dataset.paymentId = group.paymentId;
    card.append(make("h4", "pp-payment-title", `IDPGTO ${group.paymentId} · ${group.count} presença(s)`));
    const details = make("div", "pp-fields pp-payment-fields");
    field(details, "LANÇAMENTO", group.launch ? `ID ${group.launch.id}` : "NÃO LOCALIZADO");
    field(details, "DATA DO LANÇAMENTO", group.launch?.date ? formatReportDate(group.launch.date) : "");
    field(details, "FORNECEDOR DO LANÇAMENTO", group.launch?.supplier);
    field(details, "FILIAL / ETAPA", [group.launch?.branch, group.launch?.stage].filter(Boolean).join(" / "));
    field(details, "DESCRIÇÃO", group.launch?.description);
    field(details, "PRODUTO / CONTA", [group.launch?.product, group.launch?.account].filter(Boolean).join(" / "));
    field(details, "PERÍODO DAS PRESENÇAS", `${formatReportDate(group.firstDate)} — ${formatReportDate(group.lastDate)}`);
    card.append(details);
    const values = make("div", "pp-values");
    field(values, "LANÇAMENTO", money(group.launchTotal));
    field(values, "PRESENÇAS", group.presencesTotal == null ? `${money(group.partialPresencesTotal)} · PARCIAL` : money(group.presencesTotal));
    field(values, "DIFERENÇA", group.presencesTotal == null ? "INCOMPLETO" : money(group.difference), group.difference == null ? "pp-field--pending" : group.balanced ? "pp-field--success" : "pp-field--danger");
    card.append(values);
    const list = make("div", "pp-presence-list");
    group.presences.forEach(row => list.append(renderPresence(row)));
    card.append(list); return card;
  }

  function render() {
    orders.replaceChildren();
    if (!snapshot) {
      metrics.querySelectorAll("[data-metric]").forEach(value => { value.textContent = "—"; });
      pageLabel.textContent = "Dados não carregados"; previous.disabled = true; next.disabled = true; return;
    }
    const selected = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
    const result = buildPresencePaymentReport(snapshot, selected);
    metrics.querySelector('[data-metric="paymentIds"]').textContent = String(result.metrics.paymentIds);
    metrics.querySelector('[data-metric="presences"]').textContent = String(result.metrics.presences);
    metrics.querySelector('[data-metric="totalDaily"]').textContent = result.metrics.complete
      ? money(result.metrics.totalDaily) : `${money(result.metrics.partialDaily)} · PARCIAL`;
    const count = result.orders.length; const pages = Math.max(1, Math.ceil(count / PAGE_SIZE)); page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${count} pedido(s)`;
    previous.disabled = page <= 1; next.disabled = page >= pages;
    if (!count) { orders.append(make("p", "pp-empty", "Nenhuma presença corresponde aos filtros.")); return; }
    for (const order of result.orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const section = make("section", "pp-order-card"); section.dataset.order = order.order;
      const head = make("div", "pp-order-header");
      head.style.gridRow = `1 / span ${order.groups.length}`;
      head.append(make("h3", "", `PEDIDO ${order.order}`), make("strong", "", money(order.totalValue)));
      section.append(head);
      order.groups.forEach(group => section.append(renderPayment(group)));
      orders.append(section);
    }
  }

  async function load() {
    controller?.abort(); revision++;
    const current = revision; controller = new AbortController(); snapshot = null;
    showNotice("Carregando presenças vinculadas…"); render(); element.setAttribute("aria-busy", "true");
    try {
      const result = await data.loadSnapshot({ signal: controller.signal });
      if (destroyed || !open || controller.signal.aborted || current !== revision) return;
      snapshot = result; populateFilters(); showNotice(result.warnings?.join(" ") || ""); render();
    } catch (error) {
      if (destroyed || !open || controller.signal.aborted || current !== revision) return;
      showNotice(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) element.setAttribute("aria-busy", "false");
    }
  }

  for (const control of controls.values()) control.addEventListener("change", () => { page = 1; render(); });
  refresh.addEventListener("click", () => { void load(); });
  previous.addEventListener("click", () => { if (page > 1) { page--; render(); } });
  next.addEventListener("click", () => { page++; render(); });
  render();
  return Object.freeze({ element,
    open() { if (destroyed) throw new Error("O Relatório 2 foi encerrado."); open = true; element.hidden = false; return load(); },
    close() { open = false; controller?.abort(); revision++; element.hidden = true; },
    destroy() { if (destroyed) return; open = false; controller?.abort(); revision++; destroyed = true; element.remove(); },
  });
}
