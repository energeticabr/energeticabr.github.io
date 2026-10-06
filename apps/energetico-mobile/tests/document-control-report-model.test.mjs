import test from "node:test";
import assert from "node:assert/strict";

const model = await import("../src/chat/document-control-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
function normalize(snapshot) {
  assert.equal(typeof model.normalizeDocumentControlSnapshot, "function", "normalizeDocumentControlSnapshot must be implemented");
  return model.normalizeDocumentControlSnapshot(snapshot);
}
function overview(snapshot, filters = {}, today = "2026-10-06") {
  assert.equal(typeof model.buildDocumentControlOverview, "function", "buildDocumentControlOverview must be implemented");
  return model.buildDocumentControlOverview(snapshot, filters, today);
}
const row = (id, extra = {}) => ({ id, submittedDate: "2026-10-05", issuedDate: "2026-09-30", expirationDate: "2026-10-21",
  branch: "Divinópolis", homologation: "FEDERAL", documentType: "CERTIDÃO", person: "José", stage: "Obra", property: "Casa 1", status: "SUBMETIDO", ...extra });

test("normalization keeps source calendar days across offsets and parses Brazilian dates strictly", () => {
  const result = normalize({ documents: [row("001", { submittedDate: "2026-10-05T23:30:00-03:00", issuedDate: "30/09/2026", expirationDate: "2026-10-21T00:10:00+03:00" })] });
  assert.deepEqual(result.documents[0], row(1));
});

test("PowerFx metrics count exact trimmed upper statuses and inclusive validity boundaries independently of status", () => {
  const report = overview({ documents: [row(1, { status: " submetido ", expirationDate: "2026-10-05" }),
    row(2, { status: "pendente", expirationDate: "2026-10-06" }), row(3, { status: "APROVADO", expirationDate: "2026-10-21" }),
    row(4, { status: "SUBMETIDOS", expirationDate: "2026-10-22" }), row(5, { status: "PENDÊNTE", expirationDate: "" }),
    row(6, { status: "CANCELADO", expirationDate: "1990-01-01" })] });
  assert.deepEqual(report.metrics, { submitted: 1, pending: 1, total: 6, expired: 2, expiring15: 2 });
  assert.deepEqual(report.documents.map(value => value.id), [6, 5, 4, 3, 2, 1]);
  assert.equal(report.sortLabel, "🔢 MAIOR ID");
});

test("elapsed day values use calendar subtraction including leap days future dates and blank dates", () => {
  const report = overview({ documents: [row(1), row(2, { submittedDate: "2026-10-07", issuedDate: "", expirationDate: null }),
    row(3, { submittedDate: "2024-02-29", issuedDate: "2024-03-01", expirationDate: "2026-10-05" })] });
  assert.deepEqual(report.documents.map(({ id, submittedDays, issuedDays, daysToExpiry }) => [id, submittedDays, issuedDays, daysToExpiry]),
    [[3, 950, 949, -1], [2, -1, null, null], [1, 1, 6, 15]]);
});

test("each optional filter applies equality ignoring case while preserving accent differences", () => {
  for (const [field, value] of Object.entries({ branch: "Divinópolis", homologation: "FEDERAL", person: "José", documentType: "CERTIDÃO", stage: "Obra", property: "Casa 1", status: "SUBMETIDO" })) {
    const report = overview({ documents: [row(1), row(2, { [field]: "Outra opção" }), row(3, { [field]: value.toLowerCase() })] }, { [field]: value.toUpperCase() });
    assert.deepEqual(report.documents.map(value => value.id), [3, 1], field);
    assert.equal(report.metrics.total, 2);
  }
  assert.equal(overview({ documents: [row(1)] }, { person: "Jose" }).metrics.total, 0);
  assert.equal(overview({ documents: [row(1)] }, { documentType: "CERTIDAO" }).metrics.total, 0);
});

test("filters compose and filter options retain unique sorted source values from the full base", () => {
  const snapshot = { documents: [row(1, { branch: "B", status: "APROVADO", person: "Álvaro" }), row(2, { branch: "A", status: "PENDENTE", person: "Zélia" }),
    row(3, { branch: "B", status: "PENDENTE", person: "Álvaro" }), row(4, { branch: "", person: "" })] };
  const report = overview(snapshot, { branch: "B", status: "pendente", stage: "", property: null });
  assert.deepEqual(report.documents.map(value => value.id), [3]);
  assert.deepEqual(report.metrics, { submitted: 0, pending: 1, total: 1, expired: 0, expiring15: 1 });
  assert.deepEqual(report.filterOptions, { branch: ["A", "B"], homologation: ["FEDERAL"], person: ["Álvaro", "Zélia"],
    documentType: ["CERTIDÃO"], stage: ["Obra"], property: ["Casa 1"], status: ["APROVADO", "PENDENTE", "SUBMETIDO"] });
});

test("expiration sorting always ascends places blanks last and breaks ties by descending ID", () => {
  const snapshot = { documents: [row(1, { expirationDate: "" }), row(2, { expirationDate: "2026-10-05" }),
    row(3, { expirationDate: "2026-10-05" }), row(4, { expirationDate: "2026-10-21" }), row(5, { expirationDate: null })] };
  for (const direction of ["asc", "desc"]) {
    assert.deepEqual(overview(snapshot, { order: "expirationDate", direction }).documents.map(value => value.id), [3, 2, 4, 5, 1]);
  }
});

test("ID sort honors direction numerically and every other sort honors direction with ID desc ties", () => {
  const snapshot = { documents: [row(2, { branch: "A", issuedDate: "2026-01-01" }), row(10, { branch: "A", issuedDate: "2026-01-01" }),
    row(3, { branch: "B", issuedDate: "2026-02-01" })] };
  assert.deepEqual(overview(snapshot, { order: "id", direction: "asc" }).documents.map(value => value.id), [2, 3, 10]);
  assert.equal(overview(snapshot, { order: "id", direction: "asc" }).sortLabel, "🔢 MENOR ID");
  for (const order of ["branch", "issuedDate"]) {
    assert.deepEqual(overview(snapshot, { order, direction: "asc" }).documents.map(value => value.id), [10, 2, 3]);
    assert.deepEqual(overview(snapshot, { order, direction: "desc" }).documents.map(value => value.id), [3, 10, 2]);
  }
});

test("blank source fields become empty without fabricated labels and the empty report has explicit zeros", () => {
  const blanks = Object.fromEntries(Object.keys(row(1)).filter(field => field !== "id").map(field => [field, null]));
  const normalized = normalize({ documents: [row(1, blanks)] });
  assert.ok(Object.values(normalized.documents[0]).slice(1).every(value => value === ""));
  assert.deepEqual(overview({ documents: [] }), { documents: [], metrics: { submitted: 0, pending: 0, total: 0, expired: 0, expiring15: 0 },
    filterOptions: { branch: [], homologation: [], person: [], documentType: [], stage: [], property: [], status: [] }, sortLabel: "🔢 MAIOR ID" });
});

test("invalid calendar days and malformed timestamps reject even when filters would exclude the record", () => {
  for (const date of ["2026-02-29", "2024-02-30", "31/04/2026", "2026-13-01", "06/10/26", "2026-1-01", "2026-10-06junk",
    "2026-10-06T24:00:00Z", "2026-10-06T12:60:00Z", "2026-10-06T12:00:00+99:00", 123, {}, []]) {
    for (const field of ["submittedDate", "issuedDate", "expirationDate"]) {
      assert.throws(() => overview({ documents: [row(1, { [field]: date })] }, { branch: "excluded" }), /data|calendário/i);
    }
  }
  for (const today of [undefined, "06/10/2026", "2026-02-29", "2026-10-06T00:00:00Z", ""]) {
    assert.throws(() => model.buildDocumentControlOverview({ documents: [] }, {}, today), /data|ISO|calendário/i);
  }
});

test("incomplete snapshots missing fields malformed scalar values and duplicate normalized IDs reject", () => {
  for (const snapshot of [null, [], {}, { documents: null }, { documents: Array(1) }, { documents: [null] },
    ...["partial", "incomplete", "error", "truncated", "aborted"].map(flag => ({ documents: [], [flag]: true })),
    { documents: [], complete: false }, { documents: [], hasMore: true }, { documents: [], nextLink: "next" },
    { documents: [row(1), row("01")] }, { documents: [row(0)] }, { documents: [row(-1)] }, { documents: [row(1.5)] },
    { documents: [row(1, { person: {} })] }, { documents: [row(1, { status: ["PENDENTE"] })] }]) {
    assert.throws(() => normalize(snapshot), /snapshot|registro|campo|incomplet|duplic|ID/i);
  }
  for (const field of Object.keys(row(1))) {
    const missing = row(1); delete missing[field];
    assert.throws(() => normalize({ documents: [missing] }), /campo|incomplet/i);
  }
});

test("normalization overview sorting and filters do not mutate callers and every returned collection is frozen", () => {
  const source = { documents: [row(1, { person: '<script>evil()</script>' }), row(2)] }; const before = structuredClone(source);
  const filters = { order: "person", direction: "asc" }; const snapshot = normalize(source); const report = overview(snapshot, filters);
  assert.deepEqual(source, before); assert.deepEqual(filters, { order: "person", direction: "asc" });
  assert.equal(snapshot.documents[0].person, '<script>evil()</script>');
  for (const value of [snapshot, snapshot.documents, ...snapshot.documents, report, report.metrics, report.documents,
    ...report.documents, report.filterOptions, ...Object.values(report.filterOptions)]) assert.ok(Object.isFrozen(value));
});
