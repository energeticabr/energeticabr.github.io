import test from 'node:test';
import assert from 'node:assert/strict';

test('voltar do cache do Safari preserva chat e apenas atualiza anexos', async () => {
  const { bindPageLifecycle } = await import('../src/web/page-lifecycle.js');
  const windowRef = new EventTarget();
  let closed = 0, restored = 0;
  bindPageLifecycle({ windowRef, onClose: () => closed++, onRestore: () => restored++ });
  const pageEvent = (name, persisted) => Object.assign(new Event(name), { persisted });
  windowRef.dispatchEvent(pageEvent('pagehide', true));
  assert.equal(closed, 0);
  windowRef.dispatchEvent(pageEvent('pageshow', true));
  assert.equal(restored, 1);
  windowRef.dispatchEvent(pageEvent('pagehide', false));
  assert.equal(closed, 1);
  windowRef.dispatchEvent(pageEvent('pageshow', true));
  assert.equal(restored, 1);
});
