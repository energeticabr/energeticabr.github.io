import { invoiceSupplierRegime, projectNfeRows } from '../chat/nfe-report-model.js';

const PAGE_SIZE = 12;
const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
const retentionLabels = { yes:'Retenção informada', no:'Sem retenção informada', unknown:'Retenção não confirmada' };
const cnoLabels = { valid:'CNO consta', conflict:'CNO divergente', missing:'CNO não consta', unknown:'CNO não confirmada' };
const searchKey = value => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const displayDate = value => value ? value.split('-').reverse().join('/') : 'Não informada';
const regimeKey = row => `${row.key}|${row.xmlUrl}`;

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
  const root = make('div', 'nfe-report');
  root.hidden = true;
  const panel = make('section', 'nfe-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'nfe-report-title');
  const header = make('header', 'nfe-header');
  const heading = make('div', 'nfe-heading');
  const title = make('h2', '', 'Notas fiscais');
  title.id = 'nfe-report-title';
  heading.append(make('span', 'nfe-kicker', 'PAINEL FISCAL'), title, make('p', '', 'NF-e de produtos e NFS-e de serviços'));
  const actions = make('div', 'nfe-actions');
  const refresh = button('↻', () => void load(true));
  refresh.setAttribute('aria-label', 'Atualizar notas fiscais');
  refresh.title = 'Atualizar notas fiscais';
  const closeButton = button('×', close);
  closeButton.setAttribute('aria-label', 'Fechar notas fiscais');
  actions.append(refresh, closeButton);
  header.append(heading, actions);

  const body = make('div', 'nfe-body');
  const metrics = make('dl', 'nfe-metrics');
  const filters = make('div', 'nfe-filters');
  const search = make('input');
  search.type = 'search';
  search.placeholder = 'Fornecedor, CNPJ ou nota';
  const type = make('select');
  const retention = make('select');
  const cno = make('select');
  for (const [control, label, options] of [
    [search, 'Pesquisar', []],
    [type, 'Documento', [['', 'Todos'], ['NF-e','NF-e'], ['NFS-e','NFS-e']]],
    [retention, 'Retenção no XML', [['','Todas'], ...Object.entries(retentionLabels)]],
    [cno, 'CNO', [['','Todas'], ...Object.entries(cnoLabels)]],
  ]) {
    const field = make('label', '', label);
    for (const [value, name] of options) {
      const option = make('option', '', name);
      option.value = value;
      control.append(option);
    }
    field.append(control);
    filters.append(field);
  }

  const feedback = make('p', 'nfe-feedback');
  feedback.setAttribute('role', 'status');
  const pdfFeedback = make('p', 'nfe-pdf-feedback');
  pdfFeedback.hidden = true;
  pdfFeedback.setAttribute('role', 'status');
  const list = make('div', 'nfe-list');
  const pager = make('footer', 'nfe-pager');
  const previous = button('Anterior', () => changePage(page - 1));
  const next = button('Próxima', () => changePage(page + 1));
  const pageLabel = make('span');
  pager.append(previous, pageLabel, next);
  body.append(metrics, filters, feedback, list, pager);
  panel.append(header, pdfFeedback, body);
  root.append(panel);
  doc.body.append(root);

  let rows = null, page = 1, request, pageRequest, pdfRequest, returnFocus, app, oldInert, oldOverflow;
  const regimes = new Map();

  function changePage(value) {
    page = value;
    render();
    feedback.scrollIntoView?.({ block:'start' });
    (value > 1 && !next.disabled ? next : !previous.disabled ? previous : search).focus({ preventScroll:true });
  }

  function pair(target, label, value, tone = '', detail = '') {
    const entry = make('div', 'nfe-pair');
    if (tone) entry.dataset.tone = tone;
    const description = make('dd', '', value);
    if (detail) description.append(make('small', '', detail));
    entry.append(make('dt', '', label), description);
    target.append(entry);
    return description;
  }

  function card(row) {
    const record = make('article', 'nfe-card');
    record.dataset.invoiceId = row.id;
    const identity = make('div', 'nfe-identity');
    const pdfLabel = row.type === 'NFS-e' ? 'DANFSe' : 'DANFE';
    if (row.pdfName && typeof openMediaCollection === 'function') {
      const pdf = button('PDF', () => void openPdf(row, pdf), 'nfe-pdf');
      pdf.setAttribute('aria-label', `Abrir ${pdfLabel} da nota ${row.number || row.id}`);
      identity.append(pdf);
    } else identity.append(make('span', 'nfe-pdf nfe-pdf--pending', 'PDF pendente'));
    const copy = make('div', 'nfe-supplier');
    const metadata = [row.type, row.number ? `nº ${row.number}` : '', row.cancelled ? 'Cancelada' : !row.complete ? 'XML pendente' : ''].filter(Boolean);
    copy.append(make('span', 'nfe-type', metadata.join(' · ')),
      make('h3', '', row.supplier || 'Razão social não informada'));
    if (row.taxId) copy.append(make('p', '', row.taxId));
    identity.append(copy);

    const facts = make('dl', 'nfe-facts');
    const date = pair(facts, 'Emissão', '');
    const dateText = make(row.date ? 'time' : 'span', '', displayDate(row.date));
    if (row.date) dateText.dateTime = row.date;
    date.append(dateText);
    pair(facts, 'Valor da nota', row.total === null ? 'Não informado' : money.format(row.total));
    const regime = pair(facts, 'Tipo do fornecedor · XML',
      regimes.get(regimeKey(row)) || (row.xmlUrl ? 'Consultando…' : 'Não informado'));
    const retained = row.withholding ? `Pelo comprador · ${money.format(row.withholding.total)}` : '';
    pair(facts, 'Retenção no XML', retentionLabels[row.retention], row.retention === 'yes' ? 'warning' : '', retained);
    const cnoDetail = row.cno.numbers.join(' · ') + (row.cno.corrected && row.cno.numbers.length ? ' · Carta de correção' : '');
    pair(facts, 'Cadastro da obra', cnoLabels[row.cnoState], row.cnoState, cnoDetail);
    record.append(identity, facts);
    list.append(record);
    return { row, regime };
  }

  async function loadRegimes(cards, signal) {
    const queue = cards.filter(({row}) => row.xmlUrl && !regimes.has(regimeKey(row)));
    const loadOne = async () => {
      for (let item = queue.shift(); item && !signal.aborted; item = queue.shift()) {
        const { row, regime } = item;
        try {
          const blob = await data.downloadDocument(row.xmlUrl, { signal });
          signal.throwIfAborted();
          const value = invoiceSupplierRegime(await blob.text(), row, doc.defaultView.DOMParser) || 'Não informado';
          signal.throwIfAborted();
          regimes.set(regimeKey(row), value);
          regime.textContent = value;
        } catch {
          if (!signal.aborted) regime.textContent = 'Consulta indisponível';
        }
      }
    };
    await Promise.all(Array.from({ length:Math.min(3, queue.length) }, loadOne));
  }

  function render() {
    pageRequest?.abort();
    pageRequest = new AbortController();
    list.replaceChildren();
    const terms = searchKey(search.value.trim()).split(/\s+/).filter(Boolean);
    const visible = (rows || []).filter(row =>
      (!type.value || row.type === type.value) && (!retention.value || row.retention === retention.value) &&
      (!cno.value || row.cnoState === cno.value) &&
      terms.every(term => searchKey([row.supplier, row.number, row.taxId, row.key, row.taxId.replace(/\D/g, '')].join(' ')).includes(term)));
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.min(page, pages);
    metrics.hidden = !rows;
    pager.hidden = pages === 1;
    metrics.replaceChildren();
    pair(metrics, 'Notas encontradas', String(visible.length));
    pair(metrics, 'Com retenção no XML', String(visible.filter(row => row.retention === 'yes').length), 'warning');
    pair(metrics, 'Com CNO na nota', String(visible.filter(row => ['valid','conflict'].includes(row.cnoState)).length), 'valid');
    if (rows) feedback.textContent = visible.length ? 'Da emissão mais recente para a mais antiga.' : 'Nenhuma nota fiscal encontrada.';
    const cards = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(card);
    previous.disabled = page === 1;
    next.disabled = page === pages;
    pageLabel.textContent = `Página ${page} de ${pages}`;
    void loadRegimes(cards, pageRequest.signal);
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
        pdfFeedback.textContent = 'Não foi possível abrir o PDF anexado à nota. Tente novamente.';
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
    regimes.clear();
    pdfRequest = null;
    pdfFeedback.hidden = true;
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
    regimes.clear();
    list.replaceChildren();
    root.hidden = true;
    if (app) app.inert = oldInert;
    doc.body.style.overflow = oldOverflow;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-nfe-report"]');
    target?.focus?.();
    returnFocus = null;
  }

  search.addEventListener('input', () => { page = 1; render(); });
  for (const control of [type, retention, cno]) control.addEventListener('change', () => { page = 1; render(); });
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  return Object.freeze({
    element:root,
    async open() {
      if (!root.hidden) return;
      returnFocus = doc.activeElement;
      app = doc.getElementById('app');
      oldInert = app?.inert || false;
      oldOverflow = doc.body.style.overflow;
      if (app) app.inert = true;
      doc.body.style.overflow = 'hidden';
      page = 1;
      search.value = type.value = retention.value = cno.value = '';
      root.hidden = false;
      body.scrollTop = 0;
      closeButton.focus();
      await load();
    },
    close,
    destroy() { close(); root.remove(); },
  });
}
