import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindSearchableFilterSelects } from '../src/ui/searchable-filter-selects.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, { report = false, multiple = false, blank = true } = {}) {
  const dom = new JSDOM(`<form><label>Produto<select name="product" ${multiple ? 'multiple' : ''}>${blank ? '<option value="">Selecione o produto</option>' : ''}<option value="steel" selected>Aço estrutural</option><option value="concrete">Concreto</option></select></label></form>`);
  const doc = dom.window.document, select = doc.querySelector('select');
  const binding = bindSearchableFilterSelects(doc.querySelector('form'), { report });
  let changes = 0;
  select.addEventListener('change', () => changes++);
  t.after(() => { binding.destroy(); dom.window.close(); });
  return { dom, doc, select, binding, changes: () => changes,
    trigger: doc.querySelector('.sfs-trigger'), popup: doc.querySelector('.sfs-popup'),
    chips: root => [...(root || doc).querySelectorAll('.sfs-chip')],
    remove: root => (root || doc).querySelector('.sfs-chip-remove'),
  };
}

for (const report of [false, true]) {
  test(`${report ? 'report' : 'inline'} picker displays preselection, replaces it and clears the actual field`, t => {
    const ctx = fixture(t, { report });
    assert.equal(ctx.chips(ctx.doc.querySelector('.sfs-field')).length, 1);
    assert.equal(ctx.doc.querySelector('.sfs-chip-label').textContent, 'Aço estrutural');
    ctx.trigger.click();
    assert.equal(ctx.chips(ctx.popup).length, 1);
    const search = ctx.doc.querySelector('.sfs-search');
    search.value = 'concreto'; search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
    assert.equal(ctx.popup.querySelector('.sfs-chip-label').textContent, 'Aço estrutural', 'selection stays visible when filtered out');
    ctx.popup.querySelector('[role=option]').click();
    assert.equal(ctx.select.value, 'concrete');
    assert.equal(ctx.doc.querySelector('.sfs-chip-label').textContent, 'Concreto');
    assert.equal(ctx.changes(), 1);
    ctx.trigger.click();
    ctx.remove(ctx.popup).click();
    assert.equal(ctx.select.value, '');
    assert.equal(new ctx.dom.window.FormData(ctx.doc.querySelector('form')).get('product'), '');
    assert.equal(ctx.chips().length, 0);
    assert.equal(ctx.changes(), 2);
    assert.equal(ctx.popup.hidden, false, 'clearing leaves the options available');
    assert.equal(search.value, '', 'old search is cleared too');
  });
}

test('closed chip can clear a select without a blank option without choosing its first item', t => {
  const ctx = fixture(t, { blank: false });
  const remove = ctx.remove();
  assert.ok(remove, 'closed field has a remove control');
  assert.match(remove.getAttribute('aria-label'), /Remover.*Aço estrutural/);
  remove.click();
  assert.equal(ctx.select.selectedIndex, -1);
  assert.equal(ctx.select.value, '');
  assert.equal(ctx.trigger.value, '');
  assert.equal(ctx.chips().length, 0);
  assert.equal(ctx.changes(), 1);
  assert.equal(ctx.popup.hidden, true, 'closed-field removal does not open the list');
});

test('multiple chips remove only their own value and preserve other selections', t => {
  const ctx = fixture(t, { report: true, multiple: true });
  ctx.select.options[2].selected = true; ctx.binding.sync();
  ctx.trigger.click();
  assert.equal(ctx.chips(ctx.popup).length, 2);
  ctx.remove(ctx.popup).click();
  assert.deepEqual([...ctx.select.selectedOptions].map(option => option.value), ['concrete']);
  assert.equal(ctx.popup.querySelector('.sfs-chip-label').textContent, 'Concreto');
  assert.equal(ctx.changes(), 1);
});

test('disabled fieldsets prevent removal and external updates and reset refresh the chips', async t => {
  const ctx = fixture(t);
  const fieldset = ctx.doc.createElement('fieldset');
  ctx.doc.querySelector('form').append(fieldset); fieldset.append(ctx.select.parentElement);
  fieldset.disabled = true; await settle();
  assert.ok(ctx.remove()?.disabled);
  ctx.remove().click(); assert.equal(ctx.select.value, 'steel');
  fieldset.disabled = false; await settle();
  ctx.select.value = 'concrete'; ctx.select.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.equal(ctx.doc.querySelector('.sfs-chip-label').textContent, 'Concreto');
  ctx.doc.querySelector('form').reset(); await settle();
  assert.equal(ctx.doc.querySelector('.sfs-chip-label').textContent, 'Aço estrutural');
  ctx.select.value = ''; ctx.binding.sync();
  assert.equal(ctx.chips().length, 0, 'placeholder is not a selection chip');
});

test('chip labels are text and removed controls become inert after destroy', t => {
  const ctx = fixture(t);
  ctx.select.options[1].label = '<img src=x onerror=alert(1)>'; ctx.binding.sync();
  assert.equal(ctx.doc.querySelector('.sfs-chip-label').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(ctx.doc.querySelector('img'), null);
  const remove = ctx.remove();
  assert.ok(remove);
  ctx.binding.destroy(); remove.click();
  assert.equal(ctx.select.value, 'steel');
});
