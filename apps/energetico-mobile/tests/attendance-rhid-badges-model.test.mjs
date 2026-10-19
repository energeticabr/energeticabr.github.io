import test from "node:test";
import assert from "node:assert/strict";

import {
  attendanceMissingPunchContext,
  attendanceRhidOptionContext as contextFor,
  buildAttendanceRhidBadge as badgeFor,
  attendanceRhidPollEligible as eligible,
} from "../src/chat/attendance-rhid-badges.js";
const day = "2026-10-05";
const regular = "07:00;12:00;13:00;16:30";
const poll = (options = [], extra = {}) => ({ type: "poll", presentation: "attendance_multi_select", options, ...extra });
const option = (extra = {}) => ({ id: "pending_attendance_record:101", label: "101 - ANA", source_values: { FORNECEDOR: "ANA", DATA: day }, ...extra });
const context = (extra = {}) => ({ presenceId: "101", name: "ANA", date: day, ...extra });
const row = (extra = {}) => ({ Id: "sharepoint-10", ID_PESSOA_RHID: "10", NOME_COLABORADOR: "ANA", DATA_REFERENCIA: day, BATIDAS_RHID: regular, ...extra });
const report = (rows = [row()], extra = {}) => ({ date: day, rows, ...extra });

test("replication inferred from choice IDs never accepts a validation-only missing-punch correction", () => {
  const choice = option({ id: 'supplier_sync_target:101', rhidBadge: badgeFor(context(), report([row({ BATIDAS_RHID: '07:00' })])) });
  assert.equal(attendanceMissingPunchContext(choice, poll([choice]), 'exit1'), null);
});

test("badge exposes the same four effective punch slots as the daily report", () => {
  const actual = badgeFor(context(), report());
  assert.deepEqual(actual.punches, { entry1: "07:00", exit1: "12:00", entry2: "13:00", exit2: "16:30" });
  assert.equal(actual.label, "08h30");
});

test("exclusão dos relatórios não altera a conferência de batidas de uma presença individual", () => {
  const name = "BERNARDO NOTINI MOREIRA BAHIA";
  const actual = badgeFor(context({ name }), report([row({ NOME_COLABORADOR: name })]));
  assert.equal(actual.status, "present");
  assert.deepEqual(actual.punches, { entry1: "07:00", exit1: "12:00", entry2: "13:00", exit2: "16:30" });
});

test("incomplete and afternoon-only punches keep their slots without invented entries or exits", () => {
  for (const [raw, expected] of [
    ["06:45", { entry1: "06:45", exit1: null, entry2: null, exit2: null }],
    ["13:00;16:30", { entry1: null, exit1: null, entry2: "13:00", exit2: "16:30" }],
    ["07:00;12:00;13:00", { entry1: "07:00", exit1: "12:00", entry2: "13:00", exit2: null }],
    ["", { entry1: null, exit1: null, entry2: null, exit2: null }],
  ]) {
    assert.deepEqual(badgeFor(context(), report([row({ BATIDAS_RHID: raw })])).punches, expected);
  }
});

test("punch display includes approved corrections even when a period remains incomplete", () => {
  const actual = badgeFor(context(), report([row({ BATIDAS_RHID: "07:00", ADMIN_AJUSTES: { entry1: { time: "06:50" } } })]));
  assert.equal(actual.status, "inconsistent");
  assert.deepEqual(actual.punches, { entry1: "06:50", exit1: null, entry2: null, exit2: null });
});

test("duplicated valid punches still display known times and approved corrections with an inconsistency warning", () => {
  const actual = badgeFor(context(), report([row({
    BATIDAS_RHID: "07:00;07:00;12:00;13:00",
    ADMIN_AJUSTES: { exit2: { time: "16:30" } },
  })]));
  assert.equal(actual.status, "inconsistent");
  assert.equal(actual.minutes, undefined);
  assert.deepEqual(actual.punches, { entry1: "07:00", exit1: "12:00", entry2: "13:00", exit2: "16:30" });
});

test("unavailable or ambiguous identity never exposes another person's punch times", () => {
  for (const actual of [
    badgeFor(context({ date: "2026-10-06" }), report()),
    badgeFor(context({ name: "BIA" }), report()),
    badgeFor(context(), report([row(), row({ ID_PESSOA_RHID: "20", Id: "20" })])),
  ]) {
    assert.equal(actual.status, "unavailable");
    assert.equal(actual.punches, undefined);
  }
});

