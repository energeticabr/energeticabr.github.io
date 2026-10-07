import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup(t, entry, onCreate, overrides = {}) {
  const dom = new JSDOM('<main>Existing screen</main>', { url: 'https://example.test' });
  const document = dom.window.document;
  const gallery = entry.factory(galleryOptions(entry, document, { onCreate, ...overrides }));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, root: () => document.querySelector(entry.root) };
}
function forceClick(ctx, button) {
  button.dispatchEvent(new ctx.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

for (const entry of galleryCases.filter(entry => ['tasks', 'group'].includes(entry.name))) {
  test(`${entry.name}: pending async creation keeps its guard across reopen until resolution`, async t => {
    const pending = deferred(); let calls = 0;
    const ctx = setup(t, entry, () => {
      assert.equal(ctx.root().hidden, true, 'gallery closes synchronously before invoking callback');
      calls++; return pending.promise;
    });
    t.after(() => pending.resolve());
    await ctx.gallery.open();
    const button = ctx.root().querySelector('[data-gallery-create]');
    button.click();
    assert.equal(ctx.root().hidden, true, 'closing is not deferred to a microtask');
    assert.equal(calls, 1);
    await ctx.gallery.open();
    assert.equal(button.disabled, true, 'callback Promise still owns activation');
    button.click(); forceClick(ctx, button);
    assert.equal(calls, 1, 'synthetic clicks cannot duplicate an unfinished factory');
    pending.resolve(); await settle();
    assert.equal(button.disabled, false);
    button.click(); await settle();
    assert.equal(calls, 2, 'a finished callback permits a new activation');
  });

  test(`${entry.name}: async rejection is handled and shows a dismissible alert outside the closed gallery`, async t => {
    let calls = 0;
    const ctx = setup(t, entry, async () => {
      assert.equal(ctx.root().hidden, true);
      calls++;
      if (calls === 1) throw new Error('Factory unavailable');
    });
    await ctx.gallery.open();
    const button = ctx.root().querySelector('[data-gallery-create]');
    button.click(); await settle();
    const alert = ctx.document.querySelector('[data-gallery-create-error]');
    assert.ok(alert, 'failure is displayed instead of becoming an unhandled rejection');
    assert.equal(alert.getAttribute('role'), 'alert');
    assert.equal(alert.closest('[hidden]'), null, 'feedback is not buried in the closed gallery');
    assert.match(alert.textContent, /Não foi possível iniciar.+Tente novamente/);
    assert.equal(ctx.root().hidden, true, 'error handling does not reopen the gallery');
    const dismiss = alert.querySelector('button');
    assert.equal(dismiss.type, 'button');
    assert.ok(dismiss.getAttribute('aria-label'));
    dismiss.click();
    assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
    await ctx.gallery.open();
    assert.equal(button.disabled, false);
    button.click(); await settle();
    assert.equal(calls, 2);
    assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
  });

  test(`${entry.name}: a late rejected factory cannot restore UI after destroy`, async t => {
    const pending = deferred();
    const ctx = setup(t, entry, () => pending.promise);
    await ctx.gallery.open();
    const button = ctx.root().querySelector('[data-gallery-create]');
    button.click(); ctx.gallery.destroy();
    pending.reject(new Error('Late failure')); await settle();
    assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
    assert.equal(button.disabled, true);
    assert.equal(ctx.root(), null);
  });
}

test('synchronously throwing creation also reports its failure safely and clears the alert on destroy', async t => {
  const entry = galleryCases.find(entry => entry.name === 'tasks');
  const ctx = setup(t, entry, () => { throw new Error('Immediate failure'); });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-gallery-create]').click(); await settle();
  assert.ok(ctx.document.querySelector('[data-gallery-create-error]'));
  ctx.gallery.destroy();
  assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
});

test('retry removes stale failure feedback before invoking the next factory', async t => {
  const entry = galleryCases.find(entry => entry.name === 'tasks');
  let calls = 0;
  const ctx = setup(t, entry, async () => {
    calls++;
    if (calls === 1) throw new Error('First failure');
    assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
  });
  await ctx.gallery.open();
  const button = ctx.root().querySelector('[data-gallery-create]');
  button.click(); await settle();
  assert.ok(ctx.document.querySelector('[data-gallery-create-error]'));
  await ctx.gallery.open();
  button.click(); await settle();
  assert.equal(calls, 2);
  assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
});

test('a rejected factory cannot publish stale feedback after its gallery is removed', async t => {
  const entry = galleryCases.find(entry => entry.name === 'tasks');
  const pending = deferred();
  const ctx = setup(t, entry, () => pending.promise);
  await ctx.gallery.open();
  const root = ctx.root(), button = root.querySelector('[data-gallery-create]');
  button.click(); root.remove();
  pending.reject(new Error('Removed gallery')); await settle();
  assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
  assert.equal(button.disabled, true);
});

test('HR close may destroy the gallery before an async factory fails; no alert revives it', async t => {
  const entry = galleryCases.find(entry => entry.options?.gallery === 'IDFOLHA');
  const pending = deferred();
  let calls = 0;
  const ctx = setup(t, entry, () => {
    assert.equal(ctx.root(), null, 'onClose destruction completes before the factory starts');
    calls++;
    return pending.promise;
  }, { onClose: () => ctx.gallery.destroy() });
  await ctx.gallery.open();
  const button = ctx.root().querySelector('[data-gallery-create]');
  button.click(); forceClick(ctx, button);
  assert.equal(calls, 1);
  assert.equal(ctx.root(), null);
  pending.reject(new Error('Factory unavailable after HR close')); await settle();
  assert.equal(ctx.document.querySelector('[data-gallery-create-error]'), null);
  assert.equal(ctx.root(), null, 'handling failure does not restore the destroyed gallery');
  assert.equal(button.disabled, true);
});
