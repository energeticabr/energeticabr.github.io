import assert from 'node:assert/strict';

export async function waitGalleryCatalogs(root) {
  for (let attempt = 0; attempt < 50 && root.querySelector('select[aria-busy="true"]'); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(root.querySelector('select[aria-busy="true"]'), null, 'auxiliary catalogs should finish loading');
}
