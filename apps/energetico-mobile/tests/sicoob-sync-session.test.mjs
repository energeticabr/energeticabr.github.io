import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSicoobSyncSession } from '../src/ui/sicoob-sync-session.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createDdaSyncSession } from '../src/ui/dda-sync-session.js';

test('movement gallery refresh requests the source collector before reloading SharePoint', async t => {
  const dom = new JSDOM('<main id="app"></main>'); let loads = 0, starts = 0, listener, running = false;
  const monitor = { get running() { return running; }, subscribe(fn) { listener = fn; fn({ running }); return () => {}; },
    async start() { starts++; running = true; listener({ running, notice: 'Consultando transações, DDAs e notas fiscais' }); } };
  const view = createRegistrationGallery({ document: dom.window.document, kind: 'financial_movement', syncMonitor: monitor,
    data: { loadSnapshot: async () => { loads++; return { rows: [] }; } } });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open(); dom.window.document.querySelector('[data-gallery-refresh]').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1); assert.equal(loads, 1); assert.match(dom.window.document.body.textContent, /Consultando transações/);
  running = false; listener({ running, notice: 'Transações concluídas' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(loads, 2);
});

test('Sicoob session persists separately, recovers the request and presents transaction counts', async t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test' });
  const id = 'c'.repeat(32), data = new Map(); let starts = 0, result = { requestId: id, status: 'running' };
  const options = { document: dom.window.document, accountKey: 'account', randomId: () => id,
    storage: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }, schedule: () => 0, cancel() {},
    client: { refreshSicoob: async () => { starts++; return result; }, getSicoobRefreshStatus: async () => result,
      getSicoobRefreshPending: async () => ({ status: 'pending', requests: [result] }),
      acknowledgeSicoobRefresh: async requestId => ({ status: 'acknowledged', requestId }) } };
  const first = createSicoobSyncSession(options); await first.start(); first.destroy();
  assert.equal([...data.keys()][0], 'energetico.sicoob-sync.v1:account');
  result = { requestId: id, status: 'succeeded', created: 2, updated: 1, verified: 3, pendingDetails: 4 };
  const restored = createSicoobSyncSession(options); t.after(() => { restored.destroy(); dom.window.close(); });
  await restored.resume(); assert.equal(starts, 1);
  assert.match(dom.window.document.body.textContent, /2.*transações/);
  assert.match(dom.window.document.body.textContent, /4 comprovantes ou recebedores ainda sem confirmação/);
  assert.doesNotMatch(dom.window.document.body.textContent, /DDA|boleto criado/);
});

test('DDA and Sicoob completed receipts do not open competing modal dialogs', async t => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test' });
  let scheduled; const options = { document: dom.window.document, accountKey: 'same-owner', storage: dom.window.localStorage,
    schedule: fn => { scheduled = fn; return 0; }, cancel() {} };
  const dda = createDdaSyncSession({ ...options, client: {
    getDdaRefreshPending: async () => ({ status: 'pending', requests: [{ requestId: 'a'.repeat(32), status: 'succeeded', created: 0 }] }),
    acknowledgeDdaRefresh: async requestId => ({ status: 'acknowledged', requestId }),
  } });
  const sicoob = createSicoobSyncSession({ ...options, client: {
    getSicoobRefreshPending: async () => ({ status: 'pending', requests: [{ requestId: 'b'.repeat(32), status: 'succeeded', created: 2 }] }),
  } });
  t.after(() => { dda.destroy(); sicoob.destroy(); dom.window.close(); });
  await dda.resume(); await sicoob.resume();
  assert.equal(dom.window.document.querySelectorAll('.dda-sync-overlay--global').length, 1);
  assert.equal(typeof scheduled, 'function', 'hidden result schedules a retry');
  dom.window.document.querySelector('.dda-sync-overlay--global button').click();
  await new Promise(resolve => setImmediate(resolve)); await scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('.dda-sync-overlay--global').length, 1);
  assert.match(dom.window.document.body.textContent, /2 novas transações/);
});
