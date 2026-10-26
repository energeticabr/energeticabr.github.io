import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindAutoFilterForm } from '../src/ui/auto-filter-form.js';

for (const event of ['change', 'search']) test(`strict text debounce waits for input silence even with native ${event}`, t => {
  const dom = new JSDOM('<form><input name="id"><select name="supplier"><option>A</option><option>B</option></select></form><input name="search" type="search"><output></output>');
  const doc = dom.window.document, form = doc.querySelector('form'), input = doc.querySelector('[name="search"]');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  dom.window.setTimeout = globalThis.setTimeout; dom.window.clearTimeout = globalThis.clearTimeout;
  const applied = [];
  const binding = bindAutoFilterForm(form, () => { applied.push(input.value); },
    { externalControls: [input], debounceMs: 3000, strictTextDebounce: true });
  t.after(() => { binding.destroy(); dom.window.close(); });
  input.value = 'Ma'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  t.mock.timers.tick(1500); input.dispatchEvent(new dom.window.Event(event, { bubbles: true }));
  t.mock.timers.tick(1499); assert.deepEqual(applied, []);
  t.mock.timers.tick(1); assert.deepEqual(applied, ['Ma']);
  const select = doc.querySelector('select'); select.value = 'B';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(applied, ['Ma', 'Ma'], 'explicit select remains immediate');
});

for (const strict of [false, true]) for (const external of [false, true]) test(`auto filters wait for composition to finish (${external ? 'external search' : 'form field'}, strict=${strict})`, t => {
  const dom = new JSDOM('<form></form><input name="search" type="search"><output></output>');
  const doc = dom.window.document, form = doc.querySelector('form'), input = doc.querySelector('input');
  if (!external) form.append(input);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  dom.window.setTimeout = globalThis.setTimeout;
  dom.window.clearTimeout = globalThis.clearTimeout;
  const binding = bindAutoFilterForm(form, () => { doc.querySelector('output').textContent = input.value; },
    { externalControls: external ? [input] : [], ...(strict ? { debounceMs: 3000, strictTextDebounce: true } : {}) });
  t.after(() => { binding.destroy(); dom.window.close(); });
  input.value = 's'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'sa'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  t.mock.timers.tick(500);
  assert.equal(doc.querySelector('output').textContent, '', 'unfinished composition is not applied');
  input.value = 'São'; input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  t.mock.timers.tick(strict ? 2999 : 179); assert.equal(doc.querySelector('output').textContent, '');
  t.mock.timers.tick(1); assert.equal(doc.querySelector('output').textContent, 'São');
});
