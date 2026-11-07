import test from 'node:test';
import assert from 'node:assert/strict';
import { cards, run, failure, position, snapshot } from './fixtures/trancid-report.mjs';

const model = await import('../src/chat/trancid-report-model.js').catch(() => ({}));
const build = (...args) => {
  assert.equal(typeof model.buildTrancidReport, 'function', 'Trancid report builder must exist');
  return model.buildTrancidReport(...args);
};
const options = { month: '2026-11', now: '2026-11-06T12:00:00-03:00' };

test('current balances preserve all card digits and distinguish real zero from the strict R$40 threshold', () => {
  const result = build(snapshot(), options);
  assert.deepEqual(Object.keys(result).sort(), ['cards', 'lastCheckedAt', 'lastError', 'lowCount', 'month', 'months', 'totalCents']);
  assert.equal(result.totalCents, 12999);
  assert.equal(result.lowCount, 2);
  assert.deepEqual(result.cards.map(card => [card.card, card.supplier, card.balanceCents, card.low]), [
    [cards[0], 'Ana Exemplo', 5000, false], [cards[1], 'Bia Exemplo', 4000, false],
    [cards[2], 'Caio Exemplo', 3999, true], [cards[3], 'Davi Exemplo', 0, true],
  ]);
  assert.equal(result.lastCheckedAt, '2026-11-06T07:00:00-03:00');
  assert.equal(result.lastError, null);
  assert.deepEqual(result.cards[3].history, [{ date: '2026-11-06', balanceCents: 0,
    variationCents: null, status: 'observed', checkedAt: '2026-11-06T07:00:00-03:00' }]);
});

test('the authenticated snapshot supplies all four card IDs and the report orders them without a public ID allowlist', () => {
  const row = run(1, '2026-11-06T07:00:00-03:00');
  const body = JSON.parse(row.snapshot);
  const suppliedCards = ['10000000000004', '10000000000002', '10000000000001', '10000000000003'];
  body.balances.forEach((entry, index) => { entry.card = suppliedCards[index]; });
  row.snapshot = JSON.stringify(body);
  const result = build(snapshot([row]), options);
  assert.deepEqual(result.cards.map(entry => [entry.card, entry.supplier, entry.balanceCents]), [
    ['10000000000001', 'Caio Exemplo', 3999], ['10000000000002', 'Bia Exemplo', 4000],
    ['10000000000003', 'Davi Exemplo', 0], ['10000000000004', 'Ana Exemplo', 5000],
  ]);
  assert.equal(result.lowCount, 2); assert.equal(result.totalCents, 12999);
});

test('different successful-run card sets and extra or missing baseline cards reject the entire snapshot', () => {
  const first = run(1, '2026-11-05T07:00:00-03:00'), second = run(2, '2026-11-06T07:00:00-03:00');
  const body = JSON.parse(second.snapshot); body.balances[0].card = '00000000000105'; second.snapshot = JSON.stringify(body);
  assert.throws(() => build(snapshot([first, second]), options), TypeError);
  const extraPosition = position(1, null, '2026-11-06T07:00:00-03:00', 5000, { card: '00000000000105' });
  assert.throws(() => build(snapshot([first], [extraPosition]), options), TypeError);
  const missing = cards.slice(0, 3).map((card, index) => position(index + 1, null, '2026-11-06T07:00:00-03:00', 5000, { card }));
  assert.throws(() => build(snapshot([], missing), options), TypeError);
});

test('daily snapshots include unchanged balances and compare with the previous calendar day across months', () => {
  const data = snapshot([
    run(1, '2026-10-31T07:00:00-03:00', ['55,00', '40,00', '39,99', '0,00']),
    run(2, '2026-11-01T07:00:00-03:00'), run(3, '2026-11-02T07:00:00-03:00'),
  ]);
  const result = build(data, { month: '2026-11', now: '2026-11-02T10:00:00-03:00' });
  assert.deepEqual(result.cards[0].history, [
    { date: '2026-11-01', balanceCents: 5000, variationCents: -500, status: 'observed', checkedAt: '2026-11-01T07:00:00-03:00' },
    { date: '2026-11-02', balanceCents: 5000, variationCents: 0, status: 'observed', checkedAt: '2026-11-02T07:00:00-03:00' },
  ]);
  assert.deepEqual(result.months, ['2026-11', '2026-10']);
});

