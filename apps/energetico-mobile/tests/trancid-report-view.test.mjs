import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { createTrancidReportView } = await import('../src/ui/trancid-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const normalized = node => node.textContent.replace(/\s+/g, ' ');
const report = (month = '2026-11') => ({
  month, months: ['2025-12', '2026-10', '2026-11'], lastCheckedAt: '2026-11-06T18:00:00Z', lastError: null,
  totalCents: 7999, lowCount: 2,
  cards: [
    { card: '12345678901234', supplier: 'ANA FORNECEDORA', balanceCents: 3999, low: true, observedAt: '2026-11-06T18:00:00Z',
      history: [{ date: `${month}-01`, balanceCents: 5000, variationCents: -625, status: 'observed', checkedAt: `${month}-01T18:00:00Z` },
        { date: `${month}-02`, balanceCents: null, variationCents: null, status: 'unavailable', checkedAt: null },
        { date: `${month}-03`, balanceCents: 5000, variationCents: null, status: 'observed', checkedAt: `${month}-03T18:00:00Z` },
        { date: `${month}-04`, balanceCents: 5000, variationCents: 0, status: 'observed', checkedAt: `${month}-04T18:00:00Z` }] },
    { card: '22345678901234', supplier: 'LIMIAR EXATO', balanceCents: 4000, low: false, observedAt: '2026-11-06T18:00:00Z', history: [] },
    { card: '32345678901234', supplier: 'SALDO ZERADO', balanceCents: 0, low: true, observedAt: '2026-11-06T18:00:00Z', history: [] },
    { card: '42345678901234', supplier: 'SEM CONSULTA', balanceCents: null, low: false, observedAt: null, history: [] },
  ],
});
function setup(t, loadReport = async ({ month }) => report(month || '2026-11')) {
  assert.equal(typeof createTrancidReportView, 'function', 'A fábrica do relatório Trancid deve existir');
  const dom = new JSDOM('<!doctype html><body><main id="app"><button id="trigger">Trancid</button></main></body>');
  let closes = 0;
  const view = createTrancidReportView({ document: dom.window.document, loadReport, onClose: () => closes++ });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, doc: dom.window.document, view, root: view.element, closes: () => closes };
}
function change(ctx, name, value) {
  const control = ctx.root.querySelector(`[name="${name}"]`); control.value = value;
  control.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
}

// Break caught: values at/under the threshold share the wrong color, or a null balance is coerced to zero.
test('current card positions keep every card digit and flag only balances strictly below forty reais', async t => {
  const ctx = setup(t); assert.equal(await ctx.view.open({ initialSnapshot: report() }), true);
  assert.equal(ctx.root.hidden, false);
  const cards = [...ctx.root.querySelectorAll('[data-trancid-card]')]; assert.equal(cards.length, 4);
  assert.match(normalized(cards[0]), /ANA FORNECEDORA/); assert.match(normalized(cards[0]), /12345678901234/);
  assert.match(normalized(cards[0].querySelector('.trancid-balance')), /R\$ 39,99/);
  assert.deepEqual(cards.map(card => card.querySelector('.trancid-balance').classList.contains('trancid-balance--low')), [true, false, true, false]);
  assert.match(normalized(cards[1].querySelector('.trancid-balance')), /R\$ 40,00/);
  assert.match(normalized(cards[2].querySelector('.trancid-balance')), /R\$ 0,00/);
  assert.match(normalized(cards[3].querySelector('.trancid-balance')), /Indisponível/);
  assert.match(normalized(ctx.root.querySelector('.trancid-alert')), /2 cart[õo]es/);
});

