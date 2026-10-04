import { applyScreenNavigation } from "./screen-navigation.js";
import { createLoadingIndicator } from "./loading-indicator.js";
function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim().replace(/[^\d,.-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  let normalized = raw;
  const comma = raw.lastIndexOf(",");
  if (comma >= 0) {
    const integer = raw.slice(0, comma).replace(/[.,]/g, "");
    const fraction = raw.slice(comma + 1).replace(/[.,]/g, "");
    normalized = `${integer || "0"}.${fraction}`;
  } else if ((raw.match(/\./g) || []).length > 1 || /^-?\d{1,3}(?:\.\d{3})+$/.test(raw)) {
    normalized = raw.replace(/\./g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function lineAmountCents(row) {
  const unit = parseNumber(row?.VALORUNITARIO);
  const quantity = parseNumber(row?.QTD);
  if (unit === null || quantity === null) return null;
  return Math.round(Math.round(unit * 100) * quantity);
}

function formatMoney(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
  const raw = String(value ?? "");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "—";
}

function typeKey(value) {
  return String(value || "Sem tipo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/[^A-Z0-9]/g, "");
}

function display(value) {
  return value == null || value === "" ? "—" : String(value);
}

export function createHrPayrollReport({ document: documentOption, root: mountRootOption, request, onClose, onHome } = {}) {
  const documentRef = documentOption || mountRootOption?.ownerDocument || globalThis.document;
  const mountRoot = mountRootOption || documentRef?.body;
  if (!documentRef?.createElement || !mountRoot?.append || typeof request !== "function") {
    throw new TypeError("O relatório da folha requer documento, destino e consulta.");
  }

  const doc = documentRef;
  const overlay = element(doc, "section", "hr-gallery-overlay hr-payroll-report-overlay");
  overlay.hidden = true;
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Relatório da folha");
  const header = element(doc, "header", "hr-gallery-header");
  const title = element(doc, "h1", "hr-gallery-title", "Relatório da folha");
  const close = element(doc, "button", "hr-gallery-button hr-payroll-report-close", "Voltar");
  close.type = "button";
  close.dataset.action = "close-hr-payroll-report";
  const home = onHome ? element(doc, "button", "hr-gallery-button", "Início") : null;
  applyScreenNavigation({ header, back: close, home, title });

  const content = element(doc, "div", "hr-gallery-content");
  const body = element(doc, "div", "hr-payroll-report-body");
  const identity = element(doc, "section", "hr-payroll-report-identity");
  const payrollId = element(doc, "strong", "hr-payroll-report-id", "");
  const supplier = element(doc, "h2", "hr-payroll-report-supplier", "");
  const month = element(doc, "p", "hr-payroll-report-month", "");
  identity.append(payrollId, supplier, month);
  const status = element(doc, "p", "hr-gallery-status hr-payroll-report-status", "");
  status.setAttribute("aria-live", "polite");
  const totals = element(doc, "section", "hr-payroll-report-totals");
  totals.setAttribute("aria-label", "Resumo da folha");
  const breakdown = element(doc, "section", "hr-payroll-report-breakdown");
  const breakdownTitle = element(doc, "h2", "hr-payroll-report-section-title", "Totais por tipo de pagamento");
  const breakdownCards = element(doc, "div", "hr-payroll-report-type-cards");
  breakdown.append(breakdownTitle, breakdownCards);
  const paymentsSection = element(doc, "details", "hr-payroll-report-linked-section");
  const paymentsTitle = element(doc, "summary", "hr-payroll-report-linked-toggle", "Pagamentos vinculados");
  const payments = element(doc, "div", "hr-payroll-report-payments");
  payments.setAttribute("role", "list");
  paymentsSection.append(paymentsTitle, payments);
  body.append(identity, status, totals, breakdown, paymentsSection);
  content.append(body);
  overlay.append(header, content);

  let destroyed = false;
  let opened = false;
  let epoch = 0;
  let currentPayroll = null;
  let controller = null;

  function renderPayments(rows) {
    const byType = new Map();
    let totalCents = 0;
    let uncalculated = 0;
    const amounts = rows.map(row => {
      const cents = lineAmountCents(row);
      const label = String(row.TIPOPGTO ?? "").trim() || "Sem tipo";
      const key = typeKey(label);
      const current = byType.get(key) || { label, cents: 0, payments: [] };
      current.payments.push({ row, cents });
      if (cents === null) uncalculated += 1;
      else {
        totalCents += cents;
        current.cents += cents;
      }
      byType.set(key, current);
      return cents;
    });

    totals.replaceChildren();
    const totalCard = element(doc, "article", "hr-payroll-report-total-card hr-payroll-report-total-card--overall");
    totalCard.append(element(doc, "span", "hr-payroll-report-total-label", "Total da folha"));
    const totalValue = element(doc, "strong", "hr-payroll-report-total-value", formatMoney(totalCents));
    totalValue.dataset.reportTotal = "overall";
    totalCard.append(totalValue);
    totals.append(totalCard);

    breakdownCards.replaceChildren();
    for (const [key, item] of [...byType.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "pt-BR"))) {
      const card = element(doc, "details", "hr-payroll-report-total-card hr-payroll-report-type-card");
      const toggle = element(doc, "summary", "hr-payroll-report-type-toggle");
      toggle.append(element(doc, "span", "hr-payroll-report-total-label", item.label));
      const value = element(doc, "strong", "hr-payroll-report-total-value", formatMoney(item.cents));
      value.dataset.reportTotalType = key;
      toggle.append(doc.createTextNode(" "), value);
      const lines = element(doc, "ul", "hr-payroll-report-type-lines");
      for (const { row, cents } of item.payments) {
        lines.append(element(doc, "li", "hr-payroll-report-type-line",
          `${display(row.id)} - ${cents === null ? "Não calculado" : formatMoney(cents)} (${formatDate(row.DATA)})`));
      }
      card.append(toggle, lines);
      breakdownCards.append(card);
    }

    payments.replaceChildren();
    for (const [index, row] of rows.entries()) {
      const card = element(doc, "article", "hr-payroll-payment-card");
      card.setAttribute("role", "listitem");
      const cardHeader = element(doc, "header", "hr-payroll-payment-header");
      const unitValue = parseNumber(row.VALORUNITARIO);
      cardHeader.append(
        element(doc, "strong", "hr-payroll-payment-id", `Pagamento ${display(row.id)}`),
        element(doc, "span", "hr-payroll-payment-type", String(row.TIPOPGTO ?? "").trim() || "Sem tipo"),
      );
      const fields = element(doc, "dl", "hr-payroll-payment-fields");
      const fieldValues = [
        ["Data", formatDate(row.DATA)],
        ["ID do lançamento", display(row.IDLANCAMENTO)],
        ["Valor unitário", unitValue === null ? "—" : formatMoney(Math.round(unitValue * 100))],
        ["Quantidade", display(row.QTD)],
        ["Total do pagamento", amounts[index] === null ? "Não calculado" : formatMoney(amounts[index])],
      ];
      for (const [label, value] of fieldValues) {
        const pair = element(doc, "div", "hr-payroll-payment-field");
        pair.append(element(doc, "dt", "", label), element(doc, "dd", "", value));
        if (label === "Total do pagamento" && amounts[index] !== null) {
          pair.querySelector("dd").dataset.reportLineTotal = String(row.id || index);
        }
        fields.append(pair);
      }
      card.append(cardHeader, fields);
      payments.append(card);
    }

    if (uncalculated) {
      const note = element(doc, "p", "hr-payroll-report-warning",
        `${uncalculated} pagamento(s) sem valor ou quantidade numérica não entraram nos totais.`);
      totals.append(note);
    }
    if (!rows.length) status.textContent = "Nenhum pagamento vinculado a esta folha.";
    else status.textContent = `${rows.length} pagamento(s) vinculado(s) a esta folha.`;
    paymentsSection.hidden = !rows.length;
  }

  async function loadPayments() {
    if (!opened || destroyed || !currentPayroll) return;
    const requestEpoch = ++epoch;
    controller?.abort();
    controller = new AbortController();
    overlay.setAttribute("aria-busy", "true");
    status.replaceChildren(createLoadingIndicator(doc, "Carregando pagamentos da folha…"));
    totals.replaceChildren();
    breakdownCards.replaceChildren();
    payments.replaceChildren();
    paymentsSection.open = false;
    paymentsSection.hidden = true;
    try {
      const rows = await request(currentPayroll.id, { signal: controller.signal });
      if (!opened || destroyed || requestEpoch !== epoch) return;
      if (!Array.isArray(rows)) throw new Error("A consulta retornou uma lista inválida.");
      renderPayments(rows);
    } catch (error) {
      if (!opened || destroyed || requestEpoch !== epoch || error?.name === "AbortError") return;
      status.textContent = "Não foi possível carregar os pagamentos desta folha.";
      payments.replaceChildren();
      const retry = element(doc, "button", "hr-gallery-button hr-gallery-retry", "Tentar novamente");
      retry.type = "button";
      retry.dataset.action = "retry-hr-payroll-report";
      retry.addEventListener("click", () => { void loadPayments(); });
      status.append(retry);
    } finally {
      if (opened && !destroyed && requestEpoch === epoch) {
        overlay.setAttribute("aria-busy", "false");
        controller = null;
      }
    }
  }

  function closeReport() {
    if (!opened || destroyed) return;
    opened = false;
    epoch += 1;
    controller?.abort();
    controller = null;
    overlay.hidden = true;
    overlay.setAttribute("aria-busy", "false");
    onClose?.();
  }

  close.addEventListener("click", closeReport);
  home?.addEventListener("click", () => { closeReport(); onHome(); });

  return Object.freeze({
    async open(payroll) {
      if (destroyed) return false;
      const id = String(payroll?.id ?? "").trim();
      if (!/^\d{1,10}$/.test(id) || Number(id) < 1) return false;
      currentPayroll = {
        id,
        supplier: display(payroll?.FORNECEDOR),
        month: display(payroll?.MESREFERENCIA),
      };
      payrollId.textContent = `ID ${id}`;
      supplier.textContent = currentPayroll.supplier;
      month.textContent = `Mês de referência · ${currentPayroll.month}`;
      opened = true;
      if (!overlay.isConnected) mountRoot.append(overlay);
      overlay.hidden = false;
      overlay.focus();
      await loadPayments();
      return true;
    },
    close: closeReport,
    destroy() {
      destroyed = true;
      opened = false;
      epoch += 1;
      controller?.abort();
      controller = null;
      overlay.remove();
    },
  });
}
