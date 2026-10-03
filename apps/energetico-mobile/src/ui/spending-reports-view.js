import { buildSpendingReport9, buildSpendingReport10 } from "../chat/spending-reports-model.js";
import { formatReportDate, formatReportMoney } from "../chat/contractor-report-model.js";

const FILTERS = [
  ["year", "ANO", "select", [9]], ["month", "MÊS", "select", [9]],
  ["startDate", "DATA INICIAL", "date", [10]], ["endDate", "DATA FINAL", "date", [10]],
  ["supplier", "FORNECEDOR", "select", [9, 10]], ["product", "PRODUTO", "select", [9, 10]],
  ["branch", "FILIAL", "select", [9, 10]], ["disbursement", "GERA DESEMBOLSO", "select", [9, 10]],
  ["order", "PEDIDO", "select", [9, 10]],
];
const money = value => value == null ? "INCOMPLETO" : formatReportMoney(value);
const number = value => value == null ? "INCOMPLETO" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
const percent = value => value == null ? "INCOMPLETO" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}%`;
const display = value => String(value ?? "").trim() || "PENDENTE";

function safeError(error) {
  return String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createSpendingReportsView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.createElement || typeof data?.loadSnapshot !== "function") throw new TypeError("Os relatórios 9 e 10 requerem documento e fonte de dados.");
  const make = (tag, className = "", label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const button = (className, label) => { const node = make("button", className, label); node.type = "button"; return node; };
  const element = make("section", "sr-report"); element.hidden = true;
  const heading = make("header", "sr-heading");
  const title = make("h2", "sr-title"); const refresh = button("og-button sr-refresh", "Atualizar");
  heading.append(title, refresh); element.append(heading);
  const filters = make("div", "sr-filters"); const controls = new Map();
  for (const [name, label, type, reports] of FILTERS) {
    const wrapper = make("label", "sr-filter"); wrapper.dataset.reports = reports.join(",");
    wrapper.append(make("span", "sr-filter-label", label));
    const control = make(type === "date" ? "input" : "select", "og-input sr-filter-input");
    control.name = name;
    if (type === "date") control.type = "date";
    else control.append(Object.assign(make("option", "", "Todos"), { value: "" }));
    wrapper.append(control); filters.append(wrapper); controls.set(name, control);
  }
  element.append(filters);
  const metrics = make("dl", "sr-metrics"); element.append(metrics);
  const notice = make("div", "sr-notice"); notice.hidden = true; element.append(notice);
  const content = make("div", "sr-content"); element.append(content);
  const pager = make("nav", "sr-pager"); pager.setAttribute("aria-label", "Páginas do relatório de gastos");
  const previous = button("og-button sr-previous", "Anterior"); const pageLabel = make("span", "sr-page-label");
  const next = button("og-button sr-next", "Próxima"); pager.append(previous, pageLabel, next); element.append(pager);
  let snapshot = null; let controller = null; let revision = 0; let page = 1; let reportNumber = null; let destroyed = false;

  function showNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.setAttribute("role", retry ? "alert" : "status");
    notice.append(make("p", "", message));
    if (retry) { const retryButton = button("og-button sr-retry", "Tentar novamente");
      retryButton.addEventListener("click", () => { void load(); }); notice.append(retryButton); }
  }

  function field(parent, label, value) {
    const item = make("div", "sr-field");
    item.append(make("span", "sr-field-label", label), make("strong", "sr-field-value", display(value)));
    parent.append(item);
  }

  function metric(name, label, value) {
    const card = make("div", "sr-metric");
    const result = make("dd", "", value); result.dataset.metric = name;
    card.append(make("dt", "", label), result); metrics.append(card);
  }

  function populateFilters() {
    for (const [name, , type] of FILTERS) {
      if (type !== "select") continue;
      const control = controls.get(name); const current = control.value;
      const values = name === "year" ? (snapshot?.launches || []).map(row => row.date?.slice(0, 4))
        : name === "month" ? Array.from({ length: 12 }, (_, index) => String(index + 1))
          : (snapshot?.launches || []).map(row => row[name]);
      const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .sort((a, b) => name === "year" || name === "month" ? Number(a) - Number(b) : a.localeCompare(b, "pt-BR"));
      control.replaceChildren(Object.assign(make("option", "", "Todos"), { value: "" }));
      for (const value of unique) control.append(Object.assign(make("option", "", value), { value }));
      control.value = unique.includes(current) ? current : "";
    }
  }

  function category(titleText, groups, percentageLabel) {
    const section = make("section", "sr-category"); section.append(make("h4", "sr-category-title", titleText));
    if (!groups.length) section.append(make("p", "sr-empty", "Nenhum registro."));
    for (const group of groups) {
      const card = make("article", "sr-detail-card"); card.append(make("h5", "sr-detail-title", group.name));
      const fields = make("div", "sr-fields");
      field(fields, "QTDE. LINHAS", group.count); field(fields, "QTD TOTAL", number(group.quantity));
      field(fields, "TOTAL GASTO", money(group.total)); field(fields, percentageLabel, percent(group.percentage));
      card.append(fields); section.append(card);
    }
    return section;
  }

  function renderNine(result) {
    metric("total", "TOTAL DO MÊS/PERÍODO FILTRADO", money(result.total));
    metric("count", "QTDE. LANÇAMENTOS", String(result.count));
    if (result.incompleteCount) showNotice(`${result.incompleteCount} lançamento(s) sem valor unitário ou quantidade; totais afetados aparecem como INCOMPLETO.`);
    if (!result.branches.length) { content.append(make("p", "sr-empty", "Nenhum lançamento corresponde aos filtros.")); return; }
    const pages = Math.max(1, Math.ceil(result.branches.length / 8)); page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${result.branches.length} filial(is)`;
    previous.disabled = page <= 1; next.disabled = page >= pages;
    for (const branch of result.branches.slice((page - 1) * 8, page * 8)) {
      const card = make("section", "sr-branch-card"); card.append(make("h3", "sr-branch-title", branch.name));
      const summary = make("div", "sr-fields sr-branch-summary");
      field(summary, "TOTAL GASTO ACUMULADO POR FILIAL", money(branch.total));
      field(summary, "QTDE. LINHAS", branch.count); field(summary, "% DO TOTAL DO MÊS", percent(branch.percentage));
      card.append(summary);
      card.append(category("PERCENTUAL POR TIPO DE DESPESA POR FILIAL", branch.expenseTypes, "% DA FILIAL"));
      card.append(category("PRODUTOS COM MAIOR GASTO POR FILIAL", branch.products, "% DO TOTAL DO MÊS"));
      card.append(category("ETAPAS COM MAIOR GASTO POR FILIAL", branch.stages, "% DO TOTAL DO MÊS"));
      card.append(category("PRINCIPAIS FORNECEDORES POR FILIAL", branch.suppliers, "% DO TOTAL DO MÊS"));
      card.append(category("MAIORES GASTOS POR CONTA POR FILIAL", branch.accounts, "% DO TOTAL DO MÊS"));
      content.append(card);
    }
  }

  function renderTen(result) {
    metric("total", "TOTAL GERAL", money(result.total)); metric("quantity", "SOMA DE QTD", number(result.quantity));
    metric("suppliers", "FORNECEDORES", String(result.supplierCount)); metric("products", "PRODUTOS", String(result.productCount));
    metric("ids", "IDs", String(result.count));
    metric("unitMin", "VALOR UNITÁRIO MÍNIMO", money(result.unitMin));
    metric("unitAverage", "VALOR UNITÁRIO MÉDIO", money(result.unitAverage));
    metric("unitMax", "VALOR UNITÁRIO MÁXIMO", money(result.unitMax));
    if (result.incompleteCount) showNotice(`${result.incompleteCount} lançamento(s) sem valor unitário ou quantidade; totais afetados aparecem como INCOMPLETO.`);
    if (!result.days.length) { content.append(make("p", "sr-empty", "Nenhum lançamento corresponde aos filtros.")); return; }
    const pages = Math.max(1, Math.ceil(result.days.length / 10)); page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${result.days.length} data(s) de pagamento`;
    previous.disabled = page <= 1; next.disabled = page >= pages;
    for (const day of result.days.slice((page - 1) * 10, page * 10)) {
      const dayCard = make("section", "sr-day-card");
      dayCard.append(make("h3", "sr-day-title", `DATA PGTO ${day.date ? formatReportDate(day.date) : "PENDENTE"} · ${money(day.total)}`));
      for (const supplier of day.suppliers) {
        const supplierCard = make("section", "sr-supplier-card");
        supplierCard.append(make("h4", "sr-supplier-title", `${supplier.name} · TOTAL FORN. DIA ${money(supplier.total)}`));
        for (const row of supplier.rows) {
          const card = make("article", "sr-launch-card");
          card.append(make("h5", "sr-launch-title", `PEDIDO ${display(row.order)} · ID ${row.id}`));
          const fields = make("div", "sr-fields");
          field(fields, "FILIAL", row.branch); field(fields, "CONTA", row.account);
          field(fields, "PRODUTO", row.product); if (row.description) field(fields, "DESCRIÇÃO", row.description);
          field(fields, "VU", money(row.unit)); field(fields, "QTD", number(row.quantity));
          field(fields, "FRETE", money(row.freight)); field(fields, "TOTAL", money(row.total));
          card.append(fields); supplierCard.append(card);
        }
        dayCard.append(supplierCard);
      }
      content.append(dayCard);
    }
  }

  function render() {
    metrics.replaceChildren(); content.replaceChildren(); pageLabel.textContent = "";
    previous.disabled = true; next.disabled = true; pager.hidden = !snapshot;
    if (!snapshot) { metric("total", "TOTAL", "—"); return; }
    const selected = Object.fromEntries([...controls].map(([name, control]) => [name, control.value]));
    showNotice("");
    if (reportNumber === 9) renderNine(buildSpendingReport9(snapshot, selected));
    else renderTen(buildSpendingReport10(snapshot, selected));
  }

  async function load() {
    controller?.abort(); revision++;
    const current = revision; controller = new AbortController(); snapshot = null;
    render(); showNotice("Carregando lançamentos do SharePoint…"); element.setAttribute("aria-busy", "true");
    try {
      const result = await data.loadSnapshot({ reportNumber, signal: controller.signal });
      if (destroyed || element.hidden || controller.signal.aborted || current !== revision) return;
      snapshot = result; populateFilters(); render();
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
      if (destroyed) throw new Error("A visualização de gastos foi encerrada.");
      if (number !== 9 && number !== 10) throw new RangeError("Relatório de gastos desconhecido.");
      reportNumber = number; page = 1; element.hidden = false;
      title.textContent = number === 9 ? "RESUMO GERENCIAL DE GASTOS" : "PROVISÃO DE PAGAMENTOS RECORRENTES";
      for (const wrapper of filters.children) wrapper.hidden = !wrapper.dataset.reports.split(",").includes(String(number));
      return load();
    },
    close() { controller?.abort(); revision++; snapshot = null; reportNumber = null; element.hidden = true;
      metrics.replaceChildren(); content.replaceChildren(); showNotice(""); element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; this.close(); destroyed = true; element.remove(); },
  });
}
