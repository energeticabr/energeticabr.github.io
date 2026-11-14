import { placeGalleryQuickSearch } from './gallery-quick-search.js';
import { applyScreenNavigation } from "./screen-navigation.js";
import { attachGalleryRefreshButton } from './gallery-refresh.js';
import { attachGalleryCreateShortcut } from './gallery-create-shortcut.js';
import { createGalleryLoadingScreen } from './gallery-loading-screen.js';
import { createGalleryRecordActions, dismissGalleryOverlay } from './gallery-record-actions.js';
import { createHrPayrollReport } from "./hr-payroll-report-view.js";
import { createMascotReportButton } from "./report-action-button.js";
import { createPayrollPaymentComposer } from './payroll-payment-view.js';
import { bindAutoFilterForm } from './auto-filter-form.js';
import { payrollFilterOptions, validatePayrollFilters } from '../chat/payroll-gallery-filters.js';
import { createWeeklyPayslipActions } from './weekly-payslip-actions.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';
import { createGalleryAttachmentCounts } from './gallery-attachment-counts.js';

const rubricQuantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 12 });
const rubricUnitValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 12 });

const GALLERIES = {
  HOLERITE: {
    title: "Galeria Holerites",
    fields: [["FORNECEDOR", "Funcionário"], ["FILIAL", "Filial"], ["SEMANA_INICIO", "Início da semana"],
      ["SEMANA_FIM", "Fim da semana"], ["DATA_PAGAMENTO", "Data da folha"], ["TOTAL", "Total"]],
  },
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
      ["PGTOAGENDADO", "Pagamento"],
    ],
  },
};

