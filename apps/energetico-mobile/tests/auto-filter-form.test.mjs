import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindAutoFilterForm } from '../src/ui/auto-filter-form.js';

for (const external of [false, true]) test(`auto filters wait for composition to finish (${external ? 'external search' : 'form field'})`, t => {
  const dom = new JSDOM('<form></form><input name="search" type="search"><output></output>');
  const doc = dom.window.document, form = doc.querySelector('form'), input = doc.querySelector('input');
  if (!external) form.append(input);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  dom.window.setTimeout = globalThis.setTimeout;
  dom.window.clearTimeout = globalThis.clearTimeout;
  const binding = bindAutoFilterForm(form, () => { doc.querySelector('output').textContent = input.value; },
    { externalControls: external ? [input] : [] });
  t.after(() => { binding.destroy(); dom.window.close(); });
  input.value = 's'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'sa'; input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, isComposing: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  t.mock.timers.tick(500);
  assert.equal(doc.querySelector('output').textContent, '', 'unfinished composition is not applied');
  input.value = 'São'; input.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true }));
  input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));
  t.mock.timers.tick(179); assert.equal(doc.querySelector('output').textContent, '');
  t.mock.timers.tick(1); assert.equal(doc.querySelector('output').textContent, 'São');
});
