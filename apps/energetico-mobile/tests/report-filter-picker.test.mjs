import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { bindSearchableFilterSelects } from '../src/ui/searchable-filter-selects.js';

const css = readFileSync(new URL('../src/ui/searchable-filter-selects.css', import.meta.url), 'utf8');
function setup(t, { multiple = false } = {}) {
  const dom = new JSDOM('<style></style><form><label>PRODUTO<select name="product"><option value="">Todos</option><option value="aco">Aço estrutural</option><option value="cimento">Cimento</option></select></label><button type="button" id="outside">Fora</button></form>');
  const doc = dom.window.document, select = doc.querySelector('select');
  doc.querySelector('style').textContent = css; select.multiple = multiple;
  for (let index = 1; index <= 40; index++) select.add(new dom.window.Option(`Produto ${index}`, `p${index}`));
  const viewport = new dom.window.EventTarget();
  Object.assign(viewport, { width: 844, height: 390, offsetLeft: 0, offsetTop: 0 });
  Object.defineProperty(dom.window, 'visualViewport', { value: viewport, configurable: true });
  const binding = bindSearchableFilterSelects(doc.querySelector('form'), { report: true });
  const wrapper = doc.querySelector('.sfs'), trigger = wrapper.querySelector('.sfs-trigger');
  trigger.getBoundingClientRect = () => ({ left: 620, right: 760, top: 20, bottom: 47, width: 140, height: 27 });
  const popup = wrapper.querySelector('.sfs-popup'), list = wrapper.querySelector('.sfs-list');
  const search = () => { const input = popup.querySelector('input'); assert.ok(input, 'expanded report picker exposes Localizar itens'); return input; };
  t.after(() => { binding.destroy(); dom.window.close(); });
  return { dom, doc, select, viewport, binding, wrapper, trigger, popup, list, search,
    type(query) { search().value = query; search().dispatchEvent(new dom.window.Event('input', { bubbles: true })); },
    key(target, key) { target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); },
  };
}

test('report field opens choices without focusing an editable input or summoning the keyboard', t => {
  const ctx = setup(t); ctx.trigger.focus(); ctx.trigger.click();
  assert.equal(ctx.trigger.readOnly, true);
  assert.equal(ctx.popup.hidden, false);
  assert.equal(ctx.doc.activeElement, ctx.trigger);
  assert.equal(ctx.trigger.value, 'Todos');
  assert.ok(ctx.search(), 'Localizar itens lives in the expanded selection panel');
  assert.equal(ctx.search().placeholder, 'Localizar itens');
  assert.equal(ctx.search().readOnly, false);
});

test('arrow opens the same large panel and keeps search unfocused', t => {
  const ctx = setup(t); ctx.wrapper.querySelector('.sfs-arrow').click();
  assert.equal(ctx.popup.hidden, false);
  assert.notEqual(ctx.doc.activeElement, ctx.search());
  assert.ok(parseFloat(ctx.list.style.maxHeight) >= 280, 'the landscape list has room for many options');
  assert.equal(ctx.list.children.length, 43, 'no arbitrary option limit hides later products');
  const left = parseFloat(ctx.popup.style.left), width = parseFloat(ctx.popup.style.width);
  assert.ok(width >= 400 && left >= 0 && left + width <= ctx.viewport.width);
  assert.ok(Math.abs(left + width / 2 - ctx.viewport.width / 2) < 1, 'expanded panel is centered');
});

test('explicit Localizar itens focus searches accents without applying an unknown filter', t => {
  const ctx = setup(t); let changes = 0; ctx.select.addEventListener('change', () => changes++);
  ctx.trigger.click(); ctx.search().focus();
  assert.equal(ctx.doc.activeElement, ctx.search());
  ctx.type('aco'); assert.deepEqual([...ctx.list.children].map(item => item.textContent), ['Aço estrutural']);
  assert.equal(ctx.select.value, ''); assert.equal(changes, 0);
  ctx.type('inexistente'); ctx.key(ctx.search(), 'Enter');
  assert.equal(ctx.select.value, ''); assert.equal(changes, 0);
  ctx.type('aco'); ctx.list.firstElementChild.click();
  assert.equal(ctx.select.value, 'aco'); assert.equal(changes, 1);
  assert.equal(new ctx.dom.window.FormData(ctx.doc.querySelector('form')).get('product'), 'aco');
  assert.equal(ctx.popup.hidden, true); assert.equal(ctx.trigger.value, 'Aço estrutural');
  assert.equal(ctx.doc.activeElement, ctx.trigger); assert.equal(ctx.trigger.readOnly, true);
});

