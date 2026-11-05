import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createIsolatedViteServer } from './helpers/isolated-vite-server.mjs';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('seleção em lote exclui ausentes em celular e Windows', { timeout: 120000 }, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!chrome) return t.skip('Chrome unavailable');
  const server = await createIsolatedViteServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); t.after(() => server.close());
  for (const width of [320, 390, 1365]) {
    const result = await runBrowserLayout(chrome, { width, height: 1000, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-select-all.html`, captureScreenshot: Boolean(process.env.ATTENDANCE_BULK_CAPTURE_DIR) });
    const dom = new JSDOM(result.stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    assert.deepEqual(layout, { overflow: false, selected: ['1', '3', '4'], allChecked: true, dialog: false, replies: ['attendance_batch:1,3,4'] }, `${width}px`);
    if (process.env.ATTENDANCE_BULK_CAPTURE_DIR) {
      mkdirSync(process.env.ATTENDANCE_BULK_CAPTURE_DIR, { recursive: true });
      writeFileSync(`${process.env.ATTENDANCE_BULK_CAPTURE_DIR}/bulk-${width}.png`, result.screenshot);
    }
  }
});
