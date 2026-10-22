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

test('interactive fixture leaves empty E1 available for manual correction without running the auto script', { timeout: 60000 }, async t => {
  const chrome = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!chrome) return t.skip('Chrome unavailable');
  const temporary = await mkdtemp(join(tmpdir(), 'attendance-interactive-vite-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: join(temporary, 'cache'),
    optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'silent' });
  try {
    await server.listen();
    const result = await runBrowserLayout(chrome, { width: 390, height: 844,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-missing-punch-correction.html?interactive=1&view=dialog` });
    const dom = new JSDOM(result.stdout);
    try {
      const document = dom.window.document;
      assert.ok(document.querySelector('[data-action="attendance-rhid-adjust-open"][data-slot="entry1"]'), 'E1 must stay empty and clickable until a manual click');
      assert.equal(document.querySelector('[data-rhid-adjustment-dialog]'), null, 'interactive mode must not open a dialog automatically');
      assert.equal(document.querySelector('[data-action="attendance-select-toggle"]').checked, false);
      const evidence = JSON.parse(document.documentElement.dataset.layout);
      assert.deepEqual(evidence.saved, []);
      assert.equal(evidence.attendanceWrites, 0);
      assert.equal(document.documentElement.dataset.ready, 'true');
    } finally { dom.window.close(); }
  } finally { await server.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
});

for (const [slot, suggested, displayed] of [['entry1', '07:00', 'E1- 07:00'], ['exit1', '12:00', 'S1- 12:00']]) {
test(`missing ${slot} correction fits phone and Windows and saves back to the same presence`, { timeout: 180000 }, async t => {
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
          url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-missing-punch-correction.html?view=${mode}&slot=${slot}`,
          captureScreenshot: Boolean(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR) && width === 390 });
        const dom = new JSDOM(result.stdout);
        const evidence = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(evidence.realButton, true);
        assert.equal(evidence.nestedButtons, 0);
        assert.equal(evidence.identityFits, true, `supplier name must not be clipped (${width})`);
        assert.equal(evidence.fits, true, `${width} ${mode}`);
        assert.equal(evidence.overflow, false, `${width} ${mode}`);
        assert.equal(evidence.suggested, suggested);
        assert.equal(evidence.reason, 'NÃO BATEU PONTO, APESAR DE ESTAR PRESENTE');
        assert.equal(evidence.saved.length, 1);
        assert.equal(evidence.saved[0].personKey, 'rhid:23');
        assert.equal(evidence.saved[0].slot, slot);
        assert.equal(evidence.saved[0].time, suggested);
        assert.equal(evidence.displayed, displayed);
        assert.equal(evidence.selected, false);
        assert.equal(evidence.attendanceWrites, 0);
        assert.equal(evidence.closed, true);
        if (result.screenshot) {
          await mkdir(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR, { recursive: true });
          await writeFile(join(process.env.ATTENDANCE_CORRECTION_SCREENSHOT_DIR, `${slot}-${mode}-390.png`), result.screenshot);
        }
      }
    }
  } finally { await server.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
});
}
