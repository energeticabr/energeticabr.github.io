import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { REGISTRATION_GALLERY_MODELS, createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

test('validation gallery reads paginated DESCRITIVOPRESENCA and filters without writes', async () => {
  const model = REGISTRATION_GALLERY_MODELS.presenceValidation;
  assert.ok(model, 'a separate validation gallery model is registered');
  assert.equal(model.listName, 'DESCRITIVOPRESENCA');
  assert.equal(model.editFormVariant, REGISTRATION_GALLERY_MODELS.presenceDescriptions.editFormVariant);
  assert.equal(model.title, 'GALERIA VALIDAR PRESENÇAS');
  const requested = [];
  const data = createRegistrationGalleryData({ kind: 'presenceValidation', repository: {
    async resolveList(site, aliases) { assert.equal(site, 'personal'); assert.equal(aliases[0], 'DESCRITIVOPRESENCA'); return { status: 'resolved', id: 'descritivos' }; },
    async getItemsPage(site, list, options) {
      assert.equal(list, 'descritivos'); requested.push(options);
      return requested.length === 1
        ? { items: [{ id: '42', fields: { FORNECEDOR: 'Fornecedor Exemplo', DATA: '2026-11-01', FILIAL: 'Obra A', PRESENCA: 'PENDENTE' } }], hasMore: true, nextLink: 'pagina-2' }
        : { items: [{ id: '43', fields: { FORNECEDOR: 'Outro Exemplo', DATA: '2026-10-31', FILIAL: 'Obra B', PRESENCA: 'PRESENTE' } }], hasMore: false };
    },
    async updateItem() { assert.fail('opening must never validate/write'); },
    async deleteItem() { assert.fail('opening must never delete'); },
  } });
  const snapshot = await data.loadSnapshot();
  assert.equal(requested.length, 2);
  assert.deepEqual(snapshot.rows.map(row => row.id).sort(), ['42', '43']);
  const dom = new JSDOM('<body></body>'), opened = [];
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'presenceValidation', data: {
    async loadSnapshot() { return snapshot; },
    async listAttachments(id) { return [{ fileName: `presenca-${id}.pdf` }]; },
    downloadAttachment(id, name) { return `${id}/${name}`; },
  }, openMediaCollection(items) { opened.push(items); } });
  try {
    await gallery.open();
    const doc = dom.window.document;
    assert.equal(doc.querySelector('[role="dialog"] h1').textContent, model.title);
    const filter = doc.querySelector('[data-filter-field="PRESENCA"]');
    filter.value = 'PENDENTE'; filter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(doc.querySelectorAll('[data-registration-row]').length, 1);
    const row = doc.querySelector('[data-registration-row="42"]');
    assert.ok(row.querySelector('[data-gallery-action="edit"]'));
    row.querySelector('[data-action="registration-attachments"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await opened[0][0].source({}), '42/presenca-42.pdf');
  } finally { gallery.destroy(); dom.window.close(); }
});
