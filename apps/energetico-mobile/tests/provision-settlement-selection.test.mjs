import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView, renderChatMarkup } from '../src/ui/chat-view.js';
import { reviewTable, reviewMessage, reviewState } from './helpers/provision-settlement-review-fixture.mjs';

const selectionTable = (overrides = {}) => reviewTable({ selectionEnabled: true,
  rows: reviewTable().rows.map((row, index) => ({ ...row, totalCents: ['2400', '2000', '1600', '500'][index] })), ...overrides });
function harness(t, table = selectionTable(), overrides = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  const events = [];
  for (const type of ['select-reply', 'draft-changed', 'send-text']) view.on(type, event => events.push(event));
  const state = reviewState(reviewMessage(table), { account: { name: 'Prévia', homeAccountId: 'demo-a' }, ...overrides });
  view.render(state);
  t.after(() => { view.destroy(); dom.window.close(); });
  const checkbox = id => root.querySelector(`[data-provision-select-id="${id}"]`);
  return { dom, root, view, events, state, checkbox,
    checked: () => [...root.querySelectorAll('[data-provision-select-id]:checked')].map(node => node.dataset.provisionSelectId),
    all: () => root.querySelector('[data-provision-select-all]'),
    reply: command => root.querySelector(`[data-reply-id="${command}"]`),
    change(node, checked) { assert.ok(node, 'selection control exists'); node.checked = checked; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); },
  };
}

