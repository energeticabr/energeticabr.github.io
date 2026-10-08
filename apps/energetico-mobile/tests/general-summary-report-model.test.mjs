import test from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/chat/general-summary-report-model.js').catch(() => ({}));
const now = () => new Date('2026-10-08T02:59:59Z');
const zero = { dueToday: 0, overdue: 0, auditOrders: 0, quotes: 0, documents: 0,
  pendingTasks: 0, delegatedTasks: 0, activeContracts: 0, pendingPayments: 0,
  pendingDiaries: 0, commercialDocuments: 0, activePathologies: 0 };
const empty = () => ({ provisions: [], auditOrders: [], quotes: [], documents: [], tasks: [],
  delegatedTasks: [], contractors: [], presences: [], diaries: [], properties: [], pathologies: [] });
const build = (sources, options = {}) => {
  assert.equal(typeof model.buildGeneralSummaryReport, 'function', 'summary model must exist');
  return model.buildGeneralSummaryReport(sources, { now, ...options });
};

// Break caught: substituting any dashboard formula, distinct contracts, or prorated payroll.
test('all twelve PowerFx metrics have independently checked literal totals', () => {
  const snapshot = build({
    provisions: [
      { dueDate: '2026-10-07', paidDate: '' }, { dueDate: '2026-10-06', paidDate: null },
      { dueDate: '2026-10-08', paidDate: '' }, { dueDate: '', paidDate: '' },
      { dueDate: '2026-10-06', paidDate: '2026-10-07' },
    ],
    auditOrders: [{ status: ' pendente auditoria ' }, { status: 'PENDENTE' }],
    quotes: [{ status: 'ativa' }, { status: ' ATIVO ' }, { status: 'INATIVO' }],
    documents: [{ status: 'pendente' }, { status: 'SUBMETIDO' }],
    tasks: [{ status: 'atividade criada', identifiedAt: '2026-10-07' },
      { status: 'EM ATENDIMENTO', identifiedAt: '' }, { status: 'CONCLUÍDO', identifiedAt: '' }],
    delegatedTasks: [{ status: 'em atendimento' }, { status: 'ATIVIDADE CRIADA' }, { status: 'CONCLUIDO' }],
    contractors: [{ status: 'ativo', contractId: '9' }, { status: ' ATIVO ', contractId: '9' }, { status: 'INATIVO' }],
    presences: [{ presence: ' presente ', status: '', dailyValue: '120,50', hours: 1 },
      { presence: 'PRESENTE', status: 'PENDENTE', dailyValue: '80.25', hours: 20 },
      { presence: 'PRESENTE', status: 'pago', dailyValue: 999 },
      { presence: 'AUSENTE', status: '', dailyValue: 999 }, { presence: 'PRESENTE', status: null, dailyValue: null }],
    diaries: [{ status: 'pendente' }, { status: 'PENDENTE' }, { status: 'FECHADO' }],
    properties: [{ branch: 'A', property: '1', insurance: '', proposal: '', bankContract: '', deed: '', brokerDocument: '', fiscalDocument: '' },
      { branch: 'A', property: '2', insurance: '1', proposal: '1', bankContract: '1', deed: '1', brokerDocument: '1', fiscalDocument: '' },
      { branch: 'A', property: ' escritorio central ' }, { branch: 'A', property: 'todos' }, { branch: '', property: '3' }],
    pathologies: [{ status: 'ativo' }, { status: 'INATIVO' }],
  });
  assert.deepEqual(snapshot.metrics, { dueToday: 1, overdue: 1, auditOrders: 1, quotes: 2, documents: 1,
    pendingTasks: 2, delegatedTasks: 2, activeContracts: 2, pendingPayments: 200.75,
    pendingDiaries: 2, commercialDocuments: 7, activePathologies: 1 });
  assert.equal(snapshot.today, '2026-10-07');
  assert.equal(snapshot.updatedAt, '2026-10-08T02:59:59.000Z');
  assert.deepEqual(snapshot.warnings, []);
});

test('empty successful sources are zero while unavailable sources are null', () => {
  assert.deepEqual(build(empty()).metrics, zero);
  const snapshot = build({ ...empty(), provisions: null, presences: null });
  assert.deepEqual(snapshot.metrics, { ...zero, dueToday: null, overdue: null, pendingPayments: null });
  assert.ok(snapshot.warnings.some(w => /PROVIS/i.test(w)));
  assert.ok(snapshot.warnings.some(w => /DESCRITIVOPRESENCA/.test(w)));
  assert.equal(build({}).metrics.quotes, null);
});

test('today switches at midnight in Sao Paulo, three hours after UTC midnight', () => {
  const sources = { ...empty(), provisions: [{ dueDate: '2026-10-07', paidDate: '' }] };
  assert.equal(build(sources).metrics.dueToday, 1);
  const snapshot = build(sources, { now: () => new Date('2026-10-08T03:00:00Z') });
  assert.equal(snapshot.today, '2026-10-08');
  assert.equal(snapshot.metrics.overdue, 1);
  assert.equal(snapshot.metrics.dueToday, 0);
});

