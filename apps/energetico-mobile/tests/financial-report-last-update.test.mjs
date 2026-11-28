import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDdaReportView } from '../src/ui/dda-report-view.js';
import { createNfeReportView } from '../src/ui/nfe-report-view.js';
import { createSicoobTransactionReportView } from '../src/ui/sicoob-transaction-report-view.js';

for (const [name, create, grid, rows, initial] of [
  ['DDA', createDdaReportView, '.ddr-summary',
    [{ id:'1', fields:{ Title:'Exemplo', SITUACAO:'Em aberto', ULTIMA_CONSULTA:'2026-11-10T15:25:00Z' } }], '10/11/2026, 12:25'],
  ['Notas Fiscais', createNfeReportView, '.nfe-metrics', [], '—'],
  ['Sicoob', createSicoobTransactionReportView, '.ddr-summary',
    [{ id:'1', fields:{ ORIGEMMOVIMENTACAO:'SICOOB', Created:'2026-11-10T16:10:00Z', Modified:'2026-11-12T12:00:00Z' } }], '—'],
]) test(`${name} shows one last-update metric without polling text or future retry dates`, async t => {
  const dom = new JSDOM('<body><main id="app"></main></body>');
  let emit;
  const report = create({ document:dom.window.document, data:{ loadSnapshot:async () => ({ rows }) },
    syncMonitor:{ running:false, subscribe(fn) {
      emit = fn;
      fn({ running:false, notice:'Transações Sicoob: nenhuma consulta em andamento' });
      return () => {};
    } } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  const metric = () => report.element.querySelector(`${grid} > [data-report-last-update]`);
  const value = () => metric().querySelector('time').textContent;
  assert.ok(metric());
  assert.match(metric().textContent, name === 'Sicoob' ? /Última coleta concluída/ : /Última atualização/);
  assert.equal(value(), initial);
  const lastSuccessfulAt = Date.parse('2026-11-11T17:40:00Z');
  emit({ running:false, lastSuccessfulAt });
  assert.equal(value(), '11/11/2026, 14:40');
  emit({ running:true, lastSuccessfulAt, nextAllowedAt:Date.parse('2026-11-11T22:00:00Z'),
    notice:'NF-e: aguardando o intervalo obrigatório da fonte fiscal — próxima tentativa às 19:00' });
  assert.equal(value(), '11/11/2026, 14:40');
  assert.equal(report.element.querySelector('.pl-refresh').disabled, true);
  assert.doesNotMatch(report.element.textContent, /nenhuma consulta em andamento|intervalo obrigatório|19:00/);
  emit({ running:false, lastSuccessfulAt, latest:{ status:'failed', completedAt:Date.parse('2026-11-12T12:00:00Z') } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value(), '11/11/2026, 14:40');
  assert.equal(report.element.querySelectorAll(`${grid} > [data-report-last-update]`).length, 1);
});

for (const create of [createDdaReportView, createNfeReportView]) test(create.name + ' reads published update times while visible and keeps the newest confirmation', async t => {
  const dom = new JSDOM('<body><main id="app"></main></body>', { pretendToBeVisual:true });
  const { document } = dom.window;
  const earlier = Date.parse('2026-11-23T15:32:12Z');
  const automatic = Date.parse('2026-11-27T22:36:31Z');
  const manual = Date.parse('2026-11-27T23:41:12Z');
  let emit, finish, reads = 0;
  const rows = create === createDdaReportView
    ? [{ id:'1', fields:{ Title:'Exemplo', SITUACAO:'Em aberto', ULTIMA_CONSULTA:'2026-11-28T02:00:00Z' } }]
    : [];
  const report = create({ document, data:{ loadSnapshot:async () => ({ rows }) },
    loadLatestUpdate:() => { reads++; return new Promise(resolve => { finish = resolve; }); },
    syncMonitor:{ subscribe(listener) { emit = listener; listener({ lastSuccessfulAt:earlier }); } } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  const shown = () => report.element.querySelector('[data-report-last-update] time').dateTime;
  assert.equal(reads, 1);
  assert.equal(shown(), new Date(earlier).toISOString());
  finish(automatic);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shown(), new Date(automatic).toISOString());
  emit({ lastSuccessfulAt:manual });
  assert.equal(shown(), new Date(manual).toISOString());
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.equal(reads, 2);
  report.close();
  finish(Date.parse('2026-11-28T00:02:00Z'));
  await report.open();
  assert.equal(shown(), new Date(manual).toISOString());
  finish(automatic);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shown(), new Date(manual).toISOString());
});

test('the Sicoob update time advances immediately on a newer manual success after an automatic success', async t => {
  const dom = new JSDOM('<body><main id="app"></main></body>');
  const automatic = Date.parse('2026-11-27T22:36:31Z');
  const manual = Date.parse('2026-11-27T23:41:12Z');
  let emit;
  const report = createSicoobTransactionReportView({ document:dom.window.document,
    data:{ loadSnapshot:async () => ({ rows:[] }) },
    loadLatestAttempt:async () => ({ status:'succeeded', completedAt:automatic, lastSuccessfulAt:automatic }),
    syncMonitor:{ subscribe(listener) { emit = listener; listener({ running:false }); } } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  const shown = () => report.element.querySelector('[data-report-last-update] time').dateTime;
  assert.equal(shown(), new Date(automatic).toISOString());
  emit({ running:false, lastSuccessfulAt:manual });
  assert.equal(shown(), new Date(manual).toISOString());
});
