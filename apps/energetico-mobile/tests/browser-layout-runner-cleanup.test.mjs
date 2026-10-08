import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('./helpers/browser-layout-runner.mjs', import.meta.url), 'utf8');
const ownedPid = 424242;
const html = '<html data-layout="{&quot;ready&quot;:true}"><body>Measured</body></html>';

function fixture(t, { platform = 'win32', stubborn = false, forceFails = false, removalError, startupBusyAttempts = 0, startupError } = {}) {
  const child = new EventEmitter();
  Object.assign(child, { pid: ownedPid, exitCode: null, signalCode: null });
  const root = path.resolve('simulated-layout-tmp');
  const profile = path.join(root, 'energetico-layout-owned');
  const state = { exitObserved: false, removals: [], signals: [], commands: [], unsafe: [], socketsClosed: 0, endpointReads: 0 };
  const timers = new Set();
  const later = (callback, ms, ...args) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback(...args);
    }, Math.min(ms, 20));
    timers.add(timer);
    return timer;
  };
  const cancel = timer => { timers.delete(timer); clearTimeout(timer); };
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const delay = (ms, value, { signal } = {}) => new Promise((resolve, reject) => {
    const abort = () => {
      cancel(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
    };
    const timer = later(() => { signal?.removeEventListener('abort', abort); resolve(value); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
  const exit = signal => {
    if (state.exitObserved) return;
    child.exitCode = signal ? null : 0;
    child.signalCode = signal || null;
    state.exitObserved = true;
    child.emit('exit', child.exitCode, child.signalCode);
    child.emit('close', child.exitCode, child.signalCode);
  };
  const unsafe = detail => {
    state.unsafe.push(detail);
    throw new Error(`Unsafe process/filesystem operation: ${detail}`);
  };
  const kill = (pid, signal = 'SIGTERM') => {
    state.signals.push({ pid, signal });
    if (pid !== ownedPid || !['SIGTERM', 'SIGKILL'].includes(signal)) return unsafe(`kill ${pid} ${signal}`);
    if (!stubborn || (signal === 'SIGKILL' && !forceFails)) later(() => exit(signal), 5);
    return true;
  };
  child.kill = signal => kill(child.pid, signal);
  const execFile = (file, args, options, callback) => {
    if (typeof options === 'function') callback = options;
    state.commands.push({ file, args: [...args] });
    if (platform !== 'win32' || path.win32.basename(file).toLowerCase() !== 'taskkill.exe'
      && path.win32.basename(file).toLowerCase() !== 'taskkill') return unsafe(`execFile ${file}`);
    if (JSON.stringify(args) !== JSON.stringify(['/PID', String(ownedPid), '/T', '/F'])) {
      return unsafe(`taskkill arguments ${JSON.stringify(args)}`);
    }
    // A successful taskkill callback is deliberately earlier than the child's
    // exit event: returning from execFile alone must not count as confirmation.
    queueMicrotask(() => callback?.(null, '', ''));
    if (!forceFails) later(() => exit('SIGKILL'), 5);
    return new EventEmitter();
  };
  execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  class FakeSocket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const request = JSON.parse(raw);
      let result;
      switch (request.method) {
        case 'Target.createTarget': result = { targetId: 'owned-target' }; break;
        case 'Target.attachToTarget': result = { sessionId: 'owned-session' }; break;
        case 'Page.enable':
        case 'Emulation.setDeviceMetricsOverride':
        case 'Page.navigate':
          assert.equal(request.sessionId, 'owned-session'); result = {}; break;
        case 'Runtime.evaluate':
          assert.equal(request.sessionId, 'owned-session');
          result = { result: { type: 'string', value: html } }; break;
        case 'Browser.close':
          result = {};
          if (!stubborn) later(() => exit(), 5);
          break;
        default: throw new Error(`Unmodeled CDP command: ${request.method}`);
      }
      queueMicrotask(() => {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id, result }) }));
        if (request.method === 'Page.navigate') {
          this.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'owned-session', params: { timestamp: 1 } }),
          }));
        }
      });
    }
    close() { state.socketsClosed++; }
  }
  const imports = {
    'node:child_process': {
      spawn(file, args) {
        if (file !== 'simulated-owned-browser' || !args.includes(`--user-data-dir=${profile}`)) return unsafe(`spawn ${file}`);
        return child;
      },
      execFile,
      exec() { return unsafe('exec shell'); },
      execSync() { return unsafe('execSync shell'); },
      execFileSync() { return unsafe('execFileSync'); },
      spawnSync() { return unsafe('spawnSync'); },
    },
    'node:fs/promises': {
      async mkdtemp(prefix) { assert.equal(prefix, path.join(root, 'energetico-layout-')); return profile; },
      async readFile(file) {
        assert.equal(file, path.join(profile, 'DevToolsActivePort'));
        state.endpointReads++;
        if (startupError) throw startupError;
        if (state.endpointReads <= startupBusyAttempts) throw Object.assign(new Error('Chrome is writing its endpoint'), { code: 'EBUSY' });
        return '12345\n/devtools/browser/owned';
      },
      async rm(file, options) {
        state.removals.push(file);
        if (file !== profile || !options.recursive) return unsafe(`rm ${file}`);
        assert.ok(state.exitObserved, 'profile removal must follow the owned child exit event');
        if (removalError) throw removalError;
      },
    },
    'node:os': { tmpdir: () => root },
    'node:path': path,
    'node:timers/promises': { setTimeout: delay },
    'node:util': { promisify },
    'node:events': { once: (...args) => import('node:events').then(({ once }) => once(...args)) },
  };
  // Rewrite only static named imports; execute the real helper body unchanged.
  // The VM has fake process/fs/CDP capabilities and never starts a real browser.
  const transformed = source.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/gm,
    (_, bindings, specifier) => {
      assert.ok(Object.hasOwn(imports, specifier), `Unmodeled import: ${specifier}`);
      return `const {${bindings.replace(/\s+as\s+/g, ':')}} = imports[${JSON.stringify(specifier)}];`;
    }).replace('export async function runBrowserLayout', 'async function runBrowserLayout');
  const run = runInNewContext(`${transformed}\nrunBrowserLayout;`, {
    imports, Buffer, WebSocket: FakeSocket, Event, MessageEvent, AbortController,
    setTimeout: later, clearTimeout: cancel, queueMicrotask,
    process: { platform, pid: 999999, kill },
  }, { filename: 'browser-layout-runner.mjs', timeout: 1000 });
  return {
    state,
    run: () => run('simulated-owned-browser', { width: 740, height: 360, url: 'http://simulated-fixture' }),
    audit() {
      assert.deepEqual(state.unsafe, [], 'cleanup must never address an unowned process or profile');
      assert.equal(state.socketsClosed, 1);
    },
  };
}

