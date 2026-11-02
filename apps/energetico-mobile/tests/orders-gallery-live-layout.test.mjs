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

// Evaluate in the browser: wrapped text may share X coordinates with actions
// while sitting below them. A collision must intersect on both axes.
function headerOverlapsActions() {
  const card = document.querySelector('.og-order-card[data-item-id="353"]');
  const actions = [...card.querySelectorAll('.gallery-record-actions > button')].map(node => node.getBoundingClientRect());
  const content = [...card.querySelectorAll('.og-card-heading h2, .og-card-id, .og-status, .og-open-cue')];
  return content.some(node => {
    const area = node.getBoundingClientRect();
    return actions.some(action => area.left < action.right - 1 && area.right > action.left + 1
      && area.top < action.bottom - 1 && area.bottom > action.top + 1);
  });
}

test('Galeria Pedidos keeps compact paired cards and reachable controls on mobile and desktop', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const profile = mkdtempSync(join(tmpdir(), 'orders-gallery-layout-'));
  const cacheDir = join(profile, 'vite-cache');
  const pending = new Map();
  let server, child, socket;
  try {
    server = await createServer({ root: appRoot, cacheDir, server: { host: '127.0.0.1', port: 0,
      fs: { allow: [resolve(appRoot, '../..'), cacheDir] } }, logLevel: 'silent' });
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
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/fixtures/orders-gallery-responsive.html?width=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?width=${width}' && document.documentElement?.dataset.ready === 'true' && document.querySelectorAll('.og-order-card').length === 2`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Galeria Pedidos não carregou em ${width}px`);
      const layout = await evaluate(`(() => {
        const card = document.querySelector('.og-order-card[data-item-id="353"]');
        const zero = document.querySelector('.og-order-card[data-item-id="351"]');
        const rail = card.querySelector('.og-card-attachment-rail');
        const main = card.querySelector('.og-card-main');
        const fields = [...card.querySelectorAll('.og-card-field')];
        const actions = [...card.querySelectorAll('.gallery-record-actions > button')].map(node => node.getBoundingClientRect());
        const rect = card.getBoundingClientRect();
        const cardOverflows = [...document.querySelectorAll('.og-order-card')].some(node => node.scrollWidth > node.clientWidth + 1);
        return {
          documentWidth: document.documentElement.scrollWidth,
          contentOverflow: document.querySelector('.og-content').scrollWidth > document.querySelector('.og-content').clientWidth + 1,
          cardOverflows,
          cardRight: rect.right,
          railBeforeMain: rail.getBoundingClientRect().right <= main.getBoundingClientRect().left + 1,
          zeroRail: Boolean(zero.querySelector('.og-card-attachment-rail')),
          fieldColumns: getComputedStyle(card.querySelector('.og-card-fields')).gridTemplateColumns.split(' ').length,
          fieldCount: fields.length,
          actionsSideBySide: actions.length === 2 && Math.abs(actions[0].top - actions[1].top) < 1,
          headerOverlap: (${headerOverlapsActions.toString()})(),
          cardHeight: rect.height,
        };
      })()`);
      assert.ok(layout.documentWidth <= width && layout.cardRight <= width + 1 && !layout.contentOverflow && !layout.cardOverflows,
        `Galeria Pedidos extrapola ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.railBeforeMain && layout.zeroRail && layout.actionsSideBySide && !layout.headerOverlap,
        `Composição de ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.fieldColumns, 2, `Campos devem permanecer em duas colunas em ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.fieldCount, 8);
      assert.ok(layout.cardHeight < (width === 320 ? 480 : 400), `Cartão ainda está alto em ${width}px: ${JSON.stringify(layout)}`);
      const detectsActualOverlap = await evaluate(`(() => {
        const card = document.querySelector('.og-order-card[data-item-id="353"]');
        const action = card.querySelector('.gallery-record-actions > button');
        const title = card.querySelector('.og-card-heading h2').getBoundingClientRect();
        const original = action.getAttribute('style');
        try {
          Object.assign(action.style, { position: 'fixed', left: title.left + 'px', top: title.top + 'px', width: title.width + 'px', height: title.height + 'px' });
          return (${headerOverlapsActions.toString()})();
        } finally {
          if (original === null) action.removeAttribute('style'); else action.setAttribute('style', original);
        }
      })()`);
      assert.equal(detectsActualOverlap, true, `A verificação deve detectar um botão cobrindo o fornecedor em ${width}px`);
      if (width === 390 && process.env.ORDERS_GALLERY_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(process.env.ORDERS_GALLERY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      if (width === 390) {
        await evaluate(`document.querySelector('.og-order-card[data-item-id="353"] [data-gallery-action="edit"]').click()`);
        let reportReady = false;
        for (let attempt = 0; attempt < 30 && !reportReady; attempt++) {
          reportReady = await evaluate(`Boolean(document.querySelector('[data-order-linked-report]'))`);
          if (!reportReady) await delay(50);
        }
        assert.ok(reportReady, 'editor deve oferecer o relatório vinculado');
        await evaluate(`document.querySelector('[data-order-linked-report]').click()`);
        const modalLayout = await evaluate(`(() => {
          const detail = document.querySelector('.og-detail');
          const editor = document.querySelector('.gallery-record-overlay');
          const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          return { detailVisible: !detail.hidden, editorVisible: Boolean(editor),
            detailZ: Number(getComputedStyle(detail).zIndex), editorZ: Number(getComputedStyle(editor).zIndex),
            detailOnTop: detail === top || detail.contains(top) };
        })()`);
        assert.ok(modalLayout.detailVisible && modalLayout.editorVisible && modalLayout.detailZ > modalLayout.editorZ && modalLayout.detailOnTop,
          `Relatório deve sobrepor o editor sem destruir o rascunho: ${JSON.stringify(modalLayout)}`);
      }
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server?.close();
    for (let attempt = 0; attempt < 12; attempt++) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); break; }
      catch (error) { if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error; await delay(300); }
    }
  }
});
