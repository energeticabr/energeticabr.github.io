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

test('Recurring cards keep yellow edit left of delete without title overlap', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'recurring-gallery-layout-'));
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
    for (const [width, height] of [[390, 844], [320, 740], [1365, 768]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/fixtures/recurring-expenses-gallery-responsive.html?width=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?width=${width}' && document.documentElement?.dataset.ready === 'true' && document.querySelectorAll('.re-card').length === 2`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Despesas recorrentes não carregaram em ${width}px`);
      const layouts = await evaluate(`([...document.querySelectorAll('.re-card')].map(card => {
        const buttons = [...card.querySelectorAll('.gallery-record-actions > button')];
        const actions = buttons.map(node => node.getBoundingClientRect());
        const title = card.querySelector('.re-card-heading h2').getBoundingClientRect();
        const rail = card.querySelector('.og-card-attachment-rail');
        const main = card.querySelector('.og-card-main').getBoundingClientRect();
        return { id: card.dataset.itemId, overflow: card.scrollWidth > card.clientWidth + 1,
          documentWidth: document.documentElement.scrollWidth, cardRight: card.getBoundingClientRect().right,
          order: buttons.map(node => node.dataset.galleryAction), edit: buttons[0].textContent,
          paired: actions.length === 2 && Math.abs(actions[0].top - actions[1].top) < 1 && actions[0].right <= actions[1].left,
          titleOverlap: title.right > actions[0].left + 1 && title.top < actions[0].bottom && title.bottom > actions[0].top,
          titleWidth: title.width,
          overflowNodes: [...card.querySelectorAll('*')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => ({ class: node.className, text: node.textContent, width: node.clientWidth, scrollWidth: node.scrollWidth })),
          railBeforeMain: !rail || rail.getBoundingClientRect().right <= main.left + 1 };
      }))`);
      for (const layout of layouts) {
        assert.deepEqual(layout.order, ['edit', 'delete']);
        assert.equal(layout.edit, '✏️');
        assert.ok(layout.paired && !layout.titleOverlap && layout.titleWidth >= 70 && layout.railBeforeMain,
          `Botões/título em ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(!layout.overflow && layout.documentWidth <= width && layout.cardRight <= width + 1,
          `Cartão extrapola ${width}px: ${JSON.stringify(layout)}`);
      }
      if (width === 390 && process.env.RECURRING_GALLERY_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(process.env.RECURRING_GALLERY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
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
