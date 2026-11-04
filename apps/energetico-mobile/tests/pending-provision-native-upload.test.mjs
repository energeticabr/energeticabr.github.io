import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePorts } from '../src/native/native-ports.js';
import { createPendingProvisionAttachmentsData } from '../src/chat/orders-gallery-data.js';

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5f8AAAAASUVORK5CYII=', 'base64'));

for (const source of ['gallery', 'camera']) for (const transport of ['fetch', 'generic', 'filesystem']) {
  test(`native ${source} PNG without optional metadata can be submitted to its provision via ${transport}`, async () => {
    const stored = new Map();
    const ports = createNativePorts({
      camera: {
        chooseFromGallery: async () => ({ results: [{ uri: 'file:///cache/selected.png' }] }),
        takePhoto: async () => ({ uri: 'file:///cache/selected.png' }),
      },
      fetchImpl: async () => {
        if (transport === 'filesystem') throw new TypeError('file URL unavailable');
        return new Response(png, { headers: { 'Content-Type': transport === 'generic' ? 'application/octet-stream' : 'image/png' } });
      },
      filesystem: { readFile: async () => ({ data: Buffer.from(png).toString('base64') }) },
      randomUUID: () => 'synthetic-photo',
    });
    const [file] = await (source === 'gallery' ? ports.pickPhotos() : ports.capturePhoto());
    const data = createPendingProvisionAttachmentsData({ sourceKind: 'provision-description', repository: {
      resolveList: async (_site, aliases) => { assert.deepEqual(aliases, ['DESCRITIVOPROVISAO']); return { status: 'resolved', id: 'parents' }; },
      getItemsPage: async () => ({ items: [], hasMore: false }),
      listAttachments: async () => [...stored.values()].map(value => ({ name: value.name, size: value.size })),
      uploadAttachment: async (site, list, id, uploaded, name) => {
        assert.deepEqual([site, list, id], ['personal', 'parents', '11']);
        assert.equal(uploaded.type, 'image/png');
        assert.equal(name, 'foto-synthetic-photo.png');
        assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), png);
        stored.set(name, uploaded);
      },
    } });
    await data.uploadAttachment('11', file);
    assert.deepEqual((await data.listAttachments('11', { refresh: true })).map(item => item.fileName), ['foto-synthetic-photo.png']);
    assert.equal(stored.size, 1);
  });
}
