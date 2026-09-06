import test from 'node:test';
import assert from 'node:assert/strict';

function storageHarness() {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); writes.push([key, value]); }, removeItem: key => values.delete(key) };
}

test('browser checkpoint survives new instance, stores only preview fields, and scopes by account', async () => {
  const { createRecoveryStorage } = await import('../src/web/recovery-storage.js');
  const storage = storageHarness(), first = createRecoveryStorage({ storage });
  first.schedule('account-1', { activeFlow: { id: 'diary', title: 'Diário', contextId: 'abc', rows: [{ label: 'OBRA', value: 'Obra A', secret: 'DO_NOT_STORE' }] },
    question: 'Qual a data?', draft: '06/09', pendingNames: ['foto.jpg'], uncertain: false,
    token: 'DO_NOT_STORE', messages: [{ mediaUrl: 'DO_NOT_STORE' }], pendingFiles: [{ file: new Blob(['DO_NOT_STORE']) }] });
  assert.equal(storage.writes.length, 0);
  assert.equal(first.flush(), true);
  const second = createRecoveryStorage({ storage });
  const saved = second.read('account-1');
  assert.equal(saved.draft, '06/09');
  assert.deepEqual(saved.activeFlow.rows, [{ label: 'OBRA', value: 'Obra A' }]);
  assert.deepEqual(saved.pendingNames, ['foto.jpg']);
  assert.equal(second.read('account-2'), null);
  assert.doesNotMatch(storage.writes[0][1], /DO_NOT_STORE/);
});

test('rapid typing is coalesced without losing newest text; clear cancels delayed rewrite', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { createRecoveryStorage } = await import('../src/web/recovery-storage.js');
  const storage = storageHarness(), recovery = createRecoveryStorage({ storage, delayMs: 250 });
  for (let i = 0; i < 200; i++) recovery.schedule('a1', { draft: 'a'.repeat(i + 1) });
  assert.equal(storage.writes.length, 0); t.mock.timers.tick(250);
  assert.equal(storage.writes.length, 1);
  assert.equal(recovery.read('a1').draft.length, 200);
  recovery.schedule('a1', { draft: 'removed' }); recovery.clear('a1'); t.mock.timers.tick(250);
  assert.equal(recovery.read('a1'), null);
});

test('blocked storage warns without crashing and corrupt records are ignored', async () => {
  const { createRecoveryStorage } = await import('../src/web/recovery-storage.js');
  const storage = storageHarness(), recovery = createRecoveryStorage({ storage });
  recovery.schedule('a1', { draft: 'keep' }); recovery.flush();
  const key = storage.writes[0][0];
  for (const malformed of ['{broken', JSON.stringify({ version: 999, draft: 'old' }), JSON.stringify({ version: 1, activeFlow: { rows: 'bad' } })]) {
    storage.values.set(key, malformed); assert.equal(recovery.read('a1'), null);
  }
  const notices = [];
  const blocked = createRecoveryStorage({ storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } } });
  blocked.subscribe(ok => notices.push(ok));
  assert.equal(blocked.read('a1'), null);
  blocked.schedule('a1', { draft: 'unsaved' });
  assert.equal(blocked.flush(), false);
  assert.equal(notices.at(-1), false);
});

test('orphan draft remains recoverable across reload but cannot contain nested checkpoints or media URLs', async () => {
  const { createRecoveryStorage } = await import('../src/web/recovery-storage.js');
  const storage = storageHarness(), recovery = createRecoveryStorage({ storage });
  recovery.schedule('a1', { draft: 'new', reference: { draft: 'old', uncertain: true, reference: { token: 'NEVER' }, mediaUrl: 'NEVER' } });
  recovery.flush();
  assert.equal(recovery.read('a1').reference.draft, 'old');
  assert.equal(recovery.read('a1').reference.uncertain, true);
  assert.doesNotMatch(storage.writes[0][1], /NEVER/);
});
