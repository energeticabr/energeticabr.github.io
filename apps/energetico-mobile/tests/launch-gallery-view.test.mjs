import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Load inside the harness so the first RED run reports the missing feature as
// an assertion, and still exercises the actual exported UI in every test.
async function setup(t, overrides = {}) {
  const module = await import('../src/ui/launch-gallery-view.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('launch-gallery-view.js')) return {};
    throw error;
  });
  assert.equal(typeof module.createLaunchGallery, 'function', 'createLaunchGallery must be implemented');
  const dom = new JSDOM('<button id="origin">Galeria</button><main id="chat"></main>', { url: 'https://example.test' });
  const document = dom.window.document;
  const calls = [];
  const request = async (operation, payload) => {
    calls.push({ operation, payload });
    return overrides.request ? overrides.request(operation, payload) : operation === 'snapshot' ? snapshot() : detail();
  };
  const gallery = module.createLaunchGallery({ document, request, ...overrides, request });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, calls, root: () => document.querySelector('.lg-overlay') };
}

const sorts = ['MAIOR ID', 'MAIOR DATA', 'MAIOR DATA PGTO PREVISTO', 'MAIOR DATA PGTO EFETUADO',
  'CRIADO MAIS RECENTE', 'CRIADO MAIS ANTIGO', 'MODIFICADO MAIS RECENTE', 'MODIFICADO MAIS ANTIGO'];
const row = (id = 17) => ({ id, total: 85, hasAttachments: true, fields: {
  DATA: '2026-09-17', FORNECEDOR: 'Fornecedor A', PRODUTO: 'Cimento', FILIAL: 'Obra A',
  QUANTIDADE: 2.5, UN: 'SC', 'VALOR UNITÁRIO': 30, FRETE: 10, CONCLUÍDO: 'PEDIDO EMPENHADO',
  DESCRIÇÃO: '<p>Primeira &amp; segunda</p><p>Linha 2</p><script>unsafe()</script><img src=x onerror=unsafe()>',
  Modified: '2026-09-18T12:34:56Z', ASSINATURA: '',
} });
const snapshot = (overrides = {}) => ({ rows: [row()], count: 1, page: 1, pageSize: 20, pages: 1,
  totals: { committed: 85, liquidated: 25, pending: 15, paid: 10, total: 135 },
  filterOptions: { branch: ['Obra A', 'Obra B'], supplier: ['Fornecedor A'], status: ['PEDIDO EMPENHADO'],
    product: ['Cimento'], stage: ['Fundação'], contract: ['Contrato 1'] }, sortOptions: sorts, ...overrides });
const detail = (overrides = {}) => ({ item: row(), attachments: [{ fileName: 'um.pdf' }, { fileName: 'dois.png' }],
  editFields: [
    { name: 'QUANTIDADE', label: 'Quantidade', type: 'number', required: true },
    { name: 'DESCRIÇÃO', label: 'Descrição', type: 'textarea' },
    { name: 'CONCLUÍDO', label: 'Situação', type: 'select', options: [
      { value: 'PEDIDO EMPENHADO', label: 'Empenhado' }, { value: 'PEDIDO FINALIZADO', label: 'Finalizado' }] },
  ], measurementFields: [
    { name: 'DATA', label: 'Data da medição', type: 'date', required: true },
    { name: 'QUANTIDADE', label: 'Quantidade medida', type: 'number', required: true },
    { name: 'CONFERIDO', label: 'Conferido', type: 'boolean' },
  ], ...overrides });
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function button(root, text) {
  const found = [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text && !node.closest('[hidden]'));
  assert.ok(found, `visible button: ${text}`);
  return found;
}
function input(ctx, name, value, parent = ctx.root()) {
  const field = parent.querySelector(`[name="${name}"]`);
  assert.ok(field, `field: ${name}`);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  field.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  return field;
}
async function showDetail(ctx) { button(ctx.root(), 'Detalhes').click(); await settle(); }
const mutations = ctx => ctx.calls.filter(({ operation }) => !['snapshot', 'detail', 'attachment'].includes(operation));

test('filters start collapsed so records are visible; details and review scroll into view', async t => {
  const ctx = await setup(t);
  const scrolled = [];
  ctx.dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  await ctx.gallery.open();
  const filters = ctx.root().querySelector('details.lg-filters');
  assert.ok(filters);
  assert.equal(filters.open, false);
  assert.equal(filters.querySelector('summary').textContent, 'Filtros e ordenação');
  await showDetail(ctx);
  assert.ok(scrolled.includes(ctx.root().querySelector('.lg-detail')));
  button(ctx.root(), 'Excluir lançamento').click();
  assert.ok(scrolled.includes(ctx.root().querySelector('.lg-review')));
});

test('existing signature is previewed only as a safe embedded raster image', async t => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  let value = JSON.stringify(png);
  const ctx = await setup(t, {request: async op => op === 'snapshot' ? snapshot() : detail({item: {...row(), fields: {...row().fields, ASSINATURA: value}}})});
  await ctx.gallery.open(); await showDetail(ctx);
  assert.equal(ctx.root().querySelector('.lg-signature img')?.getAttribute('src'), png);
  button(ctx.root(), 'Fechar detalhes').click();
  value = 'https://untrusted.example/signature.png';
  await showDetail(ctx);
  assert.equal(ctx.root().querySelector('.lg-signature img'), null);
});

