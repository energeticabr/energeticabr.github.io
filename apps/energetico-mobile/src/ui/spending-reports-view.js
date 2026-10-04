import { buildSpendingReport9, buildSpendingReport10 } from "../chat/spending-reports-model.js";
import { formatReportDate, formatReportMoney } from "../chat/contractor-report-model.js";
import { provisionDueState } from "../chat/pending-provision-dates.js";
import { bindSearchableFilterSelects } from "./searchable-filter-selects.js";

const LOGO_URL = new URL("../../../../assets/logo-energetica-oficial.png", import.meta.url).href;

const FILTERS = [
  ["year", "ANO", "select", [9]], ["month", "MÊS", "select", [9]],
  ["branch", "FILIAL", "select", [9, 10]], ["stage", "ETAPA", "select", [9]],
  ["product", "PRODUTO", "select", [9, 10]], ["supplier", "FORNECEDOR", "select", [9, 10]],
  ["disbursement", "GERA DESEMBOLSO", "select", [9]],
  ["order", "PEDIDO", "select", [9]], ["paymentStatus", "STATUS PAGAMENTOS", "select", [10]],
  ["status", "STATUS", "select", [10]],
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
  const logo = make("img", "sr-logo"); logo.src = LOGO_URL; logo.alt = "Energética Construtora";
  const title = make("h2", "sr-title"); const refresh = button("og-button sr-refresh", "Atualizar");
  heading.append(logo, refresh); element.append(heading, title);
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
  element.insertBefore(filters, heading);
  const metrics = make("dl", "sr-metrics"); element.append(metrics);
  const notice = make("div", "sr-notice"); notice.hidden = true; element.append(notice);
  const content = make("div", "sr-content"); element.append(content);
  const pager = make("nav", "sr-pager"); pager.setAttribute("aria-label", "Páginas do relatório de gastos");
  const previous = button("og-button sr-previous", "Anterior"); const pageLabel = make("span", "sr-page-label");
  const next = button("og-button sr-next", "Próxima"); pager.append(previous, pageLabel, next); element.append(pager);
  let snapshot = null; let controller = null; let revision = 0; let page = 1; let reportNumber = null; let destroyed = false;
  let searchableFilters = null;

  function showNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.setAttribute("role", retry ? "alert" : "status");
    notice.append(make("p", "", message));
    if (retry) { const retryButton = button("og-button sr-retry", "Tentar novamente");
      retryButton.addEventListener("click", () => { void load(); }); notice.append(retryButton); }
  }

  function field(parent, label, value, variant = "") {
    const item = make("div", `sr-field${variant ? ` sr-field--${variant}` : ""}`);
    item.append(make("span", "sr-field-label", label), make("strong", "sr-field-value", display(value)));
    parent.append(item);
  }

  function metric(name, label, value) {
    const card = make("div", "sr-metric");
    const result = make("dd", "", value); result.dataset.metric = name;
    card.append(make("dt", "", label), result); metrics.append(card);
  }

  function populateFilters() {
    searchableFilters?.destroy(); searchableFilters = null;
    for (const [name, , type] of FILTERS) {
      if (type !== "select") continue;
      const control = controls.get(name); const current = control.value;
      const values = name === "year" ? (snapshot?.launches || []).map(row => row.date?.slice(0, 4))
        : name === "month" ? Array.from({ length: 12 }, (_, index) => String(index + 1))
          : name === "status" ? (snapshot?.recurrences || []).map(row => row.status)
            : name === "paymentStatus" ? (snapshot?.provisions || []).map(row => row.status)
              : (reportNumber === 10 ? snapshot?.provisions : snapshot?.launches || []).map(row => row[name]);
      const unique = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
        .sort((a, b) => name === "year" || name === "month" ? Number(a) - Number(b) : a.localeCompare(b, "pt-BR"));
      control.replaceChildren(Object.assign(make("option", "", "Todos"), { value: "" }));
      for (const value of unique) control.append(Object.assign(make("option", "", value), { value }));
      control.value = unique.includes(current) ? current : reportNumber === 10 && name === "paymentStatus"
        ? unique.find(value => value.toLocaleUpperCase("pt-BR") === "PAGAMENTO PREVISTO") || ""
        : reportNumber === 10 && name === "status" ? unique.find(value => value.toLocaleUpperCase("pt-BR") === "ATIVO") || "" : "";
    }
    searchableFilters = bindSearchableFilterSelects(filters);
  }

  function category(titleText, groups, percentageLabel, variant) {
    const section = make("section", `sr-category sr-category--${variant}`); section.append(make("h4", "sr-category-title", titleText));
    if (!groups.length) section.append(make("p", "sr-empty", "Nenhum registro."));
    if (!groups.length) return section;
    const firstLabel = ({ expense: "TIPO DE DESPESA", products: "PRODUTO", stages: "ETAPA", suppliers: "FORNECEDOR", accounts: "CONTA" })[variant];
    const labels = [firstLabel, "QTDE. LINHAS", "QTD TOTAL", "TOTAL GASTO", percentageLabel];
    const table = make("table", "sr-category-table");
    const head = make("thead"); const headRow = make("tr");
    labels.forEach(label => headRow.append(make("th", "", label)));
    head.append(headRow); table.append(head);
    const body = make("tbody");
    for (const group of groups) {
      const row = make("tr");
      [group.name, group.count, number(group.quantity), money(group.total), percent(group.percentage)]
        .forEach((value, index) => {
          const cell = make("td", index === 3 ? "sr-category-money" : "", display(value));
          cell.dataset.label = labels[index]; row.append(cell);
        });
      body.append(row);
    }
    table.append(body); section.append(table);
    return section;
  }

  function renderNine(result) {
    metric("period", "PERÍODO", result.period);
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
      field(summary, "TOTAL GASTO ACUMULADO POR FILIAL", money(branch.total), "money");
      field(summary, "QTDE. LINHAS", branch.count); field(summary, "QTD TOTAL", number(branch.quantity));
      field(summary, "% DO TOTAL DO MÊS", percent(branch.percentage));
      card.append(summary);
      card.append(category("PERCENTUAL POR TIPO DE DESPESA POR FILIAL", branch.expenseTypes, "% DA FILIAL", "expense"));
      card.append(category("PRODUTOS COM MAIOR GASTO POR FILIAL", branch.products, "% DO TOTAL DO MÊS", "products"));
      card.append(category("ETAPAS COM MAIOR GASTO POR FILIAL", branch.stages, "% DO TOTAL DO MÊS", "stages"));
      card.append(category("PRINCIPAIS FORNECEDORES POR FILIAL", branch.suppliers, "% DO TOTAL DO MÊS", "suppliers"));
      card.append(category("MAIORES GASTOS POR CONTA POR FILIAL", branch.accounts, "% DO TOTAL DO MÊS", "accounts"));
      content.append(card);
    }
  }

  function renderTen(result) {
    metric("total", "VALOR TOTAL PREVISTO", money(result.total)); metric("count", "PROVISÕES RECORRENTES", String(result.count));
    if (result.incompleteCount) showNotice(`${result.incompleteCount} provisão(ões) sem valor completo; total exibido como INCOMPLETO.`);
    if (!result.rows.length) { content.append(make("p", "sr-empty", "Nenhuma provisão de pagamento vinculada a despesa recorrente corresponde aos filtros.")); return; }
    const pages = Math.max(1, Math.ceil(result.rows.length / 10)); page = Math.min(page, pages);
    pageLabel.textContent = `Página ${page} de ${pages} · ${result.rows.length} provisão(ões)`;
    previous.disabled = page <= 1; next.disabled = page >= pages;
    const labels = ["FILIAL", "FORNECEDOR", "PRODUTO", "DATA VENCIMENTO", "AGENDAMENTO", "VALOR", "STATUS"];
    const table = make("table", "sr-provision-table");
    const head = make("thead"); const headRow = make("tr");
    labels.forEach(label => headRow.append(make("th", "", label)));
    head.append(headRow); table.append(head);
    const body = make("tbody"); table.append(body);
    for (const row of result.rows.slice((page - 1) * 10, page * 10)) {
      const tr = make("tr");
      const cells = [
        display(row.branch), display(row.supplier), display(row.product),
        row.dueDate ? formatReportDate(row.dueDate) : "—",
        [row.schedule, row.scheduledDate ? formatReportDate(row.scheduledDate) : ""].filter(Boolean).join(" · ") || "—",
        money(row.total), display(row.status),
      ];
      cells.forEach((value, index) => {
        const td = make("td", `sr-provision-cell sr-provision-cell--${index}`, value);
        td.dataset.label = labels[index];
        if (index === 6) {
          td.append(make("span", "sr-due-state", provisionDueState(row.dueDate).label));
        }
        tr.append(td);
      });
      body.append(tr);
    }
    content.append(table);
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
    searchableFilters?.close();
    controller?.abort(); revision++;
    const current = revision; controller = new AbortController(); snapshot = null;
    render(); showNotice(reportNumber === 10 ? "Carregando despesas recorrentes e provisões do SharePoint…" : "Carregando lançamentos do SharePoint…"); element.setAttribute("aria-busy", "true");
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
      searchableFilters?.destroy(); searchableFilters = null;
      reportNumber = number; page = 1; element.hidden = false;
      element.classList.toggle("sr-report--ten", number === 10);
      element.insertBefore(metrics, number === 10 ? pager : notice);
      title.textContent = number === 9 ? "RESUMO GERENCIAL DE GASTOS" : "DESPESAS RECORRENTES – PROVISÃO DE PAGAMENTOS";
      for (const wrapper of filters.children) wrapper.hidden = !wrapper.dataset.reports.split(",").includes(String(number));
      if (number === 10) {
        for (const [index, name] of ["branch", "supplier", "product", "paymentStatus", "status"].entries()) {
          controls.get(name).parentElement.style.order = String(index);
        }
      } else for (const wrapper of filters.children) wrapper.style.order = "";
      return load();
    },
    close() { searchableFilters?.close(); controller?.abort(); revision++; snapshot = null; reportNumber = null; element.hidden = true;
      metrics.replaceChildren(); content.replaceChildren(); showNotice(""); element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; this.close(); searchableFilters?.destroy(); searchableFilters = null; destroyed = true; element.remove(); },
  });
}
