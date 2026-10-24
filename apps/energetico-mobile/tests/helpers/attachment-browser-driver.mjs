import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// A separate headless test profile: actual touch hit testing and native file
// chooser events, with no access to the user's browser or applications.
export async function withAttachmentBrowser(browser, { width = 390, height = 844 } = {}, run) {
  const temporaryRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(temporaryRoot, 'energetico-attachment-'));
  const requests = new Map(), events = [];
  let child, socket, sequence = 0, sessionId, onLoaded;
  try {
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
    let spawnError, endpoint;
    child.on('error', error => { spawnError = error; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      try {
        const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port || '') && /^\/devtools\/browser\/[\da-f-]+$/.test(path || '')) {
          endpoint = `ws://127.0.0.1:${port}${path}`;
          break;
        }
      } catch (error) {
        if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error;
      }
      await delay(100);
    }
    if (!endpoint) throw new Error('O navegador de anexos não iniciou.');
    socket = new WebSocket(endpoint);
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Conexão com navegador expirou.')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); done(); }, { once: true });
      socket.addEventListener('error', error => { clearTimeout(timer); fail(error); }, { once: true });
    });
    socket.addEventListener('message', event => {
      const reply = JSON.parse(event.data);
      if (reply.method) {
        events.push(reply);
        if (reply.method === 'Page.loadEventFired' && reply.sessionId === sessionId) onLoaded?.();
        return;
      }
      const request = requests.get(reply.id);
      if (!request) return;
      requests.delete(reply.id); clearTimeout(request.timer);
      reply.error ? request.fail(new Error(reply.error.message)) : request.done(reply.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence;
      const timer = setTimeout(() => { requests.delete(id); fail(new Error(`${method} expirou.`)); }, 20000);
      requests.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    const command = (method, params) => send(method, params, sessionId);
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const wait = expression => evaluate(`new Promise((resolve,reject) => {
      const end = performance.now() + 10000;
      function check() {
        if (${expression}) return resolve(true);
        if (performance.now() > end) return reject(new Error(${JSON.stringify(`Aguardando ${expression}: `)} +
          location.href + ' ' + document.readyState + ' ' + (document.documentElement?.dataset.layout || '')));
        requestAnimationFrame(check);
      }
      check();
    })`);
    const tap = async selector => {
      const point = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element || element.disabled || !element.checkVisibility()) throw new Error('Controle indisponível: ' + ${JSON.stringify(selector)});
        const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        if (!element.contains(document.elementFromPoint(x, y))) throw new Error('Controle bloqueado por outro elemento: ' + ${JSON.stringify(selector)});
        return { x, y };
      })()`);
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Log.enable');
    await command('Page.setInterceptFileChooserDialog', { enabled: true });
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const navigate = async url => {
      let timer;
      const loaded = new Promise((done, fail) => {
        onLoaded = done;
        timer = setTimeout(() => fail(new Error('A página de teste não terminou de carregar.')), 20000);
      });
      try { await Promise.all([command('Page.navigate', { url }), loaded]); }
      finally { clearTimeout(timer); onLoaded = undefined; }
    };
    try { await run({ evaluate, wait, tap, command, events, navigate }); }
    catch (error) {
      const errors = events.filter(event => event.method === 'Runtime.exceptionThrown'
        || (event.method === 'Log.entryAdded' && ['error', 'warning'].includes(event.params.entry?.level)))
        .slice(-8).map(event => JSON.stringify(event.params).slice(0, 1200));
      const state = await evaluate(`({ title: document.querySelector('.attachment-preview-title')?.textContent,
        status: document.querySelector('.attachment-preview-status')?.textContent,
        dialogs: [...document.querySelectorAll('dialog')].map(node => ({className:node.className,open:node.open})),
        fixture: window.attachmentAppendFixture?.snapshot() })`).catch(() => null);
      console.error('Attachment browser diagnostics:', JSON.stringify({ message: error.message, errors, state }));
      throw error;
    }
  } finally {
    for (const request of requests.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(done => child.once('exit', done));
      if (process.platform === 'win32') {
        if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('PID de teste inválido.');
        await new Promise(done => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 }, done));
      } else child.kill();
      await Promise.race([exited, delay(3000)]);
    }
    await commandCleanup();
  }
  async function commandCleanup() {
    if (dirname(resolve(profile)) !== temporaryRoot || !basename(profile).startsWith('energetico-attachment-')) {
      throw new Error('Perfil de teste fora da pasta temporária.');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
}