test('body overlay survives chat rerenders; close/home/destroy preserve lifecycle and focus', async t => {
  let closed = 0, home = 0;
  const ctx = await setup(t, { onClose: () => closed++, onHome: () => home++ });
  const origin = ctx.document.querySelector('#origin');
  origin.focus();
  await ctx.gallery.open();
  const root = ctx.root();
  assert.equal(root.parentElement, ctx.document.body);
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.hidden, false);
  ctx.document.querySelector('#chat').replaceChildren(ctx.document.createElement('p'));
  assert.equal(ctx.root(), root);
  assert.equal(ctx.calls[0].operation, 'snapshot');
  button(root, 'Voltar').click();
  assert.equal(root.hidden, true);
  assert.equal(closed, 1);
  assert.equal(ctx.document.activeElement, origin);
  await ctx.gallery.open();
  button(root, 'Início').click();
  assert.equal(home, 1);
  assert.equal(root.hidden, true);
  assert.equal(mutations(ctx).length, 0);
  ctx.gallery.destroy();
  await ctx.gallery.open();
  assert.equal(ctx.root(), null);
});

test('all filters, inclusive date endpoints, server sorts, totals and paging reach the service', async t => {
  const ctx = await setup(t, { request: async (op, payload) => snapshot({ page: payload.page, count: 23, pages: 2 }) });
  await ctx.gallery.open();
  assert.equal([...ctx.root().querySelectorAll('button')].some(node => node.textContent.trim() === 'Aplicar filtros'), false);
  for (const [name, value] of Object.entries({ branch: 'Obra A', supplier: 'Fornecedor A', status: 'PEDIDO EMPENHADO',
    id: '17', product: 'Cimento', stage: 'Fundação', contract: 'Contrato 1', pendingApproval: true,
    dateStart: '2026-09-01', dateEnd: '2026-09-19', sort: sorts[7] })) input(ctx, name, value);
  await settle();
  assert.deepEqual(ctx.calls.filter(call => call.operation === 'snapshot').at(-1), { operation: 'snapshot', payload: {
    filters: { branch: 'Obra A', supplier: 'Fornecedor A', status: 'PEDIDO EMPENHADO', id: '17', product: 'Cimento',
      stage: 'Fundação', contract: 'Contrato 1', pendingApproval: true, dateStart: '2026-09-01', dateEnd: '2026-09-19' },
    sort: sorts[7], page: 1, pageSize: 20,
  } });
  assert.equal(ctx.root().querySelector('[name="sort"]').options.length, 8);
  const totals = ctx.root().querySelector('.lg-totals').textContent;
  for (const label of ['Empenhado', 'Liquidado', 'Pendente', 'Pago', 'Total']) assert.ok(totals.includes(label));
  assert.match(totals, /135,00/);
  button(ctx.root(), 'Próxima página').click(); await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').at(-1).payload.page, 2);
  button(ctx.root(), 'Página anterior').click(); await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').at(-1).payload.page, 1);
});

test('typing in launch filters automatically and coalesces rapid keystrokes into one snapshot', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  const id = ctx.root().querySelector('[name="id"]');
  id.value = '2';
  id.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  id.value = '22';
  id.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 250));

  const snapshots = ctx.calls.filter(call => call.operation === 'snapshot');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1).payload.filters.id, '22');
});

test('summary reproduces the PowerApps launch row with tolerant aliases and keeps details on the selected id', async t => {
  const full = row(3424);
  full.total = 2.85;
  full.fields = {
    ID: 3424,
    PRODUTO: 'CORDA PARA PRUMO DE CENTRO',
    'ETAPA OBRA': 'ALVENARIA E ESTRUTURAS',
    FORNECEDOR: 'PIRATININGA FERRAMENTAS LTDA',
    CONCLUÍDO: 'PEDIDO FINALIZADO',
    'ADICIONADO POR': 'SHAREPOINT APP EM 20/09/2026 14:27',
    FILIAL: '004 - EDIFÍCIO XAVANTE',
    'DATA DE RMS': '20/09/2026',
    MODIFICAÇÕES: 'SEM MODIFICAÇÕES APÓS CRIAÇÃO',
    'DATA DE COMPRA': '20/09/2026',
    'VALOR UNITÁRIO': 'R$ 2,85',
    'TIPO DE OPERAÇÃO': 'CUSTO',
    APROVAÇÃO: 'PENDENTE DE APROVAÇÃO',
    'DATA DE LIQUIDAÇÃO': '19/09/2026',
    QUANTIDADE: 1,
    UNIDADE: 'UN',
    'DATA DE PAGAMENTO': '19/09/2026',
    FRETE: 'R$ 0,00',
    'VALOR TOTAL': 'R$ 2,85',
    'FORMA DE PAGAMENTO': 'AMAEL PF - CAIXA',
    'ID PEDIDO': 318,
    'QUANTIDADE DE ANEXOS': 2,
    AVALIAÇÃO: 'SEM AVALIAÇÃO',
  };
  const ctx = await setup(t, {request: async (operation, payload) => operation === 'snapshot'
    ? snapshot({rows: [full], totals: {committed: 85, committedCount: 3, liquidated: 25, liquidatedCount: 2,
      pending: 15, paid: 10, paidCount: 4, total: 135, totalCount: 9}})
    : detail({item: full})});
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.ok(record, 'PowerApps-equivalent record');
  for (const value of ['3424', 'CORDA PARA PRUMO DE CENTRO', 'ALVENARIA E ESTRUTURAS',
    'PIRATININGA FERRAMENTAS LTDA', 'PEDIDO FINALIZADO', 'SHAREPOINT APP EM 20/09/2026 14:27',
    '004 - EDIFÍCIO XAVANTE', '20/09/2026', 'SEM MODIFICAÇÕES APÓS CRIAÇÃO', 'R$ 2,85',
    'CUSTO', 'PENDENTE DE APROVAÇÃO', '19/09/2026', '1 UN', 'AMAEL PF - CAIXA', '318',
    '2 ANEXOS', 'SEM AVALIAÇÃO']) assert.ok(record.textContent.includes(value), value);
  assert.equal([...ctx.root().querySelectorAll('.lg-filter-grid .lg-label')]
    .some(label => label.textContent === 'Medição'), true);
  assert.match(ctx.root().querySelector('.lg-totals').textContent, /3\s+R\$\s*85,00/);
  button(record, 'Detalhes').click(); await settle();
  assert.deepEqual(ctx.calls.at(-1), {operation: 'detail', payload: {id: 3424}});
});

