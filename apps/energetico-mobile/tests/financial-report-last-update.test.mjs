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
    [{ id:'1', fields:{ ORIGEMMOVIMENTACAO:'SICOOB', Created:'2026-11-10T16:10:00Z', Modified:'2026-11-12T12:00:00Z' } }], '10/11/2026, 13:10'],
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
  assert.match(metric().textContent, /Última atualização/);
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
