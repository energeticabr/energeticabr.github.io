import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup(t, onStartProvision) {
  const dom = new JSDOM('<body/>'), doc = dom.window.document;
  const rows = [7, 8].map(id => ({ id: String(id), fields: { Title: 'Fornecedor fictício de materiais com nome longo',
    CHAVE_DDA: String(id).repeat(64), SITUACAO: 'Em aberto', VENCIMENTO: '2026-12-20', VALOR: 360, Attachments: true } }));
  const gallery = createRegistrationGallery({ document: doc, kind: 'dda',
    data: { loadSnapshot: async () => ({ rows }) }, onStartProvision,
    confirmPayment: () => assert.fail('Provisão não confirma pagamento') });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  return { doc, gallery, root: doc.querySelector('[data-gallery-kind="dda"]'), button: doc.querySelector('[data-dda-create-provision="7"]') };
}

test('PROVISÃO follows the green check and passes the exact DDA without confirming payment', async t => {
  let input; const waiting = deferred();
  const h = await setup(t, value => { input = value; return waiting.promise; });
  assert.ok(h.button, 'PROVISÃO button is present');
  assert.equal(h.button.textContent, 'PROVISÃO');
  assert.equal(h.button.previousElementSibling.dataset.ddaConfirmPayment, '7');
  h.button.click(); h.button.click();
  assert.equal(input.itemId, 7); assert.equal(input.key, '7'.repeat(64));
  assert.equal(input.signal.aborted, false);
  assert.ok([...h.doc.querySelectorAll('[data-dda-create-provision]')].every(button => button.disabled));
  assert.equal(h.root.hidden, false);
  waiting.resolve(true); await tick();
  assert.equal(h.root.hidden, true);
  await h.gallery.open();
  assert.doesNotMatch(h.root.textContent, /Carregando anexos para criar a provisão/);
});

test('failed provision transfer stays visible with retry and no internal error disclosure', async t => {
  let calls = 0;
  const h = await setup(t, async () => { calls++; if (calls === 1) throw Error('private-server-token'); return true; });
  assert.ok(h.button); h.button.click(); await tick();
  assert.equal(h.root.hidden, false); assert.equal(h.button.disabled, false);
  assert.match(h.root.textContent, /Não foi possível.*provisão.*Tente novamente/);
  assert.doesNotMatch(h.root.textContent, /private-server-token/);
  h.button.click(); await tick();
  assert.equal(calls, 2); assert.equal(h.root.hidden, true);
});

test('closing the gallery cancels provision transfer and late success cannot close a reopened gallery', async t => {
  const waiting = deferred(); let signal;
  const h = await setup(t, input => { signal = input.signal; return waiting.promise; });
  assert.ok(h.button); h.button.click();
  h.gallery.close(); assert.equal(signal.aborted, true);
  await h.gallery.open(); waiting.resolve(true); await tick();
  assert.equal(h.root.hidden, false);
  assert.doesNotMatch(h.root.textContent, /Carregando anexos para criar a provisão/);
});
