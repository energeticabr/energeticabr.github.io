import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('manual edit keeps cancel, red delete and save on one usable row without changing regularization', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
  if (!browser) return t.skip('Chrome unavailable');
  const temporary = await mkdtemp(join(tmpdir(), 'rhid-delete-layout-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: join(temporary, 'cache'),
    optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const width of [320, 390, 430, 768, 1365]) for (const mode of ['edit', 'new']) {
      const result = await runBrowserLayout(browser, { width, height: 844,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rhid-manual-punch-delete.html?mode=${mode}`,
        captureScreenshot: width === 390 && mode === 'edit' && Boolean(process.env.RHID_DELETE_SCREENSHOT) });
      const dom = new JSDOM(result.stdout), evidence = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      assert.deepEqual(evidence.labels, mode === 'edit' ? ['Cancelar', 'Deletar registro', 'Salvar edição'] : ['Cancelar', 'Salvar horário']);
      for (const key of ['sameRow', 'usable', 'ordered', 'fits', 'noOverflow', 'textFits']) assert.equal(evidence[key], true, `${width} ${mode}: ${key}`);
      if (mode === 'edit') assert.equal(evidence.deleteBackground, 'rgb(181, 33, 43)');
      if (result.screenshot) await writeFile(process.env.RHID_DELETE_SCREENSHOT, result.screenshot);
    }
  } finally { await server.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); }
});
