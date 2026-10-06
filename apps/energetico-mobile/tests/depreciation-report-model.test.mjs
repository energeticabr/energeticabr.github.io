import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const model = await import("../src/chat/depreciation-report-model.js").catch(error => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const row = (id, extra = {}) => ({ id, branch: "A", depreciationDate: "2026-10-06", patrimony: `PAT-${id}`,
  group: "Equipamentos", asset: "Betoneira", estimatedUnit: 100, residualUnit: 60, quantity: 2, rate: 10, ...extra });
function normalize(snapshot) {
  assert.equal(typeof model.normalizeDepreciationReportSnapshot, "function", "normalizeDepreciationReportSnapshot must be implemented");
  return model.normalizeDepreciationReportSnapshot(snapshot);
}
function overview(snapshot, today = "2026-10-06") {
  assert.equal(typeof model.buildDepreciationOverview, "function", "buildDepreciationOverview must be implemented");
  return model.buildDepreciationOverview(snapshot, today);
}

// Each literal expectation is hand-derived from the supplied PowerFx, not a production helper.
test("qualifying records include every past date and the inclusive day 30 regardless of STATUS or DEPRECIAR", () => {
  const report = overview({ assets: [row(1, { depreciationDate: "1990-01-01", STATUS: "INATIVO", DEPRECIAR: "NÃO" }),
    row(2, { depreciationDate: "2026-10-06", residualUnit: 0, STATUS: "ATIVO", DEPRECIAR: "SIM" }),
    row(3, { depreciationDate: "2026-11-05", branch: "B", residualUnit: 20, DEPRECIAR: "NÃO" }),
    row(4, { depreciationDate: "2026-11-06" }), row(5, { depreciationDate: "" })] });
  assert.equal(report.today, "2026-10-06"); assert.equal(report.limitDate, "2026-11-05");
  assert.deepEqual(report.metrics, { records: 3, active: 2, branches: 2, total: 600, toDepreciate: 16, depreciated: 440, current: 160 });
  assert.deepEqual(report.branches.map(branch => branch.assets.map(asset => [asset.id, asset.dateTone])),
    [[[1, "overdue"], [2, "today"]], [[3, "future"]]]);
});

test("aggregate sums use unrounded decimal products rather than row displays or rounded branch totals", () => {
  // Each row: total=.025, current=.015, depreciated=.010, next=.0075.
  // Three rows: .075 -> .08; .045 -> .05; .030 -> .03; .0225 -> .02.
  const report = overview({ assets: [row(1, { estimatedUnit: "0,05", residualUnit: "0,03", quantity: "0,5", rate: 50 }),
    row(2, { estimatedUnit: "0,05", residualUnit: "0,03", quantity: "0,5", rate: 50 }),
    row(3, { branch: "B", estimatedUnit: "0,05", residualUnit: "0,03", quantity: "0,5", rate: 50 })] });
  assert.deepEqual(report.metrics, { records: 3, active: 3, branches: 2, total: 0.08, toDepreciate: 0.02, depreciated: 0.03, current: 0.05 });
  assert.deepEqual(report.branches.map(({ branch, records, quantity, total, toDepreciate, depreciated, current }) =>
    ({ branch, records, quantity, total, toDepreciate, depreciated, current })), [
    { branch: "A", records: 2, quantity: 1, total: 0.05, toDepreciate: 0.02, depreciated: 0.02, current: 0.03 },
    { branch: "B", records: 1, quantity: 0.5, total: 0.03, toDepreciate: 0.01, depreciated: 0.01, current: 0.02 },
  ]);
  assert.deepEqual(report.branches[0].assets.map(({ total, current, depreciated, toDepreciate }) =>
    ({ total, current, depreciated, toDepreciate })), [
    { total: 0.03, current: 0.02, depreciated: 0.01, toDepreciate: 0.01 },
    { total: 0.03, current: 0.02, depreciated: 0.01, toDepreciate: 0.01 },
  ]);
  assert.equal(report.branches[0].assets[0].estimatedUnit, 0.05);
});

test("Brazilian amounts and fractional quantities retain source precision before multiplication", () => {
  const snapshot = normalize({ assets: [row("001", { estimatedUnit: "R$ 1.234,567", residualUnit: "1.000,005", quantity: "2,5", rate: "2,75" })] });
  assert.equal(snapshot.assets[0].id, 1); assert.equal(snapshot.assets[0].estimatedUnit, 1234.567);
  const report = overview(snapshot);
  assert.deepEqual(report.metrics, { records: 1, active: 1, branches: 1, total: 3086.42, toDepreciate: 68.75, depreciated: 586.41, current: 2500.01 });
});

test("source decimal strings near a half cent survive normalization before aggregate display", () => {
  const snapshot = normalize({ assets: [row(1, { estimatedUnit: "0,004999999999999999999", residualUnit: 0, quantity: 1 })] });
  assert.equal(overview(snapshot).metrics.total, 0);
  assert.equal(overview(snapshot).metrics.depreciated, 0);
});

test("PowerFx residual scientific text contributes to active current depreciated and next totals", () => {
  const snapshot = normalize({ assets: [row(1, { estimatedUnit: 1200, residualUnit: "1e3", quantity: 2, rate: 10 })] });
  assert.equal(snapshot.assets[0].residualUnit, 1000);
  const report = overview(snapshot);
  assert.deepEqual(report.metrics, { records: 1, active: 1, branches: 1, total: 2400, toDepreciate: 200, depreciated: 400, current: 2000 });
  assert.equal(report.branches[0].current, 2000);
  assert.equal(report.branches[0].assets[0].toDepreciate, 200);
});

test("PowerFx residual percent text is divided by 100 before products", () => {
  const report = overview({ assets: [row(1, { estimatedUnit: 1, residualUnit: "50%", quantity: 2, rate: 10 })] });
  assert.deepEqual(report.metrics, { records: 1, active: 1, branches: 1, total: 2, toDepreciate: 0.1, depreciated: 1, current: 1 });
});

test("PowerFx residual scientific percentages and currency retain pt-BR separators", () => {
  for (const [residualUnit, expected] of [["1,25e3", 1250], ["1.234,5E-1", 123.45], ["R$ 1.234,5e-1", 123.45],
    ["1,25e+2%", 1.25], ["-5e-1%", -0.005], ["R$ 1.234,567", 1234.567]]) {
    assert.equal(normalize({ assets: [row(1, { residualUnit })] }).assets[0].residualUnit, expected, residualUnit);
  }
});

test("PowerFx residual conversions preserve decimals below half a cent through repeated normalization", () => {
  for (const residualUnit of ["4,999999999999999999e-3", "0,4999999999999999999%", "R$ 0,004999999999999999999"]) {
    const snapshot = normalize(normalize({ assets: [row(1, { residualUnit, quantity: 1, rate: 100 })] }));
    const report = overview(snapshot);
    assert.equal(report.metrics.active, 1, residualUnit);
    assert.equal(report.metrics.current, 0, residualUnit);
    assert.equal(report.metrics.toDepreciate, 0, residualUnit);
  }
});

test("only invalid residual TEXT conversion falls back to zero including mixed currency and percent", () => {
  for (const residualUnit of ["R$ 50%", "$ 50", "1e", "1e2e3", "50%%", "NaN%", "1e999"]) {
    assert.equal(normalize({ assets: [row(1, { residualUnit })] }).assets[0].residualUnit, 0, residualUnit);
  }
  for (const field of ["estimatedUnit", "quantity", "rate"]) for (const value of ["1e3", "50%", "R$ 50%"])
    assert.throws(() => normalize({ assets: [row(1, { [field]: value })] }), /valor|numéric/i);
});

test("active counts positive unit residual even with zero quantity and negative amounts are not clamped", () => {
  const report = overview({ assets: [row(1, { quantity: 0 }), row(2, { residualUnit: -1, estimatedUnit: 0, quantity: 1, rate: 10 })] });
  assert.deepEqual(report.metrics, { records: 2, active: 1, branches: 1, total: 0, toDepreciate: -0.1, depreciated: 1, current: -1 });
});

test("blank numeric values coalesce to zero while residual invalid strings implement PowerFx IfError zero", () => {
  for (const value of [null, undefined, "", "  "]) {
    const report = overview({ assets: [row(1, { estimatedUnit: value, residualUnit: value, quantity: value, rate: value })] });
    assert.deepEqual(report.metrics, { records: 1, active: 0, branches: 1, total: 0, toDepreciate: 0, depreciated: 0, current: 0 });
  }
  for (const residualUnit of ["ISENTO", "R$ ???", "1,2,3", "NaN", "Infinity"]) {
    const report = overview({ assets: [row(1, { residualUnit })] });
    assert.equal(report.metrics.active, 0); assert.equal(report.metrics.current, 0);
    assert.equal(report.metrics.depreciated, 200); assert.equal(report.metrics.toDepreciate, 0);
  }
});

test("malformed populated estimated value quantity and rate reject even outside the report period", () => {
  for (const field of ["estimatedUnit", "quantity", "rate"]) for (const value of ["ISENTO", "1,2,3", "1.23,45", true, {}, [], NaN, Infinity]) {
    assert.throws(() => overview({ assets: [row(1, { depreciationDate: "2099-01-01", [field]: value })] }), /valor|número|numéric|campo/i);
  }
  for (const residualUnit of [NaN, Infinity, {}, [], true]) assert.throws(() => normalize({ assets: [row(1, { residualUnit })] }), /valor|numéric|campo/i);
});

test("strict ISO and Brazilian calendar dates retain the source day instead of shifting offsets to UTC", () => {
  const report = overview({ assets: [row(1, { depreciationDate: "2026-11-05T23:59:59.999-03:00" }),
    row(2, { depreciationDate: "2026-10-06T00:00:00+14:00" }), row(3, { depreciationDate: "05/10/2026" })] });
  assert.deepEqual(report.branches[0].assets.map(({ id, depreciationDate, dateTone }) => ({ id, depreciationDate, dateTone })), [
    { id: 3, depreciationDate: "2026-10-05", dateTone: "overdue" },
    { id: 2, depreciationDate: "2026-10-06", dateTone: "today" },
    { id: 1, depreciationDate: "2026-11-05", dateTone: "future" },
  ]);
});

test("thirty calendar days cross leap years year end and daylight-saving changes", () => {
  for (const [today, limitDate] of [["2024-01-30", "2024-02-29"], ["2023-01-30", "2023-03-01"],
    ["2024-02-29", "2024-03-30"], ["2026-12-20", "2027-01-19"], ["2024-03-01", "2024-03-31"]]) {
    const report = overview({ assets: [row(1, { depreciationDate: limitDate })] }, today);
    assert.equal(report.limitDate, limitDate); assert.equal(report.metrics.records, 1);
  }
});

test("device timezone cannot change calendar boundaries", () => {
  assert.equal(typeof model.buildDepreciationOverview, "function", "buildDepreciationOverview must be implemented");
  const url = new URL("../src/chat/depreciation-report-model.js", import.meta.url).href;
  const script = `import { buildDepreciationOverview } from ${JSON.stringify(url)}; console.log(JSON.stringify(buildDepreciationOverview({assets:${JSON.stringify([row(1, { depreciationDate: "2024-03-31T23:30:00-03:00" })])}},"2024-03-01")));`;
  for (const TZ of ["America/Sao_Paulo", "America/New_York", "Pacific/Kiritimati", "UTC"]) {
    const report = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }));
    assert.equal(report.limitDate, "2024-03-31"); assert.equal(report.metrics.records, 1);
    assert.equal(report.branches[0].assets[0].depreciationDate, "2024-03-31");
  }
});