test('launch summary formats SharePoint dates as dd/mm/yyyy and resolves the creator name instead of its numeric lookup id', async t => {
  const item = row(3450);
  item.createdBy = { user: { displayName: 'Bernardo Notini' } };
  item.fields = {
    ...item.fields,
    'DATA DE COMPRA': '2026-09-24T03:00:00Z',
    'DATA DE RMS': '2026-09-24T03:00:00Z',
    MODIFICAÇÕES: '2026-09-25T00:43:17Z',
    'ADICIONADO POR': 1073741822,
  };
  delete item.fields.DATA;
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });

  await ctx.gallery.open();

  const record = ctx.root().querySelector('.lg-record');
  const values = new Map([...record.querySelectorAll('.lg-record-field')].map(pair => [
    pair.querySelector('.lg-record-label').textContent,
    pair.querySelector('.lg-record-value').textContent,
  ]));
  assert.equal(values.get('DATA DE COMPRA'), '24/09/2026');
  assert.equal(values.get('DATA DE RMS'), '24/09/2026');
  assert.equal(values.get('MODIFICAÇÕES'), '24/09/2026');
  assert.equal(values.get('ADICIONADO POR'), 'Bernardo Notini');
  assert.doesNotMatch(record.textContent, /2026-09-24T03:00:00Z|2026-09-25T00:43:17Z|1073741822/);

  button(record, 'Detalhes').click(); await settle();
  const details = ctx.root().querySelector('.lg-data-table');
  const detailValues = new Map([...details.querySelectorAll('tr')].map(line => [
    line.querySelector('th').textContent,
    line.querySelector('td').textContent,
  ]));
  assert.equal(detailValues.get('DATA DE COMPRA'), '24/09/2026');
  assert.equal(detailValues.get('MODIFICAÇÕES'), '24/09/2026');
  assert.equal(detailValues.get('ADICIONADO POR'), 'Bernardo Notini');
  assert.doesNotMatch(details.textContent, /1073741822|2026-09-25T00:43:17Z/);
});

test('launch creator lookup ids are never presented as person names when SharePoint omits the expanded identity', async t => {
  const item = row(3451);
  item.fields = { ...item.fields, 'ADICIONADO POR': 1073741822 };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });

  await ctx.gallery.open();

  const record = ctx.root().querySelector('.lg-record');
  assert.match(record.textContent, /ADICIONADO PORUsuário não identificado/);
  assert.doesNotMatch(record.textContent, /1073741822/);
});

