import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { renderDynamicForm } from '../portal/ui/dynamic-form.js';
import * as editReview from '../portal/ui/edit-review.js';

const { JSDOM } = createRequire(new URL('../apps/energetico-mobile/package.json', import.meta.url))('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const column = (name, control = 'text', extra = {}) => ({ name, label: name, control, editable: true, ...extra });

function setup(t, options = {}) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true });
  const root = dom.window.document.querySelector('main');
  const calls = [];
  const binding = renderDynamicForm(root, {
    entity: { title: 'Registro fictício' }, mode: 'edit',
    columns: [column('NOME')], values: { NOME: 'ORIGINAL' },
    onSubmit: (...args) => { calls.push(args); }, ...options,
  });
  const form = root.querySelector('form');
  const input = name => form.elements.namedItem(name);
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const change = (name, value, type = 'input') => {
    const control = input(name);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
    control.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  };
  const review = () => dom.window.document.querySelector('[data-edit-review]');
  t.after(() => { binding.cleanup(); dom.window.close(); });
  return { dom, root, form, input, submit, change, review, calls, binding };
}

test('live fill compares saved numeric/date/boolean/text values and removes on revert', async t => {
  const s = setup(t, {
    columns: [column('VALOR', 'currency'), column('DIA', 'date'), column('HORA', 'datetime-local'), column('ATIVO', 'checkbox'), column('NOME')],
    values: { VALOR: 250, DIA: '2026-11-01T00:00:00Z', HORA: '2026-11-01T10:20:00', ATIVO: true, NOME: 'ORIGINAL' },
  });
  s.change('VALOR', '250.00'); s.change('NOME', ' original ');
  await tick();
  assert.equal(s.form.querySelectorAll('[data-edit-changed]').length, 0);
  s.change('VALOR', '251.00'); s.change('ATIVO', false); s.change('DIA', '2026-11-02');
  await tick();
  for (const name of ['VALOR', 'ATIVO', 'DIA']) {
    assert.ok(s.input(name).closest('[data-edit-changed]'), `${name} gets a visible changed surface`);
  }
  const style = s.dom.window.getComputedStyle(s.input('VALOR'));
  assert.equal(style.backgroundColor, 'rgb(255, 204, 128)');
  assert.equal(style.borderColor, 'rgb(198, 106, 0)');
  s.change('VALOR', '250'); s.change('ATIVO', true); s.change('DIA', '2026-11-01');
  await tick();
  assert.equal(s.form.querySelectorAll('[data-edit-changed]').length, 0);
});

test('first submit shows Campo/Antes/Depois before persistence and confirmation saves once', async t => {
  let finish;
  let writes = 0;
  const s = setup(t, { onSubmit: async fields => { writes++; assert.equal(fields.NOME, 'ALTERADO'); await new Promise(resolve => { finish = resolve; }); } });
  s.change('NOME', 'ALTERADO'); s.submit(); s.submit();
  await tick();
  assert.equal(writes, 0, 'opening review must not persist');
  const review = s.review();
  assert.ok(review);
  assert.deepEqual([...review.querySelectorAll('th')].map(th => th.textContent), ['Campo', 'Antes', 'Depois']);
  assert.deepEqual([...review.querySelectorAll('tbody td')].map(td => td.textContent), ['NOME', 'ORIGINAL', 'ALTERADO']);
  assert.equal(s.dom.window.document.querySelectorAll('[data-edit-review]').length, 1);
  assert.equal(review.querySelector('[data-edit-review-confirm]').textContent, 'SUBMETER');
  assert.equal(review.querySelector('[data-edit-review-cancel]').textContent, 'CANCELAR');
  const confirm = review.querySelector('[data-edit-review-confirm]');
  confirm.click(); confirm.click(); s.submit();
  await tick();
  assert.equal(writes, 1);
  assert.equal(s.input('NOME').disabled, true);
  finish(); await tick();
  assert.equal(s.input('NOME').disabled, false);
});

