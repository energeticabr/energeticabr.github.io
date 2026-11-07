import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('DDA provision action fits below check and supports start and retry', { timeout: 240_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, cacheDir: 'node_modules/.vite-dda-create-provision', server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const capture = process.env.DDA_PROVISION_CAPTURE_DIR;
  if (capture) mkdirSync(capture, { recursive: true });
  try {
    await server.listen();
    for (const [width, height] of [[320,740], [390,844], [1365,900]]) for (const scenario of ['idle','started','failed']) {
      await t.test(`${scenario} ${width}px`, async () => {
        const result = await runBrowserLayout(browser, { width, height, captureScreenshot: Boolean(capture),
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/dda-create-provision.html?scenario=${scenario}` });
        if (capture) writeFileSync(join(capture, `dda-provision-${scenario}-${width}.png`), result.screenshot);
        const dom = new JSDOM(result.stdout);
        try {
          const state = JSON.parse(dom.window.document.documentElement.dataset.layout), detail = JSON.stringify(state);
          assert.equal(state.error, undefined, detail); assert.equal(state.label, 'PROVISÃO');
          for (const property of ['belowCheck','aligned','buttonFits','touchTarget','wordsUnbroken']) assert.equal(state[property], true, detail);
          assert.equal(state.overflow, false, detail);
          assert.equal(state.closed, scenario === 'started', detail);
          assert.equal(state.failureVisible, scenario === 'failed', detail);
          assert.equal(state.retryEnabled, scenario !== 'started', detail);
          assert.deepEqual(state.calls, scenario === 'idle' ? [] : [{ itemId: 7, key: '7'.repeat(64) }]);
        } finally { dom.window.close(); }
      });
    }
  } finally { await server.close(); }
});
