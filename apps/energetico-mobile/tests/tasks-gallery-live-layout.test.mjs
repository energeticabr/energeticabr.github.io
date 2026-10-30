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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));

test('rotação preserva tipografia; check e popup de conclusão funcionam em telas pequenas e desktop', { timeout: 120_000 }, async t => {
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
    const verifyRotation = async (selectors, width = 390, height = 844) => {
      const resize = async (width, height) => {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true,
          screenOrientation: { type: width > height ? 'landscapePrimary' : 'portraitPrimary', angle: width > height ? 90 : 0 } }, sessionId);
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      };
      const measure = () => evaluate(`(${JSON.stringify(selectors)}).map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element);
        const range = document.createRange(); range.selectNodeContents(element);
        return { selector, adjust: style.getPropertyValue('-webkit-text-size-adjust'), font: style.fontSize,
          lineHeight: style.lineHeight, textHeight: range.getBoundingClientRect().height };
      })`);
      await resize(width, height);
      const before = await measure();
      for (const sample of before) assert.equal(sample.adjust, '100%', `Escala herdada em ${sample.selector}`);
      for (let cycle = 0; cycle < 3; cycle++) {
        await resize(height, width);
        for (const sample of await measure()) assert.equal(sample.adjust, '100%', sample.selector);
        await resize(width, height);
        assert.deepEqual(await measure(), before, 'Voltar à vertical preserva fontes e altura do texto');
      }
      assert.equal(await evaluate('visualViewport.scale'), 1, 'Rotação não amplia a página');
    };
    // Exercise shared typography in chat and in a report mounted outside #app.
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-zoom-guard.html` }, sessionId);
    await waitFor('Boolean(document.documentElement.dataset.layout)');
    await verifyRotation(['html', 'body', '.chat-messages', '#menu', '#search']);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/report-landscape.html?visual` }, sessionId);
    await waitFor('Boolean(document.querySelector(".pl-overlay"))');
    await evaluate('document.querySelector("#open").click()');
    await waitFor('Boolean(document.querySelector("[role=dialog] tbody td"))');
    await verifyRotation(['[role=dialog]', '[role=dialog] th', '[role=dialog] tbody td']);
    const clickBackdrop = async touch => {
      assert.equal(await evaluate(`document.elementFromPoint(2, 2)?.classList.contains('tg-completion-overlay')`), true);
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 2, y: 2 }] }, sessionId);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 }, sessionId);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 }, sessionId);
      }
    };
    for (const [width, height] of [[320, 740], [390, 844], [1365, 768], [844, 390]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tasks-gallery-responsive.html?w=${width}` }, sessionId);
      await waitFor(`location.search === '?w=${width}' && document.documentElement?.dataset.ready === 'true'`);
      const defaults = await evaluate(`({
        label: document.querySelector('[name="status"]').selectedOptions[0].textContent,
        ids: [...document.querySelectorAll('.tg-card')].map(card => card.dataset.itemId).sort()
      })`);
      assert.equal(defaults.label, 'TODAS, EXCETO CONCLUÍDA');
      assert.deepEqual(defaults.ids, ['175', '176'], 'inclui não iniciada e exclui concluída em todas as telas');
      if (width <= 390) {
        await verifyRotation(['html', 'body', '.tg-card', '.tg-description'], width, height);
        if (process.env.ORIENTATION_SCREENSHOT_DIR) {
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
          writeFileSync(join(process.env.ORIENTATION_SCREENSHOT_DIR, `rotation-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      }
      const toolbar = await evaluate(`(() => {
        const search = document.querySelector('[data-gallery-quick-search]'), filter = document.querySelector('.tg-filter-toggle'), add = document.querySelector('[data-action="create-task"]');
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
      await evaluate(`window.holdCompletion = true; document.querySelector('.tg-card[data-item-id="176"] [data-action="complete"]').click()`);
      await waitFor(`Boolean(window.releaseCompletion)`);
      const loading = await evaluate(`(() => {
        const dialog = document.querySelector('.tg-completion-dialog'), rect = dialog.getBoundingClientRect();
        const back = dialog.querySelector('[data-gallery-editor-back]'), backRect = back?.getBoundingClientRect();
        return { buttons: dialog.querySelectorAll('button').length, fields: dialog.querySelectorAll('input').length,
          back: Boolean(back && back.textContent === '←' && back.type === 'button' && !back.disabled
            && back.getAttribute('aria-label') === 'Voltar à galeria sem salvar'
            && backRect.width >= 48 && backRect.height >= 48),
          loading: dialog.textContent.includes('Carregando conclusão'), focused: document.activeElement === dialog,
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1 };
      })()`);
      assert.equal(loading.buttons, 1, 'a seta de retorno fica disponível durante o carregamento');
      assert.equal(loading.back, true, 'a seta é acessível, visível e não submete o formulário');
      assert.equal(loading.fields, 0);
      assert.ok(loading.loading && loading.focused && loading.fits && !loading.overflow, JSON.stringify(loading));
      if (width === 390 && process.env.TASK_COMPLETION_LOADING_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.TASK_COMPLETION_LOADING_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      await evaluate(`document.querySelector('.tg-completion-dialog h2').click()`);
      assert.equal(await evaluate(`Boolean(document.querySelector('.tg-completion-dialog'))`), true);
      await clickBackdrop(width < 500);
      await waitFor(`!document.querySelector('.tg-completion-dialog')`);
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Concluir tarefa 176');
      assert.equal(await evaluate(`document.querySelector('.og-content').inert`), false);
      await evaluate(`window.holdCompletion = false; window.releaseCompletion()`);
      assert.equal(await evaluate(`Boolean(document.querySelector('.tg-completion-dialog'))`), false, 'leitura tardia não reabre');
      await evaluate(`document.querySelector('.tg-card[data-item-id="176"] [data-action="complete"]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-form]'))`);
      const modal = await evaluate(`(() => {
        const dialog = document.querySelector('.tg-completion-dialog'), rect = dialog.getBoundingClientRect();
        const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { fields: [...dialog.querySelectorAll('input')].map(input => input.value), visible: dialog === top || dialog.contains(top),
          buttons: [...dialog.querySelectorAll('button')].map(button => ({ text: button.textContent, visible: button.getBoundingClientRect().height >= 44 })),
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1, inert: document.querySelector('.og-content').inert };
      })()`);
      assert.deepEqual(modal.fields, ['2026-10-03', 'CONCLUÍDA']);
      assert.deepEqual(modal.buttons, [{ text: '←', visible: true }, { text: 'Cancelar', visible: true }, { text: 'Submeter', visible: true }]);
      assert.ok(modal.visible && modal.fits && !modal.overflow && modal.inert, JSON.stringify(modal));
      if (width === 390 && process.env.TASK_COMPLETION_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.TASK_COMPLETION_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      await evaluate(`document.querySelector('[name="completionDate"]').click()`);
      assert.equal(await evaluate(`Boolean(document.querySelector('.tg-completion-dialog'))`), true);
      await clickBackdrop(width < 500);
      await waitFor(`!document.querySelector('.tg-completion-dialog')`);
      assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Concluir tarefa 176');
      assert.equal(await evaluate('window.writes.length'), 0);
      await evaluate(`document.querySelector('.tg-card[data-item-id="176"] [data-action="complete"]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-form]'))`);
      await evaluate(`document.querySelector('[data-task-completion-submit]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-success]'))`);
      const receipt = await evaluate(`(() => {
        const dialog = document.querySelector('.tg-completion-dialog'), card = dialog.querySelector('.launch-completion');
        const rect = dialog.getBoundingClientRect();
        return { title: card.querySelector('h2').textContent,
          records: [...card.querySelectorAll('.launch-completion__row')].map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]),
          fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          overflow: dialog.scrollWidth > dialog.clientWidth + 1 || dialog.scrollHeight > dialog.clientHeight + 1,
          status: card.getAttribute('role'), writes: window.writes.length };
      })()`);
      assert.equal(receipt.title, 'ATIVIDADE CONCLUÍDA!');
      assert.deepEqual(receipt.records, [['ATIVIDADE', 'ID 176'], ['DATA CONCLUSÃO', '03/10/2026']]);
      assert.ok(receipt.fits && !receipt.overflow, JSON.stringify(receipt));
      assert.equal(receipt.status, 'status'); assert.equal(receipt.writes, 1);
      if (width === 390 && process.env.TASK_COMPLETION_SUCCESS_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(process.env.TASK_COMPLETION_SUCCESS_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      await waitFor(`!document.querySelector('.tg-completion-dialog') && window.writes.length === 1`);
      assert.deepEqual(await evaluate('window.writes'), [{ id: '176', fields: { field_8: '2026-10-03', field_12: 'CONCLUÍDA' } }]);
      assert.equal(await evaluate('document.querySelectorAll(".tg-card").length'), 1);
      await evaluate(`const add = document.querySelector('[data-action="create-task"]'); add.click(); add.click();`);
      assert.equal(await evaluate('window.createdTasks'), 1);
      assert.equal(await evaluate('document.querySelector(".tg-overlay").hidden'), true);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/tasks-gallery-responsive.html?preserve=${width}` }, sessionId);
      await waitFor(`location.search === '?preserve=${width}' && document.documentElement?.dataset.ready === 'true'`);
      await evaluate(`(() => {
        [...document.querySelectorAll('.og-pagination button')].find(button => button.textContent === 'Próxima página').click();
        const sibling = document.querySelector('[data-item-id="189"]');
        sibling.querySelector('[data-action="expand"]').click(); window.keptCard = sibling;
        document.querySelector('[data-item-id="188"]').scrollIntoView({ block: 'center' });
        window.scrollBefore = document.querySelector('.og-content').scrollTop;
        window.loadingWasShown = false;
        const screen = document.querySelector('.gallery-loading-screen');
        new MutationObserver(records => { if (records.some((record, index) =>
          record.attributeName === 'hidden' && (index + 1 < records.length ? records[index + 1].oldValue === null : !screen.hidden))) window.loadingWasShown = true; })
          .observe(screen, { attributes: true, attributeOldValue: true });
        document.querySelector('[data-item-id="188"] [data-action="complete"]').click();
      })()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-form]'))`);
      await evaluate(`document.querySelector('[data-task-completion-submit]').click()`);
      await waitFor(`Boolean(document.querySelector('[data-task-completion-success]'))`);
      await waitFor(`!document.querySelector('.tg-completion-dialog')`);
      const preserved = await evaluate(`({ page: document.querySelector('.og-page-label').textContent,
        before: window.scrollBefore, after: document.querySelector('.og-content').scrollTop,
        snapshots: window.snapshots, loadingWasShown: window.loadingWasShown,
        sameCard: window.keptCard === document.querySelector('[data-item-id="189"]'),
        expanded: window.keptCard.querySelector('[data-action="expand"]').getAttribute('aria-expanded'),
        remaining: document.querySelector('.og-list-status').textContent })`);
      assert.equal(preserved.page, 'Página 2 de 3');
      assert.ok(preserved.before > 0 && Math.abs(preserved.before - preserved.after) < 2, JSON.stringify(preserved));
      assert.equal(preserved.snapshots, 1); assert.equal(preserved.loadingWasShown, false);
      assert.equal(preserved.sameCard, true); assert.equal(preserved.expanded, 'true');
      assert.equal(preserved.remaining, '24 tarefa(s)');
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 300 });
  }
});
