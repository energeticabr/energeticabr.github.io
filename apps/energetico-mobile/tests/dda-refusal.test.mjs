import test from 'node:test';
import assert from 'node:assert/strict';
import { createDdaRefusal } from '../src/chat/dda-refusal.js';

const row = { id: '7', key: 'boleto-7' };

test('refusal retries a concurrent bank update using the new item version and verifies the dedicated field', async () => {
  let current = { id: row.id, eTag: '"1"', fields: { CHAVE_DDA: row.key, SITUACAO: 'Em aberto' } };
  const writes = [];
  const rejectDda = createDdaRefusal({ repository: {
    async resolveList(site, aliases) {
      assert.deepEqual([site, aliases], ['personal', ['DDAS SICOOB']]);
      return { status: 'resolved', id: 'dda-list' };
    },
    async getItem(site, list, id, _query, options) {
      assert.deepEqual([site, list, id], ['personal', 'dda-list', row.id]);
      assert.equal(options.includeVersion, true);
      return current;
    },
    async updateItem(_site, _list, _id, fields, { eTag, readbackFields }) {
      assert.deepEqual(fields, { DDA_RECUSADO: true });
      assert.ok(readbackFields.includes('DDA_RECUSADO'));
      assert.equal(eTag, current.eTag);
      writes.push(eTag);
      if (writes.length === 1) {
        current = { ...current, eTag: '"2"', fields: { ...current.fields, SITUACAO: 'Agendado' } };
        throw Object.assign(new Error('Item atualizado'), { status: 412 });
      }
      current = { ...current, eTag: '"3"', fields: { ...current.fields, ...fields } };
      return current;
    },
  } });
  assert.deepEqual(await rejectDda({ row }), { id: row.id });
  assert.equal(current.fields.SITUACAO, 'Agendado');
  assert.deepEqual(await rejectDda({ row }), { id: row.id });
  assert.deepEqual(writes, ['"1"', '"2"']);
});

test('refusal refuses to write against an item with a different boleto identity', async () => {
  const rejectDda = createDdaRefusal({ repository: {
    resolveList: async () => ({ status: 'resolved', id: 'dda-list' }),
    getItem: async () => ({ id: row.id, eTag: '"1"', fields: { CHAVE_DDA: 'outro-boleto' } }),
    updateItem: () => assert.fail('Unexpected write'),
  } });
  await assert.rejects(rejectDda({ row }), /O DDA mudou/);
});