test('cancel and Escape retain draft, restore focus, and allow another review', async t => {
  const s = setup(t);
  s.change('NOME', 'RASCUNHO');
  const save = s.form.querySelector('[data-form-save]'); save.focus();
  s.submit(); await tick();
  assert.ok(s.review());
  s.review().querySelector('[data-edit-review-cancel]').click(); await tick();
  assert.equal(s.calls.length, 0); assert.equal(s.review(), null);
  assert.equal(s.input('NOME').value, 'RASCUNHO');
  assert.equal(s.dom.window.document.activeElement, save);
  s.submit(); await tick();
  s.dom.window.document.dispatchEvent(new s.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await tick();
  assert.equal(s.review(), null); assert.equal(s.calls.length, 0);
  assert.equal(s.input('NOME').value, 'RASCUNHO');
  assert.ok(s.input('NOME').closest('[data-edit-changed]'));
});

test('validation blocks review and writes; readOnly/hidden/disabled never highlight', async t => {
  const s = setup(t, { columns: [column('NOME', 'text', { required: true }), column('FIXO', 'text', { readOnly: true }), column('OCULTO', 'text', { hidden: true }), column('BLOQUEADO', 'text', { disabled: true })], values: { NOME: 'ORIGINAL', FIXO: 'FIXO', BLOQUEADO: 'BLOQUEADO' } });
  s.change('NOME', ''); s.change('FIXO', 'OUTRO'); s.change('BLOQUEADO', 'OUTRO');
  s.submit(); await tick();
  assert.equal(s.review(), null); assert.equal(s.calls.length, 0);
  assert.equal(s.input('FIXO').closest('[data-edit-changed]'), null);
  assert.equal(s.input('BLOQUEADO').closest('[data-edit-changed]'), null);
});

test('clearing required text, number and date stays orange while validation blocks review', async t => {
  const s = setup(t, { columns: [column('NOME', 'text', { required: true }), column('NUMERO', 'number', { required: true }), column('DIA', 'date', { required: true })], values: { NOME: 'ORIGINAL', NUMERO: 10, DIA: '2026-11-01' } });
  for (const name of ['NOME', 'NUMERO', 'DIA']) s.change(name, '');
  await tick();
  for (const name of ['NOME', 'NUMERO', 'DIA']) assert.ok(s.input(name).closest('[data-edit-changed]'), `${name} clearing is a semantic change`);
  s.submit(); await tick();
  assert.equal(s.review(), null); assert.equal(s.calls.length, 0);
  s.change('NOME', 'ORIGINAL'); s.change('NUMERO', '10'); s.change('DIA', '2026-11-01');
  await tick(); assert.equal(s.form.querySelectorAll('[data-edit-changed]').length, 0);
});

test('cleanup while review is pending or just confirmed never calls onSubmit', async t => {
  for (const confirmFirst of [false, true]) {
    const s = setup(t);
    s.change('NOME', 'ALTERADO'); s.submit(); await tick();
    const button = s.review()?.querySelector('[data-edit-review-confirm]');
    assert.ok(button);
    if (confirmFirst) button.click();
    s.binding.cleanup(); button.click(); await tick();
    assert.equal(s.calls.length, 0); assert.equal(s.review(), null);
  }
});

test('internal attachment-only changes are reviewed and undo clears the attachment highlight', async t => {
  const s = setup(t, { attachments: { enabled: true, canView: true, canEdit: true, existingFiles: [{ name: 'antigo.pdf', size: 10 }] } });
  const file = new File(['pdf'], 'novo.pdf', { type: 'application/pdf' });
  const picker = s.form.querySelector('[data-form-attachment-input]');
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new s.dom.window.Event('change', { bubbles: true }));
  s.form.querySelector('[data-form-attachment-remove-existing]').click(); await tick();
  assert.ok(picker.closest('[data-edit-changed]'));
  s.submit(); await tick(); assert.equal(s.calls.length, 0);
  assert.match(s.review().textContent, /Anexo adicionado.*novo\.pdf/s);
  assert.match(s.review().textContent, /Anexo removido.*antigo\.pdf/s);
  s.review().querySelector('[data-edit-review-cancel]').click(); await tick();
  s.form.querySelector('[data-form-attachment-remove-upload]').click();
  s.form.querySelector('[data-form-attachment-restore-existing]').click(); await tick();
  assert.equal(s.form.querySelector('[data-form-attachments]').hasAttribute('data-edit-changed'), false);
  s.submit(); await tick();
  s.review().querySelector('[data-edit-review-confirm]').click(); await tick();
  assert.deepEqual(s.calls[0][3], { uploads: [], deletions: [] });
});

