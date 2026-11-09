import { invoiceXmlFacts, NFE_SUPPLIER_REGIMES, projectNfeRows, rankNfeOrderOptions } from '../chat/nfe-report-model.js';
import { nfeOrderId } from '../chat/nfe-order-link.js';
import { createReportLinkPicker } from './dda-provision-picker.js';
import { createNfeProposalView } from './nfe-proposal-view.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';
import { captureFilteredReport } from './report-print.js';

const PAGE_SIZE = 12;
const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const retentionLabels = { yes:'Retenção informada', no:'Sem retenção informada', unknown:'Retenção não confirmada' };
const cnoLabels = { valid:'CNO consta', conflict:'CNO divergente', missing:'CNO não consta', unknown:'CNO não confirmada', workCode:'CNO/CEI informado' };
const searchKey = value => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const displayDate = value => value ? value.split('-').reverse().join('/') : 'Não informada';
const xmlKey = row => `${row.key}|${row.xmlUrl}`;
const ORDER_PICKER_COPY = {
  title:'A QUAL PEDIDO DESEJA VINCULAR?',
  dialogLabel:'Vincular nota fiscal a pedido',
  sourceLabel:'Nota fiscal',
  targetLabel:'Pedido',
  searchLabel:'Buscar pedido por fornecedor, filial ou ID',
  listLabel:'Pedidos disponíveis',
  loading:'Carregando pedidos…',
  options:count => count ? `${count} pedido(s). Escolha um para vincular.` : 'Nenhum pedido corresponde à busca.',
  empty:'Nenhum pedido disponível.',
  loadError:'Não foi possível carregar os pedidos. Feche e tente novamente.',
  receipt:id => `Nota vinculada ao pedido #${id}.`,
  recommendation:'★ RECOMENDADO',
  reviewDetails:true,
};
const PENCIL_ICON = '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';

function classifyFiscalFacts(row, facts) {
  let retention = row.retention;
  if (facts?.declaresRetention) retention = 'yes';
  else if (row.type === 'NFS-e' && retention === 'no' && !facts) retention = 'unknown';

  let cno = row.cnoState;
  let cnoDetail = row.cno.numbers.join(' · ');
  if (cnoDetail && row.cno.corrected) cnoDetail += ' · Carta de correção';
  if (row.type === 'NFS-e' && cno === 'unknown' && facts) {
    const code = facts.workCode;
    const expected = row.cno.expected;
    const isWorkCno = /^[\d.\s/-]+$/.test(code) && code.replace(/\D/g, '') === expected.replace(/\D/g, '');
    cno = isWorkCno ? 'valid' : code ? 'workCode' : 'missing';
    cnoDetail = isWorkCno ? expected : code;
  }
  return { regime:facts?.regime || '', retention, cno, cnoDetail };
}

