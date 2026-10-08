import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path));

test('launch total is highlighted left of pencil, status moves below controls and freight/description remain visible', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'launch-total-layout-')), pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
      const response = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails)); return response.result.value;
    };
    for (const [width, height] of [[320, 740], [390, 844], [1024, 768], [1365, 768], [844, 390]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-total-responsive.html?w=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?w=${width}' && document.documentElement?.dataset.ready === 'true'`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Galeria não carregou em ${width}px`);
      const layouts = await evaluate(`(() => [...document.querySelectorAll('.lg-record')].map(card => {
        const total = card.querySelector('.lg-record-total');
        if (!total) return { missingTotal: true };
        const box = total.getBoundingClientRect(), heading = card.querySelector('.lg-record-heading').getBoundingClientRect();
        const status = card.querySelector('.lg-record-status').getBoundingClientRect(), actions = card.querySelector('.gallery-record-actions').getBoundingClientRect();
        const edit = card.querySelector('.gallery-record-action--edit').getBoundingClientRect();
        const mascot = card.querySelector('.report-mascot-button'), order = card.querySelector('.lg-record-order');
        const mascotBox = mascot?.getBoundingClientRect(), orderBox = order?.getBoundingClientRect();
        const description = card.querySelector('.lg-record-description');
        const descriptionBox = description?.getBoundingClientRect();
        const financeBox = card.querySelector('.lg-record-finance').getBoundingClientRect();
        const expandBox = card.querySelector('.lg-record-expand').getBoundingClientRect();
        return { text: total.textContent.replace(/\u00a0/g, ' '), color: getComputedStyle(total.querySelector('.lg-record-value')).color,
          mascot: mascot ? { width: mascotBox.width, height: mascotBox.height,
            fits: mascotBox.left >= orderBox.left && mascotBox.right <= orderBox.right + 1,
            loaded: mascot.querySelector('img').complete && mascot.querySelector('img').naturalWidth > 0 } : null,
          leftOfPencil: box.right <= edit.left && Math.abs(box.top + box.height/2 - edit.top - edit.height/2)<2,
          aboveDivider: box.bottom <= heading.bottom - 2,
          statusBelowActions: status.top >= actions.bottom && Math.abs(status.right - heading.right)<2,
          highlighted: getComputedStyle(total).borderStyle !== 'none' && getComputedStyle(total).backgroundColor !== 'rgba(0, 0, 0, 0)',
          fits: box.left >= heading.left && box.right <= heading.right,
          overflow: card.scrollWidth > card.clientWidth + 1 || total.scrollWidth > total.clientWidth + 1,
          labels: [...card.querySelectorAll('.lg-record-finance .lg-record-label')].map(label => label.textContent),
          freight: card.querySelector('.lg-record-finance .lg-record-field:last-child .lg-record-value').textContent.replace(/\u00a0/g, ' '),
          description: description ? {
            text: description.querySelector('.lg-record-value').textContent,
            visible: descriptionBox.height > 0 && !description.closest('[hidden]'),
            belowFreight: descriptionBox.top >= financeBox.bottom,
            beforeDisclosure: descriptionBox.bottom <= expandBox.top,
            fullWidth: Math.abs(descriptionBox.width - financeBox.width) < 1,
            preservesLines: getComputedStyle(description.querySelector('.lg-record-value')).whiteSpace === 'pre-wrap',
            overflow: description.scrollWidth > description.clientWidth + 1,
          } : null,
        };
      }))()`);
      assert.equal(layouts.length, 2);
      for (const layout of layouts) {
        assert.ok(!layout.missingTotal, 'total must move to the heading');
        assert.equal(layout.color, 'rgb(181, 31, 36)');
        assert.ok(layout.leftOfPencil && layout.aboveDivider && layout.statusBelowActions && layout.highlighted && layout.fits && !layout.overflow,
          `Layout inválido em ${width}px: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.labels, ['VALOR UNITÁRIO', 'QUANTIDADE', 'FRETE']);
        assert.ok(layout.description?.visible && layout.description.belowFreight &&
          layout.description.beforeDisclosure && layout.description.fullWidth &&
          layout.description.preservesLines && !layout.description.overflow,
          `Descrição inválida em ${width}px: ${JSON.stringify(layout.description)}`);
      }
      assert.equal(layouts[0].description.text, 'Forma dos pilares & vigas\nConferir medidas antes da execução.');
      assert.equal(layouts[0].text, 'VALOR TOTALR$ 13.040,00');
      assert.deepEqual(layouts[0].mascot, { width: 44, height: 44, fits: true, loaded: true }, `Mascote em ${width}px`);
      assert.equal(layouts[1].mascot, null);
      assert.equal(layouts[0].freight, 'R$ 40,00');
      assert.equal(layouts[1].text, 'VALOR TOTALR$ 123.456.789,99');
      assert.equal(layouts[1].freight, 'R$ 0,00');
      if (width === 390 && process.env.LAUNCH_TOTAL_SCREENSHOT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(process.env.LAUNCH_TOTAL_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(done => child.once('exit', () => done(true)));
      if (process.platform === 'win32') {
        assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0, 'isolated test browser PID');
        await new Promise(done => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, timeout: 5000 }, () => done()));
      } else child.kill();
      assert.equal(await Promise.race([exited, delay(3000, false)]), true, 'isolated test browser stopped');
    }
    await server.close();
    assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('launch-total-layout-'),
      'cleanup stays inside the uniquely created test profile');
    rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 300 });
  }
});