test('raw daily money sums exactly, with blank zero and malformed eligible money unknown', () => {
  const sources = { ...empty(), presences: [
    { presence: 'PRESENTE', status: '', dailyValue: 'R$ 1.234,56' },
    { presence: 'PRESENTE', status: '', dailyValue: '0.10' },
    { presence: 'PRESENTE', status: '', dailyValue: '0,20' },
    { presence: 'PRESENTE', status: '', dailyValue: ' ' },
    { presence: 'AUSENTE', status: '', dailyValue: 'bad' },
  ] };
  assert.equal(build(sources).metrics.pendingPayments, 1234.86);
  for (const value of ['12oops', '1.2.3', '1,23,4', '1e6', '1.234', Infinity, true, {}]) {
    const snapshot = build({ ...empty(), presences: [{ presence: 'PRESENTE', status: '', dailyValue: value }] });
    assert.equal(snapshot.metrics.pendingPayments, null, String(value));
    assert.match(snapshot.warnings.join(' '), /DESCRITIVOPRESENCA/);
  }
});

for (const field of ['insurance', 'proposal', 'bankContract', 'deed', 'brokerDocument', 'fiscalDocument']) {
  test(`commercial metric counts the missing ${field} independently of sale status`, () => {
    const row = { branch: 'A', property: '1', status: 'INATIVO', insurance: '1', proposal: '1',
      bankContract: '1', deed: '1', brokerDocument: '1', fiscalDocument: '1', [field]: ' ' };
    assert.equal(build({ ...empty(), properties: [row] }).metrics.commercialDocuments, 1);
  });
}

test('tasks sort by identification instant before the latest 2000 cap; delegated tasks have no cap', () => {
  const old = { id: '1', status: 'ATIVIDADE CRIADA', identifiedAt: '2020-01-01' };
  const newer = Array.from({ length: 1999 }, (_, i) => ({ id: String(i + 2), status: 'CONCLUÍDO', identifiedAt: '2026-10-07T12:00:00Z' }));
  const latest = { id: '2001', status: 'EM ATENDIMENTO', identifiedAt: '2026-10-07T23:00:00-03:00' };
  const snapshot = build({ ...empty(), tasks: [old, ...newer, latest],
    delegatedTasks: Array.from({ length: 2001 }, () => ({ status: 'ATIVIDADE CRIADA' })) });
  assert.equal(snapshot.metrics.pendingTasks, 1);
  assert.equal(snapshot.metrics.delegatedTasks, 2001);
  assert.match(snapshot.warnings.join(' '), /2000/);
  assert.match(snapshot.warnings.join(' '), /DATA IDENTIFICAÇÃO/);
  assert.deepEqual(build({ ...empty(), tasks: newer }).warnings, []);
});

test('invalid source calendar or structured status does not silently become zero', () => {
  const snapshot = build({ ...empty(), provisions: [{ dueDate: '2026-02-30', paidDate: '' }],
    tasks: [{ identifiedAt: 'invalid', status: 'ATIVIDADE CRIADA' }], quotes: [{ status: ['ATIVO', 'ATIVA'] }] });
  assert.equal(snapshot.metrics.dueToday, null);
  assert.equal(snapshot.metrics.overdue, null);
  assert.equal(snapshot.metrics.pendingTasks, null);
  assert.equal(snapshot.metrics.quotes, null);
  assert.equal(snapshot.metrics.documents, 0);
});

test('numeric lookup daily values remain unambiguous decimals and are not rounded per row', () => {
  const snapshot = build({ ...empty(), presences: [
    { presence: 'PRESENTE', status: '', dailyValue: { Value: 1.234 } },
    { presence: 'PRESENTE', status: '', dailyValue: 0.006 },
  ] });
  assert.equal(snapshot.metrics.pendingPayments, 1.24);
});

test('unambiguous thousands grouping and negative daily adjustments preserve the raw sum', () => {
  const snapshot = build({ ...empty(), presences: [
    { presence: 'PRESENTE', status: '', dailyValue: '1.234.567' },
    { presence: 'PRESENTE', status: '', dailyValue: '1,234,567' },
    { presence: 'PRESENTE', status: '', dailyValue: '1,234.50' },
    { presence: 'PRESENTE', status: '', dailyValue: '-0,50' },
  ] });
  assert.equal(snapshot.metrics.pendingPayments, 2470368);
});

test('large raw sums never silently lose cents when converted to the numeric contract', () => {
  for (const value of ['90071992547409.91', '90071992547409.92', '9007199254740990']) {
    const snapshot = build({ ...empty(), presences: [{ presence: 'PRESENTE', status: '', dailyValue: value }] });
    assert.equal(snapshot.metrics.pendingPayments, null, value);
    assert.match(snapshot.warnings.join(' '), /centavos|precisão/i);
  }
  assert.equal(build({ ...empty(), presences: [{ presence: 'PRESENTE', status: '', dailyValue: '-1234,56' }] }).metrics.pendingPayments, -1234.56);
});
