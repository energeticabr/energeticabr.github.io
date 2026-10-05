import { applyScreenNavigation } from "./screen-navigation.js";
import { createLoadingIndicator } from "./loading-indicator.js";
import { createGalleryRecordActions } from './gallery-record-actions.js';
import { createHrPayrollReport } from "./hr-payroll-report-view.js";
import { createMascotReportButton } from "./report-action-button.js";
import { createPayrollPaymentComposer } from './payroll-payment-view.js';

const GALLERIES = {
  IDFOLHA: {
    title: "Galeria IDFOLHA",
    fields: [["MESREFERENCIA", "Mês de referência"], ["FORNECEDOR", "Fornecedor"]],
  },
  FOLHAPGTO: {
    title: "Galeria FOLHA PGTO",
    fields: [
      ["FORNECEDOR", "Fornecedor"], ["TIPOPGTO", "Tipo de pagamento"],
      ["VALORUNITARIO", "Valor unitário"], ["QTD", "Quantidade"],
      ["DATA", "Data"], ["IDFOLHA", "IDFOLHA"],
      ["IDLANCAMENTO", "ID do lançamento"],
    ],
  },
};

function displayValue(field, value) {
  if (value == null || value === "") return "—";
  const raw = String(value);
  if (field === "DATA" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [, year, month, day] = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return `${day}/${month}/${year}`;
  }
  if (field === "VALORUNITARIO" && Number.isFinite(Number(raw))) {
    return Number(raw).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return raw;
}

export function createHrPayrollGallery({ document: documentOption,
  root: mountRootOption, gallery, request, requestReport, loadEditor, saveEditor, deleteItem, loadPaymentOptions, savePayment, onClose, onHome } = {}) {
  const documentRef = documentOption || mountRootOption?.ownerDocument || globalThis.document;
  const mountRoot = mountRootOption || documentRef?.body;
  const config = GALLERIES[gallery];
  if (!documentRef?.createElement || !mountRoot?.append || !config || typeof request !== "function") {
    throw new TypeError("Documento, galeria e consulta são obrigatórios.");
  }
  const doc = documentRef;
  const payrollReport = gallery === "IDFOLHA" && typeof requestReport === "function"
    ? createHrPayrollReport({ document: doc, root: mountRoot, request: requestReport,
      onHome: onHome ? () => { closeGallery(); onHome(); } : undefined })
    : null;
  let opened = false;
  let destroyed = false;
  let busy = false;
  let page = 1;
  let hasMore = false;
  const pageCursors = [null, null];
  let session = 0;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const root = element("section", "hr-gallery-overlay");
  root.hidden = true;
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", config.title);
  const header = element("header", "hr-gallery-header");
  const title = element("h1", "hr-gallery-title", config.title);
  const close = element("button", "hr-gallery-button hr-gallery-close", "Fechar");
  close.type = "button";
  close.dataset.action = "close-hr-gallery";
  const home = onHome ? element("button", "hr-gallery-button", "Início") : null;
  applyScreenNavigation({ header, back: close, home, title });
  const content = element("div", "hr-gallery-content");
  const status = element("p", "hr-gallery-status", "");
  status.setAttribute("aria-live", "polite");
  const cards = element("div", "hr-gallery-cards");
  cards.setAttribute("role", "list");
  const pagination = element("nav", "hr-gallery-pagination");
  pagination.setAttribute("aria-label", "Páginas da galeria");
  const previous = element("button", "hr-gallery-button", "‹ Anterior");
  previous.type = "button";
  previous.dataset.action = "previous-page";
  const pageLabel = element("span", "hr-gallery-page", "Página 1");
  const next = element("button", "hr-gallery-button", "Próxima ›");
  next.type = "button";
  next.dataset.action = "next-page";
  pagination.append(previous, pageLabel, next);
  content.append(status, cards, pagination);
  root.append(header, content);
  const recordActions = createGalleryRecordActions({
    document: doc, host: root, loadEditor, saveEditor, deleteItem,
    onChanged: () => {
      // A pre-save background response must never replace the saved record.
      session += 1;
      busy = false;
      return loadPage(page, pageCursors[page] || null);
    },
  });
  const paymentComposer = gallery === 'FOLHAPGTO' && typeof loadPaymentOptions === 'function' && typeof savePayment === 'function'
    ? createPayrollPaymentComposer({document:doc,host:root,loadOptions:loadPaymentOptions,save:savePayment,onSaved:async()=>{
      session += 1;busy=false;
      await loadPage(1,null);
    }}) : null;
  if(paymentComposer) {
    const add=element('button','hr-gallery-button hr-gallery-add-payment','+');
    add.type='button';add.dataset.action='add-payroll-payment';add.setAttribute('aria-label','Acrescentar pagamento');add.title='Acrescentar pagamento';
    header.append(add);add.addEventListener('click',()=>{recordActions.close();void paymentComposer.open(add);});
  }

  function drawRows(rows) {
    cards.replaceChildren();
    for (const row of rows) {
      const card = element("article", "hr-gallery-card");
      card.setAttribute("role", "listitem");
      const cardHeader = element("header", "hr-gallery-card-header");
      cardHeader.append(element("strong", "hr-gallery-id", `ID ${row.id || "—"}`));
      const fields = element("dl", "hr-gallery-fields");
      for (const [key, label] of config.fields) {
        const pair = element("div", "hr-gallery-field");
        pair.append(element("dt", "", label), element("dd", "", displayValue(key, row[key])));
        fields.append(pair);
      }
      const recordMain = element('div', 'gallery-record-main');
      recordMain.append(cardHeader, fields);
      card.classList.add('gallery-record-card');
      const actions = recordActions.render(row);
      if (payrollReport) {
        actions.append(createMascotReportButton(doc, {
          label: `Consultar pagamentos da folha ID ${row.id || ""}`,
          action: "open-payroll-report",
          onActivate: () => { void payrollReport.open(row); },
        }));
      }
      card.append(recordMain, actions);
      cards.append(card);
    }
    if (!rows.length) status.textContent = "Nenhum registro encontrado nesta página.";
    else status.textContent = `${rows.length} registro(s) nesta página.`;
  }

  function updateControls() {
    root.setAttribute("aria-busy", String(busy));
    previous.disabled = busy || page <= 1;
    next.disabled = busy || !hasMore;
    pageLabel.textContent = `Página ${page}`;
    close.disabled = false;
  }

  async function loadPage(targetPage, cursor = pageCursors[targetPage] || null, quiet = false) {
    if (!opened || destroyed || busy) return;
    busy = true;
    if (!quiet) {
      status.replaceChildren(createLoadingIndicator(doc, "Carregando registros…"));
      cards.replaceChildren();
    }
    updateControls();
    const epoch = session;
    try {
      const result = await request(gallery, targetPage, 25, cursor);
      if (!opened || destroyed || epoch !== session) return;
      if (result?.gallery !== gallery || !Array.isArray(result.rows)) {
        throw new Error("Resposta da galeria inválida.");
      }
      page = result.page;
      pageCursors[page] = cursor;
      pageCursors[page + 1] = result.nextCursor || null;
      hasMore = result.hasMore === true && Boolean(result.nextCursor);
      drawRows(result.rows);
    } catch {
      if (opened && !destroyed && epoch === session) {
        status.textContent = "Não foi possível carregar os registros. Tente novamente.";
        cards.replaceChildren();
        const retry = element("button", "hr-gallery-button hr-gallery-retry", "Tentar novamente");
        retry.type = "button";
        retry.addEventListener("click", () => { void loadPage(targetPage, cursor); });
        cards.append(retry);
      }
    } finally {
      if (opened && !destroyed && epoch === session) {
        busy = false;
        updateControls();
      }
    }
  }

  function closeGallery() {
    if (!opened || destroyed) return;
    recordActions.close();
    paymentComposer?.close();
    opened = false;
    session += 1;
    busy = false;
    root.hidden = true;
    onClose?.();
  }
  close.addEventListener("click", closeGallery);
  home?.addEventListener("click", () => { closeGallery(); onHome(); });
  previous.addEventListener("click", () => { if (page > 1) void loadPage(page - 1, pageCursors[page - 1] || null); });
  next.addEventListener("click", () => { if (hasMore) void loadPage(page + 1, pageCursors[page + 1]); });
  const refreshSource = () => {
    if (gallery === 'FOLHAPGTO' && opened && !destroyed && doc.visibilityState !== 'hidden' && !recordActions.isEditing() && !paymentComposer?.isOpen()) {
      void loadPage(page, pageCursors[page] || null, true);
    }
  };
  doc.defaultView?.addEventListener('focus', refreshSource);
  doc.addEventListener('visibilitychange', refreshSource);
  const refreshTimer = gallery === 'FOLHAPGTO' ? doc.defaultView?.setInterval(refreshSource, 15000) : null;

  return Object.freeze({
    async open() {
      if (destroyed) return false;
      opened = true;
      session += 1;
      if (!root.isConnected) mountRoot.append(root);
      root.hidden = false;
      page = 1;
      hasMore = false;
      pageCursors.splice(0, pageCursors.length, null, null);
      await loadPage(1);
      return true;
    },
    close: closeGallery,
    destroy() {
      doc.defaultView?.clearInterval(refreshTimer);
      doc.defaultView?.removeEventListener('focus', refreshSource);
      doc.removeEventListener('visibilitychange', refreshSource);
      recordActions.destroy();
      paymentComposer?.close();
      destroyed = true;
      opened = false;
      session += 1;
      payrollReport?.destroy();
      root.remove();
    },
  });
}