test('launch rows keep the stable pre-parity layout while keeping attachments openable', async t => {
  const item = {
    ...row(3429),
    fields: {
      ...row(3429).fields,
      ID: 3429,
      PRODUTO: 'PREGO 17 X 21',
      FORNECEDOR: 'COFER',
      FILIAL: '004 - EDIFÍCIO XAVANTE',
      'VALOR UNITÁRIO': '11,56',
      QUANTIDADE: 20,
      UNIDADE: 'KG',
      FRETE: '0,00',
      'VALOR TOTAL': '231,20',
      'ID PEDIDO': 245,
      'ADICIONADO POR': 'SHAREPOINT APP EM 21/09/2026 12:12',
      MODIFICAÇÕES: 'SEM MODIFICAÇÕES APÓS CRIAÇÃO',
      'TIPO DE OPERAÇÃO': 'CUSTO',
      AVALIAÇÃO: 'SEM AVALIAÇÃO',
      'FORMA DE PAGAMENTO': 'ENERGÉTICA - CAIXA',
      CONCLUÍDO: 'PEDIDO FINALIZADO',
      APROVAÇÃO: 'PENDENTE DE APROVAÇÃO',
      'ETAPA OBRA': 'ALVENARIA E ESTRUTURAS',
      'DATA DE RMS': '21/09/2026',
      'DATA DE COMPRA': '21/09/2026',
      'DATA DE LIQUIDAÇÃO': '20/09/2026',
      'DATA DE PAGAMENTO': '20/09/2026',
      'QUANTIDADE DE ANEXOS': 3,
    },
    attachments: [{ DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' }],
  };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.equal(record.classList.contains('lg-record--powerapps'), false);
  assert.equal(record.querySelector('.lg-record-select'), null);
  for (const selector of ['.lg-record-media', '.lg-record-heading',
    '.lg-record-commercial', '.lg-record-meta', '.lg-record-execution', '.lg-record-badges']) {
    assert.ok(record.querySelector(selector), selector);
  }
  assert.match(record.querySelector('.lg-record-media').textContent, /PDF|3\s*ANEXOS/i);
  assert.match(record.querySelector('.lg-record-badges').textContent, /PEDIDO FINALIZADO|PENDENTE DE APROVAÇÃO/i);
  assert.equal(record.querySelector('[data-lg-action="attachments"]'), null);
  assert.ok(record.querySelector('.lg-record > .lg-button'), 'details stays as the single row action');
});

test('launch cards show a PDF marker on the left when any PDF attachment exists', async t => {
  const pdf = { id: 'pdf-17', fileName: 'comprovante.pdf', mimeType: 'application/pdf', mediaUrl: '/api/portal-media/pdf-17' };
  const image = { id: 'image-17', fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-17' };
  const item = { ...row(), attachments: [image, pdf] };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.dataset.mediaKind, 'pdf');
  assert.match(media.textContent, /PDF/i);
  assert.equal(media.querySelector('img'), null);
});

test('launch cards read PowerApps attachment rows and make the PDF marker openable', async t => {
  const attachments = [
    { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' },
    { DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' },
  ];
  const item = { ...row(3429), fields: { ...row(3429).fields, Anexos: attachments, 'Tem anexos': true } };
  let opened;
  const attachmentPayloads = [];
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') {
        attachmentPayloads.push(payload);
        if (!payload.source) throw new Error("[Erro 13] Permission denied: '/var/lib/energetica-whatsapp/launch-gallery'");
        return {
        fileName: payload.fileName,
        mimeType: payload.fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        mediaUrl: `/api/portal-media/${payload.fileName.replace(/\W+/g, '-').toLowerCase()}`,
        };
      }
      return detail({ item, attachments: [{ fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/pdf-3429' }] });
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'pdf');
  assert.match(media.textContent, /PDF/i);
  media.click(); await settle();
  assert.deepEqual(attachmentPayloads, [
    { id: 3429, fileName: 'foto.jpg', source: '/sharepoint/foto.jpg' },
    { id: 3429, fileName: 'comprovante.pdf', source: '/sharepoint/comprovante.pdf' },
  ]);
  assert.deepEqual(opened, [
    { id: 3429, fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto-jpg', mimeType: 'image/jpeg' },
    { id: 3429, fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante-pdf', mimeType: 'application/pdf' },
  ]);
});

test('launch cards show the actual attachment quantity below the left marker', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.querySelector('.lg-record-attachment-count').textContent, '2 anexos');
});

test('clicking a PowerApps attachment marker opens the attachment navigator instead of launch details', async t => {
  const attachments = [
    { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' },
    { DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' },
  ];
  const item = { ...row(3432), fields: { ...row(3432).fields, Anexos: attachments, 'Tem anexos': true } };
  let opened;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') return {
        fileName: payload.fileName,
        mimeType: payload.fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        mediaUrl: `/api/portal-media/${payload.fileName.replace(/\W+/g, '-').toLowerCase()}`,
      };
      throw new Error(`unexpected ${operation} ${JSON.stringify(payload)}`);
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('.lg-record-media').click(); await settle();
  assert.deepEqual(opened, [
    { id: 3432, fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto-jpg', mimeType: 'image/jpeg' },
    { id: 3432, fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante-pdf', mimeType: 'application/pdf' },
  ]);
  assert.equal(ctx.calls.some(call => call.operation === 'detail'), false);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('attachment marker fetches attachments without rendering launch details when the list is not in the snapshot', async t => {
  const item = { ...row(3433), hasAttachments: true, fields: { ...row(3433).fields, 'QUANTIDADE DE ANEXOS': 2 } };
  let opened;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'detail') return detail({ item, attachments: [
        { fileName: 'um.pdf', mediaUrl: '/media/um.pdf' },
        { fileName: 'dois.jpg', mediaUrl: '/media/dois.jpg' },
      ] });
      throw new Error(`unexpected ${operation} ${JSON.stringify(payload)}`);
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('.lg-record-media').click(); await settle();
  assert.deepEqual(opened, [
    { id: 3433, fileName: 'um.pdf', mediaUrl: '/media/um.pdf' },
    { id: 3433, fileName: 'dois.jpg', mediaUrl: '/media/dois.jpg' },
  ]);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('launch cards keep the first PowerApps image as a clickable preview when no PDF exists', async t => {
  const image = { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' };
  const item = { ...row(3430), fields: { ...row(3430).fields, Anexos: [image], 'Tem anexos': true } };
  let requested;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') return { fileName: payload.fileName, mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-3430' };
      return detail({ item, attachments: [{ fileName: 'foto.jpg', mediaUrl: '/api/portal-media/image-3430' }] });
    },
    loadMediaPreview: async descriptor => { requested = descriptor; return 'blob:https://example.test/preview-image'; },
  });
  await ctx.gallery.open(); await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'image');
  assert.equal(media.querySelector('img')?.src, 'blob:https://example.test/preview-image');
  assert.deepEqual(requested, { fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-3430' });
});

test('a row that only reports attachments still renders an actionable attachment button', async t => {
  const item = { ...row(3431), hasAttachments: true, fields: { ...row(3431).fields, 'QUANTIDADE DE ANEXOS': 3 } };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'attachments');
  assert.match(media.textContent, /anexos/i);
});

test('launch cards load the first image preview on the left when no PDF exists', async t => {
  const image = { id: 'image-17', fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-17' };
  let requested;
  const ctx = await setup(t, {
    request: async operation => operation === 'snapshot'
      ? snapshot({ rows: [{ ...row(), attachments: [image] }] }) : detail(),
    loadMediaPreview: async descriptor => { requested = descriptor; return 'blob:https://example.test/preview-image'; },
  });
  await ctx.gallery.open(); await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.dataset.mediaKind, 'image');
  assert.equal(media.querySelector('img')?.src, 'blob:https://example.test/preview-image');
  assert.deepEqual(requested, image);
});

test('summary omits unavailable PowerApps fields instead of rendering empty labels', async t => {
  const minimal = {id: 8, total: 0, hasAttachments: false, fields: {PRODUTO: 'AREIA'}};
  const ctx = await setup(t, {request: async operation => operation === 'snapshot'
    ? snapshot({rows: [minimal]}) : detail({item: minimal})});
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.ok(record);
  assert.match(record.textContent, /AREIA/);
  assert.doesNotMatch(record.textContent, /undefined|null|DATA DE PAGAMENTO|AVALIAÇÃO/);
});

test('late snapshots cannot replace newer rows or user filter edits and close invalidates loads', async t => {
  const pending = [];
  const ctx = await setup(t, { request: () => { const d = deferred(); pending.push(d); return d.promise; } });
  const first = ctx.gallery.open();
  input(ctx, 'id', '22');
  input(ctx, 'id', 'unsubmitted');
  pending[1].resolve(snapshot({ rows: [row(22)] })); await settle();
  pending[0].resolve(snapshot({ rows: [row(17)] })); await first;
  assert.equal(ctx.root().querySelector('[name="id"]').value, 'unsubmitted');
  assert.doesNotMatch(ctx.root().querySelector('.lg-cards').textContent, /#22\b|#17\b/);
  pending[2].resolve(snapshot({ rows: [row(23)] })); await settle();
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-record-id')].map(node => node.textContent), ['23']);
  input(ctx, 'id', '99');
  ctx.gallery.close(); pending[3].resolve(snapshot({ rows: [row(99)] })); await settle();
  assert.equal(ctx.root().hidden, true);
  assert.doesNotMatch(ctx.root().querySelector('.lg-cards').textContent, /#99\b/);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
});

test('snapshot failure is actionable, retry clears busy and empty results are explicit', async t => {
  let count = 0;
  const ctx = await setup(t, { request: async () => { if (!count++) throw new Error('Sem conexão'); return snapshot({ rows: [], count: 0, pages: 0 }); } });
  await ctx.gallery.open();
  assert.match(ctx.root().textContent, /Sem conexão/);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
  button(ctx.root(), 'Tentar novamente').click(); await settle();
  assert.match(ctx.root().textContent, /Nenhum lançamento/);
  assert.equal(button(ctx.root(), 'Próxima página').disabled, true);
});

test('details render human fields and readable HTML without executable or resource elements', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  const panel = ctx.root().querySelector('.lg-detail');
  assert.match(panel.textContent, /Primeira & segunda\s+Linha 2/);
  assert.doesNotMatch(panel.textContent, /unsafe\(\)|<p>/);
  assert.equal(panel.querySelector('script, img, iframe, svg'), null);
  for (const label of ['FORNECEDOR', 'FILIAL', 'QUANTIDADE', 'UN', 'VALOR UNITÁRIO', 'FRETE', 'CONCLUÍDO']) assert.ok(panel.textContent.includes(label));
  assert.equal([...ctx.root().querySelectorAll('button')].some(b => /aprovar/i.test(b.textContent)), false);
});

test('details open as an over-gallery table and format every displayed date as dd/mm/yyyy', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  const panel = ctx.root().querySelector('.lg-detail');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.ok(panel.classList.contains('lg-detail-modal'));
  assert.ok(panel.querySelector('table.lg-data-table'));
  assert.match(panel.textContent, /17\/09\/2026/);
  assert.match(panel.textContent, /18\/09\/2026/);
  assert.doesNotMatch(panel.textContent, /2026-09-17|2026-09-18T12:34:56Z/);
  button(panel, 'Fechar detalhes').click();
  assert.equal(panel.hidden, true);
  assert.equal(ctx.root().hidden, false);
});

test('Escape closes the detail screen before closing the gallery', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  ctx.root().dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(ctx.root().hidden, false);
});

test('edit is retained during list reload, explicitly reviewed, locked on save and retried without losing draft', async t => {
  const save = deferred(); let attempts = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot();
    if (op === 'detail') return detail();
    if (op === 'update' && !attempts++) return save.promise;
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Editar').click();
  const field = input(ctx, 'QUANTIDADE', '3.75', ctx.root().querySelector('.lg-editor'));
  input(ctx, 'id', '17'); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor [name="QUANTIDADE"]'), field);
  button(ctx.root(), 'Revisar alterações').click();
  assert.equal(mutations(ctx).length, 0);
  assert.match(ctx.root().querySelector('.lg-review').textContent, /3[.,]75/);
  button(ctx.root(), 'Confirmar alterações').click();
  button(ctx.root(), 'Confirmar alterações').click();
  assert.deepEqual(mutations(ctx), [{ operation: 'update', payload: { id: 17,
    fields: { QUANTIDADE: 3.75 },
    confirm: true, expectedModified: '2026-09-18T12:34:56Z' } }]);
  assert.equal(field.disabled, true);
  save.reject(new Error('Conflito; confira o lançamento')); await settle();
  assert.equal(field.value, '3.75');
  assert.equal(field.disabled, false);
  assert.match(ctx.root().textContent, /Conflito/);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(mutations(ctx).length, 2);
  assert.equal(ctx.root().querySelector('.lg-editor'), null);
});

test('changing a reviewed input invalidates confirmation; closing and reopening never saves or loses the form', async t => {
  const ctx = await setup(t); await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Editar').click(); input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'Revisar alterações').click(); input(ctx, 'QUANTIDADE', '5');
  assert.equal(ctx.root().querySelector('.lg-review')?.hidden ?? true, true);
  ctx.gallery.close(); await ctx.gallery.open();
  assert.equal(ctx.root().querySelector('.lg-editor [name="QUANTIDADE"]').value, '5');
  assert.equal(mutations(ctx).length, 0);
});

test('delete requires explicit confirmation and carries raw Modificado fallback', async t => {
  const item = row(); delete item.fields.Modified; item.fields.Modificado = 'raw-version';
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot() : op === 'detail' ? detail({ item }) : {} });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Excluir lançamento').click();
  assert.equal(mutations(ctx).length, 0);
  button(ctx.root(), 'Cancelar confirmação').click();
  assert.equal(mutations(ctx).length, 0);
  button(ctx.root(), 'Excluir lançamento').click(); button(ctx.root(), 'Confirmar exclusão').click(); await settle();
  assert.deepEqual(mutations(ctx), [{ operation: 'delete', payload: { id: 17, confirm: true, expectedModified: 'raw-version' } }]);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('payment and measurement validate dynamic fields, require review and reuse UUID after ambiguous failure', async t => {
  const seen = new Set();
  const ctx = await setup(t, { request: async (op, payload) => {
    if (op === 'snapshot') return snapshot(); if (op === 'detail') return detail();
    if (!seen.has(op)) { seen.add(op); throw new Error('Resposta perdida'); }
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  for (const operation of ['payment', 'measurement']) {
    button(ctx.root(), operation === 'payment' ? 'Provisionar pagamento' : 'Aplicar medição').click();
    if (operation === 'payment') input(ctx, 'date', '2026-10-02');
    else { input(ctx, 'DATA', '2026-09-19'); input(ctx, 'QUANTIDADE', '0'); input(ctx, 'CONFERIDO', true); }
    button(ctx.root(), 'Revisar alterações').click();
    const before = mutations(ctx).length;
    button(ctx.root(), 'Confirmar alterações').click(); await settle();
    assert.equal(mutations(ctx).length, before + 1);
    const first = mutations(ctx).at(-1).payload;
    assert.match(first.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(first.confirm, true);
    assert.equal(first.expectedModified, row().fields.Modified);
    button(ctx.root(), 'Confirmar alterações').click(); await settle();
    assert.deepEqual(mutations(ctx).at(-1).payload, first);
    if (operation === 'payment') assert.equal(first.date, '2026-10-02');
    else assert.deepEqual(first.fields, { DATA: '2026-09-19', QUANTIDADE: 0, CONFERIDO: true });
  }
});

test('measurement retry keeps requestId after refreshing a changed launch version', async t => {
  let version = '2026-09-18T12:34:56Z';
  const attempts = [];
  const ctx = await setup(t, { request: async (operation, payload) => {
    if (operation === 'snapshot') return snapshot();
    if (operation === 'detail') return detail({item: {...row(), expectedModified: version, fields: {...row().fields, Modified: version}}});
    if (operation === 'measurement') { attempts.push(payload); throw new Error('Vínculo pendente'); }
    return {ok: true};
  }});
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Aplicar medição').click();
  input(ctx, 'DATA', '2026-09-19'); input(ctx, 'QUANTIDADE', '1');
  button(ctx.root(), 'Revisar alterações').click(); button(ctx.root(), 'Confirmar alterações').click(); await settle();
  button(ctx.root(), 'Cancelar confirmação').click(); button(ctx.root(), 'Cancelar edição').click();
  button(ctx.root(), 'Fechar detalhes').click();
  version = '2026-09-19T13:00:00Z';
  await showDetail(ctx);
  button(ctx.root(), 'Aplicar medição').click();
  input(ctx, 'DATA', '2026-09-19'); input(ctx, 'QUANTIDADE', '1');
  button(ctx.root(), 'Revisar alterações').click(); button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  assert.notEqual(attempts[0].expectedModified, attempts[1].expectedModified);
});

test('selecting a measurement contract refreshes dependent demonstrative options', async t => {
  const fields = [
    {name: 'NUMEROCONTRATO', label: 'Contrato', type: 'choice', required: true,
      options: [{value: '7', label: '7 - Fornecedor A'}, {value: '9', label: '9 - Fornecedor B'}]},
    {name: 'DEMONSTRATIVOETAPA', label: 'Descrição etapa', type: 'choice',
      options: [{value: '8', label: '8 - Fundação'}]},
  ];
  const ctx = await setup(t, {request: async (operation, payload) => {
    if (operation === 'snapshot') return snapshot();
    if (operation === 'detail') return detail({measurementFields: fields});
    if (operation === 'schema') return {fields: [fields[0], {...fields[1], options: [{value: '10', label: '10 - Alvenaria'}]}]};
    return {ok: true};
  }});
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Aplicar medição').click();
  input(ctx, 'DEMONSTRATIVOETAPA', '8');
  input(ctx, 'NUMEROCONTRATO', '9'); await settle();
  assert.deepEqual(ctx.calls.find(call => call.operation === 'schema'), {operation: 'schema', payload: {
    id: 17, scope: 'measurement', fields: {NUMEROCONTRATO: '9'},
  }});
  const demonstrative = ctx.root().querySelector('[name="DEMONSTRATIVOETAPA"]');
  assert.deepEqual([...demonstrative.options].map(option => option.value), ['', '10']);
  assert.equal(demonstrative.value, '');
});

test('attachments navigate names and use existing viewer, hiding overlay until viewer settles', async t => {
  const viewer = deferred(); const opened = [];
  const ctx = await setup(t, { request: async (op, payload) => op === 'snapshot' ? snapshot() : op === 'detail' ? detail() :
    { mediaUrl: 'https://example.test/two', fileName: payload.fileName, mimeType: 'image/png' },
  openMedia: descriptor => { opened.push(descriptor); return viewer.promise; } });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Próximo anexo').click();
  assert.match(ctx.root().querySelector('.lg-attachments').textContent, /dois.png/);
  button(ctx.root(), 'Abrir / salvar anexo').click(); await settle();
  assert.deepEqual(ctx.calls.at(-1), { operation: 'attachment', payload: { id: 17, fileName: 'dois.png' } });
  assert.deepEqual(opened, [{ mediaUrl: 'https://example.test/two', fileName: 'dois.png', mimeType: 'image/png' }]);
  assert.equal(ctx.root().hidden, true);
  viewer.resolve(); await settle();
  assert.equal(ctx.root().hidden, false);
  button(ctx.root(), 'Anexo anterior').click();
  assert.match(ctx.root().querySelector('.lg-attachments').textContent, /um.pdf/);
});

test('attachment add/remove and captured signature use explicit confirmations and upload contracts', async t => {
  const uploads = [], capture = deferred();
  const ctx = await setup(t, { upload: async (...args) => { uploads.push(args); }, captureSignature: () => capture.promise });
  await ctx.gallery.open(); await showDetail(ctx);
  const file = new ctx.dom.window.File(['x'], 'novo.pdf', { type: 'application/pdf' });
  const fileInput = ctx.root().querySelector('input[type=file]');
  Object.defineProperty(fileInput, 'files', { value: [file] });
  fileInput.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(uploads.length, 0);
  button(ctx.root(), 'Confirmar envio').click(); await settle();
  assert.deepEqual(uploads[0], [17, file, { operation: 'attachment_add', confirm: true, expectedModified: row().fields.Modified }]);
  button(ctx.root(), 'Remover anexo').click();
  button(ctx.root(), 'Confirmar remoção').click(); await settle();
  assert.deepEqual(mutations(ctx).at(-1), { operation: 'attachment_delete', payload: { id: 17, fileName: 'um.pdf', confirm: true, expectedModified: row().fields.Modified } });
  button(ctx.root(), 'Desenhar assinatura').click(); await settle();
  assert.equal(ctx.root().hidden, true);
  const signature = new ctx.dom.window.File(['png'], 'assinatura.png', { type: 'image/png' });
  capture.resolve(signature); await settle();
  assert.equal(ctx.root().hidden, false);
  assert.equal(ctx.root().querySelector('canvas'), null);
  button(ctx.root(), 'Confirmar assinatura').click(); await settle();
  assert.deepEqual(uploads[1], [17, signature, { operation: 'signature', confirm: true, expectedModified: row().fields.Modified }]);
});

test('closing during signature capture never uploads or restores a closed gallery', async t => {
  const capture = deferred(); let uploads = 0;
  const ctx = await setup(t, { captureSignature: () => capture.promise, upload: async () => uploads++ });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Desenhar assinatura').click(); await settle();
  ctx.gallery.close(); capture.resolve(new ctx.dom.window.File(['png'], 's.png')); await settle();
  assert.equal(ctx.root().hidden, true);
  assert.equal(uploads, 0);
});

test('stale detail responses are discarded and failed detail can be retried', async t => {
  const one = deferred(), two = deferred(); let count = 0;
  const ctx = await setup(t, { request: async (op, payload) => op === 'snapshot' ? snapshot({ rows: [row(17), row(18)] }) :
    payload?.purpose === 'attachment-count' ? detail({ item: row(payload.id) })
      : ++count === 1 ? one.promise : count === 2 ? two.promise : detail({ item: row(18) }) });
  await ctx.gallery.open();
  const buttons = [...ctx.root().querySelectorAll('[data-lg-action="details"]')];
  buttons[0].click(); buttons[1].click();
  two.reject(new Error('Falha ao abrir')); await settle();
  one.resolve(detail()); await settle();
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /Falha ao abrir/);
  button(ctx.root().querySelector('.lg-detail'), 'Tentar novamente').click(); await settle();
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /#18/);
});

test('invalid periods and required fields prevent review and calls; editing blocks replacement of its detail', async t => {
  const ctx = await setup(t); await ctx.gallery.open();
  input(ctx, 'dateStart', '2026-10-01'); input(ctx, 'dateEnd', '2026-09-01');
  await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').length, 2);
  assert.match(ctx.root().querySelector('[role=alert]').textContent, /data final/);
  await showDetail(ctx);
  button(ctx.root(), 'Aplicar medição').click();
  button(ctx.root(), 'Revisar alterações').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  const form = ctx.root().querySelector('.lg-editor');
  input(ctx, 'QUANTIDADE', '12', form);
  button(ctx.root(), 'Detalhes').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor'), form);
  assert.equal(form.querySelector('[name="QUANTIDADE"]').value, '12');
  assert.equal(ctx.calls.filter(c => c.operation === 'detail' && c.payload.purpose !== 'attachment-count').length, 1);
  assert.equal(mutations(ctx).length, 0);
});

test('cancelled and rejected signature capture restore the overlay without sending any file', async t => {
  let count = 0, uploads = 0;
  const ctx = await setup(t, { captureSignature: async () => {
    if (!count++) return null;
    throw new Error('Captura indisponível');
  }, upload: async () => uploads++ });
  await ctx.gallery.open(); await showDetail(ctx);
  for (let i = 0; i < 2; i++) {
    button(ctx.root(), 'Desenhar assinatura').click(); await settle();
    assert.equal(ctx.root().hidden, false);
    assert.equal(button(ctx.root(), 'Desenhar assinatura').disabled, false);
    assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
  }
  assert.match(ctx.root().querySelector('[role=alert]').textContent, /Captura indisponível/);
  assert.equal(uploads, 0);
});

test('viewer returning after loading restores gallery while its top-layer dialog remains open', async t => {
  let modal;
  const ctx = await setup(t, { openMedia: async () => {
    modal = ctx.document.createElement('dialog'); modal.setAttribute('open', ''); ctx.document.body.append(modal);
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Abrir / salvar anexo').click(); await settle();
  assert.equal(ctx.root().hidden, false);
  assert.equal(modal.hasAttribute('open'), true);
  assert.equal(button(ctx.root(), 'Abrir / salvar anexo').disabled, false);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
});

test('attachment read and viewer failures leave actionable errors with a usable overlay', async t => {
  let fetches = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot(); if (op === 'detail') return detail();
    if (!fetches++) throw new Error('Arquivo expirado');
    return { fileName: 'um.pdf', mediaUrl: '/one', mimeType: 'application/pdf' };
  }, openMedia: async () => { throw new Error('Viewer indisponível'); } });
  await ctx.gallery.open(); await showDetail(ctx);
  for (const message of ['Arquivo expirado', 'Viewer indisponível']) {
    button(ctx.root(), 'Abrir / salvar anexo').click(); await settle();
    assert.equal(ctx.root().hidden, false);
    assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
    assert.ok(ctx.root().querySelector('[role=alert]').textContent.includes(message));
  }
});

test('a confirmed mutation is never resent when its detail refresh fails', async t => {
  let details = 0;
  const ctx = await setup(t, { request: async (op, payload) => {
    if (op === 'snapshot') return snapshot();
    if (op === 'detail' && payload?.purpose === 'attachment-count') return detail();
    if (op === 'detail') { if (++details === 2) throw new Error('Falha na atualização'); return detail(); }
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), 'Editar').click(); input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'Revisar alterações').click(); button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor'), null);
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /Falha na atualização/);
  button(ctx.root().querySelector('.lg-detail'), 'Tentar novamente').click(); await settle();
  assert.equal(mutations(ctx).length, 1);
  assert.equal(button(ctx.root(), 'Editar').disabled, false);
});

test('gallery stylesheet keeps tools/signature above it and hidden overlays out of hit testing', async t => {
  const ctx = await setup(t); await ctx.gallery.open();
  const style = ctx.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(style);
  const computed = ctx.dom.window.getComputedStyle(ctx.root());
  assert.equal(computed.position, 'fixed');
  assert.ok(Number(computed.zIndex) > 2 && Number(computed.zIndex) < 20);
  assert.equal(ctx.dom.window.getComputedStyle(button(ctx.root(), 'Voltar')).minHeight, '44px');
  ctx.gallery.close();
  assert.equal(ctx.dom.window.getComputedStyle(ctx.root()).display, 'none');
});

test('gallery stylesheet keeps the stable row grid and reflows every record on mobile', () => {
  const css = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  assert.match(css, /--lg-navy:\s*#0b3764/i);
  assert.match(css, /--lg-red:\s*#b51f24/i);
  assert.match(css, /\.lg-record:nth-child\(even\)/);
  assert.match(css, /\.lg-record\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(css, /\.lg-record-main\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css, /\.lg-record--powerapps\s*\{/);
  assert.doesNotMatch(css, /\.lg-record-select\s*\{/);
  assert.match(css, /\.lg-record-media\s*\{[^}]*cursor:\s*pointer/s);
  assert.match(css, /\.lg-record-badge[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.lg-record-main\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.lg-record\s*>\s*\.lg-button\s*\{[^}]*min-height:\s*44px/s);
});

test('pending file selection survives a successful edit and its asynchronous detail refresh', async t => {
  const uploads = [];
  const ctx = await setup(t, { upload: async (...args) => uploads.push(args) });
  await ctx.gallery.open(); await showDetail(ctx);
  const file = new ctx.dom.window.File(['doc'], 'ainda-nao-enviado.pdf');
  const inputFile = ctx.root().querySelector('input[type=file]');
  Object.defineProperty(inputFile, 'files', { value: [file] });
  inputFile.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  button(ctx.root(), 'Editar').click(); input(ctx, 'QUANTIDADE', '8');
  button(ctx.root(), 'Revisar alterações').click(); button(ctx.root(), 'Confirmar alterações').click(); await settle();
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false, 'the selected file must not be silently discarded by refresh');
  button(ctx.root(), 'Confirmar envio').click(); await settle();
  assert.equal(uploads[0][1], file);
});