for (const presentation of ["attendance_multi_select", "attendance_supplier_sync"]) {
  test(`eligibility accepts ${presentation}`, () => assert.equal(eligible(poll([], { presentation })), true));
}
test("eligibility accepts only attendance records in an accordion", () => {
  assert.equal(eligible(poll([{ id: "pending_attendance_record:101" }], { presentation: "accordion" })), true);
  assert.equal(eligible(poll([{ reply: "pending_attendance_record:101" }], { presentation: "accordion" })), true);
  assert.equal(eligible(poll([{ id: "supplier_sync_target:101" }], { presentation: "accordion" })), true);
  assert.equal(eligible(poll([{ id: "pending_attendance_other_date" }], { presentation: "accordion" })), false);
  assert.equal(eligible(null), false);
  assert.equal(eligible({ type: "text", presentation: "attendance_multi_select" }), false);
  assert.equal(eligible(poll([{ id: "101" }], { presentation: "cards" })), false);
});

for (const id of ["choice:registro_presenca_pendente:101", "pending_attendance_record:101", "supplier_sync_target:101", "choice:sincronizar_atividade_fornecedor_presenca:supplier_sync_target:101", "101", 101]) {
  test(`context extracts presence ID from ${id}`, () => {
    assert.deepEqual(contextFor(option({ id }), poll()), { presenceId: "101", name: "ANA", date: day });
  });
}
test("bare numeric IDs require an eligible poll and the reply takes precedence", () => {
  assert.equal(contextFor(option({ id: "101" }), poll([], { presentation: "cards" })), null);
  assert.deepEqual(contextFor(option({ id: "local", reply: "pending_attendance_record:101" }), poll()), context());
  assert.equal(contextFor(option({ reply: "submit" }), poll()), null);
});
for (const id of ["pending_attendance_select_all", "select_all", "attendance_continue", "pending_attendance_other_date", "presence_other_dates", "attendance_close_demonstrative", "endstage", "submit", "choice:sincronizar_atividade_fornecedor_presenca:finish_supplier_sync", "attendance_batch:101,102", "pending_attendance_record:abc", "supplier_sync_target:"]) {
  test(`control/non-record ${id} has no context`, () => assert.equal(contextFor(option({ id }), poll()), null));
}
for (const label of ["SELECIONAR TODOS", "✅ PROSSEGUIR", "AVALIAR OUTRA DATA", "FINALIZAR ETAPA", "✅ SUBMETER"]) {
  test(`numeric control ${label} has no context`, () => assert.equal(contextFor(option({ id: "101", label }), poll()), null));
}
test("context keeps presence IDs separate from explicit RHID IDs", () => {
  assert.deepEqual(contextFor(option({ source_values: { Id: 101, FORNECEDOR: " ANA ", DATA: day, ID_PESSOA_RHID: 20 } }), poll()), { presenceId: "101", name: "ANA", date: day, rhidId: "20" });
  assert.deepEqual(contextFor(option({ ID_PESSOA_RHID: "30" }), poll()), { presenceId: "101", name: "ANA", date: day, rhidId: "30" });
});
test("camel-case sourceValues and label dates/names provide real context", () => {
  assert.deepEqual(contextFor({ id: "pending_attendance_record:101", label: "ignored", sourceValues: { FORNECEDOR: "JOSÉ", DATA: "05/10/2026" } }, poll()), { presenceId: "101", name: "JOSÉ", date: day });
  for (const label of ["101 - ANA - 05/10/2026", "📅 05/10/2026 | 101 - ANA"]) {
    assert.deepEqual(contextFor({ id: "pending_attendance_record:101", label }, poll()), context());
  }
});
for (const key of ["date", "data", "presenceDate", "presence_date"]) {
  test(`context reads ${key} without inventing today`, () => assert.equal(contextFor(option({ [key]: "2026-10-06T00:00:00-03:00" }), poll()).date, "2026-10-06"));
}
test("only the individual option may supply its date, never a stale expanded-poll day or history", () => {
  const undated = { id: "pending_attendance_record:101", label: "101 - ANA" };
  assert.equal(contextFor(undated, poll()).date, "");
  assert.equal(contextFor(undated, poll([], { presenceDateKey: day })).date, "");
  assert.equal(contextFor(undated, poll(), "05/10/2026").date, "");
  assert.equal(contextFor(undated, poll(), "today").date, "");
  assert.equal(contextFor(option({ date: "2026-02-30" }), poll([], { presenceDateKey: day }), day).date, "");
  assert.equal(contextFor(option({ source_values: { DATA: "30/02/2026", FORNECEDOR: "ANA" } }), poll(), day).date, "");
  assert.equal(contextFor({ ...undated, label: "101 - ANA - 31/04/2026" }, poll(), day).date, "");
});

