import { bindAutoFilterForm } from './auto-filter-form.js';
import { createGalleryAttachmentCounts, knownGalleryAttachmentCount } from './gallery-attachment-counts.js';

const FILTERS = [
  ['branch', 'Filial'], ['supplier', 'Fornecedor'], ['status', 'Concluído'], ['id', 'ID'],
  ['product', 'Produto'], ['stage', 'Etapa obra'], ['contract', 'Medição'],
  ['pendingApproval', 'Somente pendentes de aprovação'], ['dateStart', 'Data inicial'], ['dateEnd', 'Data final'],
];
const SORTS = ['MAIOR ID', 'MAIOR DATA', 'MAIOR DATA PGTO PREVISTO', 'MAIOR DATA PGTO EFETUADO',
  'CRIADO MAIS RECENTE', 'CRIADO MAIS ANTIGO', 'MODIFICADO MAIS RECENTE', 'MODIFICADO MAIS ANTIGO'];
const TOTALS = [['committed', 'Empenhado'], ['liquidated', 'Liquidado'], ['pending', 'Pendente'], ['paid', 'Pago'], ['total', 'Total']];
const money = value => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const display = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const name of ['LookupValue', 'Value', 'value', 'DisplayName', 'displayName', 'Title', 'title', 'Name', 'name', 'Email', 'email', 'user', 'application']) {
      if (value[name] != null) return display(value[name]);
    }
    return JSON.stringify(value);
  }
  return String(value);
};
const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');
const ATTACHMENT_COLLECTION_KEYS = ['attachments', 'anexos', 'files', 'arquivos', 'attachmentList', 'listaAnexos', 'attachmentFiles', 'attachmentfiles'];
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp', 'tif', 'tiff']);

function attachmentValueEntries(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value.trim() ? [{ fileName: value.trim() }] : []; }
  }
  if (Array.isArray(value)) return value.filter(Boolean).map(entry => typeof entry === 'string' ? { fileName: entry } : entry);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.value)) return attachmentValueEntries(value.value);
    if (Array.isArray(value.results)) return attachmentValueEntries(value.results);
    return [value];
  }
  return [];
}

function attachmentEntries(item) {
  const values = [];
  const sources = [item, item?.fields];
  const names = new Set(ATTACHMENT_COLLECTION_KEYS.map(key));
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (names.has(key(name))) values.push(...attachmentValueEntries(value));
    }
    for (const name of ['firstAttachment', 'primeiroAnexo', 'firstAnexo']) {
      if (source?.[name]) values.push(...attachmentValueEntries(source[name]));
    }
  }
  const unique = new Map();
  for (const entry of values) {
    const identity = `${attachmentFileName(entry)}|${String(entry?.mediaUrl ?? entry?.Value ?? entry?.value ?? '')}`;
    if (!unique.has(identity)) unique.set(identity, entry);
  }
  return [...unique.values()];
}

function attachmentFileName(attachment) {
  return String(attachment?.fileName ?? attachment?.fileNameDisplay ?? attachment?.displayName
    ?? attachment?.DisplayName ?? attachment?.Name ?? attachment?.FileName ?? attachment?.name
    ?? attachment?.file ?? attachment?.caption ?? attachment?.nome ?? '').trim();
}

function attachmentReference(attachment) {
  return String(attachment?.reference ?? attachment?.source ?? attachment?.Value
    ?? attachment?.value ?? attachment?.url ?? attachment?.Link ?? attachment?.AbsoluteUri ?? '').trim();
}

function attachmentKind(attachment) {
  const mimeType = String(attachment?.mimeType ?? attachment?.type ?? '').toLowerCase().split(';')[0];
  const extension = attachmentFileName(attachment).toLowerCase().split('.').at(-1);
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  return null;
}

function recordMedia(item) {
  const attachments = attachmentEntries(item);
  const pdf = attachments.find(attachment => attachmentKind(attachment) === 'pdf');
  if (pdf) return { kind: 'pdf', attachment: pdf };
  const first = attachments[0];
  if (attachmentKind(first) === 'image') return { kind: 'image', attachment: first };
  return attachmentReported(item) ? { kind: 'attachments', attachment: null } : null;
}

function attachmentReported(item) {
  const fields = item?.fields ?? {};
  const read = aliases => Object.entries(fields).find(([name, value]) => aliases.includes(key(name)) && value != null)?.[1];
  const count = read(['QUANTIDADEDEANEXOS', 'QTDANEXOS', 'ANEXOS']);
  const indicator = read(['TEMANEXOS', 'TEMANEXO']);
  return item?.hasAttachments === true || Number(count) > 0
    || (/^(true|sim|yes|1|com anexos)$/i.test(String(indicator ?? '').trim()));
}

function embeddedImageSource(attachment) {
  const source = attachment?.previewUrl ?? attachment?.thumbnailUrl;
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(String(source ?? '')) ? String(source) : '';
}
const DATE_FIELD_PATTERN = /(data|date|criad|modific|modified|pgto|pagamento|liquid|rms|deprecia|venc|entrega|inicio|fim|fatal|alter)/i;

function formatGalleryDate(name, value) {
  if (typeof value !== 'string' || !DATE_FIELD_PATTERN.test(String(name ?? ''))) return null;
  const raw = value.trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(instant);
}

function clusterKey(value) {
  if (Array.isArray(value)) return clusterKey(value[0]);
  if (value && typeof value === 'object') {
    for (const name of ['LookupValue', 'Value', 'value', 'ID', 'Id', 'id', 'Title', 'title']) {
      if (value[name] != null) return clusterKey(value[name]);
    }
    return '';
  }
  return String(value ?? '').trim().replace(/^#\s*/, '').replace(/\s+/g, '').toLocaleUpperCase('pt-BR');
}

function numericAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let raw = String(value ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '').replace(/[^\d,.-]/g, '');
  if (!raw) return null;
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

function personDisplayName(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    for (const name of ['user', 'application', 'LookupValue', 'DisplayName', 'displayName', 'Title', 'title', 'Name', 'name', 'Email', 'email']) {
      if (value[name] != null) {
        const resolved = personDisplayName(value[name]);
        if (resolved) return resolved;
      }
    }
    return '';
  }
  const raw = String(value).trim();
  return /^\d+$/.test(raw) ? '' : raw;
}

/**
 * Standalone body overlay. The integrator loads launch-gallery.css and supplies
 * naked service results. openMedia may settle as soon as its top-layer dialog
 * loads; captureSignature settles with a File or null after capture/cancel.
 * Nothing here owns the chat, the viewer, or the signature canvas.
 */
