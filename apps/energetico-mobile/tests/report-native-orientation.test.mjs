import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createReportOrientationController } from '../src/native/report-orientation.js';
import { bindReportLandscape } from '../src/ui/report-landscape.js';

// Only the OS bridge is substituted: visibility, lifecycle and queue are real.
function setup(t, { native = true, lock, unlock } = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperties(dom.window, {
    innerWidth: { value: 390, writable: true }, innerHeight: { value: 844, writable: true },
  });
  const calls = [];
  const screenOrientation = {
    async lock(options) { calls.push(['lock', options]); await lock?.(); },
    async unlock() { calls.push(['unlock']); await unlock?.(); },
  };
  const orientation = createReportOrientationController({ isNative: () => native, screenOrientation });
  const bindings = [];
  t.after(async () => { for (const binding of bindings) await binding.destroy(); dom.window.close(); });
  function report({ hidden = true, connected = true } = {}) {
    const root = dom.window.document.createElement('section');
    root.hidden = hidden;
    if (connected) dom.window.document.body.append(root);
    const binding = bindReportLandscape(root, { orientation });
    bindings.push(binding);
    return { root, binding };
  }
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { dom, calls, report, flush, orientation };
}

test('navigation holds cannot rotate an idle app and release once after the last overlapping handoff', async t => {
  const { calls, report, flush, orientation } = setup(t);
  const idle = orientation.beginTransition();
  await idle(); assert.deepEqual(calls, []);
  const { root } = report({ hidden: false }); await flush();
  const first = orientation.beginTransition(), second = orientation.beginTransition();
  root.hidden = true; await flush();
  await first(); await first();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }]]);
  await second(); await second();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
});

test('a navigation handoff retains an in-flight OS lock and skips obsolete unlocks', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { calls, report, flush, orientation } = setup(t, { lock: () => pending });
  const source = report({ hidden: false }); await flush();
  const release = orientation.beginTransition();
  source.binding.destroy();
  const target = report({ hidden: false });
  // Do not await the bridge queue until the OS has answered the initial lock.
  release(); finish(); await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }]]);
  target.root.hidden = true; await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
});

test('only an open connected native report locks landscape; closing restores normal orientation', async t => {
  const { calls, report, flush } = setup(t);
  const { root, binding } = report();
  await flush();
  assert.deepEqual(calls, []);
  root.hidden = false;
  binding.update();
  await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }]]);
  const field = root.appendChild(root.ownerDocument.createElement('input'));
  field.value = 'AREIA'; field.focus();
  binding.update(); binding.update();
  await flush();
  assert.equal(calls.length, 1, 'typing/resizing must not lock again or recreate fields');
  assert.equal(root.querySelector('input'), field);
  assert.equal(field.value, 'AREIA');
  root.hidden = true;
  await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
  root.hidden = false; await flush();
  assert.equal(calls.length, 3, 'reopening must reacquire landscape');
});

test('overlapping reports keep landscape until the last closes in either order', async t => {
  for (const closeFirst of [0, 1]) {
    const { calls, report, flush } = setup(t);
    const reports = [report(), report()];
    reports[0].root.hidden = false; await flush();
    reports[1].root.hidden = false; await flush();
    reports[closeFirst].root.hidden = true; await flush();
    assert.deepEqual(calls, [['lock', { orientation: 'landscape' }]]);
    reports[1 - closeFirst].root.hidden = true; await flush();
    assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
  }
});

test('closing while the native lock is pending queues unlock after completion', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { calls, report, flush } = setup(t, { lock: () => pending });
  const { root, binding } = report({ hidden: false });
  await flush();
  root.hidden = true; binding.update(); await flush();
  assert.equal(calls.length, 1);
  finish(); await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
  await binding.destroy();
  assert.equal(calls.at(-1)[0], 'unlock');
});

test('rapid reopen and close discard obsolete rotations while an OS request is pending', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { calls, report, flush } = setup(t, { lock: () => pending });
  const { root, binding } = report({ hidden: false });
  await flush();
  for (const hidden of [true, false, true]) { root.hidden = hidden; binding.update(); }
  finish(); await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']],
    'a closed report must not rotate the app back to landscape because of a stale queued open');
});

test('detached reports, hidden ancestors and destruction release orientation without leaving observers active', async t => {
  const { dom, calls, report, flush } = setup(t);
  const { root, binding } = report({ hidden: false, connected: false });
  await flush(); assert.deepEqual(calls, []);
  const parent = dom.window.document.createElement('div');
  parent.append(root); dom.window.document.body.append(parent);
  await flush(); assert.equal(calls.at(-1)[0], 'lock');
  parent.hidden = true; await flush(); assert.equal(calls.at(-1)[0], 'unlock');
  parent.hidden = false; await flush(); assert.equal(calls.at(-1)[0], 'lock');
  root.remove(); await flush(); assert.equal(calls.at(-1)[0], 'unlock');
  parent.append(root); await flush(); assert.equal(calls.at(-1)[0], 'lock');
  await binding.destroy(); await binding.destroy();
  assert.equal(calls.at(-1)[0], 'unlock');
  const count = calls.length;
  root.hidden = true; root.hidden = false; binding.update(); await flush();
  assert.equal(calls.length, count);
});

test('browser reports keep CSS landscape without invoking native APIs', async t => {
  const { calls, report, flush } = setup(t, { native: false });
  const { root, binding } = report({ hidden: false });
  await flush();
  assert.equal(root.dataset.reportPortrait, 'true');
  assert.ok(root.style.getPropertyValue('--report-width'));
  root.hidden = true; await binding.destroy(); await flush();
  assert.deepEqual(calls, []);
});

test('a native denial preserves the CSS report and still restores the orientation mask when closed', async t => {
  const { calls, report, flush } = setup(t, { lock: () => Promise.reject(new Error('Rotation denied')) });
  const { root, binding } = report({ hidden: false });
  await flush();
  assert.equal(root.dataset.reportPortrait, 'true');
  assert.equal(root.hidden, false);
  root.hidden = true; binding.update(); await flush();
  assert.deepEqual(calls, [['lock', { orientation: 'landscape' }], ['unlock']]);
});