// Break caught: missing balances/deltas display as zero, or a non-selected history date leaks into the month.
test('expanded daily history distinguishes missing observations from a recorded zero variation', async t => {
  const ctx = setup(t), initial = report(); initial.cards[0].history.push({ date: '2026-10-31', balanceCents: 5625, variationCents: 0, status: 'observed', checkedAt: null });
  await ctx.view.open({ initialSnapshot: initial });
  const details = ctx.root.querySelector('details'); details.open = true;
  const rows = [...details.querySelectorAll('[data-history-date]')];
  assert.deepEqual(rows.map(row => row.dataset.historyDate), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.match(normalized(rows[0]), /01\/11\/2026/); assert.match(normalized(rows[0]), /-R\$ 6,25/);
  assert.match(normalized(rows[1].querySelector('[data-history-balance]')), /Indisponível/);
  assert.match(normalized(rows[1].querySelector('[data-history-variation]')), /Sem comparação/);
  assert.match(normalized(rows[2].querySelector('[data-history-variation]')), /Sem comparação/);
  assert.match(normalized(rows[3].querySelector('[data-history-variation]')), /R\$ 0,00/);
});

// Break caught: changing DATA replaces the current balance with an old balance or collapses the user's card.
test('month and year filter only history and preserve expanded cards through refresh', async t => {
  const calls = [], ctx = setup(t, async options => { calls.push(options); return report(options.month); });
  await ctx.view.open({ initialSnapshot: report() }); ctx.root.querySelector('details').open = true;
  change(ctx, 'month', '10'); await tick();
  assert.equal(calls.at(-1).month, '2026-10'); assert.equal(calls.at(-1).refresh, false);
  assert.equal(ctx.root.querySelector('details').open, true);
  assert.match(normalized(ctx.root.querySelector('.trancid-balance')), /R\$ 39,99/);
  assert.deepEqual([...ctx.root.querySelectorAll('[data-history-date]')].map(row => row.dataset.historyDate), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  change(ctx, 'year', '2025'); await tick();
  assert.equal(calls.at(-1).month, '2025-10');
  ctx.root.querySelector('[data-action="refresh-trancid-report"]').click(); await tick();
  assert.equal(calls.at(-1).refresh, true); assert.equal(calls.at(-1).month, '2025-10');
  assert.equal(ctx.root.querySelector('details').open, true);
});

// Break caught: late responses win over the current filter or repopulate closed/private report contents.
test('new filters and close abort stale requests and ignore late responses', async t => {
  const pending = [], ctx = setup(t, options => new Promise(resolve => pending.push({ ...options, resolve })));
  await ctx.view.open({ initialSnapshot: report() });
  change(ctx, 'month', '10'); await tick(); change(ctx, 'month', '11'); await tick();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(report('2026-11')); await tick();
  const obsolete = report('2026-10'); obsolete.cards[0].supplier = 'RESPOSTA OBSOLETA'; pending[0].resolve(obsolete); await tick();
  assert.doesNotMatch(ctx.root.textContent, /RESPOSTA OBSOLETA/);
  ctx.root.querySelector('[data-action="refresh-trancid-report"]').click(); await tick();
  ctx.view.close(); assert.equal(pending[2].signal.aborted, true);
  pending[2].resolve(obsolete); await tick();
  assert.equal(ctx.root.hidden, true); assert.equal(ctx.root.querySelectorAll('[data-trancid-card]').length, 0);
});

// Break caught: a collector failure silently shows fresh-looking balances or destroys still valid last positions.
test('failed updates expose stale position timestamps and can be retried without losing the last report', async t => {
  let fail = true; const ctx = setup(t, async () => { if (fail) throw new Error('sensitive upstream detail'); return report(); });
  const initial = report(); initial.lastError = { at: '2026-11-06T19:00:00Z', message: 'sensitive collector detail' };
  await ctx.view.open({ initialSnapshot: initial });
  assert.match(normalized(ctx.root.querySelector('.trancid-notice')), /[UÚuú]ltima consulta/);
  assert.match(normalized(ctx.root.querySelector('.trancid-updated')), /06\/11\/2026/);
  ctx.root.querySelector('[data-action="refresh-trancid-report"]').click(); await tick();
  assert.equal(ctx.root.querySelectorAll('[data-trancid-card]').length, 4);
  assert.match(normalized(ctx.root.querySelector('.trancid-notice')), /[Nn]ão foi possível/);
  assert.doesNotMatch(ctx.root.textContent, /sensitive/);
  fail = false; ctx.root.querySelector('[data-action="refresh-trancid-report"]').click(); await tick();
  assert.equal(ctx.root.getAttribute('aria-busy'), 'false'); assert.equal(ctx.root.querySelector('.trancid-notice').hidden, true);
});

// Break caught: API-provided names/IDs become markup rather than text.
test('supplier and card labels are literal text even when they contain markup', async t => {
  const ctx = setup(t), initial = report(); initial.cards[0].supplier = '<img src=x onerror=alert(1)>';
  initial.cards[0].card = '<script>bad()</script>';
  await ctx.view.open({ initialSnapshot: initial });
  assert.match(ctx.root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(ctx.root.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(ctx.root.querySelectorAll('script,img').length, 0);
});

// Break caught: keyboard escape leaves the page inert/locked or loses the triggering mascot's focus.
test('dialog traps keyboard focus and restores the trigger, scroll lock and callback on dismissal', async t => {
  const ctx = setup(t), trigger = ctx.doc.getElementById('trigger'); trigger.focus(); ctx.doc.body.style.overflow = 'auto';
  await ctx.view.open({ initialSnapshot: report() });
  assert.equal(ctx.doc.getElementById('app').inert, true); assert.equal(ctx.doc.body.style.overflow, 'hidden');
  const panel = ctx.root.querySelector('[role="dialog"]'); assert.equal(ctx.doc.activeElement, panel);
  panel.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(ctx.doc.activeElement, ctx.root.querySelector('button'));
  panel.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ctx.root.hidden, true); assert.equal(ctx.doc.activeElement, trigger);
  assert.equal(ctx.doc.getElementById('app').inert, false); assert.equal(ctx.doc.body.style.overflow, 'auto'); assert.equal(ctx.closes(), 1);
  ctx.view.close(); assert.equal(ctx.closes(), 1);
});

// Break caught: first-open failure removes the retry action or a never-resolving loader keeps open() pending after close.
test('first-open failures remain retryable and closing settles a pending open', async t => {
  let finish; const ctx = setup(t, () => new Promise(resolve => { finish = resolve; }));
  const opening = ctx.view.open(); await tick(); ctx.view.close();
  assert.equal(await opening, true); finish(report()); await tick(); assert.equal(ctx.root.hidden, true);
  const broken = setup(t, async () => { throw new Error('offline'); });
  assert.equal(await broken.view.open(), true);
  assert.equal(broken.root.querySelector('.trancid-notice').getAttribute('role'), 'alert');
  assert.equal(broken.root.querySelector('[data-action="refresh-trancid-report"]').disabled, false);
});

// Break caught: a finished load keeps displaying "Carregando" inside cards that have no observations.
test('completed empty histories stop claiming to load and closed reports remove retained financial values', async t => {
  const ctx = setup(t); await ctx.view.open();
  assert.doesNotMatch(ctx.root.querySelectorAll('details')[1].textContent, /Carregando/);
  assert.match(ctx.root.querySelectorAll('details')[1].textContent, /Nenhuma observação/);
  ctx.view.close();
  assert.equal(ctx.root.querySelector('.trancid-total').textContent, '');
  assert.equal(ctx.root.querySelector('.trancid-alert').textContent, '');
});

// Break caught: Helvetica silently removes an unsupported minus glyph, changing a negative variation into a positive amount in the PDF.
test('exported PDF preserves the negative variation sign and every card digit', async t => {
  const ctx = setup(t); await ctx.view.open({ initialSnapshot: report() });
  const { captureFilteredReport } = await import('../src/ui/report-print.js');
  const { buildFilteredReportPdf } = await import('../src/chat/filtered-report-pdf.js');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const blob = await buildFilteredReportPdf(captureFilteredReport(ctx.root));
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  t.after(() => task.destroy());
  const pdf = await task.promise, text = [];
  for (let page = 1; page <= pdf.numPages; page++) text.push(...(await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str));
  assert.match(text.join(' '), /-R\$\s*6,25/);
  assert.match(text.join(' '), /12345678901234/);
});

test('daily history also highlights balances below forty, including zero and negative amounts',async t=>{
 const ctx=setup(t),data=report();data.cards[0].history=[3999,4000,0,-100].map((balanceCents,index)=>({date:`2026-11-0${index+1}`,balanceCents,variationCents:null,status:'observed'}));
 await ctx.view.open({initialSnapshot:data});assert.deepEqual([...ctx.root.querySelectorAll('[data-trancid-card]:first-child [data-history-balance]')].map(cell=>cell.classList.contains('trancid-balance--low')),[true,false,true,true]);
});
