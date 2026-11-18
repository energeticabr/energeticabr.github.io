import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as rhid from "../src/chat/rhid-attendance-table.js";
import { createChatView } from "../src/ui/chat-view.js";

test("calendar counts unresolved existing out-of-range people separately from missing punches", () => {
  const row = (id, punches, extra = {}) => ({ ID_PESSOA_RHID: String(id), NOME_COLABORADOR: `Pessoa ${id}`, DATA_REFERENCIA: "2026-09-28", BATIDAS_RHID: punches, ...extra });
  const rows = [row(1, "06:40;11:45;12:45;13:43"), row(1, "06:40;11:45;12:45;13:43"),
    row(2, "07:00"), row(3, ""), row(4, "06:40;11:45;12:45;13:34", { ADMIN_AJUSTES: { exit2: { time: "17:00" } } }),
    row(5, "07:00;12:00;13:00;17:00"), row(6, "08:35;12:00;13:00;17:00"),
    row(7, "06:40;11:45;12:45;13:34;13:43"),
    row(8, "07:00;12:00;13:00;14:00;17:00"),
    row(9, "07:00;12:30;13:30;17:00")];
  assert.deepEqual(rhid.rhidOutOfRangeCountsByDate(rows, "2026-09"), { "2026-09-28": 4 });
  assert.deepEqual(rhid.rhidOutOfRangeCountsByDate(rows, "2026-10"), {});
});

test("calendar highlights existing out-of-range punches orange and clears them after correction or month change", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app"), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  view.render({ sessionStatus: "authenticated", account: { name: "Tester" }, draft: "", pendingFiles: [], messages: [{ id: "rhid", role: "assistant", type: "poll", question: "RHID", options: [], detail_table: { kind: "rhid_attendance", reportDate: "2026-09-28", headers: ["Nome"], rows: [] } }] });
  root.querySelector('.chat-rhid-date-navigation [data-action="open-rhid-attendance-report"]').click();
  const status = { month: "2026-09", presentDates: ["2026-09-28"] };
  view.setRhidAttendanceMonthStatus({ ...status, outOfRangeCounts: { "2026-09-28": 1 } });
  const day = root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-28"]');
  assert.ok(day.classList.contains('chat-rhid-calendar__day--suspect'));
  assert.match(day.getAttribute('aria-label'), /fora da faixa/);
  assert.match(day.textContent, /1 conferir/);
  view.setRhidAttendanceMonthStatus({ ...status, outOfRangeCounts: {} });
  assert.equal(root.querySelector('.chat-rhid-calendar__day--suspect'), null);
  view.setRhidAttendanceMonthStatus({ ...status, outOfRangeCounts: { "2026-09-28": 1 } });
  root.querySelector('[data-action="rhid-calendar-change-month"][data-value="1"]').click();
  assert.equal(root.querySelector('.chat-rhid-calendar__day--suspect'), null);
});

test("monthly irregularities count effective incomplete people once, not absence or repaired raw defects", () => {
  const row = (id, day, punches, extra = {}) => ({ ID_PESSOA_RHID: String(id), NOME_COLABORADOR: `Pessoa ${id}`, DATA_REFERENCIA: day, BATIDAS_RHID: punches, ...extra });
  const rows = [
    row(1, "2026-09-28", "07:00"), row(1, "2026-09-28", "12:00; 13:00"),
    row(2, "2026-09-28", "07:00; 12:00; 13:00; 17:00"),
    row(3, "2026-09-28", ""), row(4, "2026-09-28", "07:00; 07:10; 12:00; 13:00; 17:00", { ADMIN_AJUSTES: { entry1: { time: "07:00" } } }),
    row(5, "2026-09-29", "07:00; 12:00"), row(6, "2026-09-29", "", { ADMIN_AJUSTES: { entry1: { time: "07:00" } } }),
    row(7, "2026-09-29", "07:00; 07:03; 12:00; 13:00; 17:00"),
    row(8, "2026-10-01", "07:00"), row(9, "2026-09-31", "07:00"),
    row(10, "2026-09-30", "07:00", { NOME_COLABORADOR: "PIS NÃO LOCALIZADO" }),
    row(11, "2026-09-30", "07:00; 07:10; 12:00; 13:00; 17:00"),
  ];
  assert.deepEqual(rhid.rhidIrregularCountsByDate(rows, "2026-09"), { "2026-09-28": 1, "2026-09-29": 2 });
});

test("calendar places a small irregular label under the day and clears stale markers", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render({ sessionStatus: "authenticated", account: { name: "Tester" }, draft: "", pendingFiles: [], messages: [{ id: "rhid", role: "assistant", type: "poll", question: "RHID", options: [], detail_table: { kind: "rhid_attendance", reportDate: "2026-09-28", headers: ["Nome"], rows: [] } }] });
  root.querySelector('.chat-rhid-date-navigation [data-action="open-rhid-attendance-report"]').click();
  view.setRhidAttendanceMonthStatus({ month: "2026-09", presentDates: ["2026-09-28", "2026-09-29"], irregularCounts: { "2026-09-28": 1, "2026-09-29": 2, "2026-09-30": -1 } });
  const day = root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-28"]');
  assert.equal(day.querySelector("small")?.textContent, "1 irreg.");
  assert.equal(day.firstElementChild.textContent, "28");
  assert.match(day.getAttribute("aria-label"), /1 apuração irregular após ajustes/i);
  assert.ok(day.classList.contains("chat-rhid-calendar__day--present"));
  assert.equal(root.querySelector('[data-value="2026-09-29"] small').textContent, "2 irreg.");
  assert.equal(root.querySelector('[data-value="2026-09-30"] small'), null);
  root.querySelector('[data-action="rhid-calendar-change-month"][data-value="1"]').click();
  assert.equal(root.querySelector(".chat-rhid-calendar__irregular"), null);
  assert.equal(view.setRhidAttendanceMonthStatus({ month: "2026-09", irregularCounts: { "2026-09-28": 99 } }), false);
  view.setRhidAttendanceMonthStatus({ month: "2026-10", error: "offline", irregularCounts: { "2026-10-01": 99 } });
  assert.equal(root.querySelector(".chat-rhid-calendar__irregular"), null);
  view.destroy(); dom.window.close();
});
