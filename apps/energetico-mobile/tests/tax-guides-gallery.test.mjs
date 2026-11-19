import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';

const rows = [
  { id: '1', hasAttachments: false, fields: { TIPO: 'INSS', FILIAL: '000 - CENTRAL', COMPETENCIA: '2026-10-01T12:00:00Z', VALOR: null, VENCIMENTO: null } },
  { id: '2', hasAttachments: true, fields: { TIPO: 'FGTS', FILIAL: '004 - OBRA', COMPETENCIA: '2026-10-01T12:00:00Z', VALOR: 1407.4, VENCIMENTO: '2026-11-19T12:00:00Z' } },
];

test('tax guides show the requested fields, pending requests, and only their own attachments', async t => {
  const dom = new JSDOM('<!doctype html><body></body>');
  t.after(() => dom.window.close());
  const opened = [];
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'taxGuides', data: {
    loadSnapshot: async () => ({ rows }), listAttachments: async id => id === '2' ? [{ fileName: 'guia-oficial.pdf' }] : [],
    downloadAttachment: (id, name) => `${id}/${name}`,
  }, openMediaCollection: files => opened.push(files) });
  t.after(() => gallery.destroy());
  await gallery.open();
  await new Promise(resolve => setImmediate(resolve));
  const doc = dom.window.document;
  const pending = doc.querySelector('[data-registration-row="1"]');
  assert.match(pending.textContent, /Anexar guia INSS/);
  assert.match(pending.textContent, /Data vencimento/);
  assert.match(pending.textContent, /Data competência/);
  assert.match(pending.textContent, /01\/10\/2026/);
  assert.doesNotMatch(pending.textContent, /R\$\s*0,00/);
  assert.equal(pending.querySelector('[data-gallery-action="delete"]'), null);
  assert.ok(pending.querySelector('[data-gallery-action="edit"]'));
  const attached = doc.querySelector('[data-registration-row="2"]');
  assert.match(attached.textContent, /Guia anexada/);
  assert.match(attached.textContent, /1\.407,40/);
  attached.querySelector('[data-action="registration-attachments"]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened.length, 1);
  assert.equal(await opened[0][0].source({}), '2/guia-oficial.pdf');
  const type = doc.querySelector('select[data-filter="TIPO"], select[name="TIPO"]')
    || [...doc.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'FGTS'));
  assert.ok(type);
  type.value = 'FGTS'; type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('[data-registration-row="1"]'), null);
  assert.ok(doc.querySelector('[data-registration-row="2"]'));
});

test('tax guide editor keeps monthly identity immutable and enables authenticated guide upload', async () => {
  const columns = [
    { name: 'CHAVE', text: {} }, { name: 'Title', text: {} },
    { name: 'TIPO', displayName: 'Tipo', choice: { choices: ['INSS', 'FGTS'] }, required: true },
    { name: 'FILIAL', displayName: 'Filial', text: {}, required: true },
    { name: 'COMPETENCIA', displayName: 'Data competência', dateTime: { format: 'dateOnly' }, required: true },
    { name: 'VENCIMENTO', displayName: 'Data vencimento', dateTime: { format: 'dateOnly' } },
    { name: 'VALOR', displayName: 'Valor', currency: { locale: 'pt-BR' } },
  ];
  const data = createRegistrationGalleryData({ kind: 'taxGuides', repository: {
    resolveList: async (_site, aliases) => { assert.equal(aliases[0], 'GUIASINSSFGTS'); return { status: 'resolved', id: 'guides' }; },
    getColumns: async () => columns,
    getItem: async () => ({ ...rows[0], eTag: '"v1"' }),
    listAttachments: async () => [], uploadAttachment: async () => {}, deleteAttachment: async () => {},
  } });
  const context = await data.loadEditor('1');
  assert.equal(context.attachments.canEdit, true);
  assert.deepEqual(context.columns.filter(c => c.readOnly).map(c => c.name).sort(), ['COMPETENCIA', 'FILIAL', 'TIPO']);
  assert.deepEqual(context.columns.filter(c => !c.readOnly).map(c => c.name).sort(), ['VALOR', 'VENCIMENTO']);
});
