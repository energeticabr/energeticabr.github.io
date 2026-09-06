import test from 'node:test';
import assert from 'node:assert/strict';

test('flushes checkpoint when hidden or pagehide, including Safari cache, before closing', async () => {
  const { bindPageLifecycle } = await import('../src/web/page-lifecycle.js');
  const windowRef = new EventTarget(), documentRef = new EventTarget(), events = [];
  bindPageLifecycle({ windowRef, documentRef, onSave: () => events.push('save'), onClose: () => events.push('close') });
  documentRef.visibilityState = 'hidden'; documentRef.dispatchEvent(new Event('visibilitychange'));
  windowRef.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  windowRef.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
  assert.deepEqual(events, ['save', 'save', 'save', 'close']);
  documentRef.dispatchEvent(new Event('visibilitychange'));
  assert.equal(events.length, 4);
});

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
