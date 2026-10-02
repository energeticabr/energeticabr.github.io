import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bindAutoFilterForm } from '../src/ui/auto-filter-form.js';

const module = await import('../src/ui/searchable-filter-selects.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { auto = false } = {}) {
  const dom = new JSDOM(`<section role="dialog"><details open><form><label class="field"><span>Produto</span><select name="product"><option value="">Todos</option><option value="steel">Aço estrutural</option><option value="concrete">Concreto</option><option value="unsafe">&lt;img src=x onerror=alert(1)&gt;</option><option value="disabled" disabled>Indisponível</option></select></label><input name="description"></form></details><button id="outside">Fora</button></section>`);
  const { document, Event, KeyboardEvent, FormData } = dom.window;
  const form = document.querySelector('form');
  const select = form.querySelector('select');
  let applies = 0;
  assert.equal(typeof module.bindSearchableFilterSelects, 'function', 'searchable filter binding is implemented');
  const binding = auto ? bindAutoFilterForm(form, () => { applies += 1; }, { debounceMs: 0 }) : module.bindSearchableFilterSelects(form);
  const trigger = () => form.querySelector('.sfs-trigger');
  const search = () => form.querySelector('.sfs-search');
  const popup = () => form.querySelector('.sfs-popup');
  const options = () => [...form.querySelectorAll('[role="option"]')];
  const type = value => { search().value = value; search().dispatchEvent(new Event('input', { bubbles: true })); };
  const key = value => search().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  t.after(() => { binding.destroy(); dom.window.close(); });
  return { dom, document, form, select, binding, trigger, search, popup, options, type, key, Event, FormData, applies: () => applies };
}

test('opens an internal search while retaining the native form control and safe option labels', t => {
  const ctx = fixture(t);
  assert.equal(ctx.select.hidden, true);
  assert.equal(ctx.trigger().textContent.includes('Todos'), true);
  assert.equal(ctx.popup().hidden, true);
  ctx.trigger().click();
  assert.equal(ctx.popup().hidden, false);
  assert.equal(ctx.popup().contains(ctx.search()), true);
  assert.equal(ctx.search().closest('label'), null);
  assert.equal(ctx.document.activeElement, ctx.search());
  assert.equal(ctx.options().length, 5);
  assert.equal(ctx.form.querySelector('img'), null);
  assert.equal(new ctx.FormData(ctx.form).get('product'), '');
  assert.equal(ctx.trigger().getAttribute('aria-expanded'), 'true');
});

test('typing matches accents and case without changing the value or applying gallery filters', async t => {
  const ctx = fixture(t, { auto: true });
  ctx.trigger().click();
  ctx.type('ACO');
  await settle();
  assert.deepEqual(ctx.options().map(option => option.textContent), ['Aço estrutural']);
  assert.equal(ctx.select.value, '');
  assert.equal(ctx.applies(), 0);
  ctx.options()[0].click();
  assert.equal(ctx.select.value, 'steel');
  assert.equal(ctx.applies(), 1);
  assert.equal(ctx.popup().hidden, true);
  assert.equal(ctx.trigger().textContent.includes('Aço estrutural'), true);
  assert.equal(new ctx.FormData(ctx.form).get('product'), 'steel');
});

test('a tap on another option survives search blur and applies the new filter', t => {
  const ctx = fixture(t, { auto: true });
  ctx.trigger().click();
  ctx.options().find(option => option.textContent === 'Aço estrutural').click();
  assert.equal(ctx.select.value, 'steel');

  ctx.trigger().click();
  const next = ctx.options().find(option => option.textContent === 'Concreto');
  next.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true }));
  ctx.search().dispatchEvent(new ctx.dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  assert.equal(ctx.popup().hidden, false, 'blur during the option tap must not dismiss the picker');
  ctx.document.querySelector('details').dispatchEvent(new ctx.Event('scroll'));
  assert.equal(ctx.popup().hidden, false, 'ancestor movement during the tap must not dismiss the picker');
  next.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true }));
  next.click();

  assert.equal(ctx.select.value, 'concrete');
  assert.equal(ctx.applies(), 2);
  assert.equal(ctx.popup().hidden, true);
});

test('iOS option tap commits on pointerup before a delayed synthetic click', t => {
  const ctx = fixture(t);
  ctx.select.value = 'steel'; ctx.binding.sync();
  ctx.trigger().click(); ctx.type('concreto');
  const next = ctx.options()[0];
  next.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true }));
  ctx.search().dispatchEvent(new ctx.dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  next.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true }));
  // Mobile Safari can dismiss the keyboard and reflow the page before firing
  // its click. The choice must already be committed at pointerup.
  assert.equal(ctx.select.value, 'concrete');
  assert.equal(ctx.trigger().textContent.includes('Concreto'), true);
  assert.equal(new ctx.FormData(ctx.form).get('product'), 'concrete');
});

