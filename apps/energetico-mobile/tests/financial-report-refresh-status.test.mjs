import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFinancialSyncCoordinator } from '../src/chat/financial-sync-coordinator.js';
import { createDdaReportView } from '../src/ui/dda-report-view.js';
import { createNfeReportView } from '../src/ui/nfe-report-view.js';
import { createSicoobTransactionReportView } from '../src/ui/sicoob-transaction-report-view.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function source() {
  const listeners = new Set();
  let state = { running:false, latest:null };
  const emit = (status, running) => {
    state = { running, latest:status && { status } };
    for (const listener of listeners) listener(state);
  };
  return {
    failStart:false,
    emit,
    async start() {
      if (this.failStart) throw Error('Falha ao iniciar');
      emit('running', true);
    },
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  };
}

for (const [key, create, grid, terminal] of [
  ['dda', createDdaReportView, '.ddr-summary', 'failed'],
  ['fiscal', createNfeReportView, '.nfe-metrics', 'partial'],
  ['sicoob', createSicoobTransactionReportView, '.ddr-summary', 'failed'],
]) test(`${key} shows its own manual refresh in the measurements until it finishes`, async t => {
  const dom = new JSDOM('<body><main id="app"></main></body>');
  const sources = { dda:source(), fiscal:source(), sicoob:source() };
  const group = createFinancialSyncCoordinator(sources);
  const current = sources[key];
  let read;
  const report = create({ document:dom.window.document, data:{ loadSnapshot:() => read?.() ?? Promise.resolve({ rows:[] }) },
    syncMonitor:group.forSource(key) });
  t.after(() => { report.destroy(); group.destroy(); dom.window.close(); });
  const status = () => report.element.querySelector(`${grid} > [data-report-refresh-status]:not([hidden]) [data-refresh-status-label]`);
  const refresh = () => report.element.querySelector('.pl-refresh').click();
  await report.open();
  assert.equal(status(), null);
  refresh();
  assert.equal(status()?.textContent, 'ATUALIZAÇÃO EM ANDAMENTO');
  await flush();
  current.emit(key === 'fiscal' ? 'waiting' : 'queued', true);
  assert.equal(status()?.textContent, 'ATUALIZAÇÃO EM ANDAMENTO');
  let finish;
  read = () => new Promise(resolve => { finish = resolve; });
  current.emit('succeeded', false);
  assert.equal(status()?.textContent, 'ATUALIZAÇÃO EM ANDAMENTO');
  read = null;
  finish({ rows:[] });
  await flush();
  assert.equal(status()?.textContent, 'SUCESSO EM ATUALIZAR');
  current.emit(null, false); // Acknowledging the receipt does not remove the card.
  report.close();
  await report.open();
  assert.equal(status()?.textContent, 'SUCESSO EM ATUALIZAR');
  refresh();
  await flush();
  current.emit(terminal, false);
  await flush();
  assert.equal(status()?.textContent, 'ERRO AO ATUALIZAR');

  refresh();
  await flush();
  read = async () => { throw Error('Falha na leitura'); };
  current.emit('succeeded', false);
  await flush();
  assert.equal(status()?.textContent, 'ERRO AO ATUALIZAR');
  read = null;

  current.failStart = true;
  refresh();
  assert.equal(status()?.textContent, 'ATUALIZAÇÃO EM ANDAMENTO');
  await flush();
  assert.equal(status()?.textContent, 'ERRO AO ATUALIZAR');
});

test('DDA keeps the card during a manual report reload without a sync monitor', async t => {
  const dom = new JSDOM('<body><main id="app"></main></body>');
  let rejectReload;
  const report = createDdaReportView({ document:dom.window.document, data:{
    loadSnapshot:() => rejectReload === undefined
      ? Promise.resolve({ rows:[] }) : new Promise((resolve, reject) => { rejectReload = reject; }),
  } });
  t.after(() => { report.destroy(); dom.window.close(); });
  await report.open();
  rejectReload = null;
  report.element.querySelector('.pl-refresh').click();
  const status = () => report.element.querySelector('.ddr-summary > [data-report-refresh-status]');
  assert.equal(status()?.textContent, 'ATUALIZAÇÃO EM ANDAMENTO');
  rejectReload(Error('Falha na leitura'));
  await flush();
  assert.equal(status()?.textContent, 'ERRO AO ATUALIZAR');
});
