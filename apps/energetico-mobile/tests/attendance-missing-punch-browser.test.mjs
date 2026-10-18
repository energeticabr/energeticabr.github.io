import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('missing-punch correction fits phone and Windows and saves back to the same presence', { timeout: 180000 }, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!chrome) return t.skip('Chrome unavailable');
  const temporary = await mkdtemp(join(tmpdir(), 'attendance-correction-vite-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: join(temporary, 'cache'),
    optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const width of [320, 390, 1365]) {
      for (const mode of ['list', 'dialog']) {
        const result = await runBrowserLayout(chrome, { width, height: 844,
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-missing-punch-correction.html?view=${mode}`,
          captureScreenshot: Boolean(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR) && width === 390 });
        const dom = new JSDOM(result.stdout);
        const evidence = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(evidence.realButton, true);
        assert.equal(evidence.nestedButtons, 0);
        assert.equal(evidence.identityFits, true, `supplier name must not be clipped (${width})`);
        assert.equal(evidence.fits, true, `${width} ${mode}`);
        assert.equal(evidence.overflow, false, `${width} ${mode}`);
        assert.equal(evidence.suggested, '12:00');
        assert.equal(evidence.reason, 'NÃO BATEU PONTO, APESAR DE ESTAR PRESENTE');
        assert.equal(evidence.saved.length, 1);
        assert.equal(evidence.saved[0].personKey, 'rhid:23');
        assert.match(evidence.displayed, /S1- 12:00/);
        assert.equal(evidence.selected, false);
        assert.equal(evidence.attendanceWrites, 0);
        assert.equal(evidence.closed, true);
        if (result.screenshot) {
          await mkdir(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR, { recursive: true });
          await writeFile(join(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR, `${mode}-390.png`), result.screenshot);
        }
      }
    }
  } finally { await server.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
});
