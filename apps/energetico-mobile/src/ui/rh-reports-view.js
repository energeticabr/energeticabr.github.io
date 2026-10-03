import { buildRhReport3, buildRhReport4, buildRhReport5 } from "../chat/rh-reports-model.js";

const TITLES = {
  3: "FORNECEDORES POR FILIAL, IMÓVEL E PROFISSÃO",
  4: "PRESENÇAS E AUSÊNCIAS POR PERÍODO",
  5: "PAGAMENTOS PENDENTES E DETALHAMENTO",
};
const LABELS = {
  startDate: "DATA INICIAL", endDate: "DATA FINAL", branch: "FILIAL", property: "IMÓVEL",
  supplier: "FORNECEDOR", status: "STATUS", stage: "ETAPA", presence: "PRESENÇA",
};
const GROUP_FIELDS = {
  3: ["startDate", "endDate", "branch", "property", "supplier", "status", "stage"],
  4: ["startDate", "endDate", "branch", "supplier", "presence"],
  5: ["startDate", "endDate", "branch", "supplier", "presence"],
};
const money = value => Number.isFinite(value)
  ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
  : "VALOR INCOMPLETO";
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
  ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "DATA NÃO INFORMADA";
const display = value => String(value ?? "").trim() || "NÃO INFORMADO";
const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const fourteenDaysAgo = today => {
  const earlier = new Date(`${today}T12:00:00`); earlier.setDate(earlier.getDate() - 14);
  return `${earlier.getFullYear()}-${String(earlier.getMonth() + 1).padStart(2, "0")}-${String(earlier.getDate()).padStart(2, "0")}`;
};
function safeError(error) {
  return String(error?.message || "Falha na consulta ao SharePoint.")
    .replace(/https?:\/\/[^\s)]+/gi, "endereço SharePoint")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [oculto]")
    .replace(/[\r\n]+/g, " ").slice(0, 240);
}