test('negative source balances and previous positions retain exact daily variation and trigger the below-R$40 warning', () => {
  const before = '2026-11-05T07:00:00-03:00', current = '2026-11-06T07:00:00-03:00';
  const data = snapshot([
    run(1, before, ['5,00', '-2,00', '0,00', '0,00']),
    run(2, current, ['-1,00', '-3,00', '0,00', '0,00']),
  ], [
    position(1, 1, before, 500),
    position(2, 2, current, -100, { previous_cents: 500, delta_cents: -600, kind: 'Alteração' }),
    position(3, 2, current, -300, { card: cards[1], employee: 'Bia Exemplo', previous_cents: -200,
      delta_cents: -100, kind: 'Alteração' }),
  ]);
  const result = build(data, options);
  assert.deepEqual(result.cards[0].history.map(day => [day.balanceCents, day.variationCents]), [[500, null], [-100, -600]]);
  assert.equal(result.cards[0].balanceCents, -100); assert.equal(result.cards[0].low, true);
  assert.equal(result.cards[1].history[1].variationCents, -100);
  assert.equal(result.totalCents, -400); assert.equal(result.lowCount, 4);
  assert.equal(model.validateTrancidSnapshot(data).positions[2].previous_cents, -200);
});

test('signed safe-cent limits remain exact, including totals whose intermediate sums exceed the number range', () => {
  const at = '2026-11-06T07:00:00-03:00';
  const minimum = build(snapshot([run(1, at, ['-90.071.992.547.409,91', '0,00', '0,00', '0,00'])]), options);
  assert.equal(minimum.cards[0].balanceCents, Number.MIN_SAFE_INTEGER);
  assert.equal(minimum.totalCents, Number.MIN_SAFE_INTEGER); assert.equal(minimum.cards[0].low, true);
  const cancelled = build(snapshot([run(1, at, ['90.071.992.547.409,91', '90.071.992.547.409,91',
    '-90.071.992.547.409,91', '-90.071.992.547.409,91'])]), options);
  assert.equal(cancelled.totalCents, 0); assert.equal(cancelled.lowCount, 2);
});

test('negative total underflow and unsafe signed daily differences reject rather than rounding centavos', () => {
  const at = '2026-11-06T07:00:00-03:00';
  assert.throws(() => build(snapshot([run(1, at, ['-90.071.992.547.409,91', '-0,01', '0,00', '0,00'])]), options), RangeError);
  assert.throws(() => build(snapshot([
    run(1, '2026-11-05T07:00:00-03:00', ['-90.071.992.547.409,91', '0,00', '0,00', '0,00']),
    run(2, at, ['90.071.992.547.409,91', '0,00', '0,00', '0,00']),
  ]), options), RangeError);
});

test('same-day initial and daily observations select latest checked_at, then the higher run ID on an exact tie', () => {
  const at = '2026-11-06T10:00:00.611765-03:00';
  const data = snapshot([
    run(3, at, ['70,00', '40,00', '39,99', '0,00']),
    run(1, '2026-11-06T07:00:00-03:00', ['80,00', '40,00', '39,99', '0,00'], { slot: 'initial:2026-11-06' }),
    run(2, at, ['75,00', '40,00', '39,99', '0,00']),
  ]);
  const result = build(data, options);
  assert.equal(result.cards[0].balanceCents, 7000);
  assert.equal(result.cards[0].history.length, 1);
  assert.equal(result.cards[0].observedAt, at);
  assert.equal(result.cards[0].history[0].variationCents, null);
});

