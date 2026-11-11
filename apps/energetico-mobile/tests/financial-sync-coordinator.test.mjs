import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinancialSyncCoordinator } from '../src/chat/financial-sync-coordinator.js';

function source(failure) {
  let state = { running: false, latest: null }; const listeners = new Set();
  const item = { starts: 0, get running() { return state.running; },
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    update(next) { state = next; for (const fn of listeners) fn(state); },
    async start() { item.starts++; if (failure) throw Error('Fonte indisponível'); item.update({ running: true, latest: { requestId: 'a'.repeat(32), status: 'running' } }); },
  }; return item;
}
for (const trigger of ['sicoob', 'dda', 'fiscal']) test(`${trigger} starts all sources and coalesces repeated clicks`, async () => {
  const sources = { sicoob: source(), dda: source(), fiscal: source() };
  const group = createFinancialSyncCoordinator(sources);
  try {
    await Promise.all([group.forSource(trigger).start(), group.forSource('dda').start()]);
    assert.deepEqual(Object.values(sources).map(s => s.starts), [1, 1, 1]);
    let snapshot; group.forSource('sicoob').subscribe(value => { snapshot = value; });
    sources.sicoob.update({ running: false, latest: { requestId: 'a'.repeat(32), status: 'succeeded' } });
    assert.equal(snapshot.running, false);
    assert.equal(snapshot.anyRunning, true);
    assert.equal(snapshot.sourceRunning, false);
    assert.equal(snapshot.latest.status, 'succeeded');
    assert.match(snapshot.notice, /Transações.*concluída/);
    await group.forSource('sicoob').start();
    assert.deepEqual(Object.values(sources).map(s => s.starts), [2, 1, 1]);
  } finally { group.destroy(); }
});
test('one source start failure does not stop other collectors and remains visible', async () => {
  const sources = { sicoob: source(true), dda: source(), fiscal: source() };
  const group = createFinancialSyncCoordinator(sources); let state;
  group.forSource('dda').subscribe(value => { state = value; });
  try {
    assert.deepEqual(await group.forSource('dda').start(), { startWarning:'Consulta não iniciada: Transações Sicoob.' });
    assert.deepEqual(Object.values(sources).map(s => s.starts), [1, 1, 1]);
    assert.match(state.notice, /Transações.*indisponível/);
    assert.equal(state.running, true);
  } finally { group.destroy(); }
});
test('disposed coordinator cannot start a collection in the old account', async () => {
  const sources = { sicoob: source(), dda: source(), fiscal: source() };
  const group = createFinancialSyncCoordinator(sources); group.destroy();
  await assert.rejects(group.forSource('dda').start(), /Sessão encerrada/);
  assert.deepEqual(Object.values(sources).map(s => s.starts), [0, 0, 0]);
});
