import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOrdersGalleryData } from '../src/chat/orders-gallery-data.js';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';
import entities from '../../../portal/catalog/entities.js';
import { mapSharePointColumns } from '../../../portal/data/column-mapper.js';
import { resolvePowerAppsUiContract } from '../../../portal/catalog/powerapps-ui-contract.js';
import { POWERAPPS_FORM_VARIANTS } from '../../../portal/catalog/powerapps-form-controls.generated.js';

const columns = [
  { name: 'DATAPEDIDO', displayName: 'DATA PEDIDO', dateTime: { format: 'dateOnly' } },
  { name: 'DATAPGTOEFETUADO', dateTime: { format: 'dateOnly' } },
  { name: 'OBS', text: {} },
];
const entity = entities.find(e => e.id === 'notas-pendentes');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const variant of POWERAPPS_FORM_VARIANTS['notas-pendentes'].filter(v => v.modes.includes('edit'))) {
  test(`${variant.formName} edits DATA PEDIDO using its own metadata`, () => {
    const contract = resolvePowerAppsUiContract(entity, mapSharePointColumns(columns, entity), { mode: 'edit', formVariantId: variant.id });
    const dates = contract.formColumns.filter(c => c.control === 'date');
    assert.deepEqual(dates.map(c => [c.name, c.label]), [['DATAPEDIDO', 'DATA PEDIDO']]);
  });
}

for (const [name, date] of [['saved order date', '2026-10-25T03:00:00Z'], ['empty order date', null]]) {
  test(`orders screen preselects ${name} and persists only the chosen date after review`, async t => {
    const writes = [];
    const original = { DATAPEDIDO: date, DATAPGTOEFETUADO: '2026-10-28T03:00:00Z', OBS: 'ORIGINAL' };
    const repository = {
      async resolveList() { return { id: 'orders', status: 'resolved' }; },
      async getItemsPage() { return { items: [], hasMore: false }; },
      async getColumns() { return columns; },
      async getItem(_site, _list, id) { return { id, eTag: '"original"', fields: original }; },
      async updateItem(_site, _list, id, fields, options) { writes.push({ fields, options }); return { id, fields }; },
    };
    const data = createOrdersGalleryData({ repository });
    const dom = new JSDOM('<main></main>');
    const host = dom.window.document.querySelector('main');
    const actions = createGalleryRecordActions({ document: dom.window.document, host,
      loadEditor: data.loadEditor, saveEditor: data.saveEditor });
    t.after(() => { actions.destroy(); dom.window.close(); });
    host.append(actions.render({ id: '452', fields: original }));
    host.querySelector('[data-gallery-action="edit"]').click();
    for (let i = 0; i < 50 && !host.querySelector('form'); i++) await tick();
    const input = host.querySelector('[name="DATAPEDIDO"]');
    assert.ok(input);
    assert.equal(input.type, 'date');
    assert.equal(input.value, date ? '2026-10-25' : '');
    assert.equal(host.querySelector('[name="DATAPGTOEFETUADO"]'), null);
    assert.equal(input.closest('[data-edit-changed]'), null);
    assert.equal(original.DATAPEDIDO, date);
    input.value = '2026-10-26';
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    host.querySelector('form').requestSubmit();
    const review = dom.window.document.querySelector('[data-edit-review]');
    assert.ok(review);
    assert.match(review.textContent, /DATA PEDIDO/);
    assert.match(review.textContent, /26\/10\/2026/);
    assert.equal(writes.length, 0);
    review.querySelector('[data-edit-review-submit]').click();
    for (let i = 0; i < 50 && !writes.length; i++) await tick();
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].fields, { DATAPEDIDO: '2026-10-26' });
    assert.equal(writes[0].options.eTag, '"original"');
    assert.equal(original.DATAPGTOEFETUADO, '2026-10-28T03:00:00Z');
  });
}
