import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const module = await import('../src/ui/payroll-sheet-create-view.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const { createPayrollSheetCreateView } = module;
const tick = () => new Promise(resolve => setImmediate(resolve));
const options = { suppliers: [{ id: '7', label: 'ÁGUA D’OURO' }, { id: '9', label: 'BETA' }], defaultMonth: '2026-10' };

function fixture(t, overrides = {}) {
  assert.equal(typeof createPayrollSheetCreateView, 'function', 'IDFOLHA view factory must exist');
  const dom = new JSDOM('<button id="trigger">+</button>'), doc = dom.window.document;
  const saves = [], notifications = [], signals = []; let closed = 0;
  const view = createPayrollSheetCreateView({ document: doc,
    loadOptions: async ({ signal }) => { signals.push(signal); return options; },
    save: async (...args) => { saves.push(args); return { id: '100' }; },
    onSaved: async result => { notifications.push(result); }, onClose: () => { closed++; }, ...overrides });
  doc.querySelector('#trigger').focus();
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, doc, view, saves, notifications, signals, closed: () => closed };
}
function submit(f, supplierId = '7', month = '2026-10') {
  const form = f.doc.querySelector('form');
  form.querySelector('[name=supplierId]').value = supplierId;
  form.querySelector('[name=month]').value = month;
  form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true }));
}

