import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";
import { attendanceBadgePoll, attendanceBadgeState } from "./helpers/attendance-rhid-badge-fixture.mjs";

function pollWithDetails() {
  const poll = attendanceBadgePoll();
  poll.options[0].detail_table = [
    [{ label: "DATA", value: "13/10/2026" }],
    [{ label: "IDDESCRITIVOETAPA", value: "384" }],
    [{ label: "ATIVIDADE", value: "PINTURA EXTERNA" }],
  ];
  return poll;
}

test("supplier disclosure shows only the requested attendance details without selecting the presence", t => {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(() => dom.window.close());
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  t.after(() => view.destroy());
  const replies = [];
  view.on("select-reply", command => replies.push(command));
  const poll = pollWithDetails();
  view.render(attendanceBadgeState(poll));
  const row = root.querySelector('.chat-attendance-select__row');
  const name = row.querySelector('.chat-attendance-select__name');
  const arrow = row.querySelector('[data-action="attendance-detail-toggle"]');
  const detail = row.querySelector('.chat-attendance-select__detail');
  assert.ok(name);
  assert.ok(arrow);
  assert.ok(detail);
  assert.equal(arrow.getAttribute("aria-expanded"), "false");
  assert.equal(detail.hidden, true);
  assert.equal(row.querySelector('input[data-action="attendance-select-toggle"]').checked, false);
  arrow.click();
  assert.equal(arrow.getAttribute("aria-expanded"), "true");
  assert.equal(detail.hidden, false);
  assert.deepEqual([...detail.querySelectorAll('dt')].map(node => node.textContent),
    ["DATA", "IDDESCRITIVO-ATIVIDADEEXECUTADA", "ATIVIDADEEXECUTADA"]);
  assert.deepEqual([...detail.querySelectorAll('dd')].map(node => node.textContent),
    ["13/10/2026", "384", "PINTURA EXTERNA"]);
  assert.deepEqual(replies, []);
  assert.equal(row.querySelector('input[data-action="attendance-select-toggle"]').checked, false);
  row.querySelector('input[data-action="attendance-select-toggle"]').click();
  assert.equal(root.querySelector('.chat-attendance-select__detail').hidden, false,
    'expansion remains open after selecting a checkbox');
  root.querySelector('[data-action="attendance-detail-toggle"]').click();
  assert.deepEqual(replies, [], 'disclosure remains independent even with a checked checkbox');
  assert.equal(root.querySelector('input[data-action="attendance-select-toggle"]').checked, true);
  assert.equal(root.querySelector('.chat-attendance-select__detail').hidden, true);
});

test("supplier detail disclosure escapes source values and survives a poll refresh", t => {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(() => dom.window.close());
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  t.after(() => view.destroy());
  const poll = pollWithDetails();
  poll.options[0].detail_table[2][0].value = '<img src=x onerror="alert(1)">';
  view.render(attendanceBadgeState(poll));
  root.querySelector('[data-action="attendance-detail-toggle"]').click();
  view.render(attendanceBadgeState({ ...poll, options: [...poll.options] }));
  const row = root.querySelector('.chat-attendance-select__row');
  assert.equal(row.querySelector('.chat-attendance-select__detail').hidden, false);
  assert.equal(row.querySelector('img, [onerror]'), null);
  assert.equal(row.querySelector('.chat-attendance-select__detail > div:last-child dd').textContent,
    '<img src=x onerror="alert(1)">');
});

test("supplier rows with no metadata do not render an empty disclosure", t => {
  const dom = new JSDOM(renderChatMarkup(attendanceBadgeState(attendanceBadgePoll())));
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector('[data-action="attendance-detail-toggle"]'), null);
});

test("camel-case detailTable and a badge-free supplier still expose a separate arrow", t => {
  const poll = pollWithDetails();
  const first = poll.options[0];
  first.label = '2101 - JOSÉ GERALDO DOS SANTOS E OUTROS SERVIÇOS DE PINTURA';
  delete first.rhidBadge;
  first.detailTable = first.detail_table;
  delete first.detail_table;
  const dom = new JSDOM(renderChatMarkup(attendanceBadgeState(poll)));
  t.after(() => dom.window.close());
  const row = dom.window.document.querySelector('.chat-attendance-select__row');
  assert.equal(row.querySelector('.chat-attendance-select__name')?.textContent, first.label);
  assert.ok(row.querySelector('[data-action="attendance-detail-toggle"]'));
  assert.equal(row.querySelector('.chat-attendance-select__detail dd').textContent, '13/10/2026');
});