export function createRhReportsView({ document: doc = globalThis.document, data } = {}) {
  const loadReport = data?.loadReport || data?.loadSnapshot;
  if (!doc?.createElement || typeof loadReport !== "function") throw new TypeError("Os relatórios de RH requerem documento e fonte de dados.");
  const make = (tag, className = "", content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  };
  const button = (label, className) => {
    const node = make("button", className, label); node.type = "button"; return node;
  };
  const element = make("section", "rh-reports"); element.hidden = true;
  const head = make("div", "rh-reports-head");
  const heading = make("h2", "rh-reports-title");
  const refresh = button("Atualizar", "rh-reports-refresh");
  head.append(heading, refresh); element.append(head);
  const filters = make("div", "rh-reports-filters"); const controls = new Map();
  for (const [name, label] of Object.entries(LABELS)) {
    const wrap = make("label", "rh-reports-filter"); wrap.dataset.filter = name;
    wrap.append(make("span", "rh-reports-filter-label", label));
    const input = make("input", "rh-reports-input");
    input.name = name; input.type = name.endsWith("Date") ? "date" : "search";
    if (input.type === "search") input.placeholder = "Todos";
    wrap.append(input); filters.append(wrap); controls.set(name, input);
  }
  element.append(filters);
  const notice = make("div", "rh-reports-notice"); notice.hidden = true; element.append(notice);
  const metrics = make("div", "rh-reports-metrics"); element.append(metrics);
  const content = make("div", "rh-reports-content"); element.append(content);
  let currentReport = null; let snapshot = null; let controller = null; let revision = 0; let destroyed = false;

  function showNotice(message, retry = false) {
    notice.replaceChildren(); notice.hidden = !message;
    if (!message) return;
    notice.setAttribute("role", retry ? "alert" : "status");
    notice.append(make("p", "", message));
    if (retry) {
      const retryButton = button("Tentar novamente", "rh-reports-retry");
      retryButton.addEventListener("click", () => { void load(); });
      notice.append(retryButton);
    }
  }

  function metric(label, value) {
    const card = make("div", "rh-reports-metric");
    card.append(make("span", "rh-reports-label", label), make("strong", "rh-reports-value", value));
    metrics.append(card);
  }

  function field(parent, label, value, tone = "") {
    const cell = make("div", "rh-reports-field");
    if (tone) cell.dataset.tone = tone;
    cell.append(make("span", "rh-reports-label", label), make("strong", "rh-reports-value", display(value)));
    parent.append(cell);
  }

  function supplierCard(row, reportNumber) {
    const card = make("article", "rh-reports-supplier");
    card.append(make("h5", "", display(row.name)));
    const grid = make("div", "rh-reports-grid");
    field(grid, "STATUS", row.status); field(grid, "PROFISSÃO", row.profession);
    field(grid, "FORMA PGTO", row.paymentMethod || row.paymentType);
    field(grid, "DIÁRIA CADASTRADA", row.dailyValue == null ? "NÃO INFORMADA" : money(row.dailyValue));
    if (reportNumber === 3) {
      field(grid, "PRIMEIRA DATA", row.firstDate ? date(row.firstDate) : "SEM REGISTRO");
      field(grid, "ÚLTIMA PRESENÇA", row.lastPresentDate ? date(row.lastPresentDate) : "SEM PRESENÇA");
      field(grid, "PRESENÇAS / REGISTROS", `${row.presentCount} / ${row.presenceCount}`);
      field(grid, "ÚLTIMOS 30 DIAS", `${row.attendance?.last30Present ?? 0} presenças`);
      field(grid, "ETAPA ATUAL", row.stage); field(grid, "ATIVIDADE EXERCIDA", row.activity);
      if (row.measurement) field(grid, "MEDIÇÃO ATUAL", row.measurement);
    } else {
      field(grid, "FILIAL", row.branch); field(grid, "DIÁRIAS PENDENTES", row.pendingCount);
      field(grid, "APROVADO", money(row.approvedValue));
      field(grid, "PENDENTE VALIDAÇÃO", money(row.validationValue));
      field(grid, "TOTAL PENDENTE", money(row.totalValue), row.totalValue == null ? "pending" : "danger");
    }
    card.append(grid);
    if (reportNumber === 5) {
      const dates = make("div", "rh-reports-entries");
      dates.append(make("h6", "", "Datas pendentes"));
      for (const presence of row.pendingRows) {
        const entry = make("div", "rh-reports-entry");
        field(entry, "DATA", date(presence.date)); field(entry, "PRESENÇA", presence.presence);
        field(entry, "VALOR", presence.dailyValue == null ? "NÃO INFORMADO" : money(presence.dailyValue));
        field(entry, "ATIVIDADE", presence.activity); field(entry, "IMÓVEL", presence.property);
        if (presence.paymentId) field(entry, "IDPGTO", presence.paymentId);
        if (presence.motivation) field(entry, "MOTIVAÇÃO", presence.motivation);
        if (presence.observation) field(entry, "OBS", presence.observation);
        dates.append(entry);
      }
      card.append(dates);
      if (row.payments?.length || row.linkedElsewhere?.length) {
        const payments = make("div", "rh-reports-entries"); payments.append(make("h6", "", "Pagamentos relacionados"));
        for (const launch of [...(row.payments || []), ...(row.linkedElsewhere || [])]) {
          const entry = make("div", "rh-reports-entry");
          field(entry, "IDPGTO", launch.id); field(entry, "DATA", date(launch.date));
          field(entry, "FORNECEDOR DO LANÇAMENTO", launch.supplier);
          field(entry, "VALOR", money(launch.total));
          if (launch.advance) field(entry, "ADIANTAMENTO", launch.advance);
          payments.append(entry);
        }
        card.append(payments);
      }
    }
    return card;
  }

  function render3(result) {
    metric("FORNECEDORES", result.metrics.suppliers);
    if (!result.groups.length) { content.append(make("p", "rh-reports-empty", "Nenhum fornecedor corresponde aos filtros.")); return; }
    for (const branch of result.groups) {
      const section = make("section", "rh-reports-branch"); section.append(make("h3", "", `FILIAL: ${display(branch.name)}`));
      for (const property of branch.properties) {
        const item = make("section", "rh-reports-property");
        item.append(make("h4", "", `IMÓVEL: ${display(property.name)}`));
        const stats = make("div", "rh-reports-grid");
        field(stats, "FORNECEDORES", property.count); field(stats, "DIÁRIA", property.dailyCount);
        field(stats, "MEDIÇÃO", property.measurementCount); field(stats, "VALOR GLOBAL", property.globalCount);
        field(stats, "SOMA POR DIA", money(property.dailyAmount)); item.append(stats);
        for (const profession of property.professions) {
          const group = make("section", "rh-reports-profession"); group.append(make("h5", "", display(profession.name)));
          for (const supplier of profession.suppliers) group.append(supplierCard(supplier, 3));
          item.append(group);
        }
        section.append(item);
      }
      content.append(section);
    }
  }

  function render4(result) {
    metric("PRESENTES", result.metrics.present); metric("PENDENTES", result.metrics.pending);
    metric("AUSENTES", result.metrics.absent); metric("VALOR DOS PRESENTES", money(result.metrics.presentValue));
    const byProfession = make("section", "rh-reports-block");
    byProfession.append(make("h3", "", "Profissões no período"));
    for (const profession of result.professions) {
      const card = make("article", "rh-reports-profession"); card.append(make("h4", "", profession.name));
      const stats = make("div", "rh-reports-grid");
      field(stats, "REGISTROS", profession.count); field(stats, "PROFISSIONAIS", profession.professionals);
      field(stats, "APROVADO PARA PGTO", money(profession.approvedValue));
      field(stats, "PENDENTE VALIDAÇÃO", money(profession.validationValue));
      field(stats, "PAGO", money(profession.paidValue)); card.append(stats);
      const people = make("div", "rh-reports-entries");
      for (const supplier of profession.suppliers) {
        const person = make("div", "rh-reports-entry");
        field(person, "FORNECEDOR", supplier.name); field(person, "REGISTROS", supplier.count);
        field(person, "PRESENTES / PENDENTES", `${supplier.present} / ${supplier.pending}`);
        field(person, "APROVADO PARA PGTO", money(supplier.approvedValue));
        field(person, "PENDENTE VALIDAÇÃO", money(supplier.validationValue));
        field(person, "PAGO", money(supplier.paidValue));
        field(person, "TOTAL", money(supplier.totalValue));
        field(person, "SITUAÇÃO", supplier.situation);
        people.append(person);
      }
      card.append(people); byProfession.append(card);
    }
    if (!result.professions.length) byProfession.append(make("p", "rh-reports-empty", "Sem registros presentes ou pendentes no período."));
    content.append(byProfession);
    const byDay = make("section", "rh-reports-block"); byDay.append(make("h3", "", "Datas e filiais"));
    for (const day of result.days) for (const branch of day.branches) {
      const card = make("article", "rh-reports-day");
      card.append(make("h4", "", `${date(day.date)} · ${display(branch.name)}`));
      const stats = make("div", "rh-reports-grid");
      field(stats, "PENDENTES", branch.pending); field(stats, "PRESENTES", branch.present);
      field(stats, "AUSENTES", branch.absent); card.append(stats);
      const list = make("div", "rh-reports-entries");
      for (const row of branch.rows) {
        const entry = make("div", "rh-reports-entry");
        field(entry, "FORNECEDOR", row.supplier); field(entry, "PRESENÇA", row.presence);
        field(entry, "PROFISSÃO", row.profession); field(entry, "IMÓVEL", row.property);
        field(entry, "ATIVIDADE", row.activity);
        field(entry, "DIÁRIA", row.dailyValue == null ? "NÃO INFORMADA" : money(row.dailyValue));
        if (row.motivation) field(entry, "MOTIVAÇÃO", row.motivation);
        if (row.observation) field(entry, "OBS", row.observation);
        list.append(entry);
      }
      card.append(list); byDay.append(card);
    }
    content.append(byDay);
  }

  function render5(result) {
    metric("APROVADO PENDENTE PGTO", money(result.metrics.approvedValue));
    metric("PENDENTE VALIDAÇÃO", money(result.metrics.validationValue));
    metric("TOTAL PENDENTE", money(result.metrics.totalValue));
    const pending = make("section", "rh-reports-block"); pending.append(make("h3", "", "Pagamentos pendentes"));
    if (!result.suppliers.length) pending.append(make("p", "rh-reports-empty", "Nenhum pagamento pendente corresponde aos filtros."));
    for (const row of result.suppliers) pending.append(supplierCard(row, 5));
    content.append(pending);
    const detail = make("section", "rh-reports-block"); detail.append(make("h3", "", "DETALHAMENTO GERAL"));
    if (!result.details.length) detail.append(make("p", "rh-reports-empty", "Nenhuma presença corresponde aos filtros."));
    for (const row of result.details) {
      const card = make("article", "rh-reports-supplier");
      card.append(make("h4", "", row.name));
      const stats = make("div", "rh-reports-grid");
      field(stats, "FILIAL", row.branch); field(stats, "QTD PRESENÇA", row.occurrences);
      field(stats, "APROVADO", money(row.approvedValue));
      field(stats, "PENDENTE VALIDAÇÃO", money(row.validationValue)); card.append(stats);
      const presences = make("div", "rh-reports-entries"); presences.append(make("h6", "", "Datas de presença"));
      for (const presence of row.presenceRows) {
        const entry = make("div", "rh-reports-entry");
        field(entry, "DATA", date(presence.date)); field(entry, "PRESENÇA", presence.presence);
        field(entry, "STATUS", presence.status); field(entry, "IMÓVEL", presence.property);
        field(entry, "ATIVIDADE", presence.activity);
        field(entry, "VALOR", presence.dailyValue == null ? "NÃO INFORMADO" : money(presence.dailyValue));
        if (presence.paymentId) field(entry, "IDPGTO", presence.paymentId);
        if (presence.motivation) field(entry, "MOTIVAÇÃO", presence.motivation);
        if (presence.observation) field(entry, "OBS", presence.observation);
        presences.append(entry);
      }
      card.append(presences);
      if (row.payments.length || row.linkedElsewhere.length) {
        const payments = make("div", "rh-reports-entries"); payments.append(make("h6", "", "Datas de pagamentos"));
        for (const launch of row.payments) {
          const entry = make("div", "rh-reports-entry");
          field(entry, "IDPGTO", launch.id); field(entry, "DATA", date(launch.date));
          field(entry, "VALOR", money(launch.total));
          if (launch.advance) field(entry, "ADIANTAMENTO", launch.advance);
          payments.append(entry);
        }
        for (const launch of row.linkedElsewhere) {
          const entry = make("div", "rh-reports-entry");
          field(entry, "IDPGTO", launch.id); field(entry, "DATA", date(launch.date));
          field(entry, "VALOR", money(launch.total));
          field(entry, "PAGO EM NOME DE", `PAGO EM NOME DE: ${launch.supplier}`);
          if (launch.advance) field(entry, "ADIANTAMENTO", launch.advance);
          payments.append(entry);
        }
        card.append(payments);
      }
      detail.append(card);
    }
    content.append(detail);
  }

  function activeFilters() {
    return Object.fromEntries([...controls].map(([name, control]) => [name, control.value.trim()]));
  }

  function render() {
    metrics.replaceChildren(); content.replaceChildren();
    if (!snapshot || !currentReport) return;
    const result = currentReport === 3 ? buildRhReport3(snapshot, activeFilters())
      : currentReport === 4 ? buildRhReport4(snapshot, activeFilters()) : buildRhReport5(snapshot, activeFilters());
    if (currentReport === 3) render3(result);
    else if (currentReport === 4) render4(result);
    else render5(result);
  }

  async function load() {
    controller?.abort(); revision++;
    const current = revision; controller = new AbortController();
    const signal = controller.signal; snapshot = null;
    showNotice("Carregando dados do SharePoint…"); render(); element.setAttribute("aria-busy", "true");
    try {
      const result = await loadReport.call(data, currentReport, { signal });
      if (destroyed || element.hidden || signal.aborted || current !== revision) return;
      snapshot = result; showNotice(""); render();
    } catch (error) {
      if (destroyed || element.hidden || signal.aborted || current !== revision) return;
      showNotice(`Não foi possível carregar o relatório: ${safeError(error)}`, true);
    } finally {
      if (current === revision) element.setAttribute("aria-busy", "false");
    }
  }

  for (const control of controls.values()) {
    control.addEventListener("change", render);
    if (control.type === "search") control.addEventListener("input", render);
  }
  refresh.addEventListener("click", () => { void load(); });
  return Object.freeze({ element,
    open(reportNumber) {
      if (destroyed) throw new Error("A visualização de RH foi encerrada.");
      const number = Number(reportNumber);
      if (![3, 4, 5].includes(number)) throw new RangeError("Número de relatório inválido: selecione 3, 4 ou 5.");
      const previous = currentReport; currentReport = number; heading.textContent = TITLES[number]; element.hidden = false;
      for (const [name, control] of controls) {
        control.parentElement.hidden = !GROUP_FIELDS[number].includes(name);
        if (previous !== number) control.value = "";
      }
      if (previous !== number && number === 4) {
        const today = todayLocal(); controls.get("startDate").value = fourteenDaysAgo(today);
        controls.get("endDate").value = today;
      }
      return load();
    },
    close() { controller?.abort(); revision++; snapshot = null; render(); element.hidden = true; element.setAttribute("aria-busy", "false"); },
    destroy() { if (destroyed) return; controller?.abort(); revision++; destroyed = true; snapshot = null; element.remove(); },
  });
}