export function createNfeReportView({ document:doc = globalThis.document, data, openMediaCollection }) {
  const make = (tag, className = '', text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (label, action, className = '') => {
    const element = make('button', className, label);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  const root = make('div', 'pl-overlay nfe-report');
  root.hidden = true;
  const panel = make('section', 'pl-dialog nfe-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'nfe-report-title');
  const toolbar = make('div', 'pl-filters nfe-toolbar');
  const header = make('header', 'nfe-header');
  const logo = make('img', 'nfe-logo');
  logo.src = LOGO;
  logo.alt = 'Energética Construtora';
  const title = make('h2', '', 'RELATÓRIO DE NOTAS FISCAIS');
  title.id = 'nfe-report-title';
  const refresh = button('⟳', () => void load(true), 'pl-refresh');
  refresh.setAttribute('aria-label', 'Atualizar notas fiscais');
  refresh.title = 'Atualizar notas fiscais';
  const closeButton = make('button');
  closeButton.setAttribute('aria-label', 'Fechar notas fiscais');
  header.append(logo, refresh, title);

  const body = make('div', 'pl-table-scroll nfe-body');
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', 'Notas fiscais da empresa');
  const metrics = make('dl', 'nfe-metrics');
  const filters = make('div', 'nfe-filters');
  const search = make('input');
  search.type = 'search';
  search.name = 'search';
  search.placeholder = 'Fornecedor, CNPJ ou nota';
  const type = make('select');
  type.name = 'document';
  const retentionFilter = make('select');
  retentionFilter.name = 'retention';
  const cnoFilter = make('select');
  cnoFilter.name = 'cno';
  const regimeFilter = make('select');
  regimeFilter.name = 'regime';
  const selects = [type, retentionFilter, cnoFilter, regimeFilter];
  for (const [control, label, options] of [
    [type, 'Documento', [['', 'Todos'], ['NF-e','NF-e'], ['NFS-e','NFS-e']]],
    [search, 'Pesquisar fornecedor, CNPJ ou nota', []],
    [retentionFilter, 'Retenção', [['', 'Todas'], ['yes', 'Com retenção'], ['no', 'Sem retenção']]],
    [cnoFilter, 'CNO', [['', 'Todas'], ['valid', 'CNO correta'], ['conflict', 'CNO incorreta'], ['missing', 'Sem CNO']]],
    [regimeFilter, 'Tipo de empresa', [['', 'Todos'], ...NFE_SUPPLIER_REGIMES.map(regime => [regime, regime])]],
  ]) {
    const field = make('label');
    for (const [value, name] of options) {
      const option = make('option', '', name);
      option.value = value;
      control.append(option);
    }
    field.append(make('span', '', label), control);
    filters.append(field);
  }
  toolbar.append(header, filters);

  const feedback = make('p', 'nfe-feedback');
  feedback.setAttribute('role', 'status');
  const pdfFeedback = make('p', 'nfe-pdf-feedback');
  pdfFeedback.hidden = true;
  pdfFeedback.dataset.reportScreenOnly = '';
  pdfFeedback.setAttribute('role', 'status');
  const table = make('table', 'nfe-table');
  table.setAttribute('aria-label', 'Notas fiscais por data de emissão');
  const columns = make('tr');
  for (const label of ['ID', 'Nota fiscal', 'Fornecedor', 'Emissão', 'Valor da nota', 'TIPO FORNECEDOR/ RETENÇÃO', 'Cadastro da obra', 'VINCULAÇÃO']) {
    const heading = make('th', '', label);
    heading.scope = 'col';
    columns.append(heading);
  }
  const tableHead = make('thead');
  tableHead.append(columns);
  const list = make('tbody');
  table.append(tableHead, list);
  const pager = make('nav', 'nfe-pager');
  pager.setAttribute('aria-label', 'Páginas do relatório');
  const previous = button('Anterior', () => changePage(page - 1));
  const next = button('Próxima', () => changePage(page + 1));
  const pageLabel = make('span');
  pager.append(previous, pageLabel, next);
  body.append(metrics, feedback, table, pager);
  const report = make('div', 'pl-report nfe-content');
  report.append(toolbar, pdfFeedback, body);
  panel.append(report);
  root.append(panel);
  doc.body.append(root);
  const landscape = bindReportLandscape(root);
  addReportCloseControl({ root, toolbar, onClose:close, button:closeButton });

  let rows = null, page = 1, request, pageRequest, pageFacts, pdfRequest, returnFocus, app, oldInert, oldOverflow;
  const xmlFacts = new Map();
  const orderLink = data.orderLink;
  const proposal = data.proposal && createNfeProposalView({
    document:doc, host:root, service:data.proposal,
    onPosted(receipt) { showLinked(receipt); picker?.close(); },
  });
  const picker = orderLink && createReportLinkPicker({
    document:doc, host:root, copy:ORDER_PICKER_COPY,
    loadOptions:async (row, signal) => rankNfeOrderOptions(await orderLink.loadOptions({ signal }), row),
    saveLink:(row, orderId, signal) => orderLink.save({ invoiceId:row.id, orderId, expectedOrderId:row.orderId, signal }),
    currentLink:row => row.orderId,
    selectCurrent:true,
    receiptId:receipt => receipt.orderId,
    rowAmount:row => row.total,
    resolveReturnFocus:trigger => list.querySelector(`[data-invoice-id="${trigger?.dataset.invoiceLink}"] .nfe-link-edit`) || closeButton,
    onLinked:showLinked,
    onPropose:proposal && ((row, trigger) => void proposal.show(row, trigger)),
  });

  function showLinked({ invoiceId, orderId }) {
    if (root.hidden || !rows || !nfeOrderId(invoiceId) || !nfeOrderId(orderId)) return;
    const previous = rows.find(row => row.id === invoiceId);
    if (!previous) return;
    const updated = { ...previous, orderId };
    rows = rows.map(row => row === previous ? updated : row);
    const cell = list.querySelector(`[data-invoice-id="${invoiceId}"] .nfe-link`);
    if (cell) renderOrderLink(cell, updated, true);
  }

  function renderOrderLink(cell, row, interactive) {
    if (!interactive) {
      if (row.orderId) cell.append(make('span', 'nfe-link-cluster nfe-link-linked', `ID ${row.orderId}`));
      else cell.textContent = '—';
      return;
    }

    const controls = make('div', 'nfe-link-controls');
    if (row.orderId) controls.append(make('span', 'nfe-link-cluster nfe-link-linked', `ID ${row.orderId}`));
    const pencil = button('', () => void picker?.show(row, pencil),
      row.orderId ? 'nfe-link-cluster nfe-link-edit' : 'nfe-link-cluster nfe-link-pencil');
    pencil.dataset.invoiceLink = row.id;
    pencil.dataset.reportScreenOnly = '';
    pencil.innerHTML = PENCIL_ICON;
    pencil.title = row.orderId ? `Editar pedido vinculado à nota ${row.number || row.id}`
      : `Vincular nota ${row.number || row.id} a um pedido`;
    pencil.setAttribute('aria-label', pencil.title);
    pencil.disabled = !picker || !nfeOrderId(row.id);
    controls.append(pencil);
    cell.replaceChildren(controls);
  }

  function orderLinkCell(row, interactive) {
    const cell = make('td', 'nfe-link');
    renderOrderLink(cell, row, interactive);
    return cell;
  }

  function changePage(value) {
    page = value;
    render();
    body.scrollTop = 0;
    (value > 1 && !next.disabled ? next : !previous.disabled ? previous : search).focus({ preventScroll:true });
  }

  function metric(label, value) {
    const entry = make('div', 'nfe-pair');
    entry.append(make('dt', '', label), make('dd', '', value));
    metrics.append(entry);
  }

  function setValue(description, value, detail = '') {
    description.textContent = value;
    if (detail) description.append(make('small', '', detail));
  }

  function renderXmlFacts({ row, regime, retention, cno }, facts) {
    const status = classifyFiscalFacts(row, facts);
    const unavailable = facts === null;
    const pending = facts === undefined && Boolean(row.xmlUrl);
    setValue(regime, status.regime || (unavailable ? 'Consulta indisponível' : pending ? 'Consultando…' : 'Não informado'));
    const retained = row.withholding ? `Pelo comprador · ${money.format(row.withholding.total)}` : '';
    setValue(retention, retentionLabels[status.retention], retained);
    retention.parentElement.dataset.tone = status.retention === 'yes' ? 'warning' : '';
    setValue(cno, cnoLabels[status.cno], status.cnoDetail);
    cno.parentElement.dataset.tone = status.cno;
  }

  function reportRow(row, includePdf = true) {
    const line = make('tr');
    line.dataset.invoiceId = row.id;
    const id = make('td');
    const identity = make('div', 'nfe-identity');
    identity.append(make('span', 'nfe-id', row.id));
    id.append(identity);
    const pdfLabel = row.type === 'NFS-e' ? 'DANFSe' : 'DANFE';
    if (includePdf && (row.pdfName || row.correctionCount) && typeof openMediaCollection === 'function') {
      const documents = !row.pdfName ? 'cartas de correção' : row.correctionCount ? `${pdfLabel} e cartas de correção` : pdfLabel;
      const label = `Abrir ${documents} da nota ${row.number || row.id}`;
      const pdf = button('', () => void openPdf(row, pdf), 'nfe-pdf');
      pdf.setAttribute('aria-label', label);
      pdf.title = label;
      pdf.innerHTML = PDF_ATTACHMENT_ICON;
      identity.append(pdf);
    } else if (includePdf) identity.append(make('small', 'nfe-pdf-pending', 'PDF pendente'));

    const note = make('td');
    note.append(make('strong', 'nfe-type', row.number ? `${row.type} · nº ${row.number}` : row.type));
    const status = row.cancelled ? 'Cancelada' : !row.complete ? 'XML pendente' : '';
    if (status) {
      const state = make('small', 'nfe-note-status', status);
      state.dataset.tone = row.cancelled ? 'conflict' : 'warning';
      note.append(state);
    }
    if (row.correctionCount) {
      const badge = make('small', 'nfe-note-status', `${row.correctionCount} CC-e`);
      badge.title = 'Cartas de Correção Eletrônicas';
      note.append(badge);
    }
    const supplier = make('td', 'nfe-supplier');
    supplier.append(make('strong', '', row.supplier || 'Razão social não informada'));
    if (row.taxId) supplier.append(make('small', '', row.taxId));
    const date = make('td', 'nfe-date');
    const dateText = make(row.date ? 'time' : 'span', '', displayDate(row.date));
    if (row.date) dateText.dateTime = row.date;
    date.append(dateText);
    const amount = make('td', 'nfe-money', row.total === null ? 'Não informado' : money.format(row.total).replace(/\u00a0/g, ' '));
    line.append(id, note, supplier, date, amount);
    const fields = { row, line };
    const taxCell = make('td');
    const taxStack = make('div', 'nfe-tax-stack');
    taxCell.append(taxStack);
    const workCell = make('td');
    for (const [name, container] of [['regime', taxStack], ['retention', taxStack], ['cno', workCell]]) {
      const cluster = make('div', 'nfe-fact');
      fields[name] = make('strong');
      cluster.append(fields[name]);
      container.append(cluster);
    }
    line.append(taxCell, workCell, orderLinkCell(row, includePdf));
    renderXmlFacts(fields, xmlFacts.get(xmlKey(row)));
    return fields;
  }

  async function loadXmlFacts(candidates, signal, onLoaded) {
    const queue = new Map(candidates.filter(row => row.xmlUrl && !xmlFacts.has(xmlKey(row)))
      .map(row => [xmlKey(row), row]));
    const pending = queue.entries();
    const loadOne = async () => {
      for (const [key, row] of pending) {
        if (signal.aborted) return;
        let facts = null;
        try {
          const blob = await data.downloadDocument(row.xmlUrl, { signal });
          signal.throwIfAborted();
          facts = invoiceXmlFacts(await blob.text(), row, doc.defaultView.DOMParser);
        } catch { /* Leave unavailable XML unclassified. */ }
        if (signal.aborted) return;
        xmlFacts.set(key, facts);
        onLoaded?.(key, facts);
      }
    };
    await Promise.all(Array.from({ length:Math.min(3, queue.size) }, loadOne));
  }

  function candidateRows() {
    const terms = searchKey(search.value.trim()).split(/\s+/).filter(Boolean);
    return (rows || []).filter(row =>
      (!type.value || row.type === type.value) &&
      terms.every(term => searchKey([row.supplier, row.number, row.taxId, row.key, row.taxId.replace(/\D/g, '')].join(' ')).includes(term)));
  }

  function needsFilterXml(row) {
    if (!row.xmlUrl) return false;
    const service = row.type === 'NFS-e';
    const readRetention = service && row.retention !== 'yes';
    const readCno = service && row.cnoState === 'unknown';
    if (retentionFilter.value && !readRetention && row.retention !== retentionFilter.value) return false;
    if (cnoFilter.value && !readCno && row.cnoState !== cnoFilter.value) return false;
    return regimeFilter.value || (retentionFilter.value && readRetention) || (cnoFilter.value && readCno);
  }

  function filteredRows(candidates) {
    if (!retentionFilter.value && !cnoFilter.value && !regimeFilter.value) return candidates;
    return candidates.filter(row => {
      const { regime, retention, cno } = classifyFiscalFacts(row, xmlFacts.get(xmlKey(row)));
      return (!retentionFilter.value || retentionFilter.value === retention) &&
        (!cnoFilter.value || cnoFilter.value === cno) &&
        (!regimeFilter.value || regimeFilter.value === regime ||
          (regimeFilter.value === 'Simples Nacional' && regime.startsWith('Simples Nacional · ')));
    });
  }

  function render() {
    pageRequest?.abort();
    pageRequest = new AbortController();
    const { signal } = pageRequest;
    const candidates = candidateRows();
    const pending = candidates.filter(row => needsFilterXml(row) && !xmlFacts.has(xmlKey(row)));
    if (!pending.length) {
      pageFacts = renderPage(candidates, signal);
      return;
    }
    body.setAttribute('aria-busy', 'true');
    metrics.hidden = table.hidden = pager.hidden = true;
    list.replaceChildren();
    feedback.textContent = 'Consultando XMLs para aplicar os filtros…';
    pageFacts = loadXmlFacts(pending, signal).then(() => {
      if (!signal.aborted) return renderPage(candidates, signal);
    });
  }

  function renderPage(candidates, signal) {
    body.removeAttribute('aria-busy');
    const visible = filteredRows(candidates);
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.min(page, pages);
    metrics.hidden = !rows;
    table.hidden = visible.length === 0;
    pager.hidden = pages === 1;
    metrics.replaceChildren();
    metric('Notas encontradas', String(visible.length));
    const amounts = visible.filter(row => !row.cancelled && row.total !== null);
    const cents = amounts.reduce((sum, row) => sum + Math.round(row.total * 100), 0);
    metric('Valor total sem canceladas', amounts.length ? money.format(cents / 100) : '—');
    metric('Última emissão', visible[0]?.date ? displayDate(visible[0].date) : '—');
    metric('Com XML completo', String(visible.filter(row => row.complete).length));
    if (rows) {
      feedback.textContent = visible.length ? 'Da emissão mais recente para a mais antiga.' : 'Nenhuma nota fiscal encontrada.';
      if (candidates.some(row => needsFilterXml(row) && xmlFacts.get(xmlKey(row)) === null)) {
        feedback.textContent += ' Alguns XMLs estão indisponíveis. Use Atualizar para tentar novamente.';
      }
    }
    const entries = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row => reportRow(row));
    list.replaceChildren(...entries.map(({ line }) => line));
    previous.disabled = page === 1;
    next.disabled = page === pages;
    pageLabel.textContent = `Página ${page} de ${pages}`;
    return loadXmlFacts(entries.map(({ row }) => row), signal, (key, facts) => {
      for (const entry of entries) if (xmlKey(entry.row) === key) renderXmlFacts(entry, facts);
    });
  }

  async function capturePrint(options) {
    if (root.hidden || !rows || picker?.isOpen) throw new Error('Aguarde a consulta das notas fiscais.');
    const { signal } = pageRequest;
    await pageFacts;
    signal.throwIfAborted();
    const visible = filteredRows(candidateRows());
    await loadXmlFacts(visible, signal);
    signal.throwIfAborted();
    const printRows = make('tbody');
    printRows.append(...visible.map(row => reportRow(row, false).line));
    const { scrollTop, scrollLeft } = body;
    list.replaceWith(printRows);
    // Capture the full table once and leave the live page and its XML nodes intact.
    pager.remove();
    try {
      return captureFilteredReport(root, options);
    } finally {
      printRows.replaceWith(list);
      body.append(pager);
      body.scrollTop = scrollTop;
      body.scrollLeft = scrollLeft;
    }
  }

  async function openPdf(row, trigger) {
    if (pdfRequest || !request || request.signal.aborted) return;
    const signal = request.signal, token = pdfRequest = {};
    const isCurrent = () => pdfRequest === token && !signal.aborted;
    const finish = () => { if (isCurrent()) pdfRequest = null; };
    let opened = false;
    trigger.disabled = true;
    pdfFeedback.hidden = true;
    try {
      const attachments = await data.listAttachments(row.id, { signal, refresh:true });
      if (!isCurrent()) return;
      const names = attachments.map(item => item?.fileName).filter(name => typeof name === 'string');
      const main = row.pdfName && names.find(name => name.toLowerCase() === row.pdfName.toLowerCase());
      const corrections = new Map();
      if (row.type === 'NF-e') {
        for (const name of names) {
          const event = /^CCe-([0-9]{6}[A-Z0-9]{12}[0-9]{26})-110110-(0[1-9]|1[0-9]|20)\.pdf$/i.exec(name);
          if (event && event[1].toUpperCase() === row.key && !corrections.has(event[2])) corrections.set(event[2], name);
        }
      }
      const correctionFiles = [...corrections.keys()].sort().map(sequence => corrections.get(sequence));
      const files = main ? [main, ...correctionFiles.filter(name => name.toLowerCase() !== main.toLowerCase())] : correctionFiles;
      if (!files.length) throw new Error('PDF ausente no item fiscal');
      trigger.disabled = false;
      await openMediaCollection(files.map(fileName => ({
        fileName,
        source:options => {
          signal.throwIfAborted();
          return data.downloadAttachment(row.id, fileName, { ...options, signal:options?.signal ?? signal });
        },
      })), { layout:'nfe-report-pdf', signal, onClose:finish, resolveReturnFocus:() => trigger.isConnected ? trigger : closeButton });
      opened = true;
    } catch {
      if (isCurrent()) {
        pdfFeedback.textContent = 'PDF anexado à nota indisponível. Tente novamente.';
        pdfFeedback.hidden = false;
      }
    } finally {
      trigger.disabled = false;
      if (!opened) finish();
    }
  }

  async function load(refreshSource = false) {
    request?.abort();
    request = new AbortController();
    const { signal } = request;
    rows = null;
    xmlFacts.clear();
    pdfRequest = null;
    pdfFeedback.hidden = true;
    root.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    filters.hidden = true;
    feedback.textContent = 'Consultando notas fiscais…';
    render();
    try {
      const snapshot = await data.loadSnapshot({ signal, refresh:refreshSource });
      if (signal.aborted) return;
      rows = projectNfeRows(snapshot.rows);
      render();
    } catch {
      if (!signal.aborted) feedback.textContent = 'Não foi possível consultar as notas fiscais. Use Atualizar para tentar novamente.';
    } finally {
      if (!signal.aborted) {
        root.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
        filters.hidden = !rows;
      }
    }
  }

  function close() {
    if (root.hidden) return;
    proposal?.close();
    picker?.close();
    request?.abort();
    pageRequest?.abort();
    rows = null;
    xmlFacts.clear();
    list.replaceChildren();
    root.hidden = true;
    if (app) app.inert = oldInert;
    doc.body.style.overflow = oldOverflow;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-nfe-report"]');
    target?.focus?.();
    returnFocus = null;
  }

  const applyFilters = () => { page = 1; render(); body.scrollTop = 0; };
  search.addEventListener('input', applyFilters);
  for (const select of selects) select.addEventListener('change', applyFilters);
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (picker?.isOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  return Object.freeze({
    element:root,
    capturePrint,
    async open() {
      if (!root.hidden) return;
      returnFocus = doc.activeElement;
      app = doc.getElementById('app');
      oldInert = app?.inert || false;
      oldOverflow = doc.body.style.overflow;
      if (app) app.inert = true;
      doc.body.style.overflow = 'hidden';
      page = 1;
      search.value = '';
      for (const select of selects) select.value = '';
      root.hidden = false;
      landscape.update();
      body.scrollTop = 0;
      body.scrollLeft = 0;
      closeButton.focus();
      await load();
    },
    close,
    destroy() { close(); landscape.destroy(); root.remove(); },
  });
}
