import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { persistEntityRecord } from '../../../portal/forms/entity-submit.js';
const entity = { id: 'fornecedores', siteKey: 'personal' }, list = { id: 'suppliers' };
test('supplier portal edit refuses inactive contractor without termination or with an earlier date', async () => {
  const writes = [], repository = { updateItem: async (...args) => { writes.push(args); } };
  const item = { id: '17', eTag: '"1"', fields: { EMPREITEIRO: 'SIM', STATUS: 'ATIVO', DATAADMISSAO: '2026-01-20' } };
  for (const fields of [{ STATUS: 'INATIVO' }, { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-19' }, { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-02-30' }]) {
    await assert.rejects(persistEntityRecord(repository, entity, list, { mode: 'edit', item, fields }), /desligamento|admissão/i);
  }
  assert.equal(writes.length, 0);
  await persistEntityRecord(repository, entity, list, { mode: 'edit', item, fields: { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-20' } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][4].eTag, '"1"');
});
test('portal date prompt cancellation performs no writes', async () => {
  const dom = new JSDOM('<main></main>'), writes = [];
  try {
    const pending = persistEntityRecord({ updateItem: async (...args) => writes.push(args) }, entity, list, {
      mode: 'edit', item: { id: '17', eTag: '"1"', fields: { EMPREITEIRO: 'SIM', STATUS: 'ATIVO', DATAADMISSAO: '2026-01-20' } },
      fields: { STATUS: 'INATIVO' }, document: dom.window.document,
    });
    await new Promise(resolve => setImmediate(resolve));
    const cancel = dom.window.document.querySelector('[data-action="cancel-termination"]');
    assert.ok(cancel, 'supplier edit must request a date before writing');
    cancel.click();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(writes.length, 0);
  } finally { dom.window.close(); }
});
test('portal date prompt validates input then saves the selected date on the original ETag', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, writes = [];
  try {
    const pending = persistEntityRecord({ updateItem: async (...args) => { writes.push(args); return { id: '17' }; } }, entity, list, {
      mode: 'edit', item: { id: '17', eTag: '"4"', fields: { EMPREITEIRO: 'SIM', STATUS: 'ATIVO', DATAADMISSAO: '2026-01-20T00:00:00Z' } },
      fields: { STATUS: 'INATIVO' }, document: doc,
    });
    await new Promise(resolve => setImmediate(resolve));
    const form = doc.querySelector('form'), date = form.querySelector('input');
    date.value = '2026-01-19';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(doc.querySelector('[role="alert"]').textContent, /anterior à admissão/);
    assert.equal(writes.length, 0);
    date.value = '2026-01-21';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await pending;
    assert.deepEqual(writes[0], ['personal', 'suppliers', '17', { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-21' }, { eTag: '"4"' }]);
    assert.equal(doc.querySelector('dialog'), null);
  } finally { dom.window.close(); }
});
test('unrelated non-contractor supplier edits retain their existing write behavior', async () => {
  const writes = [];
  await persistEntityRecord({ updateItem: async (...args) => writes.push(args) }, entity, list, {
    mode: 'edit', item: { id: '17', eTag: '"1"', fields: { EMPREITEIRO: 'NÃO' } }, fields: { STATUS: 'INATIVO' },
  });
  assert.deepEqual(writes[0][3], { STATUS: 'INATIVO' });
});