function displayValue(field, value) {
  if (value == null || value === "") return "—";
  const raw = String(value);
  if (["DATA", "SEMANA_INICIO", "SEMANA_FIM", "DATA_PAGAMENTO"].includes(field) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [, year, month, day] = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return `${day}/${month}/${year}`;
  }
  if (["VALORUNITARIO", "TOTAL"].includes(field) && Number.isFinite(Number(raw))) {
    return Number(raw).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return raw;
}

export function createHrPayrollGallery({ document: documentOption,
  root: mountRootOption, gallery, request, requestReport, invalidateRelatedReports, loadEditor, saveEditor, deleteItem, loadPaymentOptions, savePayment, onClose, onHome, onCreate, getReceiptAttachments, readReceiptAttachment, openPayslip, closePayslip, openDatePayslips,
  pickSignedPayslip, listSignedPayslips, uploadSignedPayslips, openSignedPayslip, loadPayslipEditor, savePayslipEditor } = {}) {
  const documentRef = documentOption || mountRootOption?.ownerDocument || globalThis.document;
  const mountRoot = mountRootOption || documentRef?.body;
  const config = GALLERIES[gallery];
  if (!documentRef?.createElement || !mountRoot?.append || !config || typeof request !== "function") {
    throw new TypeError("Documento, galeria e consulta são obrigatórios.");
  }
  const doc = documentRef;
  const isPayslip = gallery === "HOLERITE";
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
  let datePreview;
  let rowPreview;
  const expandedPayslipDates = new Set();
  const signedPayslips = isPayslip && typeof listSignedPayslips === 'function'
    ? createGalleryAttachmentCounts({ loadAttachments: async (row, options) => {
      const files = await listSignedPayslips(row, options);
      if (!Array.isArray(files)) throw new Error('Não foi possível consultar as vias assinadas.');
      return files;
    } })
    : null;

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
  search.placeholder=isPayslip ? 'Pesquisar holerites (funcionário, data, ID…)'
    : gallery==='IDFOLHA' ? 'Pesquisar folhas (fornecedor, mês, ID…)': 'Pesquisar pagamentos (fornecedor, tipo, ID…)';
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
  addFilter('FORNECEDOR',isPayslip ? 'Funcionário' : 'Fornecedor','select');
  if(gallery==='IDFOLHA') addFilter('MESREFERENCIA','Mês de referência','select');
  else if (!isPayslip) {
    addFilter('TIPOPGTO','Tipo de pagamento','select');
    addFilter('VALORUNITARIOmin','Valor unitário mínimo','number');addFilter('VALORUNITARIOmax','Valor unitário máximo','number');
    addFilter('QTDmin','Quantidade mínima','number');addFilter('QTDmax','Quantidade máxima','number');
    addFilter('DATAfrom','Data inicial','date');addFilter('DATAto','Data final','date');
    addFilter('IDFOLHA','IDFOLHA','number');addFilter('IDLANCAMENTO','ID do lançamento','number');
  }
  const clearFilters=element('button','hr-gallery-button','Limpar filtros');
  clearFilters.type='button';clearFilters.dataset.action='clear-payroll-filters';
  filterPanel.append(filterGrid,clearFilters);toolbar.append(search,toggle);filterForm.append(toolbar,filterPanel);
  placeGalleryQuickSearch({ input: search, toolbar });
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
  const payslipActions = isPayslip ? createWeeklyPayslipActions({ doc, host: root, pick: pickSignedPayslip, list: listSignedPayslips,
    upload: typeof uploadSignedPayslips === 'function' ? (...args) => runMutation(() => uploadSignedPayslips(...args)) : undefined,
    open: openSignedPayslip, loadEditor: loadPayslipEditor,
    saveEditor: typeof savePayslipEditor === 'function' ? (...args) => runMutation(() => savePayslipEditor(...args)) : undefined,
    onSaved: async (_row, values) => {
      if (!opened || destroyed) return;
      expandedPayslipDates.add(values.date);
      session += 1;
      busy = false;
      if (await loadPage(page, { refresh: true })) status.textContent = `Holerite de ${values.supplier} atualizado.`;
    },
  }) : null;
  const loadingScreen = createGalleryLoadingScreen({ root, header, label: 'Carregando registros…' });
  const recordActions = isPayslip ? null : createGalleryRecordActions({
    getReceiptAttachments, readReceiptAttachment,
    document: doc, host: root, loadEditor,
    galleryTitle: config.title,
    getDeletionSummary: row => config.fields.map(([name, label]) => ({ label, value: displayValue(name, row[name]) })),
    saveEditor: (...args) => runMutation(() => saveEditor(...args)),
    deleteItem: (...args) => runMutation(() => deleteItem(...args)),
    onChanged: () => {
      // A pre-save background response must never replace the saved record.
      session += 1;
      busy = false;
      return loadPage(page, { refresh: true });
    },
  });
  const paymentComposer = gallery === 'FOLHAPGTO' && typeof loadPaymentOptions === 'function' && typeof savePayment === 'function'
    ? createPayrollPaymentComposer({document:doc,host:root,loadOptions:loadPaymentOptions,
      save: (...args) => runMutation(() => savePayment(...args)), onSaved:async()=>{
      session += 1;busy=false;
      await loadPage(1, { refresh: true });
    }}) : null;
  const add = element('button', 'hr-gallery-button hr-gallery-add-payment', '+');
  const createShortcut = isPayslip ? null : attachGalleryCreateShortcut({ document: doc, root, toolbar, filterToggle: toggle, button: add,
    className: gallery === 'FOLHAPGTO' ? 'hr-gallery-button hr-gallery-add-payment' : 'hr-gallery-button',
    label: gallery === 'FOLHAPGTO' ? 'Acrescentar pagamento' : 'Adicionar registro — Galeria IDFOLHA',
    action: gallery === 'FOLHAPGTO' ? 'add-payroll-payment' : 'create-payroll-record',
    onCreate: typeof onCreate === 'function' ? onCreate : paymentComposer ? () => {
      recordActions.close(); void paymentComposer.open(add);
    } : undefined,
    close: typeof onCreate === 'function' ? closeGallery : () => {},
    isAvailable: () => opened && !destroyed && !busy && !paymentComposer?.isOpen() });
  let pendingMutations = 0;
  const refreshShortcut = attachGalleryRefreshButton({ document: doc, root, container: toolbar, header,
    onRefresh: async () => {
      autoFilters.sync();
      invalidateRelatedReports?.();
      await loadPage(page, { refresh: true });
    },
    isAvailable: () => opened && !destroyed && !busy && !pendingMutations && !paymentComposer?.isOpen() });
  async function runMutation(operation) {
    pendingMutations++; refreshShortcut.sync();
    try { return await (createShortcut ? createShortcut.runMutation(operation) : operation()); }
    finally { pendingMutations--; refreshShortcut.sync(); }
  }

  function selectedFilters() { return {search:search.value.trim(),...Object.fromEntries([...filterControls].map(([name,control])=>[name,control.value.trim()]))}; }
  function applyFilters() {
    if(!opened || destroyed) return;
    const filters=selectedFilters();
    try {validatePayrollFilters(gallery,filters);}
    catch(error) {session+=1;busy=false;loadingScreen.sync(false);status.textContent=error.message;cards.replaceChildren();hasMore=false;updateControls();return;}
    session+=1;busy=false;pageCursors.splice(0,pageCursors.length,null,null);
    // Filters update atomically without interrupting an in-progress dropdown.
    void loadPage(1, { quiet: true });
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

  function payslipTotal(row) {
    const details = element('details', 'hr-gallery-field hr-payslip-total');
    const summary = element('summary', 'hr-payslip-total-summary');
    summary.append(element('span', 'hr-payslip-total-label', 'Total'),
      element('strong', '', displayValue('TOTAL', row.TOTAL)));
    details.append(summary);
    if (!row.rubrics?.length) {
      details.append(element('p', 'hr-payslip-rubrics-empty', 'Rubricas indisponíveis para este holerite.'));
      return details;
    }
    const list = element('ul', 'hr-payslip-rubrics');
    for (const rubric of row.rubrics) {
      const item = element('li', 'hr-payslip-rubric');
      const values = element('dl', 'hr-payslip-rubric-values');
      for (const [label, value] of [
        ['Quantidade', rubricQuantity.format(rubric.quantity)],
        ['Valor unitário', rubricUnitValue.format(rubric.unitValue)],
        ...(rubric.freight ? [['Frete', displayValue('TOTAL', rubric.freight)]] : []),
        ['Forma de pagamento', rubric.formaPgto || '—'],
      ]) {
        const pair = element('div');
        pair.append(element('dt', '', label), element('dd', '', value));
        values.append(pair);
      }
      const heading = element('div', 'hr-payslip-rubric-heading');
      const subtotal = displayValue('TOTAL', rubric.total);
      const amount = element('strong', '', subtotal);
      amount.setAttribute('aria-label', `Subtotal ${subtotal}`);
      heading.append(element('strong', '', rubric.label), amount);
      item.append(heading, values);
      list.append(item);
    }
    details.append(list);
    return details;
  }

  function drawRows(rows, target = cards, submission) {
    for (const row of rows) {
      const card = element("article", "hr-gallery-card");
      card.setAttribute("role", "listitem");
      const cardHeader = element("header", "hr-gallery-card-header");
      cardHeader.append(element("strong", "hr-gallery-id", `ID ${row.id || "—"}`));
      const fields = element("dl", "hr-gallery-fields");
      for (const [key, label] of config.fields) {
        if (isPayslip && key === 'TOTAL') continue;
        const pair = element("div", "hr-gallery-field");
        pair.append(element("dt", "", label), element("dd", "", displayValue(key, row[key])));
        fields.append(pair);
      }
      const recordMain = element('div', 'gallery-record-main');
      recordMain.append(cardHeader, fields);
      if (isPayslip) recordMain.append(payslipTotal(row));
      card.classList.add('gallery-record-card');
      if (isPayslip) card.classList.add('hr-gallery-card--payslip');
      const actions = recordActions?.render(row) || element('div', 'gallery-record-actions');
      if (isPayslip) {
        const pdf = element('button', 'hr-gallery-button hr-gallery-payslip-pdf');
        pdf.type = 'button';
        pdf.dataset.action = 'open-payslip-pdf';
        pdf.setAttribute('aria-label', `Ver PDF do holerite de ${row.FORNECEDOR || 'funcionário'}, ID ${row.id}`);
        pdf.title = pdf.getAttribute('aria-label');
        pdf.innerHTML = PDF_ATTACHMENT_ICON;
        pdf.disabled = !row.pdfFileName || typeof openPayslip !== 'function';
        const badge = element('span', 'hr-payslip-upload-status');
        cardHeader.append(badge);
        const paintStatus = state => {
          card.classList.toggle('hr-gallery-card--payslip-signed', state === 'signed');
          card.classList.toggle('hr-gallery-card--payslip-missing', state === 'missing');
          pdf.setAttribute('aria-label', state === 'signed' ? `${pdf.title}. Via assinada disponível.` : pdf.title);
          badge.textContent = { signed: 'Enviado', missing: 'Falta enviar', checking: 'Verificando…', unknown: 'Não verificado' }[state];
        };
        submission.observe(row, paintStatus);
        const markSigned = signed => submission.update(row, signed ? 'signed' : 'missing');
        pdf.addEventListener('click', async () => {
          if (!opened || destroyed || busy || rowPreview) return;
          const controller = rowPreview = new AbortController();
          pdf.setAttribute('aria-busy', 'true');
          try {
            await openPayslip(row, { signal: controller.signal, onSigned: markSigned,
              resolveReturnFocus: () => pdf.isConnected ? pdf : root });
          } catch (error) {
            if (!controller.signal.aborted && card.isConnected)
              status.textContent = error?.message || 'Não foi possível abrir o PDF do holerite.';
          } finally {
            if (rowPreview === controller) rowPreview = null;
            pdf.removeAttribute('aria-busy');
          }
        });
        card.append(pdf);
        payslipActions.render(row, actions, markSigned);
      }
      if (payrollReport) {
        actions.append(createMascotReportButton(doc, {
          label: `Consultar pagamentos da folha ID ${row.id || ""}`,
          action: "open-payroll-report",
          onActivate: () => { void payrollReport.open(row); },
        }));
      }
      card.append(recordMain, actions);
      target.append(card);
    }
  }

  function drawPayslipDates(groups) {
    for (const { date, rows } of groups) {
      const group = element("section", "hr-payslip-date");
      group.setAttribute("role", "listitem");
      const header = element("header", "hr-payslip-date-header");
      const label = date ? displayValue("DATA_PAGAMENTO", date) : "Sem data da folha";
      const toggle = element("button", "hr-gallery-button hr-payslip-date-toggle", label);
      toggle.type = "button";
      toggle.dataset.action = "toggle-payslip-date";
      const expanded = expandedPayslipDates.has(date);
      toggle.setAttribute("aria-expanded", String(expanded));
      const count = element('span', 'hr-payslip-date-count');
      toggle.append(count);
      const progress = new Map(rows.map(row => [row, { state: signedPayslips && row.pdfFileName ? 'checking' : 'unknown' }]));
      function showProgress() {
        const counts = { signed: 0, missing: 0, checking: 0, unknown: 0 };
        for (const { state } of progress.values()) counts[state]++;
        const percent = Math.round(100 * counts.signed / (rows.length || 1));
        count.textContent = counts.checking ? `Verificando ${rows.length}…`
          : `${counts.signed}/${rows.length} (${percent}%) enviados · ${counts.missing} ${counts.missing === 1 ? 'pendente' : 'pendentes'}`
            + (counts.unknown ? ` · ${counts.unknown} ${counts.unknown === 1 ? 'não verificado' : 'não verificados'}` : '');
      }
      const submission = {
        observe(row, paint) {
          const entry = progress.get(row);
          entry.paint = paint;
          paint(entry.state);
        },
        update(row, state) {
          if (!group.isConnected || !opened) return;
          const entry = progress.get(row);
          if (entry.state === state) return;
          entry.state = state;
          entry.paint?.(state);
          showProgress();
        },
      };
      showProgress();
      const list = element("div", "hr-gallery-cards hr-payslip-date-items");
      list.setAttribute("role", "list");
      list.hidden = !expanded;
      if (expanded) drawRows(rows, list, submission);
      toggle.addEventListener("click", () => {
        list.hidden = !list.hidden;
        toggle.setAttribute("aria-expanded", String(!list.hidden));
        if (list.hidden) expandedPayslipDates.delete(date);
        else expandedPayslipDates.add(date);
        if (!list.hidden && !list.childElementCount) drawRows(rows, list, submission);
      });
      header.append(toggle);
      if (date && typeof openDatePayslips === "function") {
        const pdf = element("button", "hr-gallery-button hr-payslip-date-pdf", "PDF");
        pdf.type = "button";
        pdf.dataset.action = "open-payslip-date";
        pdf.setAttribute("aria-label", `Abrir o PDF com todos os holerites de ${label}`);
        pdf.addEventListener("click", async () => {
          if (!opened || destroyed || busy || datePreview) return;
          const controller = datePreview = new AbortController();
          pdf.setAttribute("aria-busy", "true");
          try {
            await openDatePayslips(date, { signal: controller.signal, resolveReturnFocus: () => pdf.isConnected ? pdf : root });
          } catch (error) {
            if (opened && !destroyed && !controller.signal.aborted && group.isConnected)
              status.textContent = error?.message || "Não foi possível abrir os holerites desta data.";
          } finally {
            if (datePreview === controller) datePreview = null;
            pdf.removeAttribute("aria-busy");
          }
        });
        header.append(pdf);
      }
      group.append(header, list);
      cards.append(group);
      for (const [row, entry] of progress) {
        if (entry.state !== 'checking') continue;
        const updateFromLookup = state => {
          if (entry.state === 'checking') submission.update(row, state);
        };
        void signedPayslips.load(row, { force: true }).then(files => {
          if (files) updateFromLookup(files.length ? 'signed' : 'missing');
        }, () => updateFromLookup('unknown'));
      }
    }
  }

  function renderRows(result) {
    const { rows } = result;
    signedPayslips?.reset();
    cards.replaceChildren();
    if (isPayslip) drawPayslipDates(result.dateGroups);
    else drawRows(rows);
    if (!rows.length) status.textContent = isPayslip ? "Nenhum holerite postado encontrado." : "Nenhum registro encontrado nesta página.";
    else status.textContent = `${rows.length} registro(s) nesta página.`;
  }

  function updateControls() {
    root.setAttribute("aria-busy", String(busy));
    previous.disabled = busy || page <= 1;
    next.disabled = busy || !hasMore;
    pageLabel.textContent = `Página ${page}`;
    close.disabled = false;
    createShortcut?.sync();
    refreshShortcut.sync();
  }

  async function loadPage(targetPage, {
    cursor = pageCursors[targetPage] || null, quiet = false, refresh = false, scrollToTop = false,
  } = {}) {
    if (!opened || destroyed || busy) return;
    busy = true;
    loadingScreen.sync(!quiet);
    if (!quiet) {
      status.textContent = '';
      signedPayslips?.reset();
      cards.replaceChildren();
    }
    updateControls();
    const epoch = session;
    const filters = selectedFilters();
    const current = () => {
      if (!opened || destroyed || !root.isConnected || epoch !== session) return false;
      if (JSON.stringify(filters) !== JSON.stringify(selectedFilters())) {
        // Discarded results must not suppress a later return to this query.
        autoFilters.invalidate();
        return false;
      }
      return true;
    };
    const task = quiet ? null : loadingScreen.beginTask({ isCurrent: current });
    task?.prepared();
    try {
      let result;
      const options = { filters, refresh, onProgress: task?.report, ...(isPayslip ? { groupByDate: true } : {}) };
      const pageSize = isPayslip ? 5 : 25;
      try { result = await request(gallery, targetPage, pageSize, cursor, options); }
      catch (error) {
        const invalidCursor = error?.status === 410 || error?.statusCode === 410
          || /cursor|skip.?token/i.test(`${error?.code || ''} ${error?.message || ''}`);
        if (!current() || !refresh || targetPage <= 1 || !invalidCursor) throw error;
        targetPage = 1; cursor = null;
        result = await request(gallery, 1, pageSize, null, options);
      }
      if (!current()) return;
      if (refresh && targetPage > 1 && result?.page > 1 && Array.isArray(result.rows) && !result.rows.length) {
        targetPage = 1; cursor = null;
        result = await request(gallery, 1, pageSize, null, options);
      }
      if (!current()) return;
      if (result?.gallery !== gallery || !Array.isArray(result.rows) || (isPayslip && !Array.isArray(result.dateGroups))) {
        throw new Error("Resposta da galeria inválida.");
      }
      task?.acquired();
      const previousPage = page;
      page = result.page;
      if (refresh) pageCursors.splice(page + 1);
      pageCursors[page] = page === 1 ? null : cursor;
      pageCursors[page + 1] = result.nextCursor || null;
      hasMore = result.hasMore === true && Boolean(result.nextCursor);
      if(!quiet || !filterForm.contains(doc.activeElement)) syncFilterOptions(result);
      renderRows(result);
      if (scrollToTop && page !== previousPage) content.scrollTop = 0;
      if(Number.isInteger(result.count)) status.textContent=`${result.count} registro(s) encontrado(s) · ${result.rows.length} nesta página.`;
      task?.complete();
      return true;
    } catch(error) {
      if (current()) {
        status.textContent = `Não foi possível carregar os registros. ${error?.message || 'Tente novamente.'}`;
        cards.replaceChildren();
        const retry = element("button", "hr-gallery-button hr-gallery-retry", "Tentar novamente");
        retry.type = "button";
        retry.addEventListener("click", () => { void loadPage(targetPage, { cursor, refresh, scrollToTop }); });
        cards.append(retry);
      }
      return false;
    } finally {
      task?.stop();
      if (opened && !destroyed && root.isConnected && epoch === session) {
        busy = false;
        loadingScreen.sync(false);
        updateControls();
      }
    }
  }

  function closeGallery() {
    if (!opened || destroyed) return;
    if (payslipActions?.isWriting()) return;
    payslipActions?.close(true);
    loadingScreen.sync(false);
    recordActions?.close();
    signedPayslips?.reset();
    rowPreview?.abort();
    rowPreview = null;
    datePreview?.abort();
    datePreview = null;
    if (isPayslip) closePayslip?.();
    autoFilters.cancelPending();
    paymentComposer?.close();
    opened = false;
    session += 1;
    busy = false;
    root.hidden = true;
    createShortcut?.sync();
    refreshShortcut.sync();
    onClose?.();
  }
  function navigateBack() {
    if (!opened || destroyed) return;
    if (payrollReport?.element && !payrollReport.element.hidden) { payrollReport.close(); return; }
    if (dismissGalleryOverlay(root)) return;
    closeGallery();
  }
  close.addEventListener("click", navigateBack);
  home?.addEventListener("click", () => { if (!payslipActions?.isWriting()) { closeGallery(); onHome(); } });
  previous.addEventListener("click", () => { if (page > 1) void loadPage(page - 1, { scrollToTop: true }); });
  next.addEventListener("click", () => { if (hasMore) void loadPage(page + 1, { scrollToTop: true }); });
  const refreshSource = () => {
    if (gallery === 'FOLHAPGTO' && opened && !destroyed && doc.visibilityState !== 'hidden' && !recordActions.isEditing() && !paymentComposer?.isOpen()) {
      void loadPage(page, { quiet: true, refresh: true });
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
      autoFilters.sync();
      await loadPage(1, { refresh: true });
      return true;
    },
    close: closeGallery,
    destroy() {
      payslipActions?.close(true);
      signedPayslips?.destroy();
      rowPreview?.abort();
      rowPreview = null;
      datePreview?.abort();
      datePreview = null;
      loadingScreen.destroy();
      createShortcut?.destroy();
      refreshShortcut.destroy();
      doc.defaultView?.clearInterval(refreshTimer);
      doc.defaultView?.removeEventListener('focus', refreshSource);
      doc.removeEventListener('visibilitychange', refreshSource);
      recordActions?.destroy();
      if (isPayslip) closePayslip?.();
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