export function createLaunchGallery({ document: documentRef = globalThis.document,
  request, upload, openMedia, openMediaCollection, loadMediaPreview, loadOrderSnapshot,
  captureSignature, onClose, onHome, clusterTimeoutMs = 30_000 } = {}) {
  if (!documentRef?.body || typeof request !== 'function') throw new TypeError('Documento e request são obrigatórios.');
  const doc = documentRef;
  let opened = false, destroyed = false, suspended = false, busy = false;
  let session = 0, listVersion = 0, detailVersion = 0;
  let listLoading = false, detailLoading = false, returnFocus;
  let current = null, selectedId = null, editor = null, review = null, attachmentIndex = 0;
  let page = 1, pages = 0, needsDetailRefresh = false;
  let clusterVersion = 0, clusterReturnFocus = null, clusterAbortController = null, clusterTimer = null;
  let allLaunchRowsCache = null, allLaunchRowsRequest = null;
  let allLaunchRowsGeneration = 0;
  const retryIds = new Map();
  const selectedUploads = new Map();
  const filterControls = new Map();

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, { locked = true, disabled = false, danger = false } = {}) {
    const node = element('button', `lg-button${danger ? ' lg-danger' : ''}`, text);
    node.type = 'button';
    if (locked) node.dataset.lgLock = 'true';
    node.dataset.lgDisabled = String(disabled);
    node.disabled = disabled || (locked && busy);
    node.addEventListener('click', () => {
      if (!opened || destroyed || node.disabled || (locked && busy)) return;
      action();
    });
    return node;
  }
  function label(text, control) {
    const node = element('label', control.type === 'checkbox' ? 'lg-field lg-check' : 'lg-field');
    node.append(element('span', 'lg-label', text), control);
    return node;
  }
  function option(value, text = value) {
    const node = element('option', '', display(text));
    node.value = display(value);
    return node;
  }
  function setOptions(select, values, placeholder, preserveUnknown = true) {
    const value = select.value;
    const options = values.map(item => typeof item === 'object' && item !== null
      ? option(item.value, item.label ?? item.value) : option(item));
    if (placeholder) options.unshift(option('', placeholder));
    // A response may describe older filters. Never erase an in-progress choice.
    if (preserveUnknown && value && !options.some(item => item.value === value)) options.push(option(value));
    select.replaceChildren(...options);
    if (value) select.value = value;
  }
  function field(fields, ...aliases) {
    const wanted = new Set(aliases.map(key));
    for (const [name, value] of Object.entries(fields ?? {})) {
      if (!wanted.has(key(name)) || value == null || display(value).trim() === '') continue;
      return value;
    }
    return undefined;
  }
  function summaryField(labelText, value, className = '') {
    if (value == null || display(value).trim() === '') return null;
    const pair = element('div', `lg-record-field${className ? ` ${className}` : ''}`);
    pair.append(element('span', 'lg-record-label', labelText), element('span', 'lg-record-value', fieldText(labelText, value)));
    return pair;
  }
  function creatorName(item) {
    const fields = item?.fields ?? {};
    const names = [
      field(fields, 'CRIADO POR', 'CREATED BY', 'AUTHOR', 'ADICIONADO POR LOOKUP VALUE', 'CRIADO POR LOOKUP VALUE', 'AUTHOR LOOKUP VALUE'),
      item?.createdBy,
      item?.author,
      item?.Author,
      field(fields, 'ADICIONADO POR'),
    ].map(personDisplayName).filter(Boolean);
    if (names.length) return names[0];
    const raw = field(fields, 'ADICIONADO POR', 'CRIADO POR', 'CREATED BY', 'AUTHOR');
    return raw != null && /^\s*\d+\s*$/.test(String(raw)) ? 'Usuário não identificado' : personDisplayName(raw);
  }
  function displayFields(item) {
    const fields = { ...(item?.fields ?? {}) };
    const creator = creatorName(item);
    const creatorKeys = new Set(['ADICIONADOPOR', 'CRIADOPOR', 'CREATEDBY', 'AUTHOR']);
    let hasCreatorField = false;
    for (const name of Object.keys(fields)) {
      if (!creatorKeys.has(key(name))) continue;
      fields[name] = creator;
      hasCreatorField = true;
    }
    if (!hasCreatorField && creator) fields['ADICIONADO POR'] = creator;
    return fields;
  }
  function notify(text, error = false) {
    notice.textContent = text;
    notice.hidden = !text;
    notice.setAttribute('role', error ? 'alert' : 'status');
    notice.classList.toggle('lg-error', error);
    if (error && opened && !suspended) notice.scrollIntoView?.({ block: 'nearest' });
  }
  function failure(error, context) {
    return `${context}: ${error?.message || 'não foi possível concluir'}. Tente novamente; se persistir, confira a conexão e atualize os dados.`;
  }
  function updateBusy() {
    root.setAttribute('aria-busy', String(opened && (listLoading || detailLoading || busy)));
    for (const control of root.querySelectorAll('[data-lg-lock]')) {
      control.disabled = busy || control.dataset.lgDisabled === 'true';
    }
    previous.disabled = listLoading || page <= 1;
    next.disabled = listLoading || page >= pages;
  }
  function active(epoch) { return opened && !destroyed && epoch === session; }
  function focus(node) { if (opened && !suspended && node?.isConnected) node.focus({ preventScroll: true }); }
  function reveal(node) { if (opened && !suspended) { node?.scrollIntoView?.({ block: 'start' }); focus(node); } }

  const root = element('section', 'lg-overlay');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Galeria lançamentos');
  root.setAttribute('aria-busy', 'false');
  root.tabIndex = -1;
  const header = element('header', 'lg-header');
  const back = button('Voltar', close, { locked: false });
  header.append(back, element('h1', 'lg-title', 'Galeria lançamentos'), button('Início', () => {
    close(); onHome?.();
  }, { locked: false }));
  const content = element('div', 'lg-content');
  const filterDisclosure = element('details', 'lg-filters');
  filterDisclosure.append(element('summary', 'lg-filter-toggle', 'Filtros e ordenação'));
  const filterForm = element('form', 'lg-filter-form');
  filterForm.setAttribute('aria-label', 'Filtros de lançamentos');
  const filterGrid = element('div', 'lg-filter-grid');
  for (const [name, title] of FILTERS) {
    const control = element(['id', 'pendingApproval', 'dateStart', 'dateEnd'].includes(name) ? 'input' : 'select', 'lg-input');
    control.name = name;
    if (control.tagName === 'INPUT') control.type = name === 'pendingApproval' ? 'checkbox' : name.startsWith('date') ? 'date' : 'text';
    else setOptions(control, [], 'Todos');
    filterControls.set(name, control);
    filterGrid.append(label(title, control));
  }
  const sort = element('select', 'lg-input'); sort.name = 'sort'; setOptions(sort, SORTS);
  filterGrid.append(label('Ordenação', sort));
  const filterActions = element('div', 'lg-actions');
  filterActions.append(button('Limpar filtros', () => {
    for (const control of filterControls.values()) { control.value = ''; control.checked = false; }
    sort.selectedIndex = 0; autoFilters.apply();
  }, { locked: false }));
  filterForm.append(filterGrid,
    element('p', 'lg-hint', 'Período de empenho: as datas inicial e final são incluídas.'), filterActions);
  const autoFilters = bindAutoFilterForm(filterForm, applyFilters);
  const totals = element('dl', 'lg-totals');
  const notice = element('p', 'lg-notice'); notice.hidden = true;
  const listStatus = element('div', 'lg-list-status'); listStatus.setAttribute('aria-live', 'polite');
  const cards = element('div', 'lg-cards'); cards.setAttribute('aria-label', 'Lançamentos');
  const pagination = element('nav', 'lg-pagination'); pagination.setAttribute('aria-label', 'Páginas de lançamentos');
  const previous = button('Página anterior', () => loadSnapshot({ ...applied, page: page - 1 }), { locked: false, disabled: true });
  const next = button('Próxima página', () => loadSnapshot({ ...applied, page: page + 1 }), { locked: false, disabled: true });
  const pageLabel = element('span', 'lg-page-label');
  pagination.append(previous, pageLabel, next);
  const panel = element('section', 'lg-detail lg-detail-modal'); panel.hidden = true; panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Detalhes do lançamento');
  const clusterPanel = element('section', 'lg-detail lg-detail-modal lg-cluster-modal'); clusterPanel.hidden = true; clusterPanel.tabIndex = -1;
  clusterPanel.setAttribute('role', 'dialog'); clusterPanel.setAttribute('aria-modal', 'true');
  clusterPanel.setAttribute('aria-label', 'Detalhes do agrupamento');
  const reviewHost = element('section', 'lg-review'); reviewHost.hidden = true;
  reviewHost.setAttribute('aria-label', 'Revisão e confirmação'); reviewHost.tabIndex = -1;
  filterDisclosure.append(filterForm);
  content.append(filterDisclosure, totals, notice, listStatus, cards, pagination);
  root.append(header, content, panel, clusterPanel);
  doc.body.append(root);
  const attachmentCounts = createGalleryAttachmentCounts({
    loadAttachments: async item => {
      const result = await request('detail', { id: item.id });
      return attachmentDescriptors(item, result);
    },
    onChange: updateAttachmentCount,
  });

  function updateAttachmentCount(item) {
    if (!active(session)) return;
    const card = [...cards.children].find(node => String(node.dataset.itemId) === String(item.id));
    const count = card?.querySelector('.lg-record-attachment-count');
    const label = attachmentCounts.label(item);
    if (count) count.textContent = label;
    const media = card?.querySelector('.lg-record-media');
    if (media) media.setAttribute('aria-label', `${media.dataset.mediaKind === 'pdf' ? 'Abrir PDF e anexos' : 'Abrir anexos'} do lançamento: ${label}`);
  }
  let applied = query(1);

  function query(targetPage) {
    return { filters: Object.fromEntries([...filterControls].map(([name, control]) =>
      [name, control.type === 'checkbox' ? control.checked : control.value])), sort: sort.value, page: targetPage, pageSize: 20 };
  }
  function applyFilters() {
    const data = query(1);
    if (data.filters.dateStart && data.filters.dateEnd && data.filters.dateStart > data.filters.dateEnd) {
      notify('A data final deve ser igual ou posterior à data inicial.', true); return;
    }
    notify(''); loadSnapshot(data);
  }
  async function loadSnapshot(data = applied) {
    if (!opened || destroyed) return;
    allLaunchRowsGeneration += 1;
    allLaunchRowsCache = null;
    allLaunchRowsRequest = null;
    attachmentCounts.reset();
    const version = ++listVersion, epoch = session;
    applied = { ...data, filters: { ...data.filters } };
    listLoading = true; listStatus.replaceChildren(element('p', 'lg-hint', 'Carregando lançamentos…')); updateBusy();
    try {
      const result = await request('snapshot', { ...data, filters: { ...data.filters } });
      if (!active(epoch) || version !== listVersion) return;
      if (!Array.isArray(result?.rows)) throw new Error('Resposta de lançamentos inválida');
      page = result.page ?? data.page; pages = result.pages ?? 1;
      totals.replaceChildren(...TOTALS.map(([totalKey, title]) => {
        const pair = element('div', `lg-total lg-total-${totalKey}`);
        const count = result.totals?.[`${totalKey}Count`] ?? result.totals?.[`${totalKey}Quantity`];
        const value = element('dd', 'lg-total-value');
        if (count != null) value.append(element('span', 'lg-total-count', display(count)), doc.createTextNode(' '),
          element('span', 'lg-total-money', money(result.totals?.[totalKey])));
        else value.append(element('span', 'lg-total-money', money(result.totals?.[totalKey])));
        pair.append(element('dt', '', title), value); return pair;
      }));
      for (const [name, options] of Object.entries(result.filterOptions ?? {})) {
        const control = filterControls.get(name);
        if (control?.tagName === 'SELECT' && Array.isArray(options)) setOptions(control, options, 'Todos');
      }
      if (result.sortOptions?.length) setOptions(sort, result.sortOptions);
      cards.replaceChildren(...result.rows.map(renderCard));
      void attachmentCounts.request(result.rows.filter(item => recordMedia(item)));
      listStatus.replaceChildren(element('p', 'lg-hint', result.rows.length ? `${result.count ?? result.rows.length} lançamento(s)` : 'Nenhum lançamento encontrado para estes filtros.'));
      pageLabel.textContent = `Página ${pages ? page : 0} de ${pages}`;
    } catch (error) {
      if (!active(epoch) || version !== listVersion) return;
      listStatus.replaceChildren(element('p', 'lg-error', failure(error, 'Erro ao carregar lançamentos')),
        button('Tentar novamente', () => loadSnapshot(data), { locked: false }));
    } finally {
      if (active(epoch) && version === listVersion) { listLoading = false; updateBusy(); }
    }
  }

  // Parse in an inert document, walk only text, and never attach parsed nodes.
  // Block boundaries remain readable (including HTML tables from G1).
  function descriptionText(value) {
    const Parser = doc.defaultView?.DOMParser ?? globalThis.DOMParser;
    if (!Parser) return display(value);
    const parsed = new Parser().parseFromString(display(value), 'text/html');
    function walk(node) {
      if (node.nodeType === 3) return node.textContent;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(node.nodeName)) return '';
      const text = [...node.childNodes].map(walk).join('');
      return text + (/^(P|DIV|BR|LI|TR|H[1-6]|SECTION)$/.test(node.nodeName) ? '\n' : /^(TD|TH)$/.test(node.nodeName) ? ' ' : '');
    }
    return walk(parsed.body).replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function fieldText(name, value) {
    if (/^DESCRI[ÇC][ÃA]O$/i.test(name)) return descriptionText(value);
    if (name === 'ASSINATURA') return value ? 'Assinatura registrada' : 'Sem assinatura';
    const date = formatGalleryDate(name, value);
    if (date) return date;
    return display(value) || '—';
  }
  function fieldList(fields) {
    const list = element('dl', 'lg-fields');
    for (const [name, value] of Object.entries(fields ?? {})) {
      const pair = element('div', 'lg-field-value');
      pair.append(element('dt', '', name), element('dd', '', fieldText(name, value))); list.append(pair);
    }
    return list;
  }
  function renderRecordMedia(item) {
    const media = recordMedia(item);
    if (!media) return null;
    const host = element('button', 'lg-record-media');
    host.type = 'button';
    host.dataset.lgLock = 'true';
    host.dataset.mediaKind = media.kind;
    host.dataset.itemId = String(item.id);
    const fileName = attachmentFileName(media.attachment);
    host.setAttribute('aria-label', media.kind === 'pdf' ? `Abrir ${fileName || 'arquivo PDF'}`
      : media.kind === 'image' ? `Abrir ${fileName || 'primeiro anexo'}` : 'Abrir anexos do lançamento');
    host.addEventListener('click', () => { if (canChangeDetail()) openRecordAttachments(item); });
    const knownCount = knownGalleryAttachmentCount(item);
    const countLabel = knownCount == null ? attachmentCounts.label(item)
      : `${display(knownCount)} ${Number(knownCount) === 1 ? 'anexo' : 'anexos'}`;
    if (media.kind === 'pdf') {
      host.append(element('span', 'lg-record-pdf-icon', 'PDF'),
        element('span', 'lg-record-media-label', 'ANEXOS'),
        element('span', 'lg-record-attachment-count', countLabel));
      return host;
    }
    if (media.kind === 'attachments') {
      host.append(element('span', 'lg-record-attachment-icon', '📎'),
        element('span', 'lg-record-media-label', 'ANEXOS'),
        element('span', 'lg-record-attachment-count', countLabel));
      return host;
    }
    const image = element('img', 'lg-record-preview');
    image.alt = `Prévia de ${attachmentFileName(media.attachment) || 'imagem anexada'}`;
    const embedded = embeddedImageSource(media.attachment);
    if (embedded) image.src = embedded;
    else if (typeof loadMediaPreview === 'function' && fileName) {
      const expectedSession = session;
      Promise.resolve().then(async () => {
        if (media.attachment?.mediaUrl) return media.attachment;
        const reference = attachmentReference(media.attachment);
        return request('attachment', { id: item.id, fileName, ...(reference ? { source: reference } : {}) });
      }).then(descriptor => loadMediaPreview(descriptor)).then(result => {
        const source = typeof result === 'string' ? result : result?.url;
        if (!source || !active(expectedSession) || !host.isConnected) return;
        image.src = source;
        host.classList.add('lg-record-media-loaded');
      }).catch(() => host.classList.add('lg-record-media-unavailable'));
    } else host.classList.add('lg-record-media-unavailable');
    host.append(image, element('span', 'lg-record-attachment-icon', '📎'),
      element('span', 'lg-record-media-label', 'ANEXOS'),
      element('span', 'lg-record-attachment-count', countLabel));
    return host;
  }
  function attachmentDescriptors(item, result) {
    const fromRow = attachmentEntries(item);
    if (fromRow.length) return fromRow;
    return attachmentValueEntries(result?.attachments ?? result?.item?.attachments
      ?? result?.item?.fields?.Anexos ?? result?.item?.fields?.ANEXOS);
  }
  function mediaDescriptor(item, attachment, resolved = {}) {
    const source = { ...(attachment && typeof attachment === 'object' ? attachment : {}),
      ...(resolved && typeof resolved === 'object' ? resolved : {}) };
    const fileName = attachmentFileName(source);
    const descriptor = { id: item.id, fileName };
    const mediaUrl = source.mediaUrl ?? source.mediaURL ?? source.downloadUrl ?? source.url;
    if (mediaUrl != null && display(mediaUrl).trim() !== '') descriptor.mediaUrl = mediaUrl;
    for (const name of ['mimeType', 'size', 'type', 'previewUrl', 'thumbnailUrl']) {
      if (source[name] != null && display(source[name]).trim() !== '') descriptor[name] = source[name];
    }
    return descriptor;
  }
  async function resolveMediaDescriptor(item, attachment, epoch) {
    const fileName = attachmentFileName(attachment);
    if (!fileName) return null;
    // Snapshot/detail rows already coming from the authenticated media endpoint
    // can be passed straight through. PowerApps attachment rows usually expose
    // only DisplayName/Value, so resolve those names through the read-only
    // attachment endpoint before handing them to the native viewer.
    if (attachment?.mediaUrl) return mediaDescriptor(item, attachment);
    const reference = attachmentReference(attachment);
    const result = await request('attachment', { id: item.id, fileName,
      ...(reference ? { source: reference } : {}) });
    if (!active(epoch)) return null;
    const resolved = result?.attachment ?? result?.item ?? result;
    const descriptor = mediaDescriptor(item, attachment, resolved);
    if (!descriptor.mediaUrl) throw new Error(`O arquivo ${fileName} não está disponível para visualização`);
    return descriptor;
  }
  function openRecordAttachments(item) {
    external(async epoch => {
      let attachments = attachmentEntries(item);
      if (!attachments.length) attachments = await attachmentCounts.load(item, { force: true });
      if (attachments == null) throw new Error('Não foi possível consultar os anexos do lançamento');
      const descriptors = [];
      for (const attachment of attachments) {
        const descriptor = await resolveMediaDescriptor(item, attachment, epoch);
        if (descriptor?.fileName && descriptor.mediaUrl) descriptors.push(descriptor);
      }
      if (!active(epoch)) return;
      if (!descriptors.length) {
        notify('Nenhum anexo disponível para este lançamento.', true);
        return;
      }
      suspended = true; root.hidden = true;
      if (typeof openMediaCollection === 'function') await openMediaCollection(descriptors);
      else if (typeof openMedia === 'function') await openMedia({ ...attachments[0], ...descriptors[0] });
      else throw new Error('Visualizador de anexos indisponível');
    });
  }
  function fieldTable(fields) {
    const table = element('table', 'lg-data-table');
    const body = element('tbody');
    for (const [name, value] of Object.entries(fields ?? {})) {
      const row = element('tr');
      row.append(element('th', '', name), element('td', '', fieldText(name, value)));
      body.append(row);
    }
    table.append(body);
    return table;
  }
  function clusterAction(labelText, value, kind) {
    if (value == null || display(value).trim() === '') return summaryField(labelText, value);
    const pair = element('div', `lg-record-field${kind === 'supplier' ? ' lg-record-supplier' : ' lg-record-order'}`);
    const trigger = button(display(value), () => {
      if (!canChangeDetail()) return;
      void openCluster(kind, value);
    });
    trigger.classList.add('lg-cluster-trigger', 'lg-record-value');
    trigger.dataset.clusterKind = kind;
    trigger.setAttribute('aria-label', `${kind === 'supplier' ? 'Ver lançamentos do fornecedor' : 'Ver pedido agrupado'}: ${display(value)}`);
    pair.append(element('span', 'lg-record-label', labelText), trigger);
    return pair;
  }
  async function fetchLaunchRows(filters = {}, { signal } = {}) {
    const rowsById = new Map();
    let pagesToLoad = 1;
    const pageSize = 100;
    for (let targetPage = 1; targetPage <= pagesToLoad; targetPage += 1) {
      if (targetPage > 100) throw new Error('A consulta ultrapassou o limite seguro de páginas.');
      const result = await request('snapshot', { filters, sort: SORTS[0], page: targetPage, pageSize }, { signal });
      if (!Array.isArray(result?.rows)) throw new Error('Resposta de lançamentos inválida');
      for (const item of result.rows) {
        const id = String(item?.id ?? field(item?.fields, 'ID') ?? '').trim();
        if (id) rowsById.set(id, item);
      }
      const reportedPages = Number(result.pages);
      if (Number.isFinite(reportedPages) && reportedPages > 100) throw new Error('A consulta ultrapassou o limite seguro de páginas.');
      pagesToLoad = Number.isFinite(reportedPages) && reportedPages > 0
        ? Math.max(pagesToLoad, Math.min(100, Math.trunc(reportedPages)))
        : result.rows.length >= pageSize ? targetPage + 1 : targetPage;
      if (targetPage >= pagesToLoad) break;
    }
    return [...rowsById.values()];
  }
  function fetchAllLaunchRows({ signal } = {}) {
    if (allLaunchRowsCache) return Promise.resolve(allLaunchRowsCache);
    if (allLaunchRowsRequest) return allLaunchRowsRequest;
    const generation = allLaunchRowsGeneration;
    let requestPromise;
    requestPromise = fetchLaunchRows({}, { signal }).then(rows => {
      if (generation === allLaunchRowsGeneration) allLaunchRowsCache = rows;
      return rows;
    }).finally(() => { if (allLaunchRowsRequest === requestPromise) allLaunchRowsRequest = null; });
    allLaunchRowsRequest = requestPromise;
    return requestPromise;
  }
  function amountFor(item) {
    return numericAmount(field(item?.fields, 'VALOR TOTAL', 'TOTAL') ?? item?.total);
  }
  function summarizeLaunchAmounts(rows) {
    let total = 0, missing = 0;
    for (const item of rows) {
      const amount = amountFor(item);
      if (amount == null) missing += 1;
      else total += amount;
    }
    return { total, missing };
  }
  function launchTable(rows, mode, orderId = '') {
    const table = element('table', 'lg-data-table lg-cluster-table');
    const headers = mode === 'order'
      ? ['ID', 'Data', 'Fornecedor', 'Forma pgto', 'Produto (descrição)', 'Qtd', 'Valor unitário', 'Frete', 'Valor total', 'Valor acumulado', 'Status']
      : ['ID', 'Data', 'Produto', 'AGRUPAR', 'Filial', 'Qtd', 'Valor unitário', 'Frete', 'Valor total', 'Status'];
    const head = element('thead'), heading = element('tr');
    for (const title of headers) heading.append(element('th', '', title));
    head.append(heading);
    const body = element('tbody');
    let accumulated = 0, accumulatedComplete = true;
    for (const item of rows) {
      const fields = item.fields ?? {};
      const amount = amountFor(item);
      if (amount != null) accumulated += amount;
      else accumulatedComplete = false;
      const date = field(fields, 'DATA DE COMPRA', 'DATA', 'DATA PGTO EFETUADO');
      const quantity = field(fields, 'QUANTIDADE', 'QTD');
      const unit = field(fields, 'UNIDADE', 'UN');
      const quantityLabel = [quantity, unit].filter(value => value != null && display(value).trim()).map(display).join(' ');
      const cells = mode === 'order'
        ? [item.id, fieldText('DATA', date) || '—', field(fields, 'FORNECEDOR') ?? '—',
          field(fields, 'FORMAPGTO', 'FORMA PGTO', 'FORMA DE PAGAMENTO') ?? '—',
          field(fields, 'PRODUTO', 'DESCRIÇÃO', 'DESCRICAO') ?? '—', quantityLabel || '—',
          fieldText('VALOR UNITÁRIO', field(fields, 'VALOR UNITÁRIO', 'VALOR UNITARIO')) || '—',
          fieldText('FRETE', field(fields, 'FRETE')) || '—', amount == null ? fieldText('VALOR TOTAL', field(fields, 'VALOR TOTAL')) || '—' : money(amount),
          accumulatedComplete ? money(accumulated) : '—', field(fields, 'CONCLUÍDO', 'STATUS') ?? '—']
        : [item.id, fieldText('DATA', date) || '—', field(fields, 'PRODUTO', 'DESCRIÇÃO', 'DESCRICAO') ?? '—',
          field(fields, 'AGRUPAR') ?? '—', field(fields, 'FILIAL') ?? '—', quantityLabel || '—',
          fieldText('VALOR UNITÁRIO', field(fields, 'VALOR UNITÁRIO', 'VALOR UNITARIO')) || '—',
          fieldText('FRETE', field(fields, 'FRETE')) || '—', amount == null ? fieldText('VALOR TOTAL', field(fields, 'VALOR TOTAL')) || '—' : money(amount),
          field(fields, 'CONCLUÍDO', 'STATUS') ?? '—'];
      const rowNode = element('tr');
      rowNode.dataset.launchId = String(item.id);
      for (const value of cells) rowNode.append(element('td', '', display(value)));
      body.append(rowNode);
    }
    table.append(head, body);
    const wrapper = element('div', 'lg-cluster-table-wrap');
    wrapper.append(table);
    const totals = element('div', 'lg-cluster-summary');
    const amounts = summarizeLaunchAmounts(rows);
    const totalLabel = amounts.missing ? `Total incompleto · parcial ${money(amounts.total)}` : money(amounts.total);
    const countLabel = `${rows.length} lançamento(s)${amounts.missing ? ` · ${amounts.missing} sem valor total` : ''}`;
    totals.append(element('span', '', countLabel), element('strong', '', totalLabel));
    if (mode === 'order' && orderId) totals.setAttribute('aria-label', `Total dos lançamentos do pedido ${orderId}: ${totalLabel}`);
    return { table: wrapper, totals, ...amounts };
  }
  function renderOrderHeader(order, orderId, launches) {
    const fields = order?.fields ?? {};
    const overview = element('section', 'lg-order-overview');
    overview.append(element('h3', 'lg-order-overview-title', 'CABEÇALHO DO PEDIDO'));
    const grid = element('div', 'lg-order-overview-grid');
    const entries = [
      ['ID', order?.id ?? orderId, 'id'],
      ['DATA PGTO EFETUADO', field(fields, 'DATAPGTOEFETUADO', 'DATA PGTO EFETUADO') || 'EM BRANCO', 'warning'],
      ['FILIAL', field(fields, 'FILIAL') || 'EM BRANCO', ''],
      ['FORNECEDOR', field(fields, 'FORNECEDOR') || 'EM BRANCO', ''],
      ['FORMA PGTO', field(fields, 'FORMAPGTO', 'FORMA PGTO', 'FORMA DE PAGAMENTO') || 'EM BRANCO', ''],
      ['VALOR TOTAL', field(fields, 'VALORTOTAL', 'VALOR TOTAL') ?? 'EM BRANCO', ''],
      ['OBS', field(fields, 'OBS') || 'SEM OBS', 'warning'],
      ['NOTA FISCAL', field(fields, 'NOTA FISCAL') || 'PENDENTE', 'warning'],
      ['OBS FISCAL', field(fields, 'OBS FISCAL') || 'EM BRANCO', 'warning'],
      ['STATUS', field(fields, 'STATUS') || 'EM BRANCO', 'warning'],
    ];
    for (const [name, value, tone] of entries) {
      const tile = element('div', `lg-order-overview-tile${tone ? ` lg-order-overview-${tone}` : ''}`);
      const formatted = name === 'VALOR TOTAL' && numericAmount(value) != null
        ? money(numericAmount(value)) : fieldText(name, value);
      tile.append(element('span', '', name), element('strong', '', formatted));
      grid.append(tile);
    }
    overview.append(grid);
    const expected = numericAmount(field(fields, 'VALORTOTAL', 'VALOR TOTAL'));
    const amounts = summarizeLaunchAmounts(launches);
    const actual = amounts.total;
    const difference = expected == null || !launches.length || amounts.missing ? null : expected - actual;
    const reconciled = difference != null && Math.abs(difference) < 0.005;
    const reconcile = element('div', `lg-order-reconcile${reconciled ? ' lg-order-reconcile-ok' : ''}`);
    const statusText = !launches.length ? 'Não foi possível comparar: o pedido não possui lançamentos vinculados.'
      : amounts.missing ? `Não foi possível comparar: ${amounts.missing} lançamento(s) sem valor total.`
        : expected == null ? 'Não foi possível comparar: o pedido não informa o valor total.'
      : reconciled ? 'Valores conferem.' : `Diferença de ${money(difference)} entre pedido e lançamentos.`;
    reconcile.append(element('strong', '', statusText),
      element('span', '', `Valor do pedido: ${expected == null ? '—' : money(expected)} · Soma dos lançamentos: ${amounts.missing ? `incompleta (parcial ${money(actual)})` : money(actual)}`));
    return { overview, reconcile };
  }
  function cancelClusterLoad() {
    if (clusterTimer != null) clearTimeout(clusterTimer);
    clusterTimer = null;
    if (clusterAbortController) {
      clusterAbortController.abort();
      clusterAbortController = null;
      if (allLaunchRowsRequest) { allLaunchRowsGeneration += 1; allLaunchRowsRequest = null; }
    }
  }
  async function openCluster(kind, value) {
    if (!opened || destroyed || !canChangeDetail()) return;
    cancelClusterLoad();
    const controller = new AbortController();
    const signal = controller.signal;
    clusterAbortController = controller;
    if (clusterPanel.hidden) clusterReturnFocus = doc.activeElement;
    const epoch = session, version = ++clusterVersion;
    const rawValue = String(value ?? '').trim();
    clusterPanel.hidden = false;
    clusterPanel.setAttribute('aria-busy', 'true');
    const title = kind === 'supplier' ? `Lançamentos do fornecedor ${display(value)}` : `Pedido agrupado #${display(value)}`;
    const closeButton = button('Fechar', closeCluster, { locked: false });
    closeButton.classList.add('lg-detail-close');
    clusterPanel.replaceChildren(element('div', 'lg-detail-header', ''), element('p', 'lg-hint', 'Carregando informações…'));
    const heading = element('h2', 'lg-section-title', title);
    clusterPanel.querySelector('.lg-detail-header').replaceChildren(heading, closeButton);
    focus(closeButton);
    const timeout = Math.max(1, Number(clusterTimeoutMs) || 30_000);
    clusterTimer = setTimeout(() => {
      if (!active(epoch) || version !== clusterVersion || clusterPanel.hidden) return;
      controller.abort();
      clusterAbortController = null;
      clusterTimer = null;
      if (allLaunchRowsRequest) { allLaunchRowsGeneration += 1; allLaunchRowsRequest = null; }
      clusterVersion += 1;
      clusterPanel.setAttribute('aria-busy', 'false');
      const retry = button('Tentar novamente', () => { void openCluster(kind, value); }, { locked: false });
      clusterPanel.replaceChildren(clusterPanel.querySelector('.lg-detail-header'),
        element('p', 'lg-error', 'A consulta demorou mais que o esperado. Verifique a conexão e tente novamente.'), retry);
      focus(retry);
    }, timeout);
    try {
      if (kind === 'supplier') {
        const results = await fetchLaunchRows({ supplier: rawValue }, { signal });
        if (!active(epoch) || version !== clusterVersion || clusterPanel.hidden) return;
        const supplierRows = results.filter(item => clusterKey(field(item.fields, 'FORNECEDOR')) === clusterKey(rawValue));
        const listing = launchTable(supplierRows, 'supplier');
        const introduction = element('p', 'lg-cluster-intro', `Todos os lançamentos de ${display(value)} encontrados na galeria.`);
        const content = supplierRows.length ? [introduction, listing.table, listing.totals]
          : [introduction, element('p', 'lg-hint', 'Nenhum lançamento encontrado para este fornecedor.')];
        clusterPanel.replaceChildren(clusterPanel.querySelector('.lg-detail-header'), ...content);
      } else {
        if (!rawValue || !clusterKey(rawValue)) throw new Error('O valor de AGRUPAR não identifica um pedido válido.');
        if (typeof loadOrderSnapshot !== 'function') throw new Error('A consulta de pedidos do SharePoint não está disponível nesta sessão.');
        const [orders, launchRows] = await Promise.all([loadOrderSnapshot({ signal }), fetchAllLaunchRows({ signal })]);
        if (!active(epoch) || version !== clusterVersion || clusterPanel.hidden) return;
        if (!Array.isArray(orders?.rows)) throw new Error('O SharePoint não devolveu os pedidos.');
        const order = orders.rows.find(item => clusterKey(item.id ?? field(item.fields, 'ID')) === clusterKey(rawValue));
        const linked = launchRows.filter(item => clusterKey(field(item.fields, 'AGRUPAR')) === clusterKey(rawValue));
        const content = [];
        if (!order) content.push(element('p', 'lg-error', `Pedido #${rawValue} não encontrado na lista do SharePoint.`));
        if (!linked.length) content.push(element('p', 'lg-hint', `Nenhum lançamento encontrado com AGRUPAR = ${rawValue}.`));
        if (order) {
          const headerData = renderOrderHeader(order, rawValue, linked);
          content.push(headerData.overview, headerData.reconcile);
        }
        if (linked.length) {
          content.push(element('h3', 'lg-cluster-table-title', `Lançamentos vinculados ao pedido ${rawValue}`));
          const listing = launchTable(linked, 'order', rawValue);
          content.push(listing.table, listing.totals);
        }
        clusterPanel.replaceChildren(clusterPanel.querySelector('.lg-detail-header'), ...content);
      }
      focus(closeButton);
    } catch (error) {
      if (!active(epoch) || version !== clusterVersion || clusterPanel.hidden) return;
      const retry = button('Tentar novamente', () => { void openCluster(kind, value); }, { locked: false });
      clusterPanel.replaceChildren(clusterPanel.querySelector('.lg-detail-header'), element('p', 'lg-error', failure(error, 'Não foi possível carregar o agrupamento')), retry);
      focus(retry);
    } finally {
      if (clusterAbortController === controller) {
        if (clusterTimer != null) clearTimeout(clusterTimer);
        clusterTimer = null;
        clusterAbortController = null;
      }
      if (active(epoch) && version === clusterVersion && !clusterPanel.hidden) clusterPanel.setAttribute('aria-busy', 'false');
    }
  }
  function closeCluster() {
    cancelClusterLoad();
    ++clusterVersion;
    clusterPanel.hidden = true;
    clusterPanel.setAttribute('aria-busy', 'false');
    clusterPanel.replaceChildren();
    const returnTo = clusterReturnFocus;
    clusterReturnFocus = null;
    if (opened && !destroyed) focus(returnTo?.isConnected ? returnTo : root.querySelector('.lg-cluster-trigger'));
  }
  function renderCard(item) {
    const fields = item.fields ?? {};
    const product = field(fields, 'PRODUTO') ?? 'Lançamento';
    const quantity = field(fields, 'QUANTIDADE');
    const unit = field(fields, 'UN', 'UNIDADE');
    const quantityText = quantity == null ? undefined : `${display(quantity)}${unit == null ? '' : ` ${display(unit)}`}`;
    const totalValue = field(fields, 'VALOR TOTAL', 'TOTAL') ?? money(item.total);
    const card = element('article', 'lg-card lg-record');
    card.dataset.itemId = String(item.id);
    const recordPreview = renderRecordMedia(item);
    if (recordPreview) card.classList.add('lg-record--with-media');
    const identity = element('header', 'lg-record-heading');
    identity.append(element('span', 'lg-record-id', display(field(fields, 'ID') ?? item.id)),
      element('h2', 'lg-record-product', display(product)));
    const status = field(fields, 'CONCLUÍDO', 'CONCLUIDO', 'STATUS');
    if (status) {
      const normalizedStatus = key(status);
      const statusClass = normalizedStatus.includes('FINALIZADO') || normalizedStatus.includes('PAGO')
        ? 'lg-status-final' : normalizedStatus.includes('PENDENTE') ? 'lg-status-pending' : 'lg-status-other';
      identity.append(element('span', `lg-record-status ${statusClass}`, display(status)));
    }

    const main = element('div', 'lg-record-main');
    const commercial = element('section', 'lg-record-group lg-record-commercial');
    const supplier = field(fields, 'FORNECEDOR');
    const branch = field(fields, 'FILIAL');
    const stage = field(fields, 'ETAPA OBRA', 'ETAPA', 'ETAPA DA OBRA');
    const group = field(fields, 'AGRUPAR');
    commercial.append(...[
      clusterAction('FORNECEDOR', supplier, 'supplier'),
      summaryField('FILIAL', branch),
      summaryField('ETAPA', stage),
      clusterAction('AGRUPAR', group, 'order'),
    ].filter(Boolean));

    const execution = element('section', 'lg-record-group lg-record-execution lg-record-dates');
    execution.append(element('h3', 'lg-record-section-title', '▦ Datas'));
    const dateEntries = [
      ['DATA DE COMPRA', field(fields, 'DATA DE COMPRA', 'DATA')],
      ['DATA PREVISTO PGTO', field(fields, 'DATA PGTO PREVISTO', 'DATA PREVISTO PGTO', 'DATA PREVISTO')],
      ['DATA DE PAGAMENTO', field(fields, 'DATA PGTO EFETUADO', 'DATA DE PAGAMENTO', 'DATA PAGAMENTO')],
      ['DATA DE RMS', field(fields, 'DATA DE RMS', 'DATA RMS')],
      ['DATA DE LIQUIDAÇÃO', field(fields, 'DATA DE LIQUIDAÇÃO', 'DATA LIQUIDAÇÃO')],
      ['CRIADO', field(fields, 'CRIADO', 'CREATED')],
      ['MODIFICAÇÕES', field(fields, 'MODIFICAÇÕES', 'MODIFICACOES', 'MODIFICADO')],
    ];
    for (const [name, value] of dateEntries) {
      const date = summaryField(name, value);
      if (date) execution.append(date);
    }

    const finance = element('section', 'lg-record-group lg-record-finance lg-record-values');
    const values = [
      ['VALOR UNITÁRIO', field(fields, 'VALOR UNITÁRIO', 'VALOR UNITARIO')],
      ['QUANTIDADE', quantityText],
      ['FRETE', field(fields, 'FRETE')],
      ['VALOR TOTAL', totalValue],
    ];
    for (const [name, value] of values) {
      const entry = summaryField(name, value);
      if (entry) finance.append(entry);
    }

    const meta = element('section', 'lg-record-group lg-record-meta');
    const metaValues = [
      ['TIPO DE OPERAÇÃO', field(fields, 'TIPO DE OPERAÇÃO', 'TIPO OPERACAO')],
      ['FORMA PGTO', field(fields, 'FORMAPGTO', 'FORMA PGTO', 'FORMA DE PAGAMENTO')],
      ['ID PEDIDO', field(fields, 'ID PEDIDO', 'PEDIDO')],
      ['ADICIONADO POR', creatorName(item)],
      ['MODIFICAÇÕES', field(fields, 'MODIFICAÇÕES', 'MODIFICACOES', 'MODIFICADO POR', 'MODIFICADO')],
      ['AVALIAÇÃO', field(fields, 'AVALIAÇÃO', 'AVALIACAO')],
    ];
    for (const [name, value] of metaValues) {
      const entry = summaryField(name, value);
      if (entry) meta.append(entry);
    }
    if (execution.children.length <= 1) execution.hidden = true;
    if (!commercial.childElementCount) commercial.hidden = true;
    if (!finance.childElementCount) finance.hidden = true;
    if (!meta.childElementCount) meta.hidden = true;
    main.append(commercial, execution, finance, meta);

    const badges = element('div', 'lg-record-badges');
    const badgeValues = [
      ['lg-badge-approval', field(fields, 'APROVAÇÃO', 'APROVACAO', 'STATUS APROVAÇÃO', 'STATUS APROVACAO')],
      ['lg-badge-rating', field(fields, 'AVALIAÇÃO', 'AVALIACAO')],
    ];
    for (const [className, value] of badgeValues) {
      if (value == null || display(value).trim() === '') continue;
      badges.append(element('span', `lg-record-badge ${className}`, display(value)));
    }
    const details = button('Detalhes', () => { if (canChangeDetail()) loadDetail(item.id); });
    details.dataset.lgAction = 'details';
    const body = element('div', 'lg-record-content');
    body.append(identity, main);
    body.append(badges);
    body.append(details);
    card.append(...(recordPreview ? [recordPreview] : []), body);
    return card;
  }
  function canChangeDetail() {
    if (busy) return false;
    if (editor || review) { notify('Conclua ou cancele a edição/confirmação aberta antes de trocar de lançamento.', true); return false; }
    return true;
  }
  async function loadDetail(id) {
    if (!opened || destroyed) return;
    selectedId = id;
    const version = ++detailVersion, epoch = session;
    detailLoading = true; panel.hidden = false;
    panel.replaceChildren(element('p', 'lg-hint', `Carregando detalhes de #${id}…`)); updateBusy();
    try {
      const result = await request('detail', { id });
      if (!active(epoch) || version !== detailVersion) return;
      if (!result?.item?.fields) throw new Error('Resposta de detalhes inválida');
      current = result; needsDetailRefresh = false;
      renderDetail(); reveal(panel); focus(panel.querySelector('.lg-detail-close') ?? panel);
    } catch (error) {
      if (!active(epoch) || version !== detailVersion) return;
      current = null;
      panel.replaceChildren(element('p', 'lg-error', failure(error, `Erro ao abrir #${id}`)),
        button('Tentar novamente', () => loadDetail(id)), button('Fechar detalhes', dismissDetail));
    } finally {
      if (active(epoch) && version === detailVersion) { detailLoading = false; updateBusy(); }
    }
  }
  function dismissDetail() {
    if (!canChangeDetail()) return;
    ++detailVersion; detailLoading = false; current = null; selectedId = null;
    panel.hidden = true; panel.replaceChildren(); updateBusy();
  }
  function clearReview() { review = null; reviewHost.hidden = true; reviewHost.replaceChildren(); }
  function renderDetail() {
    clearReview(); editor = null;
    const item = current.item;
    const title = element('h2', 'lg-section-title', `Lançamento #${item.id}`);
    const close = button('Fechar detalhes', dismissDetail, { locked: false });
    close.classList.add('lg-detail-close');
    const detailHeader = element('div', 'lg-detail-header'); detailHeader.append(title, close);
    panel.replaceChildren(detailHeader, fieldTable(displayFields(item)));
    const actions = element('div', 'lg-actions');
    actions.append(button('Editar', () => beginEditor('update'), { disabled: !current.editFields?.length }),
      button('Excluir lançamento', () => {
        if (!canChangeDetail()) return;
        showReview('Excluir lançamento', [`Excluir definitivamente o lançamento #${item.id}?`], 'Confirmar exclusão',
          'delete', { id: item.id, confirm: true, expectedModified: modified() });
      }, { danger: true }),
      button('Provisionar pagamento', () => beginEditor('payment')),
      button('Aplicar medição', () => beginEditor('measurement'), { disabled: !current.measurementFields?.length }));
    panel.append(actions, renderAttachments(), renderSignature(), reviewHost);
    updateBusy();
  }
  function modified() { return current.item.expectedModified ?? current.item.fields.Modified ?? current.item.fields.Modificado; }
  function uuid() {
    const crypto = doc.defaultView?.crypto ?? globalThis.crypto;
    if (crypto?.randomUUID) return crypto.randomUUID();
    if (!crypto?.getRandomValues) throw new Error('Gerador seguro de identificador indisponível');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function beginEditor(operation) {
    if (!canChangeDetail()) return;
    notify('');
    const definitions = operation === 'payment' ? [{ name: 'date', label: 'Data prevista do pagamento', type: 'date', required: true }]
      : operation === 'measurement' ? current.measurementFields : current.editFields;
    const form = element('form', 'lg-editor');
    const controls = [];
    const schemaState = { version: 0, loading: false };
    async function refreshDependencies(definition, control) {
      const scope = operation === 'update' && definition.name === 'FILIAL' ? 'edit'
        : operation === 'measurement' && definition.name === 'NUMEROCONTRATO' ? 'measurement' : '';
      if (!scope || !control.value) return;
      const version = ++schemaState.version;
      schemaState.loading = true;
      notify('Atualizando opções relacionadas…');
      try {
        const result = await request('schema', {id: current.item.id, scope, fields: {[definition.name]: control.value}});
        if (editor?.form !== form || version !== schemaState.version || !Array.isArray(result?.fields)) return;
        for (const refreshed of result.fields) {
          const entry = controls.find(item => item.definition.name === refreshed.name);
          if (!entry) continue;
          Object.assign(entry.definition, refreshed);
          if (entry.control.tagName === 'SELECT' && Array.isArray(refreshed.options)) {
            setOptions(entry.control, refreshed.options, 'Selecione', entry.control === control);
          }
        }
        clearReview(); notify('Opções relacionadas atualizadas.');
      } catch (error) {
        if (editor?.form === form && version === schemaState.version) notify(failure(error, 'Não foi possível atualizar as opções'), true);
      } finally {
        if (version === schemaState.version) schemaState.loading = false;
      }
    }
    form.append(element('h3', 'lg-section-title', operation === 'payment' ? 'Provisionar pagamento' : operation === 'measurement' ? 'Aplicar medição' : 'Editar lançamento'));
    const grid = element('div', 'lg-editor-grid');
    for (const definition of definitions) {
      const type = String(definition.type ?? 'text').toLowerCase();
      const isCheck = ['boolean', 'checkbox', 'bool'].includes(type);
      const control = element(definition.options?.length || type === 'select' ? 'select' : ['textarea', 'multiline', 'html'].includes(type) ? 'textarea' : 'input', 'lg-input');
      control.name = definition.name; control.required = Boolean(definition.required); control.dataset.lgLock = 'true';
      if (control.tagName === 'INPUT') {
        control.type = isCheck ? 'checkbox' : ['number', 'decimal', 'currency', 'integer'].includes(type) ? 'number'
          : ['date', 'email', 'tel', 'url', 'datetime-local'].includes(type) ? type : 'text';
        if (control.type === 'number') control.step = type === 'integer' ? '1' : 'any';
      }
      if (control.tagName === 'SELECT') setOptions(control, definition.options ?? [], 'Selecione');
      // Edits round-trip raw values, including existing HTML descriptions.
      // Measurement starts blank: a new measurement is not a copy of the order.
      const value = operation === 'update' ? current.item.fields[definition.name] : '';
      if (isCheck) control.checked = value === true || value === 1 || value === 'true';
      else {
        if (control.tagName === 'SELECT' && value != null && ![...control.options].some(opt => opt.value === display(value))) control.append(option(value));
        control.value = control.type === 'date' ? display(value).slice(0, 10) : display(value);
      }
      const invalidate = () => { clearReview(); notify(''); };
      control.addEventListener('input', invalidate);
      control.addEventListener('change', () => { invalidate(); void refreshDependencies(definition, control); });
      controls.push({ definition, control, initial: isCheck ? control.checked : control.value });
      grid.append(label(`${definition.label ?? definition.name}${definition.required ? ' *' : ''}`, control));
    }
    const actions = element('div', 'lg-actions');
    actions.append(button('Revisar alterações', () => reviewEditor()), button('Cancelar edição', () => {
      clearReview(); form.remove(); editor = null; notify('Edição cancelada.');
    }));
    form.append(grid, actions); form.addEventListener('submit', event => { event.preventDefault(); if (!busy) reviewEditor(); });
    editor = { operation, form, controls, schemaState }; panel.insertBefore(form, reviewHost); focus(controls[0]?.control);
  }
  function reviewEditor() {
    if (!editor || busy) return;
    if (editor.schemaState?.loading) { notify('Aguarde a atualização das opções relacionadas.', true); return; }
    if (!editor.form.reportValidity()) return;
    const fields = {}, lines = [];
    for (const { definition, control, initial } of editor.controls) {
      const value = control.type === 'checkbox' ? control.checked : control.type === 'number' && control.value !== '' ? Number(control.value) : control.value;
      const unchanged = control.type === 'checkbox' ? value === initial : String(control.value) === String(initial);
      if (editor.operation === 'update' && unchanged) continue;
      fields[definition.name] = value;
      lines.push(`${definition.label ?? definition.name}: ${control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent ?? '' : fieldText(definition.name, value)}`);
    }
    const operation = editor.operation;
    if (operation === 'update' && !Object.keys(fields).length) {
      notify('Nenhuma alteração foi feita no lançamento.', true); return;
    }
    const payload = { id: current.item.id, ...(operation === 'payment' ? { date: fields.date } : { fields }), confirm: true, expectedModified: modified() };
    let key;
    if (operation === 'update') payload.expectedModified = modified();
    else {
      // The SharePoint version is concurrency control, not operation identity.
      // Keeping it out of the key makes an ambiguous create/link retry reuse
      // the same requestId after detail refresh instead of duplicating records.
      key = JSON.stringify([operation, Object.fromEntries(Object.entries(payload)
        .filter(([name]) => !['confirm', 'expectedModified', 'requestId'].includes(name)))]);
      try { if (!retryIds.has(key)) retryIds.set(key, uuid()); }
      catch (error) { notify(failure(error, 'Erro na revisão'), true); return; }
      payload.requestId = retryIds.get(key);
    }
    showReview('Revise antes de confirmar', [`Lançamento #${current.item.id}`, ...lines], 'Confirmar alterações', operation, payload, undefined, key);
  }
  function showReview(title, lines, confirmText, operation, payload, file, key) {
    clearReview();
    review = { operation, payload, file, key };
    reviewHost.append(element('h3', 'lg-section-title', title), ...lines.map(line => element('p', 'lg-review-line', line)),
      button(confirmText, commitReview, { danger: ['delete', 'attachment_delete'].includes(operation) }),
      button('Cancelar confirmação', () => { clearReview(); focus(editor?.controls[0]?.control ?? panel); }));
    reviewHost.hidden = false; reveal(reviewHost);
  }
  async function commitReview() {
    if (!review || busy || !opened) return;
    const pending = review;
    busy = true; notify('Salvando…'); updateBusy();
    try {
      if (pending.file) {
        if (typeof upload !== 'function') throw new Error('Envio de arquivo indisponível');
        await upload(pending.payload.id, pending.file, { operation: pending.operation, confirm: true, expectedModified: pending.payload.expectedModified });
      } else await request(pending.operation, pending.payload);
      if (destroyed) return;
      if (pending.key) retryIds.delete(pending.key);
      if (pending.operation === 'attachment_add' && selectedUploads.get(pending.payload.id) === pending.file) selectedUploads.delete(pending.payload.id);
      clearReview(); editor?.form.remove(); editor = null;
      notify('Operação concluída.');
      needsDetailRefresh = true;
      if (pending.operation === 'delete') {
        selectedUploads.delete(pending.payload.id);
        ++detailVersion; current = null; selectedId = null; panel.hidden = true; panel.replaceChildren(); needsDetailRefresh = false;
      }
      if (opened) {
        await Promise.all([loadSnapshot(applied), selectedId != null ? loadDetail(selectedId) : Promise.resolve()]);
      }
    } catch (error) {
      if (!destroyed) notify(failure(error, 'Não foi possível salvar'), true);
    } finally { busy = false; if (!destroyed) updateBusy(); }
  }
  function renderAttachments() {
    const section = element('section', 'lg-attachments');
    const id = current.item.id;
    const attachments = current.attachments ?? [];
    attachmentIndex = Math.min(attachmentIndex, Math.max(0, attachments.length - 1));
    section.append(element('h3', 'lg-section-title', 'Anexos'));
    const name = element('p', 'lg-file-name');
    const nav = element('div', 'lg-actions');
    const prev = button('Anexo anterior', () => { attachmentIndex--; renderSelection(); });
    const nextAttachment = button('Próximo anexo', () => { attachmentIndex++; renderSelection(); });
    const open = button('Abrir / salvar anexo', () => viewAttachment(attachments[attachmentIndex].fileName), { disabled: !attachments.length || !openMedia });
    const remove = button('Remover anexo', () => {
      if (!canChangeDetail()) return;
      const fileName = attachments[attachmentIndex].fileName;
      showReview('Remover anexo', [`Remover ${fileName} do lançamento #${current.item.id}?`], 'Confirmar remoção', 'attachment_delete',
        { id: current.item.id, fileName, confirm: true, expectedModified: modified() });
    }, { disabled: !attachments.length, danger: true });
    function renderSelection() {
      name.textContent = attachments.length ? `${attachmentIndex + 1} de ${attachments.length} · ${attachments[attachmentIndex].fileName}` : 'Nenhum anexo neste lançamento.';
      prev.dataset.lgDisabled = String(attachmentIndex <= 0);
      nextAttachment.dataset.lgDisabled = String(attachmentIndex >= attachments.length - 1);
      updateBusy();
    }
    nav.append(prev, nextAttachment, open, remove);
    const file = element('input', 'lg-input'); file.type = 'file'; file.dataset.lgLock = 'true';
    file.disabled = !upload; file.dataset.lgDisabled = String(!upload);
    const selection = element('p', 'lg-hint');
    function showSelection() {
      selection.textContent = selectedUploads.has(id) ? `Arquivo selecionado: ${selectedUploads.get(id).name}` : 'Nenhum arquivo selecionado.';
    }
    file.addEventListener('change', () => {
      if (file.files?.[0]) selectedUploads.set(id, file.files[0]);
      if (review?.operation === 'attachment_add') clearReview();
      showSelection();
    });
    showSelection();
    section.append(name, nav, label('Novo anexo', file), selection, button('Adicionar anexo', () => {
      if (!canChangeDetail()) return;
      const selected = selectedUploads.get(id);
      if (!selected) { notify('Selecione um arquivo para adicionar.', true); return; }
      showReview('Adicionar anexo', [`Enviar ${selected.name} para o lançamento #${current.item.id}?`], 'Confirmar envio', 'attachment_add', { id: current.item.id, expectedModified: modified() }, selected);
    }, { disabled: !upload }), button('Limpar arquivo selecionado', () => {
      selectedUploads.delete(id); file.value = ''; showSelection();
      if (review?.operation === 'attachment_add') clearReview();
    }, { disabled: !upload }));
    renderSelection(); return section;
  }
  function renderSignature() {
    const section = element('section', 'lg-signature');
    let signature = current.item.fields.ASSINATURA;
    try { if (typeof signature === 'string' && signature.startsWith('"')) signature = JSON.parse(signature); } catch { signature = ''; }
    section.append(element('h3', 'lg-section-title', 'Assinatura'),
      element('p', 'lg-hint', current.item.fields.ASSINATURA ? 'Assinatura registrada. Uma nova assinatura substituirá a atual.' : 'Sem assinatura registrada.'));
    // SharePoint stores PowerApps JSON(data:image). Never request an arbitrary URL.
    if (typeof signature === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(signature) && signature.length <= 8_000_000) {
      const preview = element('img', 'lg-signature-preview');
      preview.alt = 'Assinatura registrada no lançamento'; preview.src = signature;
      section.append(preview);
    }
    section.append(button('Desenhar assinatura', capture, { disabled: !captureSignature || !upload }));
    return section;
  }
  async function external(work) {
    if (busy || !opened) return;
    const epoch = session, origin = doc.activeElement;
    busy = true; updateBusy();
    try { await work(epoch); }
    catch (error) { if (active(epoch)) notify(failure(error, 'Não foi possível abrir'), true); }
    finally {
      busy = false; suspended = false;
      if (!destroyed) { root.hidden = !opened; updateBusy(); if (active(epoch)) focus(origin); }
    }
  }
  function viewRecordAttachment(id, fileName) {
    external(async epoch => {
      const descriptor = await request('attachment', { id, fileName });
      if (!active(epoch)) return;
      suspended = true; root.hidden = true;
      await openMedia(descriptor);
    });
  }
  function viewAttachment(fileName) {
    viewRecordAttachment(current.item.id, fileName);
  }
  function capture() {
    if (!canChangeDetail()) return;
    const id = current.item.id;
    external(async epoch => {
      suspended = true; root.hidden = true;
      const file = await captureSignature();
      if (!active(epoch) || !file) return;
      suspended = false; root.hidden = false;
      showReview('Assinatura capturada', [`Salvar ${file.name} no lançamento #${id}?`], 'Confirmar assinatura', 'signature', { id, expectedModified: modified() }, file);
    });
  }
  function onKeyDown(event) {
    if (!opened || suspended || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!clusterPanel.hidden) { closeCluster(); return; }
      if (!panel.hidden) { dismissDetail(); return; }
      close(); return;
    }
    if (event.key !== 'Tab') return;
    const activeModal = !clusterPanel.hidden ? clusterPanel : !panel.hidden ? panel : root;
    const controls = [...activeModal.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]') && (node.tagName === 'SUMMARY' || !node.closest('details:not([open])')));
    const first = controls[0] ?? activeModal, last = controls.at(-1) ?? activeModal;
    if (event.shiftKey && (doc.activeElement === first || !controls.includes(doc.activeElement))) { event.preventDefault(); focus(last); }
    else if (!event.shiftKey && (doc.activeElement === last || !controls.includes(doc.activeElement))) { event.preventDefault(); focus(first); }
  }
  root.addEventListener('keydown', onKeyDown);
  async function open() {
    if (destroyed || opened) return;
    opened = true; ++session; returnFocus = doc.activeElement;
    root.hidden = suspended; focus(back);
    await Promise.all([loadSnapshot(applied), needsDetailRefresh && selectedId != null && !editor ? loadDetail(selectedId) : Promise.resolve()]);
  }
  function close() {
    if (!opened || destroyed) return;
    autoFilters.cancelPending();
    cancelClusterLoad();
    opened = false; ++session; ++listVersion; ++detailVersion; ++clusterVersion;
    if (detailLoading) needsDetailRefresh = true;
    listLoading = false; detailLoading = false; root.hidden = true;
    clusterPanel.hidden = true; clusterPanel.replaceChildren();
    if (!busy) clearReview();
    updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }
  function destroy() {
    if (destroyed) return;
    autoFilters.destroy();
    attachmentCounts.destroy();
    cancelClusterLoad();
    opened = false; destroyed = true; ++session; ++listVersion; ++detailVersion; ++clusterVersion;
    retryIds.clear(); selectedUploads.clear(); root.removeEventListener('keydown', onKeyDown); root.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  return { open, close, destroy };
}
