import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePointRepository } from '../portal/data/sharepoint-repository.js';

const list = '11111111-1111-4111-8111-111111111111';
const site = { host: 'synthetic.sharepoint.com', path: '/sites/synthetic' };
for (const transport of ['graph', 'rest']) {
  function setup() {
    const calls = [];
    const request = async (path, options = {}) => {
      calls.push({ path, options });
      if (path.includes('/sites/synthetic') && !path.includes('/items')) return { id: 'site' };
      if (path.includes('/items')) return transport === 'rest'
        ? { ID: 17, '@odata.etag': '"2"', STATUS: 'INATIVO', EMPREITEIRO: 'SIM' }
        : { id: '17', eTag: '"2"', fields: { STATUS: 'INATIVO', EMPREITEIRO: 'SIM' } };
      return { id: 'site' };
    };
    const repository = createSharePointRepository({ request }, { personal: {
      ...site, readTransport: transport, writeTransport: transport,
    } }, { restTransport: { request: (_config, path, options) => request(path, options) } });
    return { repository, calls };
  }
  test(transport + ': lifecycle source update restricts its actual adapter readback to STATUS/EMPREITEIRO', async () => {
    const { repository, calls } = setup();
    const saved = await repository.updateItem('personal', list, '17', { STATUS: 'INATIVO' }, {
      eTag: '"1"', readbackFields: ['STATUS', 'EMPREITEIRO'],
    });
    assert.equal(saved.fields.STATUS, 'INATIVO');
    const read = calls.filter(c => c.options.method === 'GET' && c.path.includes('/items')).at(-1);
    const query = new URL(read.path, 'https://synthetic.invalid').searchParams;
    if (transport === 'graph') {
      assert.equal(query.get('$select'), 'id,eTag');
      assert.equal(query.get('$expand'), 'fields($select=STATUS,EMPREITEIRO)');
    } else {
      assert.equal(query.get('$select'), 'ID,STATUS,EMPREITEIRO');
      assert.equal(query.has('$expand'), false);
    }
    assert.equal(calls.filter(c => c.options.method === 'PATCH' || c.options.headers?.['X-HTTP-Method'] === 'MERGE').length, 1);
  });
  test(transport + ': explicit restricted source reads omit audit expansion and unrelated fields', async () => {
    const { repository, calls } = setup();
    await repository.getItem('personal', list, '17', '$expand=fields', { restrictedFields: ['STATUS', 'EMPREITEIRO'] });
    const query = new URL(calls.at(-1).path, 'https://synthetic.invalid').searchParams;
    assert.equal(query.get('$select'), transport === 'graph' ? 'id,eTag' : 'ID,STATUS,EMPREITEIRO');
    assert.equal(query.get('$expand'), transport === 'graph' ? 'fields($select=STATUS,EMPREITEIRO)' : null);
  });
  test(transport + ': existing callers retain the full readback', async () => {
    const { repository, calls } = setup();
    await repository.updateItem('personal', list, '17', { Title: 'Synthetic' }, { eTag: '"1"' });
    const query = new URL(calls.at(-1).path, 'https://synthetic.invalid').searchParams;
    if (transport === 'graph') assert.equal(query.get('$expand'), 'fields');
    else assert.match(query.get('$select'), /\*/);
  });
  test(transport + ': malformed optional readback is rejected before any write', async () => {
    const { repository, calls } = setup();
    await assert.rejects(repository.updateItem('personal', list, '17', { STATUS: 'INATIVO' }, {
      eTag: '"1"', readbackFields: ['STATUS)', 'Title'],
    }));
    assert.equal(calls.filter(c => c.options.method === 'PATCH' || c.options.headers?.['X-HTTP-Method'] === 'MERGE').length, 0);
  });
}
