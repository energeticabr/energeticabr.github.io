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
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));

test('paid date stays left of total in a green band while supplier and order remain selectable on every viewport', { timeout: 90_000 }, async t => {
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
    for (const [width, height] of [[320, 740], [390, 844], [430, 932], [700, 1000], [1024, 768], [1365, 768], [844, 390]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-gallery-total-responsive.html?w=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?w=${width}' && document.documentElement?.dataset.ready === 'true'`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Galeria não carregou em ${width}px`);
      const layouts = await evaluate(`(() => [...document.querySelectorAll('.lg-record')].map(card => {
        const band = card.querySelector('.lg-record-payment-summary');
        if (!band) return { missingBand: true };
        const date = band.querySelector('.lg-record-payment-date'), dateBox = date.getBoundingClientRect();
        const total = card.querySelector('.lg-record-total');
        if (!total) return { missingTotal: true };
        const box = total.getBoundingClientRect(), heading = card.querySelector('.lg-record-heading').getBoundingClientRect();
        const status = card.querySelector('.lg-record-status').getBoundingClientRect(), actions = card.querySelector('.gallery-record-actions').getBoundingClientRect();
        const edit = card.querySelector('.gallery-record-action--edit').getBoundingClientRect();
        const order = card.querySelector('.lg-record-order');
        const orderBox = order?.getBoundingClientRect();
        const description = card.querySelector('.lg-record-description');
        const descriptionBox = description?.getBoundingClientRect();
        const financeBox = card.querySelector('.lg-record-finance').getBoundingClientRect();
        const expandBox = card.querySelector('.lg-record-expand').getBoundingClientRect();
        const payment = card.querySelector('.lg-record-payment-method');
        const paymentBox = payment?.getBoundingClientRect();
        const contentWidths = [...total.children].map(child => {
          const range = document.createRange(); range.selectNodeContents(child);
          return range.getBoundingClientRect().width;
        });
        const valueRange = document.createRange(); valueRange.selectNodeContents(total.querySelector('.lg-record-value'));
        const numericRange = valueRange.cloneRange(); numericRange.setStart(total.querySelector('.lg-record-value').firstChild, 3);
        return { text: total.textContent.replace(/\u00a0/g, ' '), color: getComputedStyle(total.querySelector('.lg-record-value')).color,
          valueLines: valueRange.getClientRects().length, numericLines: numericRange.getClientRects().length,
          totalWidth: box.width, contentWidth: Math.max(...contentWidths),
          order: order ? { height: orderBox.height, images: order.querySelectorAll('img').length,
            actions: order.querySelectorAll('button').length } : null,
          date: date.querySelector('.lg-record-value').textContent,
          green: [date, total].every(node => {
            const channels = getComputedStyle(node).backgroundColor.match(/[\\d.]+/g)?.map(Number);
            return channels?.length >= 3 && channels[1] > channels[0] && channels[1] > channels[2];
          }),
          dateLeftOfTotal: dateBox.right <= box.left + 1 && Math.abs(dateBox.top - box.top) < 1 && Math.abs(dateBox.bottom - box.bottom) < 1,
          belowControls: box.top >= actions.bottom,
          aboveDivider: box.bottom <= heading.bottom - 2,
          statusBelowActions: status.top >= box.bottom && Math.abs(status.right - heading.right)<2,
          highlighted: getComputedStyle(total).borderStyle !== 'none' && getComputedStyle(total).backgroundColor !== 'rgba(0, 0, 0, 0)',
          fits: box.left >= heading.left && box.right <= heading.right,
          overflow: card.scrollWidth > card.clientWidth + 1 || total.scrollWidth > total.clientWidth + 1,
          overflowNodes: [...card.querySelectorAll('*')].filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => [node.className?.baseVal ?? node.className, node.clientWidth, node.scrollWidth]),
          labels: [...card.querySelectorAll('.lg-record-finance .lg-record-label')].map(label => label.textContent),
          freight: card.querySelector('.lg-record-freight .lg-record-value').textContent.replace(/\u00a0/g, ' '),
          inclusiveTotal: card.querySelector('.lg-record-total-with-freight .lg-record-value')?.textContent.replace(/\u00a0/g, ' '),
          details: [...card.querySelectorAll('.lg-record-detail-tile')].map(tile => {
            const rect = tile.getBoundingClientRect(), trigger = tile.querySelector('.lg-cluster-trigger');
            return { filled: getComputedStyle(tile).backgroundColor !== 'rgba(0, 0, 0, 0)',
              fits: tile.scrollWidth <= tile.clientWidth + 1 && rect.left >= heading.left && rect.right <= heading.right + 1,
              height: rect.height, selectable: trigger?.tagName === 'BUTTON' && !trigger.disabled,
              hint: tile.querySelector('.lg-record-detail-hint')?.textContent,
              icon: tile.querySelector('.lg-card-icon')?.getBoundingClientRect().width > 0,
              arrow: tile.querySelector('.lg-record-chevron')?.getBoundingClientRect().width > 0 };
          }),
          payment: payment ? { text: payment.querySelector('.lg-record-value').textContent,
            visible: paymentBox.height > 0 && !payment.closest('[hidden]'),
            belowDescription: paymentBox.top >= descriptionBox.bottom,
            beforeDisclosure: paymentBox.bottom <= expandBox.top,
            fullWidth: Math.abs(paymentBox.width - financeBox.width) < 1,
            overflow: payment.scrollWidth > payment.clientWidth + 1 } : null,
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
      assert.equal(layouts.length, 3);
      for (const layout of layouts) {
        assert.ok(!layout.missingBand && !layout.missingTotal, 'paid date and total must share a summary band');
        assert.equal(layout.color, 'rgb(23, 103, 55)');
        assert.ok(layout.green && layout.dateLeftOfTotal && layout.belowControls && layout.aboveDivider && layout.statusBelowActions && layout.highlighted && layout.fits && !layout.overflow,
          `Layout inválido em ${width}px: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.labels, ['VALOR UNITÁRIO', 'QUANTIDADE', 'FRETE', 'TOTAL COM FRETE']);
        for (const tile of layout.details) assert.ok(tile.filled && tile.fits && tile.height >= 44 && tile.selectable && tile.icon && tile.arrow && tile.hint,
          `Detalhamento inválido em ${width}px: ${JSON.stringify(tile)}`);
        assert.ok(layout.description?.visible && layout.description.belowFreight &&
          layout.description.beforeDisclosure && layout.description.fullWidth &&
          layout.description.preservesLines && !layout.description.overflow,
          `Descrição inválida em ${width}px: ${JSON.stringify(layout.description)}`);
        assert.ok(layout.payment?.visible && layout.payment.belowDescription && layout.payment.beforeDisclosure &&
          layout.payment.fullWidth && !layout.payment.overflow,
          `Conta/forma pgto inválida em ${width}px: ${JSON.stringify(layout.payment)}`);
      }
      assert.deepEqual(layouts.map(layout => layout.date), ['03/10/2026', '—', '09/10/2026']);
      assert.equal(layouts[0].numericLines, 1, `Amount and cents must stay together at ${width}px: ${JSON.stringify(layouts[0])}`);
      assert.ok(layouts[0].valueLines <= (width < 390 ? 2 : 1), `Normal currency amount should fit at ${width}px`);
      assert.equal(layouts[2].valueLines, 1, `Normal amount must not break across lines at ${width}px`);
      assert.equal(layouts[0].payment.text, 'ENERGÉTICA - CAIXA / PIX');
      assert.equal(layouts[2].payment.text, 'DINHEIRO');
      assert.equal(layouts[2].text, 'VALOR TOTALR$ 906,00');
      assert.equal(layouts[0].description.text, 'Forma dos pilares & vigas\nConferir medidas antes da execução.');
      assert.equal(layouts[0].text, 'VALOR TOTALR$ 13.040,00');
      assert.ok(layouts[0].order.height <= 110, `Pedido compacto em ${width}px: ${JSON.stringify(layouts[0].order)}`);
      assert.equal(layouts[0].order.images, 0, 'no redundant image increases the order row');
      assert.equal(layouts[0].order.actions, 1, 'the tile keeps one accessible detail action');
      assert.equal(layouts[1].order, null);
      assert.equal(layouts[0].freight, 'R$ 40,00');
      assert.equal(layouts[0].inclusiveTotal, 'R$ 13.040,00', 'freight is already included in the service total');
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
