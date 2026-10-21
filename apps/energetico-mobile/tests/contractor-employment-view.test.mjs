import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as subject from '../src/ui/contractor-employment-view.js';
import { createContractorEmploymentFixture } from './helpers/contractor-employment-fixture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const synthetic = { id: '4', eTag: '"1"', fields: { Title: 'Funcionário Exemplo', CARGO: '', DATAADMISSAO: '', STATUS: 'ATIVO', FILIAL: 'Obra A', IDFORNECEDORORIGEM: '17', field_6: 31, Author: 'Autor Exemplo', Created: '2026-01-01' } };
test('shows all target fields and incomplete RH data, and cancelling inactivation never saves', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, saved = [];
  const data = { loadSnapshot: async () => ({ rows: [synthetic], columns: [{ name: 'field_6', displayName: 'ENDEREÇO' }] }), save: async (...args) => { saved.push(args); return synthetic; } };
  const view = subject.createContractorEmploymentView({ document: doc, data });
  try {
    await view.open();
    assert.match(doc.body.textContent, /Dados de RH incompletos: cargo e admissão/);
    assert.match(doc.body.textContent, /ENDEREÇO/);
    assert.match(doc.body.textContent, /31/);
    assert.match(doc.body.textContent, /Created/);
    doc.querySelector('[data-action="inactivate"]').click();
    assert.equal(doc.querySelector('[name="DATADESLIGAMENTO"]').required, true);
    assert.equal(doc.querySelectorAll('[name="CARGO"] option').length, 9);
    doc.querySelector('[data-action="cancel-edit"]').click();
    await tick();
    assert.equal(saved.length, 0);
    assert.equal(doc.querySelector('form'), null);
  } finally { view.destroy(); dom.window.close(); }
});
test('retains editor and shows explicit partial error without claiming successful save', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  const view = subject.createContractorEmploymentView({ document: doc, data: {
    loadSnapshot: async () => ({ rows: [synthetic], columns: [] }),
    save: async () => { throw new Error('Fornecedor salvo; espelho pendente. Tente novamente.'); },
  } });
  try {
    await view.open(); doc.querySelector('[data-action="edit"]').click();
    doc.querySelector('[name="CARGO"]').value = 'PEDREIRO III';
    doc.querySelector('[name="DATAADMISSAO"]').value = '2026-01-20';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.match(doc.querySelector('[role="alert"]').textContent, /espelho pendente/);
    assert.ok(doc.querySelector('form'));
  } finally { view.destroy(); dom.window.close(); }
});
test('gallery search and filters include inactive history and fields outside the highlights', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  const inactive = { id: '5', fields: { ...synthetic.fields, Title: 'Histórico Exemplo', CARGO: 'MESTRE DE OBRAS', FILIAL: 'Obra B', STATUS: 'INATIVO' } };
  const view = subject.createContractorEmploymentView({ document: doc, data: { loadSnapshot: async () => ({ rows: [synthetic, inactive] }), save() { assert.fail('Filtering cannot write'); } } });
  try {
    await view.open();
    const filter = doc.querySelector('[data-filter="STATUS"]'); filter.value = 'INATIVO'; filter.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual([...doc.querySelectorAll('[data-employment-row]')].map(node => node.dataset.employmentRow), ['5']);
    assert.equal(doc.querySelector('[data-action="inactivate"]'), null);
    filter.value = ''; filter.dispatchEvent(new dom.window.Event('change'));
    const search = doc.querySelector('[data-search]'); search.value = '2026-01-01'; search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelectorAll('[data-employment-row]').length, 2);
    search.value = 'não existe'; search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelectorAll('[data-employment-row]').length, 0);
  } finally { view.destroy(); dom.window.close(); }
});
test('inactivation validates dates before save and a valid submit updates the retained historical card', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, writes = [];
  const complete = { ...synthetic, fields: { ...synthetic.fields, CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20' } };
  const view = subject.createContractorEmploymentView({ document: doc, data: {
    loadSnapshot: async () => ({ rows: [complete] }),
    save: async (selected, draft) => { writes.push({ selected, draft }); return { ...selected, fields: { ...selected.fields, ...draft } }; },
  } });
  try {
    await view.open(); doc.querySelector('[data-action="inactivate"]').click();
    const form = doc.querySelector('form'), date = doc.querySelector('[name="DATADESLIGAMENTO"]');
    for (const value of ['', '2026-01-19']) {
      date.value = value; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
      assert.equal(writes.length, 0); assert.match(doc.querySelector('[role="alert"]').textContent, /desligamento|admissão/);
    }
    date.value = '2026-01-20'; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(writes.length, 1);
    assert.equal(doc.querySelectorAll('[data-employment-row]').length, 1);
    assert.match(doc.querySelector('[data-employment-row]').textContent, /INATIVO/);
    assert.equal(doc.querySelector('[data-action="inactivate"]'), null);
    assert.match(doc.querySelector('[role="status"]').textContent, /confirmada/);
  } finally { view.destroy(); dom.window.close(); }
});
test('failed refresh never presents a partial or empty search as a completed query', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  let fail = false;
  const view = subject.createContractorEmploymentView({ document: doc, data: {
    loadSnapshot: async () => { if (fail) throw new Error('Paginação incompleta'); return { rows: [synthetic] }; }, save() {},
  } });
  try {
    await view.open(); fail = true; doc.querySelector('[data-action="refresh"]').click(); await tick();
    assert.equal(doc.querySelectorAll('[data-employment-row]').length, 0);
    const search = doc.querySelector('[data-search]'); search.value = 'exemplo'; search.dispatchEvent(new dom.window.Event('input'));
    assert.match(doc.querySelector('[role="status"]').textContent, /incompleta/i);
    assert.match(doc.querySelector('[role="alert"]').textContent, /Paginação incompleta/);
  } finally { view.destroy(); dom.window.close(); }
});

