import test from 'node:test';
import assert from 'node:assert/strict';
import { createGalleryRecordData } from '../src/chat/gallery-record-data.js';

function fixture(fields = {}, listName = 'DESCRITIVOPROVISAO') {
  const writes = [], repository = {
    getItem: async () => ({ id: '7', eTag: 'v1', fields: { FILIAL: '  legado  ', OBS: 'ANTIGO', ...fields } }),
    getColumns: async () => [{ name: 'FILIAL', text: {}, required: true }, { name: 'OBS', text: {} },
      { name: 'Title', text: {} }, { name: 'SECRET', text: {} }, { name: 'STATUS', readOnly: true, text: {} }],
    updateItem: async (_site, _list, _id, patch) => { writes.push(patch); return { id: '7' }; },
  };
  return { writes, data: createGalleryRecordData({ repository, listName, metadataOnly: true,
    resolveList: async () => ({ id: 'parents' }) }) };
}
test('field-scoped save validates baseline required fields and never normalizes untouched fields into writes', async () => {
  const f = fixture(), context = await f.data.loadEditor('7');
  await f.data.saveEditor(context, { OBS: 'novo' }, { editedFields: ['OBS'] });
  assert.deepEqual(f.writes, [{ OBS: 'NOVO' }]);
  const invalid = fixture({ FILIAL: '' });
  await assert.rejects(invalid.data.saveEditor(await invalid.data.loadEditor('7'), { OBS: 'novo' }, { editedFields: ['OBS'] }), /FILIAL/);
  assert.deepEqual(invalid.writes, []);
});
test('parent field scope rejects protected, unknown and readonly destinations', async () => {
  for (const name of ['Title', 'ID', 'SECRET', 'STATUS', 'unknown']) {
    const f = fixture(); const context = await f.data.loadEditor('7');
    await assert.rejects(f.data.saveEditor(context, { [name]: 'unsafe' }, { editedFields: [name] }), /campo|escopo|editável/i);
    assert.deepEqual(f.writes, []);
  }
});
test('field-scoped save is unavailable outside metadata-only provision parents', async () => {
  const f = fixture({}, 'UNRELATED');
  await assert.rejects(f.data.saveEditor(await f.data.loadEditor('7'), { OBS: 'novo' }, { editedFields: ['OBS'] }), /escopo|descritivo/i);
  assert.deepEqual(f.writes, []);
});
test('field-scoped save rejects extra fields and forged cloned contexts', async () => {
  const f = fixture(), context = await f.data.loadEditor('7');
  await assert.rejects(f.data.saveEditor(context, { OBS: 'novo', FILIAL: 'outra' }, { editedFields: ['OBS'] }), /campo|escopo/i);
  await assert.rejects(f.data.saveEditor({ ...context }, { OBS: 'novo' }, { editedFields: ['OBS'] }), /contexto/i);
  assert.deepEqual(f.writes, []);
});
