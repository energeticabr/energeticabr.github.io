import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { resumeConversation } from '../src/chat/resume-conversation.js';

test('reconnection retries only the empty current-question command, even without a parent signal', async () => {
  const bodies = [];
  const result = await resumeConversation({ sendText: async body => {
    bodies.push(body);
    if (bodies.length === 1) throw new TypeError('Load failed');
    return { status: 'processed', messages: [] };
  } }, { retryDelay: async () => {} });
  assert.equal(result.status, 'processed');
  assert.deepEqual(bodies, [{ text: '', replyId: 'input_continue' }, { text: '', replyId: 'input_continue' }]);
});

test('authentication and throttling failures do not cause automatic reconnection retries', async () => {
  for (const status of [401, 403, 429]) {
    let requests = 0;
    const error = Object.assign(new Error('synthetic refusal'), { status });
    await assert.rejects(resumeConversation({ sendText: async () => { requests++; throw error; } }), value => value === error);
    assert.equal(requests, 1);
  }
});

test('advancing PDF evidence keeps the inactivity deadline alive and is followed by one resume', async () => {
  let resumes = 0, aborted = false;
  const result = await resumeConversation({
    waitForDiaryEvidence: async ({ signal, onProgress }) => {
      for (const percent of [10, 20, 30, 40]) {
        await delay(10); onProgress({ requestId: 'pdf', stage: 'photos', percent });
      }
      aborted = signal.aborted;
    },
    sendText: async () => { resumes++; return 'restored'; },
  }, { timeoutMs: 30, maxWaitMs: 30, retryDelay: async () => {} });
  assert.equal(result, 'restored');
  assert.equal(resumes, 1);
  assert.equal(aborted, false);
});

test('unchanged evidence cannot keep a hung preflight alive forever or dispatch a flow command', async () => {
  let reads = 0, commands = 0;
  const intervals = [];
  try {
    await assert.rejects(resumeConversation({
      waitForDiaryEvidence: ({ signal, onProgress }) => {
        reads++;
        const interval = setInterval(() => onProgress({ requestId: 'pdf', stage: 'photos', percent: 10 }), 5);
        intervals.push(interval); signal.addEventListener('abort', () => clearInterval(interval), { once: true });
        return new Promise(() => {});
      },
      sendText: async () => { commands++; },
    }, { timeoutMs: 20, retryDelay: async () => {} }), error => error.code === 'RESUME_CONNECTION_FAILED');
    assert.equal(reads, 3);
    assert.equal(commands, 0);
  } finally { intervals.forEach(clearInterval); }
});

test('sign-out during backoff cancels recovery immediately and cannot start another attempt', async () => {
  const abort = new AbortController(); let started, requests = 0;
  const waiting = new Promise(resolve => { started = resolve; });
  const pending = resumeConversation({ sendText: async () => { requests++; throw new TypeError('Load failed'); } }, {
    signal: abort.signal, retryDelay: () => { started(); return new Promise(() => {}); },
  });
  await waiting; abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('regressing PDF progress cannot extend the recovery watchdog indefinitely', async () => {
  const abort = new AbortController(); let reads = 0;
  const guard = setTimeout(() => abort.abort(), 500);
  try {
    await assert.rejects(resumeConversation({
      waitForDiaryEvidence: ({ signal, onProgress }) => {
        reads++; let alternate = false;
        const interval = setInterval(() => { alternate = !alternate; onProgress({ requestId: 'pdf', stage: 'photos', percent: alternate ? 10 : 11 }); }, 5);
        signal.addEventListener('abort', () => clearInterval(interval), { once: true });
        return new Promise(() => {});
      },
      sendText: async () => { throw new Error('must not reach the form'); },
    }, { signal: abort.signal, timeoutMs: 20, retryDelay: async () => {} }), error => error.code === 'RESUME_CONNECTION_FAILED');
    assert.equal(reads, 3);
  } finally { clearTimeout(guard); }
});

test('the total inactivity cap releases recovery when the VM request never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false, signal;
  const pending = resumeConversation({ sendText: (_body, options) => {
    signal = options.progressSignal; return new Promise(() => {});
  } }).then(() => { settled = true; return 'unexpected success'; }, error => { settled = true; return error.code; });
  await new Promise(setImmediate);
  t.mock.timers.tick(30_000); await new Promise(setImmediate);
  assert.equal(settled, true, 'all attempts share the established thirty-second inactivity budget');
  assert.equal(await pending, 'RESUME_TIMEOUT');
  assert.equal(signal.aborted, true);
});

test('the shared inactivity cap also cancels a pending retry delay', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let backoff = false, settled = false, requests = 0;
  const pending = resumeConversation({ sendText: () => { requests++; return new Promise(() => {}); } }, {
    timeoutMs: 20, maxWaitMs: 60, retryDelay: () => { backoff = true; return new Promise(() => {}); },
  }).catch(error => { settled = true; return error.code; });
  await new Promise(setImmediate); t.mock.timers.tick(20); await new Promise(setImmediate);
  assert.equal(backoff, true);
  assert.equal(settled, false);
  t.mock.timers.tick(40); await new Promise(setImmediate);
  assert.equal(settled, true);
  assert.equal(await pending, 'RESUME_TIMEOUT');
  assert.equal(requests, 1);
});