test('cargo edit cannot reactivate source; explicit status review shows RH-only dates and requires termination', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, f = createContractorEmploymentFixture();
  f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"';
  const view = subject.createContractorEmploymentView({ document: doc, data: f.data });
  try {
    await view.open(); doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click();
    doc.querySelector('[name="CARGO"]').value = 'MESTRE DE OBRAS';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.deepEqual(f.writes.map(w => w.list), ['FUNCIONARIOSRH']); assert.equal(f.source.fields.STATUS, 'INATIVO');
    doc.querySelector('[data-employment-row="4"] [data-action="inactivate"]').click();
    doc.querySelector('[name="DATADESLIGAMENTO"]').value = '2026-02-20';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.writes.length, 1); assert.match(doc.querySelector('[role="alert"]').textContent, /diverge/);
    doc.querySelector('[data-employment-row="4"] [data-action="review-conflict"]').click(); await tick();
    const source = doc.querySelector('[data-conflict-source]');
    assert.match(source.textContent, /INATIVO/); assert.doesNotMatch(source.textContent, /Cargo|Admissão|Desligamento/);
    assert.match(doc.querySelector('[data-conflict-target]').textContent, /MESTRE DE OBRAS/);
    doc.querySelector('[data-action="renew-baseline"]').click(); await tick();
    assert.equal(doc.querySelector('[name="STATUS"]').value, 'INATIVO');
    assert.equal(doc.querySelector('[name="DATAADMISSAO"]').value, '2026-01-20');
    assert.equal(doc.querySelector('[name="DATADESLIGAMENTO"]').value, '');
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.writes.length, 1); assert.match(doc.querySelector('[role="alert"]').textContent, /desligamento/);
    doc.querySelector('[name="DATADESLIGAMENTO"]').value = '2026-02-20';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.writes.length, 2); assert.equal(f.source.fields.STATUS, 'INATIVO');
  } finally { view.destroy(); dom.window.close(); }
});

test('target partial conflict can be cancelled then renewed after a reviewed superseding RH version', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, f = createContractorEmploymentFixture();
  const view = subject.createContractorEmploymentView({ document: doc, data: f.data });
  try {
    await view.open(); f.failTarget(true);
    doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click(); doc.querySelector('[name="CARGO"]').value = 'MESTRE DE OBRAS';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.writes.length, 1); assert.match(doc.querySelector('[role="alert"]').textContent, /não foi confirmada/);
    f.target.fields.CARGO = 'SUPERVISOR DE OBRAS'; f.target.eTag = '"9"'; f.source.fields.STATUS = 'INATIVO'; f.source.eTag = '"9"'; f.failTarget(false);
    doc.querySelector('[data-action="refresh"]').click(); await tick();
    assert.match(doc.querySelector('[role="alert"]').textContent, /não foi confirmada/);
    const review = () => doc.querySelector('[data-employment-row="4"] [data-action="review-conflict"]');
    review().click(); await tick(); assert.match(doc.querySelector('[data-conflict-target]').textContent, /SUPERVISOR DE OBRAS/);
    doc.querySelector('[data-action="cancel-conflict"]').click(); assert.equal(f.writes.length, 1);
    review().click(); await tick(); doc.querySelector('[data-action="renew-baseline"]').click(); await tick();
    assert.match(doc.querySelector('.ce-editor').textContent, /não confirma a tentativa anterior/i);
    assert.equal(doc.querySelector('[name="STATUS"]').value, 'ATIVO'); assert.equal(doc.querySelector('[name="CARGO"]').value, 'SUPERVISOR DE OBRAS');
    assert.doesNotMatch(doc.querySelector('[role="status"]').textContent, /Atualização confirmada/);
    doc.querySelector('[name="CARGO"]').value = 'SERVENTE DE PEDREIRO III';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.writes.length, 2); assert.equal(f.source.fields.STATUS, 'INATIVO'); assert.match(doc.querySelector('[role="status"]').textContent, /Atualização confirmada/);
  } finally { view.destroy(); dom.window.close(); }
});

