import test from 'node:test';
import assert from 'node:assert/strict';

const modelURL = new URL('../src/chat/pending-work-diaries-report-model.js', import.meta.url);
const model = await import(modelURL.href).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === modelURL.href) return {};
  throw error;
});

function report(snapshot) {
  assert.equal(typeof model.buildPendingWorkDiariesReport, 'function', 'buildPendingWorkDiariesReport must be implemented');
  return model.buildPendingWorkDiariesReport(snapshot);
}

const row = (id, extra = {}) => ({ id, date: '2026-10-07', branch: 'Obra A', status: 'PENDENTE', ...extra });

test('an explicitly empty complete snapshot produces an honest zero report', () => {
  assert.deepEqual(report({ rows: [], count: 0 }), { rows: [], pendingCount: 0, limited: false, countLabel: '0' });
});

test('only exact normalized PENDENTE statuses enter the numeric descending report', () => {
  const result = report({ rows: [row('2'), row('10', { status: ' pendente ' }), row(9),
    row(100, { status: 'POSTADO' }), row(99, { status: 'PENDÊNTE' }), row(98, { status: 'PENDENTES' }),
    row(97, { status: '<script>PENDENTE</script>' }), row(96, { status: '' })], count: 8 });
  assert.deepEqual(result, {
    rows: [
      { id: 10, date: '2026-10-07', dateLabel: '07/10/2026', branch: 'Obra A', status: 'PENDENTE' },
      { id: 9, date: '2026-10-07', dateLabel: '07/10/2026', branch: 'Obra A', status: 'PENDENTE' },
      { id: 2, date: '2026-10-07', dateLabel: '07/10/2026', branch: 'Obra A', status: 'PENDENTE' },
    ], pendingCount: 3, limited: false, countLabel: '3',
  });
});

test('calendar dates and timestamp instants format the normalized Brazilian day without another UTC shift', () => {
  for (const [date, wantDate, wantLabel] of [
    ['2026-10-07', '2026-10-07', '07/10/2026'],
    [' 07/10/2026 ', '2026-10-07', '07/10/2026'],
    ['2024-02-29', '2024-02-29', '29/02/2024'],
    ['2026-10-07T01:00:00Z', '2026-10-06', '06/10/2026'],
    ['2026-10-07T23:30:00-03:00', '2026-10-07', '07/10/2026'],
    ['2026-10-07T00:10:00+03:00', '2026-10-06', '06/10/2026'],
  ]) {
    const result = report({ rows: [row(1, { date })], count: 1 });
    assert.equal(result.rows.length, 1, date);
    const [actual] = result.rows;
    assert.equal(actual.date, wantDate, date);
    assert.equal(actual.dateLabel, wantLabel, date);
  }
});

test('missing and invalid dates remain visibly unknown rather than becoming today or rolling into another month', () => {
  for (const date of [null, undefined, '', 'garbage', '2026-02-29', '31/04/2026',
    '2026-02-30T12:00:00Z', '2026-10-07T25:00:00Z', '<img src=x onerror=evil()>']) {
    const result = report({ rows: [row(1, { date })], count: 1 });
    assert.equal(result.rows.length, 1, String(date));
    const [actual] = result.rows;
    assert.equal(actual.date, '', String(date));
    assert.equal(actual.dateLabel, '—', String(date));
  }
});

test('equivalent normalized IDs and report fields deduplicate before counting', () => {
  const result = report({ rows: [row('0002', { date: '07/10/2026', branch: ' Obra A ' }),
    row(2, { status: 'pendente' }), row(' 2 ', { responsible: 'Unused reminder field' }), row(10)], count: 4 });
  assert.deepEqual(result.rows.map(value => value.id), [10, 2]);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.countLabel, '2');
});

test('1999 unique pending rows retain the exact localized count', () => {
  const result = report({ rows: Array.from({ length: 1999 }, (_, index) => row(index + 1)), count: 1999 });
  assert.equal(result.rows.length, 1999);
  assert.equal(result.pendingCount, 1999);
  assert.equal(result.limited, false);
  assert.equal(result.countLabel, '1.999');
});

test('exactly 2000 unique pending rows hit the FirstN warning boundary', () => {
  const result = report({ rows: Array.from({ length: 2000 }, (_, index) => row(index + 1)), count: 2000 });
  assert.equal(result.rows.length, 2000);
  assert.equal(result.pendingCount, 2000);
  assert.equal(result.limited, true);
  assert.equal(result.countLabel, '⚠️ > 2.000');
});

test('more than 2000 pending rows retain the newest numeric IDs and the count before capping', () => {
  const rows = [row(99999, { status: 'POSTADO' }), ...Array.from({ length: 2001 }, (_, index) => row(String(index + 1)))];
  const result = report({ rows, count: 2002 });
  assert.equal(result.rows.length, 2000);
  assert.equal(result.rows[0].id, 2001);
  assert.equal(result.rows.at(-1).id, 2);
  assert.equal(result.pendingCount, 2001);
  assert.equal(result.limited, true);
  assert.equal(result.countLabel, '⚠️ > 2.000');
});

