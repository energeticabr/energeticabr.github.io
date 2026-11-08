import { invoiceXmlFacts, projectNfeRows } from '../chat/nfe-report-model.js';
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
  for (const [control, label, options] of [
    [type, 'Documento', [['', 'Todos'], ['NF-e','NF-e'], ['NFS-e','NFS-e']]],
    [search, 'Pesquisar fornecedor, CNPJ ou nota', []],
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
  pdfFeedback.setAttribute('role', 'status');
  const table = make('table', 'nfe-table');
  table.setAttribute('aria-label', 'Notas fiscais por data de emissão');
  const columns = make('tr');
  for (const label of ['ID', 'Nota fiscal', 'Fornecedor', 'Emissão', 'Valor da nota', 'Tipo do fornecedor · XML', 'Retenção no XML', 'Cadastro da obra']) {
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
    const unavailable = facts === null;
    const pending = facts === undefined && Boolean(row.xmlUrl);
    setValue(regime, facts?.regime || (unavailable ? 'Consulta indisponível' : pending ? 'Consultando…' : 'Não informado'));
    const retained = row.withholding ? `Pelo comprador · ${money.format(row.withholding.total)}` : '';
    let retentionState = row.retention;
    if (facts?.declaresRetention) retentionState = 'yes';
    else if (row.type === 'NFS-e' && retentionState === 'no' && !facts) retentionState = 'unknown';
    setValue(retention, retentionLabels[retentionState], retained);
    retention.parentElement.dataset.tone = retentionState === 'yes' ? 'warning' : '';

    let cnoState = row.cnoState;
    let detail = row.cno.numbers.join(' · ');
    if (detail && row.cno.corrected) detail += ' · Carta de correção';
    if (row.type === 'NFS-e' && cnoState === 'unknown' && facts) {
      const code = facts.workCode;
      const expected = row.cno.expected;
      const isWorkCno = /^[\d.\s/-]+$/.test(code) && code.replace(/\D/g, '') === expected.replace(/\D/g, '');
      cnoState = isWorkCno ? 'valid' : code ? 'workCode' : 'missing';
      detail = isWorkCno ? expected : code;
    }
    setValue(cno, cnoLabels[cnoState], detail);
    cno.parentElement.dataset.tone = cnoState;
  }

  function reportRow(row, includePdf = true) {
    const line = make('tr');
    line.dataset.invoiceId = row.id;
    const id = make('td');
    const identity = make('div', 'nfe-identity');
    identity.append(make('span', 'nfe-id', row.id));
    id.append(identity);
    const pdfLabel = row.type === 'NFS-e' ? 'DANFSe' : 'DANFE';
    if (includePdf && row.pdfName && typeof openMediaCollection === 'function') {
      const label = `Abrir ${pdfLabel} da nota ${row.number || row.id}`;
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
    const supplier = make('td', 'nfe-supplier');
    supplier.append(make('strong', '', row.supplier || 'Razão social não informada'));
    if (row.taxId) supplier.append(make('small', '', row.taxId));
    const date = make('td', 'nfe-date');
    const dateText = make(row.date ? 'time' : 'span', '', displayDate(row.date));
    if (row.date) dateText.dateTime = row.date;
    date.append(dateText);
    const amount = make('td', 'nfe-money', row.total === null ? 'Não informado' : money.format(row.total));
    line.append(id, note, supplier, date, amount);
    const fields = { row, line };
    for (const name of ['regime', 'retention', 'cno']) {
      const cell = make('td');
      const cluster = make('div', 'nfe-fact');
      fields[name] = make('strong');
      cluster.append(fields[name]);
      cell.append(cluster);
      line.append(cell);
    }
    renderXmlFacts(fields, xmlFacts.get(xmlKey(row)));
    return fields;
  }

  async function loadXmlFacts(entries, signal) {
    const queue = entries.filter(({row}) => row.xmlUrl && !xmlFacts.has(xmlKey(row)));
    const loadOne = async () => {
      for (let item = queue.shift(); item && !signal.aborted; item = queue.shift()) {
        const { row } = item;
        try {
          const blob = await data.downloadDocument(row.xmlUrl, { signal });
          signal.throwIfAborted();
          const facts = invoiceXmlFacts(await blob.text(), row, doc.defaultView.DOMParser);
          signal.throwIfAborted();
          xmlFacts.set(xmlKey(row), facts);
          renderXmlFacts(item, facts);
        } catch {
          if (!signal.aborted) renderXmlFacts(item, null);
        }
      }
    };
    await Promise.all(Array.from({ length:Math.min(3, queue.length) }, loadOne));
  }

  function filteredRows() {
    const terms = searchKey(search.value.trim()).split(/\s+/).filter(Boolean);
    return (rows || []).filter(row =>
      (!type.value || row.type === type.value) &&
      terms.every(term => searchKey([row.supplier, row.number, row.taxId, row.key, row.taxId.replace(/\D/g, '')].join(' ')).includes(term)));
  }

  function render() {
    pageRequest?.abort();
    pageRequest = new AbortController();
    const visible = filteredRows();
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
    if (rows) feedback.textContent = visible.length ? 'Da emissão mais recente para a mais antiga.' : 'Nenhuma nota fiscal encontrada.';
    const entries = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(row => reportRow(row));
    list.replaceChildren(...entries.map(({ line }) => line));
    previous.disabled = page === 1;
    next.disabled = page === pages;
    pageLabel.textContent = `Página ${page} de ${pages}`;
    pageFacts = loadXmlFacts(entries, pageRequest.signal);
  }

  async function capturePrint(options) {
    if (root.hidden || !rows) throw new Error('Aguarde a consulta das notas fiscais.');
    const { signal } = pageRequest;
    await pageFacts;
    signal.throwIfAborted();
    const entries = filteredRows().map(row => reportRow(row, false));
    await loadXmlFacts(entries, signal);
    signal.throwIfAborted();
    const printRows = make('tbody');
    printRows.append(...entries.map(({ line }) => line));
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
      const match = attachments.find(item => item.fileName?.toLowerCase() === row.pdfName.toLowerCase());
      if (!match) throw new Error('PDF ausente no item fiscal');
      trigger.disabled = false;
      await openMediaCollection([{
        fileName:match.fileName,
        source:options => {
          signal.throwIfAborted();
          return data.downloadAttachment(row.id, match.fileName, { ...options, signal:options?.signal ?? signal });
        },
      }], { signal, onClose:finish, resolveReturnFocus:() => trigger.isConnected ? trigger : closeButton });
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
  type.addEventListener('change', applyFilters);
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
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
      search.value = type.value = '';
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
