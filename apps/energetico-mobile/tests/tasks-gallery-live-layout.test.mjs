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

test('check fica acima da seta; popup de conclusão funciona em telas pequenas e desktop', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'tasks-gallery-layout-')), pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 200 && !existsSync(portFile); attempt++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome não iniciou');
    const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let sequence = 0;
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data), request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      response.error ? request.fail(new Error(response.error.message)) : request.done(response.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} expirou`)); }, 10_000);
      pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails)); return response.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(expression)) return; await delay(100); }
      assert.fail(`Não carregou: ${expression}`);
    };
    for (const [width, height] of [[320, 740], [390, 844], [1365, 768], [844, 390]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tasks-gallery-responsive.html?w=${width}` }, sessionId);
      await waitFor(`location.search === '?w=${width}' && document.documentElement?.dataset.ready === 'true'`);
      const toolbar = await evaluate(`(() => {
        const search = document.querySelector('.tg-search-field'), filter = document.querySelector('.tg-filter-toggle'), add = document.querySelector('[data-action="create-task"]');
        const a = search.getBoundingClientRect(), b = filter.getBoundingClientRect(), c = add.getBoundingClientRect(), style = getComputedStyle(add);
        return { aligned: Math.abs(a.bottom - b.bottom) < 1 && Math.abs(b.bottom - c.bottom) < 1,
          ordered: a.right <= b.left && b.right <= c.left, fits: c.right <= innerWidth && a.width > 0,
          color: style.color, background: style.backgroundColor, enabled: !add.disabled,
          overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      assert.ok(toolbar.aligned && toolbar.ordered && toolbar.fits && toolbar.enabled && !toolbar.overflow, JSON.stringify(toolbar));
      assert.equal(toolbar.color, 'rgb(33, 132, 67)');
      assert.equal(toolbar.background, 'rgb(255, 255, 255)');
      if (width === 390 && process.env.TASK_GALLERY_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.TASK_GALLERY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      const layout = await evaluate(`(() => {
        const card = document.querySelector('.tg-card[data-item-id="176"]'), check = card.querySelector('[data-action="complete"]'), arrow = card.querySelector('[data-action="expand"]');
        const a = check.getBoundingClientRect(), b = arrow.getBoundingClientRect();
        return { above: a.bottom <= b.top, aligned: Math.abs(a.left - b.left) < 1,
          green: getComputedStyle(check).backgroundColor, overflow: card.scrollWidth > card.clientWidth + 1, arrowEnabled: !arrow.disabled,
          heights: [card.querySelector('.tg-description').scrollHeight, card.querySelector('.tg-description').clientHeight],
          busy: document.querySelector('.tg-overlay').getAttribute('aria-busy') };
      })()`);
      assert.ok(layout.above && layout.aligned && !layout.overflow, JSON.stringify(layout));
      assert.equal(layout.green, 'rgb(37, 162, 78)');
      await evaluate(`document.querySelector('.tg-card[data-item-id="176"] [data-action="complete"]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-form]'))`);
      const modal = await evaluate(`(() => {
        const dialog = document.querySelector('.tg-completion-dialog'), rect = dialog.getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { fields: [...dialog.querySelectorAll('input')].map(input => input.value), visible: dialog === top || dialog.contains(top),
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1, inert: document.querySelector('.og-content').inert };
      })()`);
      assert.deepEqual(modal.fields, ['2026-10-03', 'CONCLUÍDA']);
      assert.ok(modal.visible && modal.fits && !modal.overflow && modal.inert, JSON.stringify(modal));
      if (width === 390 && process.env.TASK_COMPLETION_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.TASK_COMPLETION_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      await evaluate(`document.querySelector('[data-task-completion-cancel]').click()`);
      assert.equal(await evaluate('window.writes.length'), 0);
      await evaluate(`document.querySelector('.tg-card[data-item-id="176"] [data-action="complete"]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-form]'))`);
      await evaluate(`document.querySelector('[data-task-completion-submit]').click()`);
      await waitFor(`!document.querySelector('.tg-completion-dialog') && window.writes.length === 1`);
      assert.deepEqual(await evaluate('window.writes'), [{ id: '176', fields: { field_8: '2026-10-03', field_12: 'CONCLUÍDA' } }]);
      assert.equal(await evaluate('document.querySelectorAll(".tg-card").length'), 1);
      await evaluate(`const add = document.querySelector('[data-action="create-task"]'); add.click(); add.click();`);
      assert.equal(await evaluate('window.createdTasks'), 1);
      assert.equal(await evaluate('document.querySelector(".tg-overlay").hidden'), true);
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 300 });
  }
});
