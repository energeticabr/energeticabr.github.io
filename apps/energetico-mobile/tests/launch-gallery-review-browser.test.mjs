import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path));

test('launch edit confirmation stays readable above the form on phones and desktop', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'launch-review-layout-'));
  const pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 200 && !existsSync(portFile); attempt++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome não iniciou inspeção remota');
    const [debugPort, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let sequence = 0;
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data), request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      response.error ? request.fail(new Error(response.error.message)) : request.done(response.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} expirou`)); }, 10_000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const port = server.httpServer.address().port;
    for (const [width, height] of [[320, 740], [390, 844], [1365, 768]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/fixtures/launch-gallery-review-responsive.html?width=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?width=${width}' && document.documentElement.dataset.ready === 'true'`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Revisão não carregou em ${width}px`);
      const layout = await evaluate(`(() => {
        const popup = document.querySelector('.lg-review');
        const card = popup.querySelector('.lg-review-card');
        const bounds = card.getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { popupPosition: getComputedStyle(popup).position, popupVisible: !popup.hidden,
          cardLeft: bounds.left, cardRight: bounds.right, cardTop: bounds.top, cardBottom: bounds.bottom,
          cardOverflow: card.scrollWidth > card.clientWidth + 1,
          tableOverflow: popup.querySelector('table').scrollWidth > popup.querySelector('table').clientWidth + 1,
          onTop: popup === top || popup.contains(top), rows: popup.querySelectorAll('tbody tr').length,
          cancelColor: getComputedStyle(popup.querySelector('.lg-review-cancel')).backgroundColor,
          confirmColor: getComputedStyle(popup.querySelector('.lg-review-confirm')).backgroundColor,
          editorVisible: !document.querySelector('.lg-detail').hidden,
        };
      })()`);
      assert.ok(layout.popupVisible && layout.editorVisible && layout.popupPosition === 'fixed' && layout.onTop,
        `Popup não cobre a edição em ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.cardLeft >= 0 && layout.cardRight <= width + 1 && layout.cardTop >= 0
        && layout.cardBottom <= height + 1 && !layout.cardOverflow && !layout.tableOverflow,
      `Popup extrapola ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.rows, 2);
      assert.equal(layout.cancelColor, 'rgb(181, 31, 36)', 'Cancelar deve ser vermelho');
      assert.equal(layout.confirmColor, 'rgb(20, 128, 74)', 'Confirmar deve ser verde');
      if (width === 390) {
        for (const [className, expected] of [['lg-review-cancel', layout.cancelColor], ['lg-review-confirm', layout.confirmColor]]) {
          const point = await evaluate(`(() => { const box = document.querySelector('.${className}').getBoundingClientRect();
            return {x: box.left + box.width / 2, y: box.top + box.height / 2}; })()`);
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, sessionId);
          assert.equal(await evaluate(`getComputedStyle(document.querySelector('.${className}')).backgroundColor`), expected,
            `${className} deve manter a cor ao passar o mouse`);
        }
      }
      if (width === 390 && process.env.LAUNCH_REVIEW_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(process.env.LAUNCH_REVIEW_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    for (let attempt = 0; attempt < 12; attempt++) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); break; }
      catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error; await delay(300); }
    }
  }
});