test('review cannot discard an uncertain target write whose original ETag has not changed', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  const { data, repository, writes } = createContractorEmploymentFixture();
  repository.updateItem = async () => { throw new Error('synthetic unknown write'); };
  const view = subject.createContractorEmploymentView({ document: doc, data });
  try {
    await view.open(); doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click();
    doc.querySelector('[name="CARGO"]').value = 'MESTRE DE OBRAS';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    const review = doc.querySelector('[data-employment-row="4"] [data-action="review-conflict"]');
    assert.ok(review); review.click(); await tick();
    const renew = doc.querySelector('[data-action="renew-baseline"]');
    assert.equal(renew.disabled, true); renew.click(); await tick();
    assert.equal(writes.length, 0);
    doc.querySelector('[data-action="cancel-conflict"]').click();
    assert.equal(doc.querySelector('[name="CARGO"]').value, 'MESTRE DE OBRAS');
  } finally { view.destroy(); dom.window.close(); }
});
test('a new partial save replaces any earlier success status until both records are verified', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document;
  const { data, failTarget } = createContractorEmploymentFixture();
  const view = subject.createContractorEmploymentView({ document: doc, data });
  try {
    await view.open();
    doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click();
    doc.querySelector('[name="CARGO"]').value = 'MESTRE DE OBRAS';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.match(doc.querySelector('[role="status"]').textContent, /Atualização confirmada/);
    failTarget(true);
    doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click();
    doc.querySelector('[name="CARGO"]').value = 'SUPERVISOR DE OBRAS';
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.match(doc.querySelector('[role="alert"]').textContent, /não foi confirmada/);
    assert.doesNotMatch(doc.querySelector('[role="status"]').textContent, /Atualização confirmada/);
  } finally { view.destroy(); dom.window.close(); }
});

test('zero future registrations is a valid empty gallery, never a historical regularization request', async () => {
  const dom = new JSDOM('<main></main>'), f = createContractorEmploymentFixture();
  f.repository.getItemsPage = async () => ({ items: [], hasMore: false });
  const view = subject.createContractorEmploymentView({ document: dom.window.document, data: f.data });
  try {
    await view.open();
    assert.match(dom.window.document.querySelector('[role="status"]').textContent, /0 de 0/);
    assert.match(dom.window.document.querySelector('.ce-list').textContent, /futuros cadastros/i);
    assert.doesNotMatch(dom.window.document.body.textContent, /regularizar|importar|históric.*fonte/i);
    assert.deepEqual(f.resolved, ['FUNCIONARIOSRH']); assert.equal(f.writes.length, 0);
  } finally { view.destroy(); dom.window.close(); }
});
test('choosing reactivation explicitly clears the RH termination before synchronizing statuses', async () => {
  const dom = new JSDOM('<main></main>'), doc = dom.window.document, f = createContractorEmploymentFixture();
  f.source.fields.STATUS = f.target.fields.STATUS = 'INATIVO'; f.target.fields.DATADESLIGAMENTO = '2026-02-20';
  const view = subject.createContractorEmploymentView({ document: doc, data: f.data });
  try {
    await view.open(); doc.querySelector('[data-employment-row="4"] [data-action="edit"]').click();
    const state = doc.querySelector('[name="STATUS"]'); state.value = 'ATIVO'; state.dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.querySelector('[name="DATADESLIGAMENTO"]').value, '');
    doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(f.target.fields.DATADESLIGAMENTO, null); assert.deepEqual(f.writes[0].fields, { STATUS: 'ATIVO' });
  } finally { view.destroy(); dom.window.close(); }
});