test("invalid source dates and non-ISO today never silently become missing or normalized overflow dates", () => {
  for (const depreciationDate of ["2026-02-29", "31/04/2026", "2024-02-30", "2026-13-01", "6/10/2026",
    "2026-10-06garbage", "2026-10-06T24:00:00Z", "2026-10-06T00:60:00Z", "2026-10-06T00:00:00+25:00", 42, {}]) {
    assert.throws(() => normalize({ assets: [row(1, { depreciationDate })] }), /data|calendário/i);
  }
  for (const today of [undefined, null, "", "06/10/2026", "2026-02-29", "2026-10-06T00:00:00Z", new Date()]) {
    assert.throws(() => model.buildDepreciationOverview({ assets: [] }, today), /data|hoje|ISO/i);
  }
});

test("branches sort in pt-BR with SEM FILIAL and branch rows sort by date then unit residual descending", () => {
  const snapshot = { assets: [row(1, { branch: "Zebra", residualUnit: 2 }), row(2, { branch: "Água", residualUnit: 10 }),
    row(3, { branch: "Água", residualUnit: 5, depreciationDate: "2026-10-05" }), row(4, { branch: "Água", residualUnit: 20, quantity: 0.1 }),
    row(5, { branch: "  " }), row(6, { branch: "Beta" })] };
  const report = overview(snapshot);
  assert.deepEqual(report.branches.map(branch => branch.branch), ["Água", "Beta", "SEM FILIAL", "Zebra"]);
  assert.deepEqual(report.branches[0].assets.map(asset => asset.id), [3, 4, 2]);
  assert.deepEqual(normalize(snapshot).assets.map(asset => asset.id), [5, 6, 4, 2, 3, 1]);
});

