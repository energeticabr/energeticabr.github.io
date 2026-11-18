import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedViteServer as createServer } from './helpers/isolated-vite-server.mjs';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));

test('launch titles include the saved observation and end on the second line with …), including after resizing', { timeout: 120000 }, async t => {
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  t.after(() => server.close());
  for (const width of [320, 390, 844, 1365]) {
    const result = await runBrowserLayout(browser, { width, height: 844, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/launch-product-observation.html`, captureScreenshot: width === 390 && !!process.env.LAUNCH_OBS_SCREENSHOT });
    const dom = new JSDOM(result.stdout);
    const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    assert.equal(layout.overflow, false);
    for (const state of [layout.initial, layout.narrow, layout.restored]) {
      assert.deepEqual(state.slice(0, 3).map(item => item.text), ['PEDREIRO', 'PEDREIRO', 'PEDREIRO']);
      assert.equal(state[3].full, 'PEDREIRO(TURNO DA MANHÃ)');
      assert.equal(state[6].full, 'PEDREIRO(Linha 1 Linha 2 Linha 3)');
      assert.equal(state[7].full, 'PEDREIRO(Acabamento & serviço 👷🏽‍♂️)');
      for (const item of state.slice(3)) {
        assert.ok(item.text.startsWith('PEDREIRO('), `${width}px: ${item.text}`);
        assert.ok(item.height <= item.lineHeight * 2 + 1, JSON.stringify(item));
        assert.ok(item.scrollHeight <= Math.ceil(item.lineHeight * 2), `Third line at ${width}px: ${JSON.stringify(item)}`);
        assert.equal(item.hasMarkup, false);
        if (item.text !== item.full) assert.ok(item.text.endsWith('…)'), item.text);
      }
      assert.ok(state[4].text.endsWith('…)'));
      assert.ok(state[5].text.endsWith('…)'));
    }
    assert.deepEqual(layout.restored, layout.initial, 'Restore the full available title after widening');
    if (result.screenshot) writeFileSync(process.env.LAUNCH_OBS_SCREENSHOT, result.screenshot);
  }
});