for (const extra of [{ date: "" }, { date: null }, { source_values: { DATA: "" } },
  { detail_table: [[{ label: "DATA", value: "" }]] }, { detailTable: { rows: [[{ label: "DATA", value: null }]] } }]) {
  test(`explicitly empty per-record date blocks fallback ${JSON.stringify(extra)}`, () => {
    const actual = { id: "pending_attendance_record:101", label: "101 - ANA", ...extra };
    assert.equal(contextFor(actual, poll([], { presenceDateKey: day }), day).date, "");
    assert.equal(badgeFor(contextFor(actual, poll(), day), report()).status, "unavailable");
  });
}

test("legacy pending portal options obtain the day from their actual detail cells", () => {
  const actual = { id: "choice:pending_attendance_record:pending_attendance_record:101", reply: "pending_attendance_record:101", label: "101 - ANA",
    detail_table: [[{ label: "DATA", value: "05/10/2026" }, { label: "FILIAL", value: "004" }], [{ label: "ATIVIDADE", value: "EXECUÇÃO FUNDAÇÃO" }]] };
  const extracted = contextFor(actual, poll());
  assert.deepEqual(extracted, { presenceId: "101", name: "ANA", date: day });
  assert.equal(badgeFor(extracted, report()).label, "08h30");
});

test("each restored detail table chooses its own day instead of the previously selected day", () => {
  const actual = { id: "pending_attendance_record:101", label: "101 - ANA",
    detailTable: { rows: [[{ label: "DATA", value: "2026-10-06T12:00:00Z" }]] } };
  assert.equal(contextFor(actual, poll([], { presenceDateKey: day }), day).date, "2026-10-06");
});

test("invalid dates in a legacy detail table do not fall through to another days punches", () => {
  const actual = { id: "pending_attendance_record:101", label: "101 - ANA",
    detail_table: [[{ label: "DATA", value: "30/02/2026" }]] };
  assert.equal(contextFor(actual, poll([], { presenceDateKey: day }), day).date, "");
  const explicit = { ...actual, date: "2026-10-06" };
  assert.equal(contextFor(explicit, poll(), day).date, "2026-10-06");
});