test('secondary mouse button does not commit a searchable option', t => {
  const ctx = fixture(t);
  ctx.trigger().click();
  const option = ctx.options().find(item => item.textContent === 'Concreto');
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 2 }));
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true, button: 2 }));
  assert.equal(ctx.select.value, '');
});

test('captured touch released outside its option does not commit it', t => {
  const ctx = fixture(t);
  ctx.trigger().click();
  const option = ctx.options().find(item => item.textContent === 'Concreto');
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 30, clientY: 30 }));
  ctx.document.elementFromPoint = () => ctx.document.querySelector('#outside');
  // Touch pointer capture can keep event.target on the option even though
  // the release coordinates are outside it.
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
  option.click();
  assert.equal(ctx.select.value, '');
  ctx.document.elementFromPoint = () => option;
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 30, clientY: 30 }));
  option.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 30, clientY: 30 }));
  assert.equal(ctx.select.value, 'concrete', 'a próxima tentativa válida continua disponível');
});

test('small stationary touch still commits when keyboard reflow moves the hit target', t => {
  const ctx = fixture(t);
  ctx.trigger().click();
  const option = ctx.options().find(item => item.textContent === 'Concreto');
  const down = new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 30, clientY: 30 });
  const up = new ctx.dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 36, clientY: 30 });
  Object.defineProperty(down, 'pointerType', { value: 'touch' });
  Object.defineProperty(up, 'pointerType', { value: 'touch' });
  option.dispatchEvent(down);
  ctx.document.elementFromPoint = () => ctx.document.querySelector('#outside');
  option.dispatchEvent(up);
  assert.equal(ctx.select.value, 'concrete');
});

test('releasing a dragged option outside the list restores normal popup dismissal', async t => {
  const ctx = fixture(t);
  ctx.trigger().click();
  ctx.options()[1].dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true }));
  ctx.popup().dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true }));
  await settle();
  ctx.document.querySelector('details').dispatchEvent(new ctx.Event('scroll'));
  assert.equal(ctx.popup().hidden, true);
  assert.equal(ctx.select.value, '', 'dragging away did not choose the option');
});

test('unknown search is never submitted as a filter and no-results Enter does nothing', t => {
  const ctx = fixture(t);
  ctx.trigger().click(); ctx.type('missing'); ctx.key('Enter');
  assert.equal(ctx.options().length, 0);
  assert.equal(ctx.select.value, '');
  assert.match(ctx.popup().textContent, /Nenhuma opção/i);
  ctx.type('');
  assert.equal(ctx.options()[0].textContent, 'Todos');
});

test('keyboard navigates enabled options, chooses with Enter and closes with Escape', t => {
  const ctx = fixture(t);
  let changes = 0;
  ctx.select.addEventListener('change', () => { changes += 1; });
  ctx.trigger().dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(ctx.popup().hidden, false);
  ctx.type(''); ctx.key('ArrowDown'); ctx.key('Enter');
  assert.equal(ctx.select.value, 'steel');
  assert.equal(changes, 1);
  ctx.trigger().click(); ctx.type('Indisponível'); ctx.key('Enter');
  assert.equal(ctx.select.value, 'steel');
  ctx.key('Escape');
  assert.equal(ctx.popup().hidden, true);
  assert.equal(ctx.document.activeElement, ctx.trigger());
});

test('outside click, collapsed details, hidden gallery and cancelPending close the popup', async t => {
  const ctx = fixture(t, { auto: true });
  ctx.trigger().click(); ctx.document.querySelector('#outside').click();
  assert.equal(ctx.popup().hidden, true);
  ctx.trigger().click(); ctx.binding.cancelPending();
  assert.equal(ctx.popup().hidden, true);
  ctx.trigger().click(); ctx.document.querySelector('details').open = false;
  await settle(); assert.equal(ctx.popup().hidden, true);
  ctx.document.querySelector('details').open = true;
  ctx.trigger().click(); ctx.document.querySelector('section').hidden = true;
  await settle(); assert.equal(ctx.popup().hidden, true);
});

test('options added after binding and disabled state refresh automatically', async t => {
  const ctx = fixture(t);
  ctx.select.replaceChildren(new ctx.dom.window.Option('Todos', ''), new ctx.dom.window.Option('Café', 'coffee'));
  ctx.select.value = 'coffee';
  await settle();
  assert.equal(ctx.trigger().textContent.includes('Café'), true);
  ctx.trigger().click(); ctx.type('cafe');
  assert.deepEqual(ctx.options().map(option => option.textContent), ['Café']);
  ctx.select.disabled = true;
  await settle();
  assert.equal(ctx.trigger().disabled, true);
  assert.equal(ctx.popup().hidden, true);
  ctx.select.disabled = false;
  await settle();
  assert.equal(ctx.trigger().disabled, false);
});