test('external attachment getter snapshots reviewed files for persistence and undefined falls back internally', async t => {
  for (const external of [undefined, { uploads: [{ name: 'externo.pdf' }], deletions: ['externo-antigo.pdf'] }]) {
    let current = external;
    let reads = 0;
    const internalFile = new File(['pdf'], 'interno.pdf', { type: 'application/pdf' });
    const s = setup(t, { attachments: { enabled: true, canView: true, canEdit: true, pendingFiles: [internalFile] }, getEditAttachmentChanges: () => { reads++; return current; } });
    s.submit(); await tick(); assert.ok(s.review());
    assert.equal(s.calls.length, 0);
    assert.match(s.review().textContent, external ? /externo\.pdf/ : /interno\.pdf/);
    if (external) assert.doesNotMatch(s.review().textContent, /interno\.pdf/);
    const expected = external ? { uploads: [external.uploads[0]], deletions: ['externo-antigo.pdf'] } : { uploads: [internalFile], deletions: [] };
    if (external) external.uploads.push({ name: 'tardio.pdf' });
    current = { uploads: [{ name: 'nao-revisado.pdf' }], deletions: [] };
    s.review().querySelector('[data-edit-review-confirm]').click(); await tick();
    assert.equal(reads, 1);
    assert.deepEqual(s.calls[0][3], expected);
  }
});

test('creation still saves directly without edit styling or review', async t => {
  const s = setup(t, { mode: 'create' });
  s.change('NOME', 'NOVO'); s.submit(); await tick();
  assert.equal(s.review(), null); assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0].NOME, 'NOVO');
  assert.equal(s.form.querySelectorAll('[data-edit-changed]').length, 0);
});

test('retry draft is compared to loaded record rather than treated as the baseline', async t => {
  const s = setup(t, { retryState: { displayValues: { NOME: 'TENTATIVA' } } });
  await tick(); assert.ok(s.input('NOME').closest('[data-edit-changed]'));
  s.submit(); await tick();
  assert.deepEqual([...s.review().querySelectorAll('tbody td')].map(td => td.textContent), ['NOME', 'ORIGINAL', 'TENTATIVA']);
});

test('explicit saved baseline survives callers replacing values with failed draft', async t => {
  const s = setup(t, { values: { NOME: 'RASCUNHO' }, editBaseline: { NOME: 'Nome original' } });
  await tick(); assert.ok(s.input('NOME').closest('[data-edit-changed]'));
  s.submit(); await tick();
  assert.deepEqual([...s.review().querySelectorAll('tbody td')].map(td => td.textContent), ['NOME', 'Nome original', 'RASCUNHO']);
});

test('search text alone is not a change; selecting and reverting colors the visible combobox', async t => {
  const s = setup(t, { columns: [column('STATUS', 'select', { choices: ['ABERTO', 'FECHADO'] })], values: { STATUS: 'ABERTO' } });
  const input = s.form.querySelector('.searchable-select-input');
  input.focus(); input.value = 'FECH'; input.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  await tick(); assert.equal(input.closest('[data-edit-changed]'), null);
  s.form.querySelector('[role=option]').click(); await tick();
  assert.ok(input.closest('[data-edit-changed]'));
  assert.equal(s.dom.window.getComputedStyle(input).backgroundColor, 'rgb(255, 204, 128)');
  input.value = 'ABER'; input.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  s.form.querySelector('[role=option]').click(); await tick();
  assert.equal(input.closest('[data-edit-changed]'), null);
});