test('closing selection clears only the search and restores non-editable field focus', t => {
  const ctx = setup(t); ctx.select.value = 'cimento'; ctx.binding.sync();
  ctx.trigger.click(); ctx.search().focus(); ctx.type('p40');
  ctx.popup.querySelector('[aria-label="Fechar opções de PRODUTO"]').click();
  assert.equal(ctx.popup.hidden, true); assert.equal(ctx.trigger.value, 'Cimento');
  assert.equal(ctx.doc.activeElement, ctx.trigger);
  ctx.trigger.click(); assert.equal(ctx.search().value, ''); assert.equal(ctx.list.children.length, 43);
  ctx.key(ctx.trigger, 'Escape'); assert.equal(ctx.popup.hidden, true);
});

test('multiple report choices update the field while keeping search and option list open', t => {
  const ctx = setup(t, { multiple: true }); ctx.trigger.click(); ctx.search().focus();
  ctx.type('aco'); ctx.list.firstElementChild.click(); ctx.type('cimento'); ctx.list.firstElementChild.click();
  assert.deepEqual([...ctx.select.selectedOptions].map(option => option.value), ['aco', 'cimento']);
  assert.equal(ctx.trigger.value, 'Aço estrutural, Cimento'); assert.equal(ctx.popup.hidden, false);
  ctx.type('todos'); ctx.list.firstElementChild.click();
  assert.deepEqual([...ctx.select.selectedOptions].map(option => option.value), ['']);
});

test('keyboard navigation chooses from the readonly report field without activating search', t => {
  const ctx = setup(t); assert.equal(ctx.trigger.readOnly, true);
  ctx.trigger.focus(); ctx.key(ctx.trigger, 'ArrowDown'); ctx.key(ctx.trigger, 'Enter');
  assert.equal(ctx.select.value, 'aco'); assert.equal(ctx.popup.hidden, true);
  assert.equal(ctx.doc.activeElement, ctx.trigger);
});

test('search keyboard overlays the report list without flattening its opening height', t => {
  const ctx = setup(t); ctx.trigger.click(); ctx.search().focus(); ctx.type('produto');
  const openingHeight = ctx.popup.style.height, openingListHeight = ctx.list.style.maxHeight;
  ctx.viewport.height = 230; ctx.viewport.offsetTop = 30; ctx.viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  const top = parseFloat(ctx.popup.style.top), height = parseFloat(ctx.popup.style.height);
  assert.equal(ctx.popup.style.height, openingHeight, 'keyboard must not shrink the selection panel');
  assert.equal(ctx.list.style.maxHeight, openingListHeight, 'scrollable options retain their height');
  assert.ok(top >= 30 && top + 48 <= 260, 'Localizar itens remains above the keyboard');
  assert.ok(top + height > 260, 'the keyboard may cover the list bottom, as in PowerApps');
  assert.equal(ctx.search().value, 'produto'); assert.equal(ctx.list.children.length, 40);
  ctx.list.lastElementChild.click(); assert.equal(ctx.select.value, 'p40');
});

test('Android layout resize and search rerender do not collapse the report picker', t => {
  const ctx = setup(t); ctx.trigger.click(); ctx.search().focus();
  ctx.viewport.height = 170;
  ctx.dom.window.innerHeight = 170;
  ctx.dom.window.dispatchEvent(new ctx.dom.window.Event('resize'));
  ctx.type('produto');
  assert.equal(ctx.popup.style.height, '366px');
  assert.equal(ctx.list.style.maxHeight, '312px');
  ctx.binding.sync();
  assert.equal(ctx.popup.style.height, '366px');
  ctx.binding.close(); ctx.trigger.click();
  assert.equal(ctx.popup.style.height, '366px', 'reopening during keyboard dismissal keeps the full list');
});