for (const [date, punches, status, label, minutes] of [
  ["2026-10-05", regular, "present", "08h30", 510],
  ["2026-10-06", "07:00;12:00;13:00;16:29", "inconsistent", "INCONSISTENTE", 509],
  ["2026-10-07", "07:00;12:00;13:00;16:31", "present", "08h31", 511],
  ["2026-10-08", "07:00;15:30", "present", "08h30", 510],
  ["2026-10-09", "07:00;11:00", "present", "04h00", 240],
  ["2026-10-10", "07:00;08:00", "inconsistent", "INCONSISTENTE", undefined],
  ["2026-10-11", "07:00;08:00", "inconsistent", "INCONSISTENTE", undefined],
  ["2026-10-05", "07:00;12:00;13:00;16:30;18:00", "present", "08h30", 510],
  ["2026-10-05", "07:00;12:00;13:00;16:30;18:00;19:00", "present", "09h30", 570],
  ["2026-10-05", "05:00;07:00;08:00;12:00;13:00;15:30;18:00;19:00", "present", "09h30", 570],
]) {
  test(`daily duration ${date} [${punches}] gives ${label}`, () => {
    const badge = badgeFor(context({ date }), { date, rows: [row({ DATA_REFERENCIA: date, BATIDAS_RHID: punches, MINUTOS_TRABALHADOS: 9999 })] });
    assert.equal(badge.status, status);
    assert.equal(badge.label, label);
    assert.equal(badge.date, date);
    assert.equal(badge.minutes, minutes);
    assert.match(badge.description, /RHID/);
  });
}
for (const punches of ["07:00", "07:00;12:00;13:00", "07:00;07:00;12:00;13:00;16:30", "07:00;12:00;13:00;24:99", "garbage", "07:00;12:00;13:00;16:30;garbage", '["07:00",', { unexpected: "07:00" }, ["07:00", "12:00", "13:00", "16:30", null], "07:00;12:00;13:00;16:30:99"]) {
  test(`invalid/incomplete punches ${JSON.stringify(punches)} require review`, () => {
    const badge = badgeFor(context(), report([row({ BATIDAS_RHID: punches })]));
    assert.equal(badge.status, "inconsistent");
    assert.equal(badge.label, "INCONSISTENTE");
  });
}
test("ISO offsets and JSON/object punches preserve the wall-clock durations", () => {
  const punches = ["07:00", "12:00", "13:00", "16:30"].map(time => ({ dataHora: `${day}T${time}:00-03:00` }));
  for (const raw of [punches, JSON.stringify(punches)]) {
    const badge = badgeFor(context(), report([row({ BATIDAS_RHID: raw })]));
    assert.equal(badge.label, "08h30");
    assert.equal(badge.minutes, 510);
  }
});
test("approved ADMIN_AJUSTES complete an odd raw punch list without mutating it", () => {
  const source = row({ BATIDAS_RHID: "07:00;12:00;13:00", ADMIN_AJUSTES: { exit2: { time: "16:30", adjustedAt: `${day}T21:00:00Z`, reason: "Conferido" } } });
  const before = structuredClone(source);
  const badge = badgeFor(context(), report([source]));
  assert.equal(badge.label, "08h30");
  assert.equal(badge.minutes, 510);
  assert.deepEqual(source, before);
});
test("approved adjustments fill the missing lunch entry and reject inverted chronology", () => {
  assert.equal(badgeFor(context(), report([row({ BATIDAS_RHID: "07:00;12:00;16:30", ADMIN_AJUSTES: { entry2: { time: "13:00" } } })])).label, "08h30");
  assert.equal(badgeFor(context(), report([row({ ADMIN_AJUSTES: { entry2: { time: "11:00" } } })])).status, "inconsistent");
});
test("latest approved adjustment is shared by fragments of the same RHID person", () => {
  const badge = badgeFor(context(), report([
    row({ BATIDAS_RHID: "07:00;12:00", ADMIN_AJUSTES: { exit2: { time: "16:00", adjustedAt: `${day}T20:00:00Z` } } }),
    row({ Id: "sharepoint-11", BATIDAS_RHID: "13:00", ADMIN_AJUSTES: { exit2: { time: "16:30", adjustedAt: `${day}T21:00:00Z` } } }),
  ]));
  assert.equal(badge.label, "08h30");
});
test("duplicate punches across fragments remain inconsistent", () => {
  assert.equal(badgeFor(context(), report([row(), row({ Id: "sharepoint-11", BATIDAS_RHID: "07:00" })])).status, "inconsistent");
});
for (const punches of ["", null, [], "[]"]) {
  test(`registered row with no punches ${JSON.stringify(punches)} is absent`, () => {
    const badge = badgeFor(context(), report([row({ BATIDAS_RHID: punches, MINUTOS_TRABALHADOS: 510 })]));
    assert.equal(badge.status, "absent");
    assert.equal(badge.label, "AUSENTE");
  });
}
test("unique normalized names match without accents or extra spaces", () => {
  assert.equal(badgeFor(context({ name: " José   da Silva " }), report([row({ NOME_COLABORADOR: "JOSE DA SILVA" })])).status, "present");
});
test("presence IDs do not silently match RHID or SharePoint row IDs", () => {
  assert.equal(badgeFor(context({ presenceId: "10", name: "BIA" }), report()).status, "unavailable");
  assert.equal(badgeFor(context({ presenceId: "sharepoint-10", name: "BIA" }), report()).status, "unavailable");
});
test("unlinked namesakes remain unavailable even if a presence ID equals a RHID ID", () => {
  const rows = [row({ BATIDAS_RHID: "" }), row({ Id: "sharepoint-20", ID_PESSOA_RHID: "20" })];
  assert.equal(badgeFor(context({ presenceId: "10" }), report(rows)).status, "unavailable");
  assert.equal(badgeFor(context({ rhidId: "20" }), report(rows)).status, "present");
});
test("pendingPresenceIds identify namesakes without merging their punches", () => {
  const rows = [row({ BATIDAS_RHID: "", pendingPresenceIds: [101] }), row({ Id: "sharepoint-20", ID_PESSOA_RHID: "20", pendingPresenceIds: ["102"] })];
  assert.equal(badgeFor(context(), report(rows)).status, "absent");
  assert.equal(badgeFor(context({ presenceId: "102" }), report(rows)).status, "present");
});
test("conflicting or missing explicit links cannot fall back to a convenient name", () => {
  const rows = [row({ pendingPresenceIds: ["101"] }), row({ Id: "sharepoint-20", ID_PESSOA_RHID: "20" })];
  assert.equal(badgeFor(context({ rhidId: "20" }), report(rows)).status, "unavailable");
  assert.equal(badgeFor(context({ rhidId: "30" }), report(rows)).status, "unavailable");
  assert.equal(badgeFor(context(), report([row({ pendingPresenceIds: ["101"] }), row({ Id: "sharepoint-20", ID_PESSOA_RHID: "20", pendingPresenceIds: ["101"] })])).status, "unavailable");
});
test("an explicit RHID identity tolerates a renamed collaborator", () => {
  assert.equal(badgeFor(context({ rhidId: "10", name: "OLD NAME" }), report()).status, "present");
});

