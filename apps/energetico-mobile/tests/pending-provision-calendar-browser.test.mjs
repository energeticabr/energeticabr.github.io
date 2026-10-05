import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

test('clique real abre calendário e teclado seleciona nova data em telas estreitas e desktop no Chrome', { timeout: 90_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(p => p && existsSync(p));
  if (!browser) return t.skip('Chrome indisponível');
  const app = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root: app, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'provision-calendar-')), pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let n = 0; n < 200 && !existsSync(portFile); n++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome iniciou');
    const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let seq = 0;
    socket.addEventListener('message', e => { const r = JSON.parse(e.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.fail(new Error(r.error.message)) : p.done(r.result); });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => { const id = ++seq, timer = setTimeout(() => { pending.delete(id); fail(new Error(method + ' expirou')); }, 15000); pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const tap = async selector => {
      const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2};})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, sessionId);
    };
    const key = async (key, code, keyCode) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode }, sessionId);
    };
    for (const width of [320, 390, 1365]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-provision-calendar.html?w=${width}` }, sessionId);
      let ready = false;
      for (let n = 0; n < 200 && !ready; n++) { ready = await evaluate(`location.search==='?w=${width}'&&document.documentElement?.dataset.ready==='true'`); if (!ready) await delay(100); }
      assert.ok(ready, 'fixture carregada');
      await tap('[data-action="edit-pending-provision-due-date"]');
      const layout = await evaluate(`(()=>{const f=document.querySelector('[data-role="pending-provision-due-date"]'),r=f.getBoundingClientRect();return {type:f.type,value:f.value,fits:r.x>=0&&r.right<=innerWidth&&r.width>0,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
      assert.deepEqual(layout, { type: 'date', value: '2026-10-05', fits: true, overflow: false });
      await tap('[data-role="pending-provision-due-date"]');
      if (width === 390 && process.env.PROVISION_CALENDAR_SCREENSHOT) { const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId); writeFileSync(process.env.PROVISION_CALENDAR_SCREENSHOT, Buffer.from(shot.data, 'base64')); }
      // The actual browser calendar receives these keys; no synthetic change or value assignment.
      await key('ArrowRight', 'ArrowRight', 39);
      await key('Enter', 'Enter', 13);
      assert.equal(await evaluate(`document.querySelector('[data-role="pending-provision-due-date"]').value`), '2026-10-06');
      assert.deepEqual(await evaluate('window.saved'), []);
      await tap('[data-action="save-pending-provision-due-date"]');
      assert.deepEqual(await evaluate('window.saved'), [{ paymentId: '314', value: '06/10/2026' }]);
      await tap('[data-action="cancel-pending-provision-date-edit"]');
      assert.equal(await evaluate('window.cancelled'), 1);
      assert.deepEqual(await evaluate('window.saved'), [{ paymentId: '314', value: '06/10/2026' }]);
    }
  } finally {
    for (const p of pending.values()) clearTimeout(p.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; }
  }
});