test('missing and failed days stay unavailable and do not invent variations after a gap', () => {
  const result = build(snapshot([
    run(1, '2026-11-03T07:00:00-03:00'), failure(2, '2026-11-04T07:00:00-03:00'),
    run(3, '2026-11-05T07:00:00-03:00', ['45,00', '40,00', '39,99', '0,00']),
    failure(4, '2026-11-06T07:00:00-03:00'),
  ]), options);
  assert.deepEqual(result.cards[0].history.map(day => [day.date, day.balanceCents, day.variationCents, day.status, day.checkedAt]), [
    ['2026-11-03', 5000, null, 'observed', '2026-11-03T07:00:00-03:00'],
    ['2026-11-04', null, null, 'unavailable', null],
    ['2026-11-05', 4500, null, 'observed', '2026-11-05T07:00:00-03:00'],
    ['2026-11-06', null, null, 'unavailable', null],
  ]);
  assert.equal(result.lastError, 'Fonte temporariamente indisponível');
  assert.equal(result.lastCheckedAt, '2026-11-06T07:00:00-03:00');
  assert.equal(result.cards[0].observedAt, '2026-11-05T07:00:00-03:00');
  assert.equal(result.cards[0].balanceCents, 4500);
});

test('selecting an old month changes only history, retaining current balances and supplier names', () => {
  const latest = run(2, '2026-11-06T07:00:00-03:00', ['5,50', '40,00', '39,99', '0,00']);
  const parsed = JSON.parse(latest.snapshot); parsed.balances[0].employee = 'Ana Atual'; latest.snapshot = JSON.stringify(parsed);
  const result = build(snapshot([run(1, '2026-10-31T07:00:00-03:00'), latest]), { ...options, month: '2026-10' });
  assert.equal(result.cards[0].balanceCents, 550);
  assert.equal(result.cards[0].low, true);
  assert.equal(result.cards[0].supplier, 'Ana Atual');
  assert.deepEqual(result.cards[0].history.map(day => [day.date, day.balanceCents]), [['2026-10-31', 5000]]);
});

test('observation dates use São Paulo calendar and never the stale source report clock', () => {
  const row = run(1, '2026-11-02T01:00:00Z'); row.report_at = '2026-10-31T23:55:00-03:00';
  const body = JSON.parse(row.snapshot); body.report_generated_at = row.report_at; row.snapshot = JSON.stringify(body);
  const result = build(snapshot([row]), { month: '2026-11', now: '2026-11-02T01:30:00Z' });
  assert.deepEqual(result.cards[0].history.map(day => day.date), ['2026-11-01']);
});

test('initial positions retain a baseline when run snapshots are not yet present', () => {
  const at = '2026-11-06T07:00:00-03:00';
  const rows = cards.map((card, index) => position(index + 1, null, at, 4000, { card, employee: `Pessoa ${index + 1}` }));
  const result = build(snapshot([], rows), options);
  assert.equal(result.totalCents, 16000); assert.equal(result.lowCount, 0);
  assert.equal(result.cards[0].history[0].variationCents, null);
});

test('an error after a same-day success warns without erasing that observation; a later success clears it', () => {
  const rows = [run(1, '2026-11-06T07:00:00-03:00'), failure(2, '2026-11-06T08:00:00-03:00')];
  assert.equal(build(snapshot(rows), options).cards[0].history[0].status, 'observed');
  assert.ok(build(snapshot(rows), options).lastError);
  rows.push(run(3, '2026-11-06T09:00:00-03:00'));
  assert.equal(build(snapshot(rows), options).lastError, null);
});

