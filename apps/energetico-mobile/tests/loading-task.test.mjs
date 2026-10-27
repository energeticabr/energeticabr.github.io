import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLoadingIndicator } from '../src/ui/loading-indicator.js';
import { beginLoadingTask } from '../src/ui/loading-task.js';

test('counts completed stages and measured acquisition units, without elapsed-time estimates', async () => {
  const seen = [];
  const task = beginLoadingTask(value => seen.push(value));
  task.prepared();
  task.report({ percent: 50 });
  task.report({ percent: 10 });
  task.acquired();
  assert.deepEqual(seen.map(value => value.percent), [0, 33, 50, 66]);
  assert.ok(seen.every(value => /etapas/i.test(value.progressLabel)));
  task.complete();
  assert.equal(seen.at(-1).percent, 100);
});

test('unknown byte totals retain the last confirmed stage instead of replacing it with unknown', () => {
  const seen = [], task = beginLoadingTask(value => seen.push(value.percent));
  task.prepared();
  task.report({ percent: null, loaded: 1234, total: null });
  task.report({ percent: NaN });
  assert.deepEqual(seen, [0, 33]);
  task.stop();
  task.complete();
  assert.deepEqual(seen, [0, 33]);
});

test('superseded loader operation ignores all late progress and completion', t => {
  const dom = new JSDOM(); t.after(() => dom.window.close());
  const root = createLoadingIndicator(dom.window.document, 'Carregando…');
  const first = beginLoadingTask(root); first.prepared();
  const second = beginLoadingTask(root); second.prepared(); second.report({ percent: 20 });
  first.complete(); first.report({ percent: 99 });
  assert.equal(root.querySelector('[role=progressbar]').textContent, '40%');
  second.acquired(); second.complete();
  assert.equal(root.querySelector('[role=progressbar]').textContent, '100%');
});

test('independent loaders never consume each other progress', t => {
  const dom = new JSDOM(); t.after(() => dom.window.close());
  const a = createLoadingIndicator(dom.window.document, 'Consulta');
  const b = createLoadingIndicator(dom.window.document, 'Prévia');
  const first = beginLoadingTask(a); const second = beginLoadingTask(b);
  first.prepared(); second.prepared(); second.acquired();
  assert.equal(a.querySelector('[role=progressbar]').textContent, '33%');
  assert.equal(b.querySelector('[role=progressbar]').textContent, '66%');
});

test('cancelled or stale tasks never finish and optional presentation cannot reject work', async () => {
  const controller = new AbortController(), seen = [];
  const task = beginLoadingTask(value => { seen.push(value.percent); throw new Error('UI only'); }, { signal: controller.signal });
  task.prepared(); controller.abort(); task.complete();
  assert.deepEqual(seen, [0, 33]);
  let current = true;
  const late = beginLoadingTask(value => seen.push(value.percent), { isCurrent: () => current });
  late.prepared(); current = false; late.acquired(); late.complete();
  assert.equal(seen.at(-1), 33);
});

test('run confirms acquisition then presentation and never claims 100 on validation failure', async () => {
  const seen = [], task = beginLoadingTask(value => seen.push(value.percent));
  await assert.rejects(task.run(async report => {
    report({ percent: 45 }); return { invalid: true };
  }, async () => { throw new Error('invalid result'); }), /invalid result/);
  assert.deepEqual(seen, [0, 33, 48, 66]);
  task.complete();
  assert.notEqual(seen.at(-1), 100);
});

test('run returns presented value and completes only once presentation resolves', async () => {
  const seen = [], task = beginLoadingTask(value => seen.push(value.percent));
  let present;
  const result = task.run(async () => 42, value => new Promise(resolve => { present = () => resolve(value + 1); }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.at(-1), 66);
  present();
  assert.equal(await result, 43);
  assert.equal(seen.at(-1), 100);
});

test('an asynchronous presentation observer cannot create an unhandled rejection', async () => {
  const task = beginLoadingTask(async () => { throw new Error('optional async observer'); });
  task.prepared(); task.acquired(); task.complete();
  await new Promise(resolve => setImmediate(resolve));
});