test("empty base and no qualifying dates return explicit zero indicators and no branches", () => {
  for (const assets of [[], [row(1, { depreciationDate: null }), row(2, { depreciationDate: "2026-11-06" })]]) {
    assert.deepEqual(overview({ assets }), { today: "2026-10-06", limitDate: "2026-11-05",
      metrics: { records: 0, active: 0, branches: 0, total: 0, toDepreciate: 0, depreciated: 0, current: 0 }, branches: [] });
  }
});

test("partial snapshots missing row fields duplicate IDs and invalid scalar fields reject rather than fake zero", () => {
  for (const snapshot of [null, [], {}, { assets: null }, { assets: {} }, ...["partial", "incomplete", "truncated", "aborted", "error"].map(flag => ({ assets: [], [flag]: true })),
    { assets: [], complete: false }, { assets: [null] }, { assets: [row(0)] }, { assets: [row(1), row("01")] },
    { assets: [row(1, { branch: {} })] }, { assets: [row(1, { asset: ["A", "B"] })] }]) {
    assert.throws(() => normalize(snapshot), /snapshot|registro|campo|incomplet|duplic|ID/i);
  }
  for (const field of Object.keys(row(1))) {
    const incomplete = row(1); delete incomplete[field];
    assert.throws(() => normalize({ assets: [incomplete] }), /incomplet|campo/i);
  }
});