test('real view uses globalThis.document when the controller factory omits document', async t => {
  const dom = new JSDOM('<button>+</button>'), doc = dom.window.document;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let view, writes = 0, closed = 0;
  t.after(() => {
    view?.destroy(); dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  view = createPayrollSheetCreateView({ loadOptions: async () => options,
    save: async () => { writes++; return { id: '100' }; }, onClose: () => { closed++; } });
  await view.open();
  assert.ok(doc.querySelector('[role=dialog]'));
  assert.equal(doc.querySelector('[name=month]').value, '2026-10');
  doc.querySelector('[data-sheet-create-cancel]').click();
  assert.equal(view.isOpen(), false); assert.equal(writes, 0); assert.equal(closed, 1);
});

test('busy Tab and Shift-Tab prevent escape when no controls can receive focus', async t => {
  let release;
  const f = fixture(t, { save: () => new Promise(resolve => { release = resolve; }) });
  await f.view.open();
  const month = f.doc.querySelector('[name=month]'); month.focus(); submit(f);
  const dialog = f.doc.querySelector('[role=dialog]');
  for (const shiftKey of [false, true]) {
    const event = new f.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    f.doc.activeElement.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(f.doc.activeElement, dialog);
  }
  release({ id: '100' }); await tick();
});

test('Tab restores focus from disabled or outside elements in both directions and is cleaned up on destroy', async t => {
  const f = fixture(t); await f.view.open();
  const dialog = f.doc.querySelector('[role=dialog]'), month = dialog.querySelector('[name=month]');
  const first = dialog.querySelector('[role=combobox]'), last = dialog.querySelector('[type=submit]');
  for (const outside of [false, true]) for (const shiftKey of [false, true]) {
    month.disabled = false;
    if (outside) f.doc.querySelector('#trigger').focus(); else { month.focus(); month.disabled = true; }
    const event = new f.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    f.doc.activeElement.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(f.doc.activeElement, shiftKey ? last : first);
  }
  f.view.destroy(); f.doc.querySelector('#trigger').focus();
  const event = new f.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  f.doc.activeElement.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
});

test('standalone accessible native composer opens under body with searchable supplier and month, without writes', async t => {
  const f = fixture(t); await f.view.open();
  const dialog = f.doc.querySelector('[role=dialog]');
  assert.ok(dialog?.closest('.gallery-record-overlay').parentElement === f.doc.body);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.getAttribute('aria-labelledby'));
  assert.ok(dialog.classList.contains('gallery-record-dialog'));
  assert.equal(dialog.querySelector('[role=combobox]').getAttribute('aria-label'), 'Fornecedor');
  assert.equal(dialog.querySelector('[name=month]').type, 'month');
  assert.equal(dialog.querySelector('[name=month]').value, '2026-10');
  assert.deepEqual([...dialog.querySelectorAll('.dynamic-form-actions button')].map(node => node.textContent), ['CANCELAR', 'SUBMETER']);
  assert.equal(f.saves.length, 0); assert.equal(f.notifications.length, 0);
});

test('supplier search accepts only an existing option and explicit submit notifies before closing', async t => {
  const sequence = [];
  const f = fixture(t, { onSaved: async result => { assert.equal(result.id, '100'); assert.equal(f.view.isOpen(), true); sequence.push('saved'); },
    onClose: () => { sequence.push('close'); } });
  await f.view.open();
  const search = f.doc.querySelector('[role=combobox]'); search.focus(); search.value = 'beta';
  search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  const offered = [...f.doc.querySelectorAll('[role=option]')].filter(node => node.textContent.includes('BETA'));
  assert.equal(offered.length, 1); offered[0].click();
  const form = f.doc.querySelector('form');
  form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.deepEqual(f.saves[0][0], { supplierId: '9', month: '2026-10' });
  assert.match(f.saves[0][1].operationId, /^[a-zA-Z0-9-]{1,80}$/);
  assert.deepEqual(sequence, ['saved', 'close']);
  assert.equal(f.view.isOpen(), false);
  assert.equal(f.doc.activeElement.id, 'trigger');
});

test('opening twice, typing arbitrary supplier and cancelling never submits', async t => {
  const f = fixture(t); await f.view.open(); await f.view.open();
  assert.equal(f.doc.querySelectorAll('[role=dialog]').length, 1);
  const search = f.doc.querySelector('[role=combobox]'); search.focus(); search.value = 'INVENTADO';
  search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  f.doc.querySelector('form').dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(f.saves.length, 0); assert.equal(f.doc.querySelector('[role=alert]').hidden, false);
  f.doc.querySelector('[data-sheet-create-cancel]').click();
  assert.equal(f.view.isOpen(), false); assert.equal(f.notifications.length, 0);
  assert.equal(f.signals[0].aborted, true);
});

test('double submit and user cancel while saving cannot start another write or dismiss', async t => {
  let release; let attempts = 0;
  const f = fixture(t, { save: () => { attempts++; return new Promise(resolve => { release = resolve; }); } });
  await f.view.open(); submit(f); submit(f);
  f.doc.querySelector('[data-sheet-create-cancel]').click();
  f.doc.querySelector('[role=dialog]').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(attempts, 1); assert.equal(f.view.isOpen(), true);
  assert.equal(f.doc.querySelector('[role=dialog]').getAttribute('aria-busy'), 'true');
  assert.equal(f.doc.querySelector('[name=month]').disabled, true);
  release({ id: '100' }); await tick();
  assert.equal(f.view.isOpen(), false);
});

test('load failure has accessible retry and retry does not create a sheet', async t => {
  let calls = 0;
  const f = fixture(t, { loadOptions: async () => { if (++calls === 1) throw new Error('Sem conexão'); return options; } });
  await f.view.open();
  assert.match(f.doc.querySelector('[role=alert]').textContent, /Sem conexão/);
  f.doc.querySelector('[data-sheet-create-retry]').click(); await tick();
  assert.ok(f.doc.querySelector('[name=supplierId]')); assert.equal(f.saves.length, 0);
  assert.equal(f.doc.querySelector('[role=alert]').hidden, true);
});

test('save error permits explicit retry with same operation and never submits automatically', async t => {
  const attempts = [];
  const f = fixture(t, { save: async (...args) => { attempts.push(args); if (attempts.length === 1) throw new Error('Sem conexão'); return { id: '100' }; } });
  await f.view.open(); submit(f); await tick();
  assert.equal(f.view.isOpen(), true); assert.match(f.doc.querySelector('[role=alert]').textContent, /Sem conexão/);
  assert.equal(f.doc.querySelector('[name=month]').disabled, false);
  submit(f); await tick();
  assert.equal(attempts.length, 2); assert.equal(attempts[0][1].operationId, attempts[1][1].operationId);
  assert.equal(f.view.isOpen(), false);
});

test('uncertain creation retains the selected tuple for explicit retry', async t => {
  const attempts = [];
  const f = fixture(t, { save: async (...args) => {
    attempts.push(args);
    if (attempts.length === 1) throw Object.assign(new Error('Resposta perdida'), { code: 'payroll_sheet_create_uncertain' });
    return { id: '100' };
  } });
  await f.view.open(); submit(f); await tick();
  assert.equal(f.doc.querySelector('[name=supplierId]').disabled, true);
  assert.equal(f.doc.querySelector('[name=month]').disabled, true);
  submit(f, '9', '2026-11'); await tick();
  assert.deepEqual(attempts[1][0], { supplierId: '7', month: '2026-10' });
  assert.equal(attempts[1][1].operationId, attempts[0][1].operationId);
  assert.equal(f.view.isOpen(), false);
});

test('uncertainty marker retains the tuple without replacing a Graph service error code', async t => {
  const f = fixture(t, { save: async () => {
    throw Object.assign(new Error('Serviço indisponível'), { code: 'serviceNotAvailable', payrollSheetCreateUncertain: true });
  } });
  await f.view.open(); submit(f); await tick();
  assert.equal(f.doc.querySelector('[name=supplierId]').disabled, true);
  assert.equal(f.doc.querySelector('[name=month]').disabled, true);
  assert.equal(f.doc.querySelector('[type=submit]').disabled, false);
});

test('callback failure retries gallery notification without posting the saved sheet again', async t => {
  let notifications = 0;
  const f = fixture(t, { onSaved: async () => { if (++notifications === 1) throw new Error('Galeria indisponível'); } });
  await f.view.open(); submit(f); await tick();
  assert.equal(f.view.isOpen(), true); assert.equal(f.doc.querySelector('[name=month]').disabled, true);
  f.doc.querySelector('form').dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(f.saves.length, 1); assert.equal(notifications, 2); assert.equal(f.view.isOpen(), false);
});

test('close during load aborts and discards late options; reopened composer keeps its own options', async t => {
  let resolve; let calls = 0;
  const f = fixture(t, { loadOptions: ({ signal }) => { f.signals.push(signal); return ++calls === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve(options); } });
  const pending = f.view.open(); await tick(); f.view.close();
  assert.equal(f.signals[0].aborted, true);
  await f.view.open(); resolve({ suppliers: [{ id: '44', label: 'ATRASADO' }], defaultMonth: '2020-01' }); await pending;
  assert.equal(f.doc.querySelector('[name=month]').value, '2026-10');
  assert.equal(f.doc.querySelector('[name=supplierId]').querySelector('[value="44"]'), null);
  assert.equal(f.saves.length, 0);
});

test('forced close during save suppresses stale callbacks and reopening until mutation settles', async t => {
  let resolve;
  const f = fixture(t, { save: () => new Promise(done => { resolve = done; }) });
  await f.view.open(); submit(f); f.view.close(); await f.view.open();
  assert.equal(f.view.isOpen(), false);
  resolve({ id: '100' }); await tick();
  assert.equal(f.notifications.length, 0);
  await f.view.open(); assert.equal(f.view.isOpen(), true);
});

test('destroy removes searchable controls and ignores load completion and future open', async t => {
  let resolve;
  const f = fixture(t, { loadOptions: () => new Promise(done => { resolve = done; }) });
  const pending = f.view.open(); await tick(); f.view.destroy(); resolve(options); await pending; await f.view.open();
  assert.equal(f.doc.querySelector('[role=dialog]'), null); assert.equal(f.view.isOpen(), false); assert.equal(f.saves.length, 0);
});

test('destroy prevents a close callback from reopening the composer', async t => {
  let callbacks = 0;
  const f = fixture(t, { onClose: () => { callbacks++; void f.view.open(); } });
  await f.view.open(); f.view.destroy(); await tick();
  assert.equal(callbacks, 0);
  assert.equal(f.doc.querySelector('[role=dialog]'), null);
  assert.equal(f.view.isOpen(), false);
});

test('idle dialog traps keyboard focus and destroy makes a detached form inert', async t => {
  const f = fixture(t); await f.view.open();
  const dialog = f.doc.querySelector('[role=dialog]'), form = dialog.querySelector('form');
  const last = dialog.querySelector('[type=submit]'); last.focus();
  last.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(f.doc.activeElement.getAttribute('role'), 'combobox');
  f.doc.activeElement.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(f.doc.activeElement, last);
  f.view.destroy();
  form.querySelector('[name=supplierId]').value = '7';
  form.dispatchEvent(new f.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(f.saves.length, 0); assert.equal(f.closed(), 0);
});

test('public close notifies once while subsequent close and destroy are silent', async t => {
  const f = fixture(t); await f.view.open();
  f.view.close(); f.view.close(); f.view.destroy();
  assert.equal(f.closed(), 1);
  assert.equal(f.notifications.length, 0);
  assert.equal(f.view.isOpen(), false);
});

test('destroy during a pending save is silent and suppresses saved and close callbacks', async t => {
  let resolve;
  const f = fixture(t, { save: () => new Promise(done => { resolve = done; }) });
  await f.view.open(); submit(f); f.view.destroy();
  assert.equal(f.closed(), 0);
  resolve({ id: '100' }); await tick();
  assert.equal(f.notifications.length, 0); assert.equal(f.closed(), 0);
  assert.equal(f.view.isOpen(), false);
});

test('Escape closes an idle composer and empty supplier list prevents submission', async t => {
  const f = fixture(t, { loadOptions: async () => ({ ...options, suppliers: [] }) });
  await f.view.open();
  assert.equal(f.doc.querySelector('[type=submit]').disabled, true);
  assert.match(f.doc.querySelector('[role=alert]').textContent, /fornecedor/i);
  f.doc.querySelector('[role=dialog]').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.view.isOpen(), false); assert.equal(f.saves.length, 0);
});
