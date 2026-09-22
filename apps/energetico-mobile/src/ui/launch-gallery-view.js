const FILTERS = [
  ['branch', 'Filial'], ['supplier', 'Fornecedor'], ['status', 'Concluído'], ['id', 'ID'],
  ['product', 'Produto'], ['stage', 'Etapa obra'], ['contract', 'Medição'],
  ['pendingApproval', 'Somente pendentes de aprovação'], ['dateStart', 'Data inicial'], ['dateEnd', 'Data final'],
];
const SORTS = ['MAIOR ID', 'MAIOR DATA', 'MAIOR DATA PGTO PREVISTO', 'MAIOR DATA PGTO EFETUADO',
  'CRIADO MAIS RECENTE', 'CRIADO MAIS ANTIGO', 'MODIFICADO MAIS RECENTE', 'MODIFICADO MAIS ANTIGO'];
const TOTALS = [['committed', 'Empenhado'], ['liquidated', 'Liquidado'], ['pending', 'Pendente'], ['paid', 'Pago'], ['total', 'Total']];
const money = value => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const display = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
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
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const instant = new Date(raw);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(instant);
}

/**
 * Standalone body overlay. The integrator loads launch-gallery.css and supplies
 * naked service results. openMedia may settle as soon as its top-layer dialog
 * loads; captureSignature settles with a File or null after capture/cancel.
 * Nothing here owns the chat, the viewer, or the signature canvas.
 */