test('lookup search is not a change; selecting a result reviews IDs and labels', async t => {
  const s = setup(t, { columns: [column('CLIENTE', 'lookup', { relation: { kind: 'lookup', listId: 'clientes', displayField: 'Title', resolvable: true } })], values: { CLIENTELookupId: 7, CLIENTELookupValue: 'ANTIGO' }, relationshipDebounceMs: 0, relationshipSearch: async () => [{ id: 9, label: 'NOVO' }] });
  const input = s.form.querySelector('.searchable-select-input');
  input.focus(); input.value = 'NOVO'; input.dispatchEvent(new s.dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(input.closest('[data-edit-changed]'), null);
  s.form.querySelector('.searchable-select [role=option]').click(); await tick();
  assert.ok(input.closest('[data-edit-changed]'));
  s.submit(); await tick(); assert.equal(s.calls.length, 0);
  assert.deepEqual([...s.review().querySelectorAll('tbody td')].map(td => td.textContent), ['CLIENTE', 'ANTIGO (ID: 7)', 'NOVO (ID: 9)']);
});

test('custom editors can load highlight styles before submit and abort pending review', async t => {
  const s = setup(t, { mode: 'create' });
  assert.equal(typeof editReview.ensureEditReviewStyles, 'function');
  editReview.ensureEditReviewStyles(s.dom.window.document);
  s.input('NOME').closest('label').setAttribute('data-edit-changed', '');
  assert.equal(s.dom.window.getComputedStyle(s.input('NOME')).backgroundColor, 'rgb(255, 204, 128)');
  const controller = new AbortController();
  const pending = editReview.confirmEditChanges({ form: s.form, changes: [], signal: controller.signal });
  assert.ok(s.review());
  controller.abort();
  assert.equal(await pending, false); assert.equal(s.review(), null);
  assert.equal(await editReview.confirmEditChanges({ form: s.form, changes: [], signal: controller.signal }), false);
  assert.equal(s.review(), null);
});

test('canonical multi values avoid false differences, with localized date/currency and original text in review', () => {
  const columns = [column('MULTI', 'select', { allowMultipleValues: true, powerApps: { multipleSerialization: { kind: 'concat', delimiter: '; ' } } }), column('VALOR', 'currency'), column('DIA', 'date'), column('NOME'), column('OBS', 'textarea', { isMessage: true })];
  const changes = editReview.buildEditChanges(columns, { MULTI: 'A; B', VALOR: '250.00', DIA: '2026-11-01T00:00:00Z', NOME: 'Nome original', OBS: 'Manter Caso' }, { MULTI: ['B', 'A'], VALOR: 251, DIA: '2026-11-02', NOME: 'NOVO NOME', OBS: 'manter caso' });
  assert.deepEqual(changes.map(({ label, before, after }) => ({ label, before, after })), [
    { label: 'VALOR', before: 'R$ 250,00', after: 'R$ 251,00' },
    { label: 'DIA', before: '01/11/2026', after: '02/11/2026' },
    { label: 'NOME', before: 'Nome original', after: 'NOVO NOME' },
    { label: 'OBS', before: 'Manter Caso', after: 'manter caso' },
  ]);
});

test('removing owner or closing review settles false; repeated calls share one safe escaped modal', async t => {
  const s = setup(t);
  const pending = editReview.confirmEditChanges({ form: s.form, title: '<b>Revisar</b>', changes: [{ label: 'Campo', before: '<img src=x onerror=alert(1)>', after: 'Seguro' }] });
  assert.equal(pending, editReview.confirmEditChanges({ form: s.form, changes: [] }));
  assert.equal(s.review().querySelector('img'), null);
  assert.equal(s.review().querySelector('h2').textContent, '<b>Revisar</b>');
  s.form.remove();
  assert.equal(await pending, false); assert.equal(s.review(), null);
});