for (const data of [null, { date: day, rows: null }, { date: day }, { date: "2026-10-06", rows: [row()] }, { rows: [row()] }, report([null]), report([row({ DATA_REFERENCIA: "2026-10-06" })]), report([row({ DATA_REFERENCIA: "2026-02-30" })]), report([row({ DATA_REFERENCIA: null })])]) {
  test(`invalid report ${JSON.stringify(data)} stays unavailable`, () => {
    const badge = badgeFor(context(), data);
    assert.equal(badge.status, "unavailable");
    assert.equal(badge.label, "RHID INDISPONÍVEL");
  });
}
test("invalid context dates remain empty/unavailable even with a valid report", () => {
  for (const date of ["", "2026-02-30", "today"]) {
    const badge = badgeFor(context({ date }), report());
    assert.equal(badge.status, "unavailable");
    assert.equal(badge.date, "");
    assert.equal(badge.minutes, undefined);
  }
  assert.equal(badgeFor(null, report()).status, "unavailable");
});
for (const registration of [undefined, { complete: false, people: [] }, { complete: true, people: null }, { complete: "true", people: [] }, { complete: true, people: [null] }, { complete: true, people: [{ id: "10" }] }]) {
  test(`non-authoritative directory ${JSON.stringify(registration)} cannot infer registration`, () => {
    assert.equal(badgeFor(context(), report([], { registration })).status, "unavailable");
  });
}
test("a complete directory can establish registration or authoritatively exclude a user", () => {
  const registration = { complete: true, people: [{ id: "10", name: "ANA" }] };
  assert.equal(badgeFor(context(), report([], { registration })).status, "absent");
  assert.equal(badgeFor(context({ name: "BIA" }), report([], { registration })).label, "S/ CADASTRO");
  assert.equal(badgeFor(context({ rhidId: "20" }), report([], { registration })).status, "unregistered");
  assert.equal(badgeFor(context(), report([], { registration: { complete: true, people: [] } })).status, "unregistered");
});
test("a known person in an incomplete directory does not prove absence for the day", () => {
  assert.equal(badgeFor(context(), report([], { registration: { complete: false, people: [{ id: "10", name: "ANA" }] } })).status, "unavailable");
});
test("directory namesakes require an explicit identity even when only one day row exists", () => {
  const registration = { complete: true, people: [{ id: "10", name: "ANA" }, { id: "20", name: "ANA" }] };
  assert.equal(badgeFor(context(), report([], { registration })).status, "unavailable");
  assert.equal(badgeFor(context(), report([row()], { registration })).status, "unavailable");
  assert.equal(badgeFor(context({ rhidId: "20" }), report([], { registration })).status, "absent");
});
test("a directory identity connects a uniquely named supplier to a renamed day row", () => {
  const registration = { complete: true, people: [{ id: "10", name: "ANA" }] };
  assert.equal(badgeFor(context(), report([row({ NOME_COLABORADOR: "ANA NOVO NOME" })], { registration })).status, "present");
});
test("a wrong day row cannot be downgraded to absence through a complete directory", () => {
  const registration = { complete: true, people: [{ id: "10", name: "ANA" }] };
  assert.equal(badgeFor(context(), report([row({ DATA_REFERENCIA: "2026-10-06" })], { registration })).status, "unavailable");
});
test("the model never mutates frozen options, polls, reports or adjustments", () => {
  function freeze(value) {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  const sourceOption = freeze(option());
  const sourcePoll = freeze(poll([sourceOption]));
  const sourceReport = freeze(report([row({ BATIDAS_RHID: "07:00;12:00;13:00", ADMIN_AJUSTES: { exit2: { time: "16:30" } } })]));
  const before = structuredClone({ sourceOption, sourcePoll, sourceReport });
  assert.equal(badgeFor(contextFor(sourceOption, sourcePoll), sourceReport).label, "08h30");
  assert.deepEqual({ sourceOption, sourcePoll, sourceReport }, before);
});

test("a missing punch field is unavailable, not confirmed absence", () => {
  const { BATIDAS_RHID: _punches, ...incomplete } = row();
  assert.equal(badgeFor(context(), report([incomplete])).status, "unavailable");
});
test("a malformed daily row cannot prove missing registration through a directory", () => {
  assert.equal(badgeFor(context({ name: "BIA" }), report([{}], { registration: { complete: true, people: [] } })).status, "unavailable");
});
test("an adjustment cannot silently discard punches in an ambiguous fixed slot", () => {
  const date = "2026-10-09";
  assert.equal(badgeFor(context({ date }), { date, rows: [row({ DATA_REFERENCIA: date, BATIDAS_RHID: "06:00;06:10;06:20;14:00", ADMIN_AJUSTES: { exit2: { time: "16:30" } } })] }).status, "inconsistent");
});
test("a negative clock time is malformed even when its absolute time looks valid", () => {
  assert.equal(badgeFor(context(), report([row({ BATIDAS_RHID: "-07:00;12:00;13:00;16:30" })])).status, "inconsistent");
});

test("real numeric IDs and camel-case date aliases preserve separate identities", () => {
  const actual = { id: 101, sourceValues: { Id: 101, FORNECEDOR: "ANA", presence_date: "05/10/2026", ID_PESSOA_RHID: 10 } };
  const extracted = contextFor(actual, poll([], { presentation: "attendance_supplier_sync" }));
  assert.deepEqual(extracted, { presenceId: "101", name: "ANA", date: day, rhidId: "10" });
  assert.equal(badgeFor(extracted, report([row({ ID_PESSOA_RHID: 10 })])).label, "08h30");
});
test("empty linkedDeviceIds never exclude a person from the complete RHID directory", () => {
  const registration = { complete: true, people: [{ id: 10, name: "ANA", linkedDeviceIds: [] }] };
  const actual = context({ rhidId: "10" });
  assert.equal(badgeFor(actual, report([row({ ID_PESSOA_RHID: 10 })], { registration })).status, "present");
  assert.equal(badgeFor(actual, report([], { registration })).status, "absent");
  assert.equal(badgeFor(actual, { date: day, rows: null, registration }).status, "unavailable");
});
test("a dated row alias and a Brazilian report date use the same calendar day", () => {
  const { DATA_REFERENCIA: _date, ...actual } = row();
  assert.equal(badgeFor(context(), { date: "05/10/2026", rows: [{ ...actual, date: `${day}T00:00:00-03:00` }] }).label, "08h30");
});

for (const adjustments of [
  { entry1: { time: "07:00" }, entry2: { time: "13:00" } },
  { exit1: { time: "12:00" }, exit2: { time: "16:30" } },
  { entry1: { time: "07:00" }, exit2: { time: "16:30" } },
]) {
  test(`unpaired approved adjustment slots are inconsistent even on Friday: ${JSON.stringify(adjustments)}`, () => {
    const date = "2026-10-09";
    assert.equal(badgeFor(context({ date }), { date, rows: [row({ DATA_REFERENCIA: date, BATIDAS_RHID: [], ADMIN_AJUSTES: adjustments })] }).status, "inconsistent");
  });
}

test("supplier sync inferred from choice IDs is eligible without explicit presentation", () => {
  const inferred = { type: "poll", options: [{ id: "choice:sincronizar_atividade_fornecedor_presenca:supplier_sync_target:101" }] };
  assert.equal(eligible(inferred), true);
  assert.equal(eligible({ type: "poll", options: [{ id: "choice:sincronizar_atividade_fornecedor_presenca:finish_supplier_sync" }] }), false);
});