export function createLaunchGallery({ document: documentRef = globalThis.document,
  request, upload, openMedia, openMediaCollection, loadMediaPreview, captureSignature, onClose, onHome } = {}) {
  if (!documentRef?.body || typeof request !== 'function') throw new TypeError('Documento e request são obrigatórios.');
  const doc = documentRef;
  let opened = false, destroyed = false, suspended = false, busy = false;
  let session = 0, listVersion = 0, detailVersion = 0;
  let listLoading = false, detailLoading = false, returnFocus;
  let current = null, selectedId = null, editor = null, review = null, attachmentIndex = 0;
  let page = 1, pages = 0, needsDetailRefresh = false;
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
    pair.append(element('span', 'lg-record-label', labelText), element('span', 'lg-record-value', display(value)));
    return pair;
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
  const apply = button('Aplicar filtros', applyFilters, { locked: false });
  filterActions.append(apply, button('Limpar filtros', () => {
    for (const control of filterControls.values()) { control.value = ''; control.checked = false; }
    sort.selectedIndex = 0; applyFilters();
  }, { locked: false }));
  filterForm.append(filterGrid,
    element('p', 'lg-hint', 'Período de empenho: as datas inicial e final são incluídas.'), filterActions);
  filterForm.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
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
  const reviewHost = element('section', 'lg-review'); reviewHost.hidden = true;
  reviewHost.setAttribute('aria-label', 'Revisão e confirmação'); reviewHost.tabIndex = -1;
  filterDisclosure.append(filterForm);
  content.append(filterDisclosure, totals, notice, listStatus, cards, pagination);
  root.append(header, content, panel);
  doc.body.append(root);
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
    const fileName = attachmentFileName(media.attachment);
    host.setAttribute('aria-label', media.kind === 'pdf' ? `Abrir ${fileName || 'arquivo PDF'}`
      : media.kind === 'image' ? `Abrir ${fileName || 'primeiro anexo'}` : 'Abrir anexos do lançamento');
    host.addEventListener('click', () => { if (canChangeDetail()) openRecordAttachments(item); });
    if (media.kind === 'pdf') {
      const count = field(item.fields, 'QUANTIDADE DE ANEXOS', 'QTD ANEXOS', 'ANEXOS');
      host.append(element('span', 'lg-record-pdf-icon', 'PDF'),
        element('span', 'lg-record-media-label', count == null ? 'Documento' : `${display(count)} anexos`));
      return host;
    }
    if (media.kind === 'attachments') {
      const count = field(item.fields, 'QUANTIDADE DE ANEXOS', 'QTD ANEXOS', 'ANEXOS');
      host.append(element('span', 'lg-record-attachment-icon', '📎'),
        element('span', 'lg-record-media-label', count ? `${display(count)} anexos` : 'Anexos'));
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
    host.append(image);
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
      let result;
      let attachments = attachmentEntries(item);
      if (!attachments.length) result = await request('detail', { id: item.id });
      if (!attachments.length) attachments = attachmentDescriptors(item, result);
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
  function renderCard(item) {
    const fields = item.fields ?? {};
    const product = field(fields, 'PRODUTO') ?? 'Lançamento';
    const quantity = field(fields, 'QUANTIDADE');
    const unit = field(fields, 'UN', 'UNIDADE');
    const quantityText = quantity == null ? undefined : `${display(quantity)}${unit == null ? '' : ` ${display(unit)}`}`;
    const attachmentCount = field(fields, 'QUANTIDADE DE ANEXOS', 'QTD ANEXOS', 'ANEXOS');
    const totalValue = field(fields, 'VALOR TOTAL', 'TOTAL') ?? money(item.total);
    const card = element('article', 'lg-card lg-record');
    const recordPreview = renderRecordMedia(item);
    if (recordPreview) card.classList.add('lg-record--with-media');
    const identity = element('header', 'lg-record-heading');
    identity.append(element('span', 'lg-record-id', display(field(fields, 'ID') ?? item.id)),
      element('h2', 'lg-record-product', display(product)));

    const main = element('div', 'lg-record-main');
    const commercial = element('section', 'lg-record-group lg-record-commercial');
    const execution = element('section', 'lg-record-group lg-record-execution');
    const finance = element('section', 'lg-record-group lg-record-finance');
    const meta = element('section', 'lg-record-group lg-record-meta');
    const groups = [
      [commercial, [
        ['FORNECEDOR', field(fields, 'FORNECEDOR')],
        ['FILIAL', field(fields, 'FILIAL')],
        ['DATA DE COMPRA', field(fields, 'DATA DE COMPRA', 'DATA')],
        ['VALOR UNITÁRIO', field(fields, 'VALOR UNITÁRIO', 'VALOR UNITARIO')],
        ['QUANTIDADE', quantityText],
        ['FRETE', field(fields, 'FRETE')],
      ]],
      [execution, [
        ['ETAPA OBRA', field(fields, 'ETAPA OBRA', 'ETAPA', 'ETAPA DA OBRA')],
        ['DATA DE RMS', field(fields, 'DATA DE RMS', 'DATA RMS')],
        ['DATA DE LIQUIDAÇÃO', field(fields, 'DATA DE LIQUIDAÇÃO', 'DATA LIQUIDAÇÃO')],
        ['DATA DE PAGAMENTO', field(fields, 'DATA DE PAGAMENTO', 'DATA PAGAMENTO')],
      ]],
      [finance, [
        ['TIPO DE OPERAÇÃO', field(fields, 'TIPO DE OPERAÇÃO', 'TIPO OPERACAO')],
        ['FORMA PGTO', field(fields, 'FORMAPGTO', 'FORMA PGTO', 'FORMA DE PAGAMENTO')],
        ['ID PEDIDO', field(fields, 'ID PEDIDO', 'PEDIDO')],
        ['VALOR TOTAL', totalValue],
      ]],
      [meta, [
        ['ADICIONADO POR', field(fields, 'ADICIONADO POR', 'CRIADO POR')],
        ['MODIFICAÇÕES', field(fields, 'MODIFICAÇÕES', 'MODIFICACOES', 'MODIFICADO POR', 'MODIFICADO')],
        ['AVALIAÇÃO', field(fields, 'AVALIAÇÃO', 'AVALIACAO')],
      ]],
    ];
    for (const [group, entries] of groups) {
      const nodes = entries.map(([labelText, value]) => summaryField(labelText, value)).filter(Boolean);
      group.replaceChildren(...nodes);
      if (nodes.length) main.append(group);
    }
    const badges = element('div', 'lg-record-badges');
    const badgeValues = [
      ['lg-badge-status', field(fields, 'CONCLUÍDO', 'CONCLUIDO', 'STATUS')],
      ['lg-badge-approval', field(fields, 'APROVAÇÃO', 'APROVACAO', 'STATUS APROVAÇÃO', 'STATUS APROVACAO')],
      ['lg-badge-attachment', attachmentCount == null ? (item.hasAttachments ? 'COM ANEXOS' : 'SEM ANEXOS')
        : `${display(attachmentCount)} ${Number(attachmentCount) === 1 ? 'ANEXO' : 'ANEXOS'}`],
      ['lg-badge-rating', field(fields, 'AVALIAÇÃO', 'AVALIACAO')],
    ];
    for (const [className, value] of badgeValues) {
      if (value == null || display(value).trim() === '') continue;
      badges.append(element('span', `lg-record-badge ${className}`, display(value)));
    }
    const details = button('Detalhes', () => { if (canChangeDetail()) loadDetail(item.id); });
    details.dataset.lgAction = 'details';
    card.append(...(recordPreview ? [recordPreview] : []), identity, main, badges, details);
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
    panel.replaceChildren(detailHeader, fieldTable(item.fields));
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
      if (!panel.hidden) { dismissDetail(); return; }
      close(); return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...root.querySelectorAll('button, input, select, textarea, summary, [tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]') && (node.tagName === 'SUMMARY' || !node.closest('details:not([open])')));
    const first = controls[0], last = controls.at(-1);
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
    opened = false; ++session; ++listVersion; ++detailVersion;
    if (detailLoading) needsDetailRefresh = true;
    listLoading = false; detailLoading = false; root.hidden = true;
    if (!busy) clearReview();
    updateBusy();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    onClose?.();
  }
  function destroy() {
    if (destroyed) return;
    opened = false; destroyed = true; ++session; ++listVersion; ++detailVersion;
    retryIds.clear(); selectedUploads.clear(); root.removeEventListener('keydown', onKeyDown); root.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }
  return { open, close, destroy };
}
