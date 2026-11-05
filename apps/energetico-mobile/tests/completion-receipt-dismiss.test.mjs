import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDdaSyncReceipt } from '../src/ui/dda-sync-receipt.js';
import { createSefazSyncReceipt } from '../src/ui/sefaz-sync-receipt.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
for (const kind of ['dda', 'sefaz']) {
  function setup(t, status = 'succeeded') {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const dom = new JSDOM('<body><main><button>Galeria</button></main></body>');
    const doc = dom.window.document;
    let acknowledgements = 0;
    const onAcknowledge = async () => { acknowledgements++; return true; };
    const popup = kind === 'dda'
      ? createDdaSyncReceipt({ document: doc, host: doc.querySelector('main'), format: () => 'Fictício', requireAcknowledgement: true, onAcknowledge })
      : createSefazSyncReceipt({ document: doc, onAcknowledge });
    const result = { status, created: 1, createdItemIds: [42], sources: Object.fromEntries(['NFE', 'CTE', 'NFSE'].map(key => [key, { status, documents: 1, createdItemIds: [42] }])) };
    const show = () => popup.show(result, [], doc.querySelector('main button'));
    t.after(() => { popup.destroy(); dom.window.close(); });
    return { doc, popup, show, acknowledgements: () => acknowledgements };
  }
  test(`${kind} creation receipt dismisses and acknowledges once at 1500 ms`, async t => {
    const h = setup(t); h.show();
    t.mock.timers.tick(1499); await settle();
    assert.ok(h.doc.querySelector('[role="dialog"]'));
    assert.equal(h.acknowledgements(), 0);
    t.mock.timers.tick(1); await settle();
    assert.equal(h.doc.querySelector('[role="dialog"]'), null);
    assert.equal(h.acknowledgements(), 1);
    t.mock.timers.tick(5000); await settle();
    assert.equal(h.acknowledgements(), 1);
  });
  test(`${kind} manual close cancels expiry and leaves later receipt open for its full duration`, async t => {
    const h = setup(t); h.show();
    t.mock.timers.tick(500);
    h.doc.querySelector('[role="dialog"] button').click(); await settle();
    h.show();
    t.mock.timers.tick(1000); await settle();
    assert.ok(h.doc.querySelector('[role="dialog"]'));
    t.mock.timers.tick(500); await settle();
    assert.equal(h.doc.querySelector('[role="dialog"]'), null);
    assert.equal(h.acknowledgements(), 2);
  });
  for (const status of ['failed', 'partial']) test(`${kind} ${status} receipt preserves error details and retry`, async t => {
    const h = setup(t, status); h.show();
    t.mock.timers.tick(5000); await settle();
    assert.ok(h.doc.querySelector('[role="dialog"]'));
    assert.equal(h.acknowledgements(), 0);
  });
  test(`${kind} destruction cancels automatic acknowledgement`, async t => {
    const h = setup(t); h.show(); h.popup.destroy();
    t.mock.timers.tick(5000); await settle();
    assert.equal(h.acknowledgements(), 0);
  });
}
