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

test('tab visibility and Safari cache both resume the app once per foreground transition', async () => {
  const { bindPageLifecycle } = await import('../src/web/page-lifecycle.js');
  const windowRef = new EventTarget(), documentRef = new EventTarget(), events = [];
  documentRef.visibilityState = 'visible';
  bindPageLifecycle({
    windowRef, documentRef, onClose() {},
    onSave: () => events.push('save'),
    onForeground: () => events.push('foreground'),
    onRestore: () => events.push('restore'),
  });
  const visibility = state => {
    documentRef.visibilityState = state;
    documentRef.dispatchEvent(new Event('visibilitychange'));
  };
  const pageEvent = name => windowRef.dispatchEvent(Object.assign(new Event(name), { persisted: true }));
  visibility('hidden');
  visibility('visible');
  pageEvent('pagehide');
  visibility('visible');
  pageEvent('pageshow');
  assert.deepEqual(events, ['save', 'foreground', 'save', 'foreground', 'restore']);
});