test('confirmed cleanup preserves the captured stdout', { timeout: 1500 }, async t => {
  const f = fixture(t);
  const result = await f.run();
  assert.equal(result.stdout, '<!doctype html>' + html);
  assert.equal(result.stderr, '');
  assert.ok(f.state.exitObserved);
  assert.equal(f.state.removals.length, 1);
  f.audit();
});

// Break: a transient Windows startup file lock aborts a valid layout capture.
test('Windows endpoint startup retries transient EBUSY then captures the real result', { timeout: 1500 }, async t => {
  const f = fixture(t, { startupBusyAttempts: 2 });
  const result = await f.run();
  assert.equal(result.stdout, '<!doctype html>' + html);
  assert.equal(f.state.endpointReads, 3);
  assert.ok(f.state.exitObserved);
  f.audit();
});

// Break: ignoring a persistent startup lock returns success or loops forever.
test('persistent Windows endpoint EBUSY expires the existing startup bound and still cleans its owned child', { timeout: 5000 }, async t => {
  const f = fixture(t, { startupBusyAttempts: Infinity });
  await assert.rejects(f.run(), /não iniciou/);
  assert.equal(f.state.endpointReads, 100);
  assert.ok(f.state.exitObserved);
  assert.equal(f.state.removals.length, 1);
  assert.equal(f.state.socketsClosed, 0);
  assert.deepEqual(f.state.unsafe, []);
});

for (const [platform, code] of [['win32', 'EPERM'], ['linux', 'EBUSY']]) {
  test(`${platform} unrelated startup ${code} rejects immediately instead of fabricating a measurement`, { timeout: 1500 }, async t => {
    const error = Object.assign(new Error('Endpoint unavailable'), { code });
    const f = fixture(t, { platform, startupError: error });
    await assert.rejects(f.run(), value => value === error);
    assert.equal(f.state.endpointReads, 1);
    assert.ok(f.state.exitObserved);
    assert.equal(f.state.removals.length, 1);
    assert.equal(f.state.socketsClosed, 0);
    assert.deepEqual(f.state.unsafe, []);
  });
}

for (const code of ['EPERM', 'EBUSY']) {
  test(`profile cleanup ${code} rejects instead of returning successful stdout`, { timeout: 1500 }, async t => {
    const removalError = Object.assign(new Error(`Profile cleanup ${code}`), { code });
    const f = fixture(t, { removalError });
    await assert.rejects(f.run(), error => error === removalError || error.code === code || error.cause === removalError,
      'a persistent profile removal failure must reject the helper result');
    assert.ok(f.state.exitObserved);
    assert.equal(f.state.removals.length, 1);
    f.audit();
  });
}

for (const platform of ['win32', 'linux']) {
  test(`${platform} forced cleanup targets only the spawned PID and waits for its exit`, { timeout: 1500 }, async t => {
    const f = fixture(t, { platform, stubborn: true });
    const result = await f.run();
    assert.equal(result.stdout, '<!doctype html>' + html);
    assert.ok(f.state.exitObserved, 'successful cleanup requires the owned child exit event');
    if (platform === 'win32') {
      assert.equal(f.state.commands.length, 1, 'one taskkill invocation must target the owned process tree');
      assert.deepEqual(f.state.commands[0].args, ['/PID', '424242', '/T', '/F']);
    } else {
      assert.deepEqual(f.state.signals, [{ pid: 424242, signal: 'SIGTERM' }, { pid: 424242, signal: 'SIGKILL' }]);
      assert.deepEqual(f.state.commands, []);
    }
    assert.equal(f.state.removals.length, 1);
    f.audit();
  });

  test(`${platform} cleanup rejects when neither termination bound confirms exit`, { timeout: 1500 }, async t => {
    const f = fixture(t, { platform, stubborn: true, forceFails: true });
    await assert.rejects(f.run(), error => /encerr|terminat|exit|cleanup/i.test(error.message),
      'a live owned browser after both termination bounds must not return success');
    assert.equal(f.state.exitObserved, false);
    assert.deepEqual(f.state.removals, [], 'do not remove the profile while its browser is still alive');
    if (platform === 'win32') assert.equal(f.state.commands.length, 1);
    else assert.deepEqual(f.state.signals, [{ pid: 424242, signal: 'SIGTERM' }, { pid: 424242, signal: 'SIGKILL' }]);
    f.audit();
  });
}
