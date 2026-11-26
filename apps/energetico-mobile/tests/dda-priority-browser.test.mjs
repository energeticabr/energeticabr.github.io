import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

test('DDA priority dialog and full-row highlight fit on mobile and Windows', { timeout: 90000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createIsolatedViteServer({ root, logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: ['decimal.js', 'pdf-lib', 'pako', '@capacitor/core'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [resolve(root, '../..')] } },
  });
  try {
    await server.listen();
    const capture = process.env.DDA_PRIORITY_CAPTURE_DIR;
    for (const [width, height, mode] of [[320, 740, 'saved'], [390, 844, 'dialog'], [844, 390, 'saved'], [1365, 900, 'saved']]) {
      const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?standalone&report&layout&priority=${mode}`;
      const result = await runBrowserLayout(browser, { width, height, url, captureScreenshot: Boolean(capture) });
      const dom = new JSDOM(result.stdout);
      try {
        const state = JSON.parse(dom.window.document.documentElement.dataset.priority);
        const context = JSON.stringify({ width, state });
        assert.ok(state.dialogFits && state.dateFocused, context);
        if (mode === 'saved') {
          assert.ok(state.first && state.clusterBelow && state.clusterFits && state.buttonFits, context);
          assert.match(state.due, /^29\/10\/2026/);
          assert.equal(state.clusterBackground, 'rgb(255, 233, 236)', context);
          assert.deepEqual(state.backgrounds, ['rgb(255, 213, 158)'], context);
          assert.notEqual(state.otherBackground, state.backgrounds[0], context);
        }
        if (capture) {
          mkdirSync(capture, { recursive: true });
          writeFileSync(join(capture, `dda-prioridade-${width}-${mode}.png`), result.screenshot);
        }
      } finally {
        dom.window.close();
      }
    }
    await withAttachmentBrowser(browser, { width: 1365, height: 900 }, async ({ navigate, wait, evaluate, command }) => {
      await navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-report.html?standalone&report&layout&priority=dialog`);
      await wait('document.documentElement.dataset.priority');
      const tab = async (modifiers = 0) => {
        for (const type of ['keyDown', 'keyUp']) {
          await command('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers });
        }
        return evaluate('document.activeElement.type');
      };
      assert.equal(await tab(), 'date', 'Tab advances between the date segments');
      assert.equal(await tab(8), 'date', 'Shift+Tab returns to the first segment');
      assert.equal(await tab(8), 'submit', 'Shift+Tab wraps to Save after the first segment');
      assert.equal(await tab(), 'date', 'Tab from Save wraps to the date');
    });
  } finally {
    await server.close();
  }
});