test("sparse row arrays and snapshots declaring a remaining cursor cannot become zero indicators", () => {
  for (const snapshot of [{ assets: Array(1) }, { assets: [row(1), , row(3)] }, { assets: [], hasMore: true },
    { assets: [], nextLink: "remaining-page" }]) {
    assert.throws(() => normalize(snapshot), /snapshot|registro|campo|incomplet/i);
  }
});

test("normalization and overview never mutate inputs and leave injection strings as plain data", () => {
  const markup = '<img src=x onerror="evil()"><script>evil()</script>';
  const source = { assets: [row(1, { branch: ` ${markup} `, patrimony: markup, group: markup, asset: markup }), row(2)] };
  const before = structuredClone(source);
  const snapshot = normalize(source); const report = overview(snapshot);
  assert.deepEqual(source, before); assert.equal(snapshot.assets[0].branch, markup);
  assert.equal(report.branches[0].assets[0].asset, markup);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.assets)); assert.ok(Object.isFrozen(snapshot.assets[0]));
  assert.ok(Object.isFrozen(report)); assert.ok(Object.isFrozen(report.metrics)); assert.ok(Object.isFrozen(report.branches));
  assert.ok(Object.isFrozen(report.branches[0])); assert.ok(Object.isFrozen(report.branches[0].assets[0]));
});
