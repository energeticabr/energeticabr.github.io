import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
import { createRegistrationGalleryData, REGISTRATION_GALLERY_MODELS } from '../src/chat/registration-gallery-data.js';

for (const [kind, model] of Object.entries(REGISTRATION_GALLERY_MODELS).filter(([, model]) => model.nativeCard)) {
  test(`${kind} opens against the frozen production SharePoint repository`, async () => {
    const calls = [];
    const repository = createSharePointRepository({ async request(path) {
      calls.push(path);
      if (path.includes('/columns')) return { value: [{ name: 'Title', displayName: model.fields[0], text: {} }] };
      if (path.includes('/items/')) return { id: '1', eTag: '"v1"', fields: { Title: 'EXEMPLO', STATUS: 'ATIVO' } };
      if (path.includes('/items')) return { value: [{ id: '1', eTag: '"v1"', fields: { Title: 'EXEMPLO', STATUS: 'ATIVO' } }] };
      if (path.includes('/lists')) return { value: [{ id: 'list-id', displayName: model.listName, list: { template: 'genericList' } }] };
      return { id: 'site-id' };
    } }, { personal: { host: 'tenant.sharepoint.com', path: '/sites/test' } });
    assert.equal(Object.isFrozen(repository), true);
    const data = createRegistrationGalleryData({ kind, repository });
    const snapshot = await data.loadSnapshot();
    assert.equal(snapshot.rows[0].id, '1');
    assert.equal(snapshot.rows[0].fields[model.fields[0]], 'EXEMPLO');
    assert.ok(calls.some(path => path.includes('/columns')));
    if (kind === 'assetFunction') {
      const context = await data.loadEditor('1');
      assert.equal(context.columns[0].label, 'FUNCAO');
      assert.equal(context.contract.readOnly, false);
    }
  });
}