test('Monitor permits multiple failed attempts and one successful attempt in the same date slot', () => {
  const slot = '2026-11-06';
  const rows = [
    run(1, '2026-11-05T07:00:00-03:00', undefined, { slot: 'initial:2026-11-05' }),
    { ...failure(2, '2026-11-06T07:00:00-03:00', 'Consulta indisponível'), slot },
    { ...failure(3, '2026-11-06T07:05:00-03:00', 'Consulta indisponível'), slot },
    run(4, '2026-11-06T07:10:00-03:00', ['45,00', '40,00', '39,99', '0,00'], { slot }),
  ];
  const result = build(snapshot(rows), options);
  assert.equal(result.lastError, null);
  assert.equal(result.cards[0].balanceCents, 4500);
  assert.deepEqual(result.cards[0].history.map(day => [day.date, day.balanceCents, day.variationCents]), [
    ['2026-11-05', 5000, null], ['2026-11-06', 4500, -500],
  ]);
  // Publication/logout failures can be recorded after the successful ingestion.
  rows.push({ ...failure(5, '2026-11-06T07:11:00-03:00', 'SAIDA: sessão indisponível'), slot },
    { ...failure(6, '2026-11-06T07:12:00-03:00', 'PUBLICACAO: conexão indisponível'), slot });
  const withFailures = build(snapshot(rows), options);
  assert.equal(withFailures.cards[0].balanceCents, 4500);
  assert.equal(withFailures.cards[0].history[1].status, 'observed');
  assert.equal(withFailures.lastError, 'PUBLICACAO: conexão indisponível');
  assert.equal(withFailures.lastCheckedAt, '2026-11-06T07:12:00-03:00');
  assert.equal(model.validateTrancidSnapshot(snapshot(rows)).runs.length, 6);
});

test('Monitor successful-slot uniqueness and unique run IDs still reject corrupted exports', () => {
  const first = run(1, '2026-11-06T07:00:00-03:00', undefined, { slot: '2026-11-06' });
  const second = run(2, '2026-11-06T08:00:00-03:00', undefined, { slot: '2026-11-06' });
  assert.throws(() => build(snapshot([first, second]), options), TypeError);
  assert.throws(() => build(snapshot([first, { ...failure(1, '2026-11-06T08:00:00-03:00'), slot: '2026-11-06' }]), options), TypeError);
});

test('incomplete, malformed, unsafe and duplicate money data rejects rather than becoming a low balance', () => {
  const mutations = [
    value => { value.runs[0].snapshot = '{'; },
    value => { const body = JSON.parse(value.runs[0].snapshot); body.balances.pop(); value.runs[0].snapshot = JSON.stringify(body); },
    value => { const body = JSON.parse(value.runs[0].snapshot); body.balances.push(body.balances[0]); value.runs[0].snapshot = JSON.stringify(body); },
    value => { const body = JSON.parse(value.runs[0].snapshot); body.balances[0].card = '0000000000010'; value.runs[0].snapshot = JSON.stringify(body); },
    ...[undefined, null, '', ' ', false, 0, '1.00', '1,001', 'abc', '90.071.992.547.409,92',
      '-90.071.992.547.409,92', '-', '--1,00', '+1,00', '-1.00', '-1,001'].map(balance => value => {
      const body = JSON.parse(value.runs[0].snapshot); body.balances[0].balance = balance; value.runs[0].snapshot = JSON.stringify(body);
    }),
    value => { value.positions = [position(1, 1, '2026-11-06T07:00:00-03:00', null)]; },
    value => { value.positions = [position(1, 1, '2026-11-06T07:00:00-03:00', Number.MAX_SAFE_INTEGER + 1)]; },
    value => { value.positions = [position(1, 1, '2026-11-06T07:00:00-03:00', Number.MIN_SAFE_INTEGER - 1)]; },
    value => { value.positions = [position(1, 1, '2026-11-06T07:00:00-03:00', 550)]; },
    value => { const row = position(1, 1, '2026-11-06T07:00:00-03:00'); value.positions = [row, { ...row, id: 2 }]; },
    value => { value.runs.push({ ...value.runs[0] }); },
    value => { value.runs[0].checked_at = '2026-11-06T07:00:00'; },
    value => { value.runs[0].checked_at = '2026-02-30T07:00:00-03:00'; },
    value => { value.money_unit = 'reais'; },
  ];
  for (const mutate of mutations) {
    const data = snapshot(); mutate(data);
    assert.throws(() => build(data, options), TypeError);
  }
});

test('safe individual money values still reject an unsafe total and invalid reference months', () => {
  const data = snapshot([run(1, '2026-11-06T07:00:00-03:00', ['90.071.992.547.409,91', '1,00', '1,00', '1,00'])]);
  assert.throws(() => build(data, options), RangeError);
  for (const month of ['2026-13', '2026-00', '26-11', '', null]) {
    assert.throws(() => build(snapshot(), { ...options, month }), TypeError);
  }
});
