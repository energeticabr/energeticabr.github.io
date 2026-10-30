import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

// Exercises the real payment dialog with a deliberately fake launch consumer.
// The tray proves the dialog's callback contract, not app-controller integration.
test('DDA payment launch offer fits and hands off the paid identity without reconfirming', { timeout: 240_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const capture = process.env.DDA_PAYMENT_LAUNCH_CAPTURE_DIR;
  if (capture) mkdirSync(capture, { recursive: true });
  try {
    await server.listen();
    for (const [width, height] of [[320, 740], [390, 844], [1365, 900]]) {
      for (const scenario of ['offer', 'started', 'failed', 'retry', 'declined']) {
        await t.test(`${scenario} at ${width}x${height}`, async () => {
          const result = await runBrowserLayout(browser, {
            width, height, captureScreenshot: Boolean(capture),
            url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-payment-launch.html?scenario=${scenario}`,
          });
          if (capture) writeFileSync(join(capture, `dda-payment-launch-${scenario}-${width}.png`), result.screenshot);
          const dom = new JSDOM(result.stdout);
          try {
            const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
            const detail = JSON.stringify({ width, scenario, state });
            assert.equal(state.error, undefined, detail);
            assert.equal(state.width, width, detail);
            assert.equal(state.pageOverflow, false, detail);
            assert.equal(state.offeredBeforePayment, false, detail);
            assert.equal(state.paymentCalls, 1, detail);
            assert.equal(state.confirmedCalls, 1, detail);
            assert.equal(state.paymentIdentity.itemId, 42, detail);
            assert.equal(state.paymentIdentity.key, 'b'.repeat(64), detail);
            assert.equal(state.paymentIdentity.signalIsAbortSignal, true, detail);
            assert.equal(state.sourceNames.length, 2, detail);
            assert.deepEqual(state.sourceNames, [
              'DANFE-EXEMPLO-000042-materiais-de-construcao.pdf',
              'Comprovante-EXEMPLO-000042-pagamento-boleto.pdf',
            ], detail);
            assert.equal(state.sourceFilesValid, true, detail);
            assert.equal(state.sourceUnchanged, true, detail);
            assert.equal(state.offer.title, 'Pagamento confirmado', detail);
            assert.match(state.offer.text, /Deseja iniciar um lançamento usando os anexos deste DDA\?/, detail);
            assert.equal(state.offer.yesText, 'Sim, iniciar lançamento', detail);
            assert.equal(state.offer.noText, 'Não, voltar à galeria', detail);
            for (const field of ['dialogFits', 'textFits', 'buttonsFit', 'buttonsReachable', 'keyboardReachable', 'backgroundInert']) {
              assert.equal(state.offer[field], true, `${field}: ${detail}`);
            }
            assert.equal(state.offer.horizontalOverflow, false, detail);
            assert.equal(state.offer.verticalScrollAccessible, true, detail);
            assert.equal(state.offer.paymentControlPresent, false, detail);
            assert.equal(state.offer.wordsUnbroken, true, detail);
            assert.equal(state.offer.yesBackground, 'rgb(18, 100, 67)', detail);
            assert.equal(state.offer.yesColor, 'rgb(255, 255, 255)', detail);
            assert.ok(state.offer.yesContrast >= 4.5, detail);
            if (width <= 420) assert.ok(state.offer.buttonWidths.every(value => value > 200), detail);

            const starts = scenario === 'retry' ? 2 : ['started', 'failed'].includes(scenario) ? 1 : 0;
            assert.equal(state.launchRequests.length, starts, detail);
            for (const request of state.launchRequests) {
              assert.equal(request.itemId, 42, detail);
              assert.equal(request.key, 'b'.repeat(64), detail);
              assert.equal(request.signalIsAbortSignal, true, detail);
              assert.equal(request.abortedAtStart, false, detail);
            }
            if (starts) {
              assert.deepEqual(state.pending, {
                open: true, controlsDisabled: true, noTray: true, paymentCalls: 1, launchCalls: 1,
              }, detail);
            }
            if (scenario === 'failed' || scenario === 'retry') {
              assert.equal(state.failure.open, true, detail);
              assert.equal(state.failure.controlsEnabled, true, detail);
              assert.equal(state.failure.paymentControlPresent, false, detail);
              assert.equal(state.failure.paymentCalls, 1, detail);
              assert.equal(state.failure.launchCalls, 1, detail);
              assert.equal(state.failure.noTray, true, detail);
              assert.match(state.failure.message, /pagamento já está confirmado.*Tente novamente.*não será repetida/i, detail);
              assert.equal(state.failure.privateErrorVisible, false, detail);
              for (const field of ['dialogFits', 'textFits', 'buttonsFit', 'buttonsReachable', 'keyboardReachable']) {
                assert.equal(state.failure.layout[field], true, `${field}: ${detail}`);
              }
              assert.equal(state.failure.layout.horizontalOverflow, false, detail);
              assert.equal(state.failure.layout.verticalScrollAccessible, true, detail);
              assert.equal(state.failure.layout.wordsUnbroken, true, detail);
              assert.equal(state.failure.layout.yesBackground, 'rgb(18, 100, 67)', detail);
              assert.equal(state.failure.layout.yesColor, 'rgb(255, 255, 255)', detail);
              assert.ok(state.failure.layout.yesContrast >= 4.5, detail);
              if (width <= 420) assert.ok(state.failure.layout.buttonWidths.every(value => value > 200), detail);
            }
            if (scenario === 'started' || scenario === 'retry') {
              assert.equal(state.open, false, detail);
              assert.equal(state.tray.visible, true, detail);
              assert.equal(state.tray.fits, true, detail);
              assert.equal(state.tray.overflow, false, detail);
              assert.deepEqual(state.tray.names, state.sourceNames, detail);
              assert.equal(state.tray.sameFiles, true, detail);
              assert.match(state.tray.label, /simulado/i, detail);
            } else {
              assert.equal(state.tray.visible, false, detail);
              assert.equal(state.open, scenario !== 'declined', detail);
            }
            if (scenario === 'declined') {
              assert.equal(state.galleryVisible, true, detail);
              assert.equal(state.focusRestored, true, detail);
              assert.equal(state.backgroundRestored, true, detail);
            }
            assert.deepEqual(state.externalResources, [], detail);
          } finally { dom.window.close(); }
        });
      }
    }
  } finally { await server.close(); }
});
