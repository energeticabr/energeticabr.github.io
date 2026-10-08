import { applyScreenNavigation } from "./screen-navigation.js";
import { attachGalleryRefreshButton } from './gallery-refresh.js';
import { attachGalleryCreateShortcut } from './gallery-create-shortcut.js';
import { createLoadingIndicator } from "./loading-indicator.js";
import { createGalleryRecordActions } from './gallery-record-actions.js';
import { createHrPayrollReport } from "./hr-payroll-report-view.js";
import { createMascotReportButton } from "./report-action-button.js";
import { createPayrollPaymentComposer } from './payroll-payment-view.js';
import { bindAutoFilterForm } from './auto-filter-form.js';
import { payrollFilterOptions, validatePayrollFilters } from '../chat/payroll-gallery-filters.js';

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
  root: mountRootOption, gallery, request, requestReport, loadEditor, saveEditor, deleteItem, loadPaymentOptions, savePayment, onClose, onHome, onCreate, getReceiptAttachments, readReceiptAttachment } = {}) {
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
  const filterForm = element('form', 'hr-gallery-filter-form');
  filterForm.setAttribute('aria-label', `Filtros de ${config.title}`);
  const toolbar = element('div', 'hr-gallery-toolbar');
  const search = element('input', 'hr-gallery-search');
  search.type='search'; search.name='search';
  search.placeholder=gallery==='IDFOLHA' ? 'Pesquisar folhas (fornecedor, mês, ID…)': 'Pesquisar pagamentos (fornecedor, tipo, ID…)';
  search.setAttribute('aria-label', 'Pesquisar registros');
  const toggle = element('button','hr-gallery-button hr-gallery-filter-toggle','⚲ Filtros');
  toggle.type='button'; toggle.dataset.action='toggle-payroll-filters'; toggle.setAttribute('aria-expanded','false');
  const filterPanel = element('section','hr-gallery-filter-panel');
  filterPanel.hidden=true; filterPanel.id=`hr-payroll-filters-${gallery}`;
  toggle.setAttribute('aria-controls',filterPanel.id);
  toggle.addEventListener('click',()=>{filterPanel.hidden=!filterPanel.hidden;toggle.setAttribute('aria-expanded',String(!filterPanel.hidden));});
  const filterGrid=element('div','hr-gallery-filter-grid'), filterControls=new Map();
  function addFilter(name, label, type='text') {
    const wrapper=element('label','hr-gallery-filter-field'); wrapper.append(element('span','',label));
    const control=element(type==='select'?'select':'input','hr-gallery-filter-input');
    control.name=name;
    if(type==='select') control.append(Object.assign(element('option','','Todos'),{value:''}));
    else {control.type=type;if(type==='number'){control.step='any';control.inputMode='decimal';}}
    wrapper.append(control);filterGrid.append(wrapper);filterControls.set(name,control);
  }
  addFilter('id','ID','number');
  addFilter('FORNECEDOR','Fornecedor','select');
  if(gallery==='IDFOLHA') addFilter('MESREFERENCIA','Mês de referência','select');
  else {
    addFilter('TIPOPGTO','Tipo de pagamento','select');
    addFilter('VALORUNITARIOmin','Valor unitário mínimo','number');addFilter('VALORUNITARIOmax','Valor unitário máximo','number');
    addFilter('QTDmin','Quantidade mínima','number');addFilter('QTDmax','Quantidade máxima','number');
    addFilter('DATAfrom','Data inicial','date');addFilter('DATAto','Data final','date');
    addFilter('IDFOLHA','IDFOLHA','number');addFilter('IDLANCAMENTO','ID do lançamento','number');
  }
  const clearFilters=element('button','hr-gallery-button','Limpar filtros');
  clearFilters.type='button';clearFilters.dataset.action='clear-payroll-filters';
  filterPanel.append(filterGrid,clearFilters);toolbar.append(search,toggle);filterForm.append(toolbar,filterPanel);
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
  content.append(filterForm, status, cards, pagination);
  root.append(header, content);
  const recordActions = createGalleryRecordActions({
    getReceiptAttachments, readReceiptAttachment,
    document: doc, host: root, loadEditor,
    saveEditor: (...args) => runMutation(() => saveEditor(...args)),
    deleteItem: (...args) => runMutation(() => deleteItem(...args)),
    onChanged: () => {
      // A pre-save background response must never replace the saved record.
      session += 1;
      busy = false;
      return loadPage(page, pageCursors[page] || null, false, true);
    },
  });
  const paymentComposer = gallery === 'FOLHAPGTO' && typeof loadPaymentOptions === 'function' && typeof savePayment === 'function'
    ? createPayrollPaymentComposer({document:doc,host:root,loadOptions:loadPaymentOptions,
      save: (...args) => runMutation(() => savePayment(...args)), onSaved:async()=>{
      session += 1;busy=false;
      await loadPage(1,null,false,true);
    }}) : null;
  const add = element('button', 'hr-gallery-button hr-gallery-add-payment', '+');
  const createShortcut = attachGalleryCreateShortcut({ document: doc, root, toolbar, filterToggle: toggle, button: add,
    className: gallery === 'FOLHAPGTO' ? 'hr-gallery-button hr-gallery-add-payment' : 'hr-gallery-button',
    label: gallery === 'FOLHAPGTO' ? 'Acrescentar pagamento' : 'Adicionar registro — Galeria IDFOLHA',
    action: gallery === 'FOLHAPGTO' ? 'add-payroll-payment' : 'create-payroll-record',
    onCreate: typeof onCreate === 'function' ? onCreate : paymentComposer ? () => {
      recordActions.close(); void paymentComposer.open(add);
    } : undefined,
    close: typeof onCreate === 'function' ? closeGallery : () => {},
    isAvailable: () => opened && !destroyed && !busy && !paymentComposer?.isOpen() });
  let pendingMutations = 0;
  const refreshShortcut = attachGalleryRefreshButton({ document: doc, root, container: toolbar,
    onRefresh: () => {
      autoFilters.sync();
      return loadPage(page, pageCursors[page] || null, false, true);
    },
    isAvailable: () => opened && !destroyed && !busy && !pendingMutations && !paymentComposer?.isOpen() });
  async function runMutation(operation) {
    pendingMutations++; refreshShortcut.sync();
    try { return await createShortcut.runMutation(operation); }
    finally { pendingMutations--; refreshShortcut.sync(); }
  }

  function selectedFilters() { return {search:search.value.trim(),...Object.fromEntries([...filterControls].map(([name,control])=>[name,control.value.trim()]))}; }
  function applyFilters() {
    if(!opened || destroyed) return;
    const filters=selectedFilters();
    try {validatePayrollFilters(gallery,filters);}
    catch(error) {session+=1;busy=false;status.textContent=error.message;cards.replaceChildren();hasMore=false;updateControls();return;}
    session+=1;busy=false;pageCursors.splice(0,pageCursors.length,null,null);
    void loadPage(1,null);
  }
  const autoFilters=bindAutoFilterForm(filterForm,applyFilters);
  clearFilters.addEventListener('click',()=>{filterForm.reset();autoFilters.sync();applyFilters();});
  function syncFilterOptions(result) {
    const options=result.filterOptions || payrollFilterOptions(gallery,result.rows);
    for(const [key,values] of Object.entries(options)) {
      const control=filterControls.get(key);
      if(control?.tagName!=='SELECT' || !Array.isArray(values)) continue;
      const selected=control.value;
      const choices=selected && !values.includes(selected) ? [...values,selected]:values;
      const expected=['',...choices];
      if(control.options.length===expected.length &&
        [...control.options].every((option,index)=>option.value===expected[index] && option.textContent===(index ? expected[index]:'Todos'))) continue;
      control.replaceChildren(Object.assign(element('option','','Todos'),{value:''}),
        ...choices.map(value=>Object.assign(element('option','',value),{value})));
      control.value=selected;
    }
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
    createShortcut.sync();
    refreshShortcut.sync();
  }

  async function loadPage(targetPage, cursor = pageCursors[targetPage] || null, quiet = false, refresh = false) {
    if (!opened || destroyed || busy) return;
    busy = true;
    if (!quiet) {
      status.replaceChildren(createLoadingIndicator(doc, "Carregando registros…"));
      cards.replaceChildren();
    }
    updateControls();
    const epoch = session;
    const filters = selectedFilters();
    try {
      const current = () => opened && !destroyed && root.isConnected && epoch === session
        && JSON.stringify(filters) === JSON.stringify(selectedFilters());
      let result;
      try { result = await request(gallery, targetPage, 25, cursor, {filters,refresh}); }
      catch (error) {
        const invalidCursor = error?.status === 410 || error?.statusCode === 410
          || /cursor|skip.?token/i.test(`${error?.code || ''} ${error?.message || ''}`);
        if (!current() || !refresh || targetPage <= 1 || !invalidCursor) throw error;
        targetPage = 1; cursor = null;
        result = await request(gallery, 1, 25, null, {filters,refresh});
      }
      if (!current()) return;
      if (refresh && targetPage > 1 && result?.page > 1 && Array.isArray(result.rows) && !result.rows.length) {
        targetPage = 1; cursor = null;
        result = await request(gallery, 1, 25, null, {filters,refresh});
      }
      if (!current()) return;
      if (result?.gallery !== gallery || !Array.isArray(result.rows)) {
        throw new Error("Resposta da galeria inválida.");
      }
      page = result.page;
      if (refresh) pageCursors.splice(page + 1);
      pageCursors[page] = page === 1 ? null : cursor;
      pageCursors[page + 1] = result.nextCursor || null;
      hasMore = result.hasMore === true && Boolean(result.nextCursor);
      if(!quiet || !filterForm.contains(doc.activeElement)) syncFilterOptions(result);
      drawRows(result.rows);
      if(Number.isInteger(result.count)) status.textContent=`${result.count} registro(s) encontrado(s) · ${result.rows.length} nesta página.`;
    } catch(error) {
      if (opened && !destroyed && root.isConnected && epoch === session) {
        status.textContent = `Não foi possível carregar os registros. ${error?.message || 'Tente novamente.'}`;
        cards.replaceChildren();
        const retry = element("button", "hr-gallery-button hr-gallery-retry", "Tentar novamente");
        retry.type = "button";
        retry.addEventListener("click", () => { void loadPage(targetPage, cursor, false, refresh); });
        cards.append(retry);
      }
    } finally {
      if (opened && !destroyed && root.isConnected && epoch === session) {
        busy = false;
        updateControls();
      }
    }
  }

  function closeGallery() {
    if (!opened || destroyed) return;
    recordActions.close();
    autoFilters.cancelPending();
    paymentComposer?.close();
    opened = false;
    session += 1;
    busy = false;
    root.hidden = true;
    createShortcut.sync();
    refreshShortcut.sync();
    onClose?.();
  }
  close.addEventListener("click", closeGallery);
  home?.addEventListener("click", () => { closeGallery(); onHome(); });
  previous.addEventListener("click", () => { if (page > 1) void loadPage(page - 1, pageCursors[page - 1] || null); });
  next.addEventListener("click", () => { if (hasMore) void loadPage(page + 1, pageCursors[page + 1]); });
  const refreshSource = () => {
    if (gallery === 'FOLHAPGTO' && opened && !destroyed && doc.visibilityState !== 'hidden' && !recordActions.isEditing() && !paymentComposer?.isOpen()) {
      void loadPage(page, pageCursors[page] || null, true, true);
    }
  };
  doc.defaultView?.addEventListener('focus', refreshSource);
  doc.addEventListener('visibilitychange', refreshSource);
  const refreshTimer = gallery === 'FOLHAPGTO' ? doc.defaultView?.setInterval(refreshSource, 15000) : null;

  return Object.freeze({
    async open() {
      if (destroyed) return false;
      opened = true;
      busy = false;
      session += 1;
      if (!root.isConnected) mountRoot.append(root);
      root.hidden = false;
      page = 1;
      hasMore = false;
      pageCursors.splice(0, pageCursors.length, null, null);
      await loadPage(1,null,false,true);
      return true;
    },
    close: closeGallery,
    destroy() {
      createShortcut.destroy();
      refreshShortcut.destroy();
      doc.defaultView?.clearInterval(refreshTimer);
      doc.defaultView?.removeEventListener('focus', refreshSource);
      doc.removeEventListener('visibilitychange', refreshSource);
      recordActions.destroy();
      autoFilters.destroy();
      paymentComposer?.close();
      destroyed = true;
      opened = false;
      session += 1;
      payrollReport?.destroy();
      root.remove();
    },
  });
}