test('sync and apply reflect programmatic resets without an extra native change', t => {
  const ctx = fixture(t, { auto: true });
  ctx.select.value = 'steel'; ctx.binding.sync();
  assert.match(ctx.trigger().textContent, /Aço/);
  assert.equal(ctx.applies(), 0);
  ctx.select.value = ''; ctx.binding.apply();
  assert.match(ctx.trigger().textContent, /Todos/);
  assert.equal(ctx.applies(), 1);
});

test('native reset, external change and destroy restore native presentation', async t => {
  const ctx = fixture(t);
  ctx.select.value = 'concrete'; ctx.select.dispatchEvent(new ctx.Event('change', { bubbles: true }));
  assert.match(ctx.trigger().textContent, /Concreto/);
  ctx.form.reset(); await settle();
  assert.match(ctx.trigger().textContent, /Todos/);
  ctx.binding.destroy();
  assert.equal(ctx.select.hidden, false);
  assert.equal(ctx.select.closest('label')?.textContent.includes('Produto'), true);
  assert.equal(ctx.trigger(), null);
});

test('a disabled fieldset locks the picker until it is enabled again', async t => {
  const ctx = fixture(t);
  const fieldset = ctx.document.createElement('fieldset');
  ctx.form.append(fieldset); fieldset.append(ctx.select.parentElement);
  ctx.trigger().click(); fieldset.disabled = true; await settle();
  assert.equal(ctx.trigger().disabled, true);
  assert.equal(ctx.popup().hidden, true);
  fieldset.disabled = false; await settle();
  assert.equal(ctx.trigger().disabled, false);
});

test('destroy makes a previously displayed option inert', t => {
  const ctx = fixture(t);
  ctx.trigger().click(); ctx.type('aco');
  const previousOption = ctx.options()[0];
  ctx.binding.destroy();
  previousOption.click();
  assert.equal(ctx.select.value, '');
});

function viewport(ctx, { top = 0, height = 800, triggerTop = 120, triggerBottom = 164 } = {}) {
  const visualViewport = new ctx.dom.window.EventTarget();
  visualViewport.offsetTop = top; visualViewport.height = height;
  Object.defineProperty(ctx.dom.window, 'visualViewport', { configurable: true, value: visualViewport });
  ctx.trigger().getBoundingClientRect = () => ({ top: triggerTop, bottom: triggerBottom, height: triggerBottom - triggerTop });
  return visualViewport;
}

test('dropdown opens below a trigger with room and keeps option height bounded', t => {
  const ctx = fixture(t);
  viewport(ctx);
  ctx.trigger().click();
  assert.equal(ctx.popup().dataset.placement, 'below');
  assert.equal(ctx.popup().style.top, 'calc(100% + 5px)');
  assert.equal(ctx.popup().style.bottom, 'auto');
  assert.equal(parseFloat(ctx.form.querySelector('.sfs-list').style.maxHeight), 240);
});

test('dropdown opens above near the viewport bottom and remains inside the viewport', t => {
  const ctx = fixture(t);
  viewport(ctx, { height: 420, triggerTop: 300, triggerBottom: 344 });
  ctx.trigger().click();
  assert.equal(ctx.popup().dataset.placement, 'above');
  assert.equal(ctx.popup().style.bottom, 'calc(100% + 5px)');
  assert.equal(ctx.popup().style.top, 'auto');
  assert.ok(parseFloat(ctx.popup().style.maxHeight) <= 287);
  assert.ok(parseFloat(ctx.form.querySelector('.sfs-list').style.maxHeight) < 240);
});

test('visual viewport resize repositions the open dropdown for the mobile keyboard', t => {
  const ctx = fixture(t);
  const visualViewport = viewport(ctx, { triggerTop: 220, triggerBottom: 264 });
  ctx.trigger().click();
  assert.equal(ctx.popup().dataset.placement, 'below');
  visualViewport.height = 330;
  visualViewport.dispatchEvent(new ctx.Event('resize'));
  assert.equal(ctx.popup().dataset.placement, 'above');
  assert.ok(parseFloat(ctx.popup().style.maxHeight) <= 207);
  assert.equal(ctx.popup().hidden, false);
});

test('scrolling options keeps the popup open while scrolling an ancestor closes it', t => {
  const ctx = fixture(t);
  ctx.trigger().click();
  ctx.form.querySelector('.sfs-list').dispatchEvent(new ctx.Event('scroll'));
  assert.equal(ctx.popup().hidden, false);
  ctx.document.querySelector('section').dispatchEvent(new ctx.Event('scroll'));
  assert.equal(ctx.popup().hidden, true);
});
