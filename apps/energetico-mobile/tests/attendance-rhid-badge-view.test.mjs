import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";
import { attendanceBadgePoll, attendanceBadgeState } from "./helpers/attendance-rhid-badge-fixture.mjs";

const presentations = ["attendance_multi_select", "accordion", "attendance_supplier_sync"];

function rendered(t, poll, stateOverrides = {}) {
  const dom = new JSDOM(renderChatMarkup(attendanceBadgeState(poll, stateOverrides)));
  t.after(() => dom.window.close());
  return dom.window.document;
}

function mounted(t) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command));
  t.after(() => { view.destroy(); dom.window.close(); });
  return { root, view, replies };
}

function rowFor(root, id) {
  return root.querySelector(`input[data-action="attendance-select-toggle"][data-reply-id="${id}"]`)
    ?.closest(".chat-attendance-select__row");
}

for (const presentation of presentations) {
  test(`RHID badges follow supplier names with four distinct textual states (${presentation})`, t => {
    const poll = attendanceBadgePoll(presentation);
    const before = structuredClone(poll);
    const doc = rendered(t, poll);
    const expected = [
      ["2101", "present", "08h45", "2101 - JOSÉ GERALDO DOS SANTOS"],
      ["2102", "absent", "AUSENTE", "2102 - CARLOS EDUARDO DA SILVA"],
      ["2103", "inconsistent", "INCONSISTENTE", "2103 - MARIA APARECIDA DOS SANTOS"],
      ["2104", "unregistered", "S/ CADASTRO", "2104 - ANA CLÁUDIA DE OLIVEIRA"],
    ];
    for (const [id, status, label, name] of expected) {
      const row = rowFor(doc, id);
      const badge = row.querySelector(".chat-attendance-rhid-badge");
      assert.ok(badge, `missing RHID badge for ${status}`);
      assert.equal(badge.textContent, label);
      assert.ok(badge.classList.contains(`chat-attendance-rhid-badge--${status}`));
      assert.equal(badge.dataset.rhidDate, "2026-10-13");
      const nameNode = row.querySelector(".chat-attendance-select__name");
      assert.equal(nameNode.textContent, name);
      assert.equal(nameNode.nextElementSibling, badge, "badge must follow the complete supplier name");
      assert.ok(badge.closest(presentation === "attendance_supplier_sync" ? "label" : "button"));
      assert.equal(row.querySelector("input").getAttribute("aria-label"), `Selecionar ${name}`);
      if (presentation !== "attendance_supplier_sync") {
        assert.equal(row.querySelector("button").dataset.label, name);
        assert.equal(row.querySelector("button").dataset.replyId, `pending_attendance_record:${id}`);
      }
    }
    const present = rowFor(doc, "2101").querySelector(".chat-attendance-rhid-badge");
    assert.equal(present.title, "RHID em 13/10/2026: presente, 8 horas e 45 minutos.");
    assert.equal(present.getAttribute("aria-label"), present.title);
    assert.deepEqual(poll, before, "rendering must not mutate options or attendance values");
  });

  test(`loading and unavailable badges stay neutral instead of negative (${presentation})`, t => {
    const doc = rendered(t, attendanceBadgePoll(presentation));
    for (const [id, label] of [["2105", "CONSULTANDO RHID"], ["2106", "RHID INDISPONÍVEL"]]) {
      const badge = rowFor(doc, id).querySelector(".chat-attendance-rhid-badge");
      assert.ok(badge, `missing neutral badge for ${id}`);
      assert.equal(badge.textContent, label);
      assert.ok(badge.classList.contains("chat-attendance-rhid-badge--neutral"));
      assert.equal(badge.classList.contains("chat-attendance-rhid-badge--absent"), false);
      assert.equal(badge.classList.contains("chat-attendance-rhid-badge--unregistered"), false);
      assert.doesNotMatch(badge.textContent, /AUSENTE|S\/ CADASTRO/);
    }
  });

  test(`RHID badges never appear on bulk, date or endstage controls (${presentation})`, t => {
    const doc = rendered(t, attendanceBadgePoll(presentation));
    assert.equal(doc.querySelectorAll(".chat-attendance-rhid-badge").length, 6);
    for (const selector of [
      ".chat-select-all", '[data-action="attendance-select-proceed"]',
      'button[data-reply-id="pending_attendance_other_date"]',
      'button[data-reply-id="attendance_close_demonstrative"]',
      'button[data-reply-id="endstage"]',
    ]) {
      const control = doc.querySelector(selector);
      assert.ok(control, `control still exists: ${selector}`);
      assert.equal(control.querySelector(".chat-attendance-rhid-badge"), null);
    }
  });

  test(`existing labels and row markup remain unchanged without a badge (${presentation})`, t => {
    const poll = attendanceBadgePoll(presentation);
    poll.options = poll.options.map(({ rhidBadge, ...option }) => option);
    const doc = rendered(t, poll);
    assert.equal(doc.querySelector(".chat-attendance-rhid-badge"), null);
    assert.equal(doc.querySelector(".chat-attendance-select__content"), null);
    const row = rowFor(doc, "2101");
    const label = row.querySelector(presentation === "attendance_supplier_sync" ? ".chat-attendance-select__label" : "button");
    assert.equal(label.innerHTML, "2101 - JOSÉ GERALDO DOS SANTOS");
    assert.equal(row.querySelector("input").getAttribute("aria-label"), "Selecionar 2101 - JOSÉ GERALDO DOS SANTOS");
  });

  test(`badge refresh preserves checkbox selection and original batch command for the same poll (${presentation})`, t => {
    const { root, view, replies } = mounted(t);
    const poll = attendanceBadgePoll(presentation);
    view.render(attendanceBadgeState(poll));
    rowFor(root, "2101").querySelector("input").click();
    const refreshed = { ...poll, options: poll.options.map((option, index) => index === 0
      ? { ...option, rhidBadge: { status: "absent", label: "AUSENTE", date: "2026-10-13", description: "RHID atualizado: sem batidas no dia." } }
      : option) };
    view.render(attendanceBadgeState(refreshed));
    const row = rowFor(root, "2101");
    assert.equal(row.querySelector("input").checked, true);
    assert.equal(row.querySelector("input").getAttribute("aria-label"), "Selecionar 2101 - JOSÉ GERALDO DOS SANTOS");
    const badge = row.querySelector(".chat-attendance-rhid-badge");
    assert.ok(badge, "refresh must render the updated RHID badge");
    assert.equal(badge.textContent, "AUSENTE");
    assert.equal(badge.title, "RHID atualizado: sem batidas no dia.");
    assert.deepEqual(replies, [], "badge refresh must not emit a reply");
    const supplierSync = presentation === "attendance_supplier_sync";
    root.querySelector('[data-action="attendance-select-proceed"]').click();
    assert.deepEqual(replies, [{
      type: "select-reply",
      replyId: supplierSync ? "supplier_sync_batch:2101" : "attendance_batch:2101",
      label: supplierSync ? "SUBMETER (1)" : "PROSSEGUIR (1)",
    }]);
    view.render(attendanceBadgeState(refreshed, { activeText: { id: "busy" } }));
    assert.equal(rowFor(root, "2101").querySelector("input").checked, true);
    assert.equal(rowFor(root, "2101").querySelector("input").disabled, true);
    assert.equal(root.querySelector('[data-action="attendance-select-proceed"]').disabled, true);
  });

  test(`clicking a badge uses the record's existing action and unmodified label (${presentation})`, t => {
    const { root, view, replies } = mounted(t);
    view.render(attendanceBadgeState(attendanceBadgePoll(presentation)));
    const badge = rowFor(root, "2101").querySelector(".chat-attendance-rhid-badge");
    assert.ok(badge, "record has a clickable badge inside its existing action");
    badge.click();
    if (presentation === "attendance_supplier_sync") {
      assert.deepEqual(replies, []);
      assert.equal(rowFor(root, "2101").querySelector("input").checked, true);
      root.querySelector('[data-action="attendance-select-proceed"]').click();
      assert.deepEqual(replies, [{ type: "select-reply", replyId: "supplier_sync_batch:2101", label: "SUBMETER (1)" }]);
    } else {
      assert.deepEqual(replies, [{ type: "select-reply", replyId: "pending_attendance_record:2101", label: "2101 - JOSÉ GERALDO DOS SANTOS" }]);
      assert.equal(rowFor(root, "2101").querySelector("input").checked, false);
    }
  });

  test(`filters use supplier names and bulk selection excludes disabled records (${presentation})`, t => {
    const { root, view, replies } = mounted(t);
    const poll = attendanceBadgePoll(presentation);
    poll.options[2] = { ...poll.options[2], disabled: true };
    view.render(attendanceBadgeState(poll));
    assert.ok(rowFor(root, "2101").querySelector(".chat-attendance-rhid-badge"));
    rowFor(root, "2101").querySelector("input").click();
    view.render(attendanceBadgeState(poll, { draft: "CARLOS" }));
    assert.equal(root.querySelectorAll(".chat-attendance-select__row").length, 1);
    assert.ok(rowFor(root, "2102"));
    root.querySelector('[data-action="attendance-select-all"]').click();
    view.render(attendanceBadgeState(poll));
    assert.equal(rowFor(root, "2101").querySelector("input").checked, true);
    assert.equal(rowFor(root, "2102").querySelector("input").checked, true);
    assert.equal(rowFor(root, "2103").querySelector("input").disabled, true);
    assert.equal(rowFor(root, "2103").querySelector("input").checked, false);
    root.querySelector('[data-action="attendance-select-proceed"]').click();
    assert.equal(replies.at(-1).replyId, presentation === "attendance_supplier_sync" ? "supplier_sync_batch:2101,2102" : "attendance_batch:2101,2102");
    view.render(attendanceBadgeState(poll, { draft: "AUSENTE" }));
    assert.equal(root.querySelectorAll(".chat-attendance-select__row").length, 0, "badge text is not part of the supplier filter");
    assert.ok(root.querySelector('button[data-reply-id="pending_attendance_other_date"]'));
  });

  test(`badge labels and descriptions are escaped without changing supplier identity (${presentation})`, t => {
    const poll = attendanceBadgePoll(presentation);
    poll.options[0] = {
      ...poll.options[0],
      label: '2101 - JOSÉ & "SANTOS" <img src=x onerror=alert(1)>',
      rhidBadge: {
        status: "present",
        label: '<img src=x onerror=alert(2)> & "08h45"',
        date: '2026-10-13" onmouseover="alert(3)',
        description: '"><svg onload=alert(4)> & "RHID"',
      },
    };
    const doc = rendered(t, poll);
    const row = rowFor(doc, "2101");
    const badge = row.querySelector(".chat-attendance-rhid-badge");
    assert.ok(badge, "escaped badge is still shown as text");
    assert.equal(badge.textContent, '<img src=x onerror=alert(2)> & "08h45"');
    assert.equal(badge.title, '"><svg onload=alert(4)> & "RHID"');
    assert.equal(badge.getAttribute("aria-label"), badge.title);
    assert.equal(badge.dataset.rhidDate, '2026-10-13" onmouseover="alert(3)');
    assert.equal(row.querySelector("img, svg, script, [onerror], [onload], [onmouseover]"), null);
    assert.equal(row.querySelector("input").getAttribute("aria-label"), 'Selecionar 2101 - JOSÉ & "SANTOS" <img src=x onerror=alert(1)>');
    if (presentation !== "attendance_supplier_sync") assert.equal(row.querySelector("button").dataset.label, poll.options[0].label);
  });
}

test("unrecognized RHID statuses cannot inject CSS classes or masquerade as absences", t => {
  const poll = attendanceBadgePoll();
  const statuses = ['absent" onclick="alert(1)', "__proto__", "constructor", "unknown"];
  poll.options = poll.options.slice(0, 4).map((option, index) => ({
    ...option, rhidBadge: { ...option.rhidBadge, status: statuses[index] },
  }));
  const doc = rendered(t, poll);
  assert.equal(doc.querySelectorAll(".chat-attendance-select__row").length, 4);
  assert.equal(doc.querySelector(".chat-attendance-rhid-badge, [onclick]"), null);
  assert.equal(rowFor(doc, "2101").querySelector("button").textContent, "2101 - JOSÉ GERALDO DOS SANTOS");
});