test('duplicate and non-pending rows cannot trigger the 2000 warning', () => {
  const rows = Array.from({ length: 2000 }, () => row(7));
  rows.push(row(8, { status: 'POSTADO' }));
  const result = report({ rows, count: 2001 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.limited, false);
  assert.equal(result.countLabel, '1');
});

test('malicious branch text remains a scalar for textContent and extra source fields are not exposed', () => {
  const payload = '<img src=x onerror="globalThis.stolen=true"> & <script>evil()</script>';
  const [actual] = report({ rows: [row(1, { branch: ` ${payload} `, responsible: { private: true } })], count: 1 }).rows;
  assert.deepEqual(actual, { id: 1, date: '2026-10-07', dateLabel: '07/10/2026', branch: payload, status: 'PENDENTE' });
});

test('numeric and absent branch values become plain scalar labels', () => {
  const result = report({ rows: [row(1, { branch: 123 }), row(2, { branch: null })], count: 2 });
  assert.deepEqual(result.rows.map(value => value.branch), ['', '123']);
});

test('report sorting and normalization preserve the frozen reminder snapshot and its original order', () => {
  const snapshot = Object.freeze({ rows: Object.freeze([Object.freeze(row('2')), Object.freeze(row('10'))]), count: 2 });
  const before = structuredClone(snapshot);
  const result = report(snapshot);
  assert.deepEqual(result.rows.map(value => value.id), [10, 2]);
  assert.deepEqual(snapshot, before);
  assert.notEqual(result.rows, snapshot.rows);
});

test('malformed or explicitly incomplete snapshots throw instead of fabricating zero', () => {
  for (const snapshot of [null, undefined, [], {}, { rows: null, count: 0 }, { rows: [] },
    { rows: [], count: -1 }, { rows: [], count: NaN }, { rows: [], count: Infinity },
    { rows: [], count: '0' }, { rows: [], count: 0.5 }, { rows: [], count: 1 },
    { rows: [row(1)], count: 0 }, { rows: [row(1)], count: 2000 },
    ...['partial', 'incomplete', 'truncated', 'aborted', 'error', 'hasMore'].map(flag => ({ rows: [], count: 0, [flag]: true })),
    { rows: [], count: 0, nextLink: 'next' }, { rows: [], count: 0, complete: false }]) {
    assert.throws(() => report(snapshot), /snapshot|incompleto|contagem/i);
  }
});

test('malformed rows sparse arrays and missing source fields throw before filtering', () => {
  for (const invalid of [null, undefined, [], 'row', {}, ...['id', 'date', 'branch', 'status'].map(field => {
    const missing = row(1); delete missing[field]; return missing;
  })]) {
    assert.throws(() => report({ rows: [invalid], count: 1 }), /registro|campo/i);
  }
  assert.throws(() => report({ rows: Array(1), count: 1 }), /registro|campo/i);
});

test('IDs must be positive safe integer scalars even for non-pending records', () => {
  for (const id of [null, undefined, '', ' ', 0, '000', -1, '-1', 1.5, '1.5', '1e3', '0x10',
    NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '9007199254740992', true, {}, [], '<script>1</script>']) {
    assert.throws(() => report({ rows: [row(id, { status: 'POSTADO' })], count: 1 }), /ID/i);
  }
});

test('conflicting duplicates reject instead of silently overwriting pending details or status', () => {
  for (const conflict of [{ branch: 'Obra B' }, { date: '2026-10-08' }, { status: 'POSTADO' }]) {
    for (const rows of [[row('01'), row(1, conflict)], [row(1, conflict), row('01')]]) {
      assert.throws(() => report({ rows, count: 2 }), /duplic|conflit/i);
    }
  }
});

test('structured or non-finite scalar fields reject without invoking attacker coercion', () => {
  const hostile = { toString() { throw new Error('attacker coercion executed'); } };
  for (const [field, invalidValues] of [
    ['branch', [hostile, { LookupValue: 'Obra A' }, [], true, NaN, Infinity]],
    ['status', [hostile, { Value: 'PENDENTE' }, ['PENDENTE'], null, undefined, true, 123]],
    ['date', [hostile, {}, [], true, 123]],
  ]) {
    for (const value of invalidValues) {
      assert.throws(() => report({ rows: [row(1, { [field]: value })], count: 1 }), /campo|data|status/i);
    }
  }
  assert.throws(() => report({ rows: [row(hostile)], count: 1 }), /ID/i);
});

test('invalid records beyond the FirstN cap cannot be hidden by truncation', () => {
  const rows = [...Array.from({ length: 2000 }, (_, index) => row(index + 2)), row('bad')];
  assert.throws(() => report({ rows, count: 2001 }), /ID/i);
});