test('pending rows default selected, paid rows are disabled, with accessible checkboxes on the left and select-all below', t => {
  const h = harness(t);
  assert.deepEqual(h.checked(), ['11', '12', '13']);
  for (const id of ['11', '12', '13', '14']) {
    const check = h.checkbox(id); assert.ok(check);
    assert.ok(check.closest('tr').cells[0].contains(check));
    assert.match(check.getAttribute('aria-label'), new RegExp(`provisão #${id}`, 'i'));
  }
  assert.equal(h.checkbox('14').disabled, true);
  assert.equal(h.checkbox('14').checked, false);
  assert.equal(h.all().checked, true);
  assert.equal(h.all().indeterminate, false);
  const table = h.root.querySelector('.provision-review table');
  assert.ok(table.compareDocumentPosition(h.all()) & h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(h.root.querySelector('[data-provision-selection-summary]').textContent, /3 de 3.*R\$\s*60,00/);
  assert.match(table.tFoot.textContent, /TOTAL GERAL.*R\$ 65,00/s);
});

test('server readonly labels distinguish unavailable rows from paid rows and remain escaped in text and aria', t => {
  for (const label of ['Indisponível para baixa — somente consulta', 'Indisponível <img src=x onerror="bad()"> & "SUSPENSO"']) {
    const table = selectionTable(); table.rows[3].readonlyLabel = label;
    const h = harness(t, table), row = h.root.querySelector('[data-provision-id="14"]');
    assert.equal(row.querySelector('.provision-review__paid').textContent, label);
    assert.equal(h.checkbox('14').getAttribute('aria-label'), `Provisão #14 — ${label}`);
    assert.equal(row.querySelector('img,script'), null);
    assert.equal(h.checkbox('14').getAttribute('onerror'), null);
    assert.equal(h.checkbox('14').disabled, true);
    assert.equal(h.checkbox('14').checked, false);
    assert.doesNotMatch(h.root.querySelector('.provision-review__readonly').textContent, /já baixadas/i);
    h.change(h.checkbox('12'), false);
    assert.equal(h.root.querySelector('.provision-review__pending strong').textContent, 'R$ 60,00');
    assert.match(h.root.querySelector('[data-provision-selection-summary]').textContent, /R\$\s*40,00/);
  }
});

test('local toggles emit no commands; Submit and Edit carry exactly the selected pending IDs in table order', t => {
  const h = harness(t);
  h.change(h.checkbox('12'), false);
  assert.deepEqual(h.events, []);
  assert.equal(h.all().checked, false); assert.equal(h.all().indeterminate, true);
  assert.match(h.root.querySelector('[data-provision-selection-summary]').textContent, /2 de 3.*R\$\s*40,00/);
  h.reply('description_review_submit').click();
  h.reply('description_review_edit').click();
  assert.deepEqual(h.events.map(event => event.replyId), ['description_review_submit:11,13', 'description_review_edit:11,13']);
});

test('native checkbox clicks and the select-all label remain local actions', t => {
  const h = harness(t);
  h.checkbox('12').click(); assert.deepEqual(h.checked(), ['11', '13']);
  h.all().closest('label').click(); assert.deepEqual(h.checked(), ['11', '12', '13']);
  h.all().closest('label').click(); assert.deepEqual(h.checked(), []);
  h.checkbox('14').click(); assert.deepEqual(h.checked(), []);
  assert.deepEqual(h.events, []);
});

test('unselect-all blocks Submit and Edit; selecting all again includes only pending rows', t => {
  const h = harness(t);
  h.change(h.all(), false);
  assert.deepEqual(h.checked(), []);
  assert.equal(h.all().indeterminate, false);
  assert.equal(h.reply('description_review_submit').disabled, true);
  assert.equal(h.reply('description_review_edit').disabled, true);
  h.reply('description_review_submit').click(); h.reply('description_review_edit').click();
  assert.deepEqual(h.events, []);
  h.change(h.all(), true);
  assert.deepEqual(h.checked(), ['11', '12', '13']);
  assert.equal(h.reply('description_review_submit').disabled, false);
});

test('draft-only updates and ordinary cloned rerenders preserve local selection and do not mutate metadata', t => {
  const h = harness(t), original = structuredClone(h.state.messages);
  h.change(h.checkbox('12'), false);
  h.view.render({ ...h.state, draft: 'observação fictícia' });
  assert.deepEqual(h.checked(), ['11', '13']);
  h.view.render(structuredClone({ ...h.state, draft: 'outro texto' }));
  assert.deepEqual(h.checked(), ['11', '13']);
  assert.deepEqual(h.state.messages, original);
  assert.deepEqual(h.events, []);
});

test('refreshing the same account display name or flow title preserves its local checks', t => {
  const h = harness(t); h.change(h.checkbox('12'), false);
  h.view.render({ ...h.state, account: { ...h.state.account, name: 'Nome atualizado' },
    activeFlow: { ...h.state.activeFlow, title: 'Título atualizado' } });
  assert.deepEqual(h.checked(), ['11', '13']);
});

test('edit/back restores server-selected IDs rather than stale local IDs', t => {
  const h = harness(t);
  h.change(h.checkbox('12'), false); h.reply('description_review_edit').click();
  assert.equal(h.events[0].replyId, 'description_review_edit:11,13');
  h.view.render({ ...h.state, messages: [{ id: 'edit-step', type: 'poll', role: 'assistant', question: 'Edite uma linha', options: [] }],
    activeFlow: { ...h.state.activeFlow, stepKey: 'description_edit' } });
  const message = { ...reviewMessage(selectionTable({ selectedIds: ['13'], rows: selectionTable().rows.map(row => ({ ...row, selected: row.id === '13' })) })), id: 'review-after-edit' };
  h.view.render({ ...h.state, messages: [message] });
  assert.deepEqual(h.checked(), ['13']);
  h.reply('description_review_submit').click();
  assert.equal(h.events.at(-1).replyId, 'description_review_submit:13');
});

for (const scope of ['account', 'flow', 'description', 'scope', 'signout']) test(`a ${scope} change clears stale client selection`, t => {
  const h = harness(t); h.change(h.checkbox('12'), false);
  let next = structuredClone(h.state);
  if (scope === 'account') next.account.homeAccountId = 'demo-b';
  if (scope === 'flow') next.activeFlow.contextId = 'other-flow-instance';
  if (scope === 'description') next.messages[0].detail_table.descriptionId = '8';
  if (scope === 'scope') next.scopeKey = 'another-scope';
  if (scope === 'signout') h.view.render({ sessionStatus: 'signed-out' });
  h.view.render(next);
  assert.deepEqual(h.checked(), ['11', '12', '13']);
});

test('server selection is filtered to pending rows; forged foreign or paid checkboxes cannot enter replies', t => {
  const h = harness(t, selectionTable({ selectedIds: ['13', '999', '14', '11', '13'] }));
  assert.deepEqual(h.checked(), ['11', '13']);
  h.checkbox('14').disabled = false; h.change(h.checkbox('14'), true);
  const forged = h.checkbox('12'); forged.dataset.provisionSelectId = '999'; h.change(forged, true);
  h.reply('description_review_submit').click();
  assert.equal(h.events.at(-1).replyId, 'description_review_submit:11,13');
});

test('row.selected is honored when selectedIds is absent, including an explicitly empty selection', t => {
  const table = selectionTable(); table.rows = table.rows.map(row => ({ ...row, selected: row.id === '12' }));
  const h = harness(t, table); assert.deepEqual(h.checked(), ['12']);
  h.view.render({ ...h.state, messages: [{ ...reviewMessage(selectionTable({ selectedIds: [] })), id: 'empty-server-selection' }] });
  assert.deepEqual(h.checked(), []);
  assert.equal(h.reply('description_review_submit').disabled, true);
});

test('invalid amounts keep Edit available while canSubmit=false remains authoritative', t => {
  const table = selectionTable({ canSubmit: false });
  table.rows[1] = { ...table.rows[1], totalDisplay: 'PENDENTE', totalCents: undefined };
  const h = harness(t, table);
  assert.equal(h.reply('description_review_submit').disabled, true);
  assert.equal(h.reply('description_review_edit').disabled, false);
  assert.doesNotMatch(h.root.querySelector('[data-provision-selection-summary]').textContent, /R\$/);
  h.change(h.checkbox('12'), false);
  assert.equal(h.reply('description_review_submit').disabled, true);
  h.reply('description_review_edit').click();
  assert.equal(h.events.at(-1).replyId, 'description_review_edit:11,13');
});

test('only selected rows gate Submit: deselecting an invalid pending row releases a valid subset', t => {
  const table = selectionTable({ canSubmit: false, selectedValid: false });
  table.rows = table.rows.map(row => ({ ...row, canSubmit: !row.paid && row.id !== '12' }));
  table.rows[1] = { ...table.rows[1], totalDisplay: 'PENDENTE', totalCents: undefined };
  const h = harness(t, table);
  assert.equal(h.reply('description_review_submit').disabled, true, 'invalid selected row blocks Submit');
  assert.equal(h.reply('description_review_edit').disabled, false);
  h.change(h.checkbox('12'), false);
  assert.equal(h.reply('description_review_submit').disabled, false, 'unselected invalid row cannot block the valid subset');
  h.reply('description_review_submit').click();
  assert.equal(h.events.at(-1).replyId, 'description_review_submit:11,13');
  h.change(h.checkbox('12'), true);
  assert.equal(h.reply('description_review_submit').disabled, true, 'reselecting invalid row blocks Submit again');
});

test('without row validity flags, selectedValid and projected cents never bypass the legacy global gate', t => {
  const table = selectionTable({ canSubmit: false, selectedValid: true });
  table.rows[1] = { ...table.rows[1], totalDisplay: 'PENDENTE', totalCents: undefined };
  const h = harness(t, table);
  assert.equal(h.reply('description_review_submit').disabled, true);
  h.change(h.checkbox('12'), false);
  assert.equal(h.reply('description_review_submit').disabled, true);
  h.reply('description_review_submit').click(); assert.deepEqual(h.events, []);
  h.reply('description_review_edit').click(); assert.equal(h.events.at(-1).replyId, 'description_review_edit:11,13');
});

test('busy or historical review controls cannot alter or submit a selection', t => {
  const h = harness(t);
  h.view.render({ ...h.state, activeText: { id: 'fixture-request' } });
  assert.ok([...h.root.querySelectorAll('[data-provision-select-id], [data-provision-select-all]')].every(node => node.disabled));
  h.change(h.checkbox('12'), false);
  h.view.render(h.state); assert.deepEqual(h.checked(), ['11', '12', '13']);
  h.view.render({ ...h.state, messages: [...h.state.messages, { id: 'next-poll', type: 'poll', role: 'assistant', question: 'Próxima pergunta', options: [] }] });
  assert.ok([...h.root.querySelectorAll('[data-provision-select-id]')].every(node => node.disabled));
  h.reply('description_review_submit').click(); assert.deepEqual(h.events, []);
});

for (const [name, blockedState] of [
  ['attachment upload', { attachmentUploadProgress: { loaded: 1, total: 2 } }],
  ['attachment sending', { pendingFiles: [{ id: 'fake-sending', name: 'fictitious.pdf', status: 'sending', progress: 50 }] }],
  ['recoveryBlocked', { recoveryBlocked: true }],
  ['recoveryUncertain', { recoveryUncertain: true }],
]) test(`selection respects the existing chat busy rule during ${name}`, t => {
  const h = harness(t); h.change(h.checkbox('12'), false);
  const blocked = { ...h.state, ...blockedState };
  h.view.render(blocked);
  assert.equal(h.root.querySelector('[data-action="capture-photo"]').disabled, true, 'existing chat action is blocked');
  const controls = () => [...h.root.querySelectorAll('[data-provision-select-id], [data-provision-select-all]')];
  assert.ok(controls().every(node => node.disabled), 'selection must not re-enable blocked chat controls');
  assert.equal(h.reply('description_review_submit').disabled, true);
  assert.equal(h.reply('description_review_edit').disabled, true);
  h.view.render({ ...blocked, draft: 'fictitious draft while blocked' });
  assert.ok(controls().every(node => node.disabled), 'draft-only render preserves the same busy state');
  // Even a synthetic event on a manually re-enabled control cannot bypass busy.
  for (const command of ['description_review_submit', 'description_review_edit']) {
    const button = h.reply(command); button.disabled = false; button.click();
  }
  h.checkbox('11').disabled = false; h.change(h.checkbox('11'), false);
  h.all().disabled = false; h.change(h.all(), false);
  assert.deepEqual(h.events, []);
  h.view.render(h.state);
  assert.deepEqual(h.checked(), ['11', '13'], 'busy events cannot change the preserved selection');
  assert.equal(h.reply('description_review_submit').disabled, false);
  h.reply('description_review_submit').click();
  assert.equal(h.events.at(-1).replyId, 'description_review_submit:11,13');
});

test('exact server cents are summed without floating point or parsing display amounts', t => {
  const table = selectionTable({ selectedIds: ['11', '12'] });
  table.rows[0].totalCents = '900719925474099301'; table.rows[1].totalCents = '9';
  table.rows[0].totalDisplay = 'EXIBIÇÃO FICTÍCIA';
  const h = harness(t, table);
  assert.match(h.root.querySelector('[data-provision-selection-summary]').textContent, /9\.007\.199\.254\.740\.993,10/);
  h.change(h.checkbox('11'), false);
  assert.match(h.root.querySelector('[data-provision-selection-summary]').textContent, /R\$\s*0,09/);
});

test('legacy tables keep plain replies and invalid metadata falls back to escaped textual summary', t => {
  const h = harness(t, reviewTable());
  assert.equal(h.all(), null);
  h.reply('description_review_submit').click();
  assert.equal(h.events[0].replyId, 'description_review_submit');
  for (const table of [selectionTable({ rows: [null] }), selectionTable({ selectedIds: '11' }), selectionTable({ descriptionId: '<img>' })]) {
    const dom = new JSDOM(renderChatMarkup(reviewState(reviewMessage(table))));
    assert.equal(dom.window.document.querySelector('[data-provision-settlement-review]'), null);
    assert.match(dom.window.document.body.textContent, /PRODUTO \| QTD/);
    dom.window.close();
  }
});