test('report picker adapts to rotation instead of retaining the previous orientation height', t => {
  const ctx = setup(t); ctx.viewport.width = 390; ctx.viewport.height = 844; ctx.trigger.click();
  assert.equal(ctx.popup.style.height, '640px');
  ctx.viewport.width = 844; ctx.viewport.height = 390;
  ctx.viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  assert.equal(ctx.popup.style.height, '366px');
  assert.ok(parseFloat(ctx.popup.style.left) + parseFloat(ctx.popup.style.width) <= 844);
});

test('resizing a desktop window without editing search still fits the smaller viewport', t => {
  const ctx = setup(t); ctx.viewport.height = 800; ctx.trigger.click();
  assert.equal(ctx.popup.style.height, '640px');
  ctx.viewport.height = 390; ctx.viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  assert.equal(ctx.popup.style.height, '366px');
});

test('report search respects safe-area padding through keyboard panning and rotation', t => {
  const ctx = setup(t);
  // JSDOM cannot resolve env(); use computed pixel insets while browser tests
  // exercise the real safe-area environment values.
  const backdrop = ctx.wrapper.querySelector('.sfs-backdrop');
  backdrop.style.padding = '59px 0px 34px';
  ctx.viewport.width = 390; ctx.viewport.height = 844; ctx.trigger.click();
  const height = parseFloat(ctx.popup.style.height);
  assert.ok(parseFloat(ctx.popup.style.top) >= 71, 'search must start below the status bar');
  assert.ok(parseFloat(ctx.popup.style.top) + height <= 798, 'list must leave bottom safe area');
  ctx.search().focus(); ctx.type('produto');
  ctx.viewport.height = 450; ctx.viewport.offsetTop = 30;
  ctx.viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  assert.ok(parseFloat(ctx.popup.style.top) >= 101, 'panned search still leaves status-bar clearance');
  assert.equal(parseFloat(ctx.popup.style.height), height, 'keyboard does not flatten the option list');
  backdrop.style.padding = '0px 59px 21px';
  ctx.viewport.width = 844; ctx.viewport.height = 390; ctx.viewport.offsetTop = 0;
  ctx.viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  assert.ok(parseFloat(ctx.popup.style.top) + parseFloat(ctx.popup.style.height) <= 357);
  assert.ok(parseFloat(ctx.popup.style.left) >= 71, 'rotation remeasures notch insets');
  assert.equal(ctx.search().value, 'produto');
});

test('report options use compact black text while search remains large enough to avoid iOS focus zoom', t => {
  const ctx = setup(t); ctx.trigger.click();
  const style = ctx.dom.window.getComputedStyle(ctx.list.children[1]);
  assert.equal(style.color, 'rgb(0, 0, 0)');
  assert.equal(style.fontSize, '14px');
  assert.ok(['normal', '400'].includes(style.fontWeight));
  assert.equal(ctx.dom.window.getComputedStyle(ctx.search()).fontSize, '16px');
});

test('backdrop dismisses the report selection and is removed when picker is destroyed', t => {
  const ctx = setup(t); ctx.trigger.click();
  const backdrop = ctx.wrapper.querySelector('.sfs-backdrop'); assert.ok(backdrop); assert.equal(backdrop.hidden, false);
  backdrop.click(); assert.equal(ctx.popup.hidden, true); assert.equal(backdrop.hidden, true);
  ctx.binding.destroy(); assert.equal(ctx.doc.querySelector('.sfs-backdrop'), null); assert.equal(ctx.select.hidden, false);
});

test('disabled report controls settle without a visibility-observer feedback loop', async t => {
  const dom = new JSDOM('<form><select aria-label="Produto" disabled><option>Todos</option></select></form>');
  let deliveries = 0; const observers = [];
  const NativeObserver = dom.window.MutationObserver;
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super((records, observer) => {
        if (++deliveries > 20) { observers.forEach(item => item.disconnect()); return; }
        callback(records, observer);
      });
      observers.push(this);
    }
  };
  const binding = bindSearchableFilterSelects(dom.window.document.querySelector('form'), { report: true });
  t.after(() => { binding.destroy(); dom.window.close(); });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(deliveries <= 20, 'disabled state must not continuously mutate its already-hidden backdrop');
  assert.equal(dom.window.document.querySelector('.sfs-trigger').disabled, true);
});
