import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
test('employee gallery, inactivation form and supplier date prompt fit phones, tablets and Windows', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const app = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root: app, server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(app, '../..')] } }, logLevel: 'silent' });
  await server.listen();
  try {
    for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1365, 900]]) {
      for (const mode of ['', '?edit=1', '?portal=1', '?conflict=1']) {
        const capture = Boolean(process.env.CONTRACTOR_EMPLOYMENT_SCREENSHOT_DIR) && mode !== '?portal=1';
        const { stdout, screenshot } = await runBrowserLayout(browser, { width, height,
          url: 'http://127.0.0.1:' + server.httpServer.address().port + '/tests/fixtures/contractor-employment-responsive.html' + mode,
          captureScreenshot: capture,
        });
        const dom = new JSDOM(stdout), result = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
        assert.equal(result.overflow, false, width + mode + ': no horizontal overflow');
        assert.equal(result.controlsFit, true, width + mode + ': touch controls fit');
        assert.equal(result.rows, 3);
        assert.equal(result.editor, mode === '?edit=1');
        assert.equal(result.portal, mode === '?portal=1');
        if (mode === '?conflict=1') assert.equal(result.conflict, true, 'comparison must show the current source and mirror together');
        if (capture) {
          await mkdir(process.env.CONTRACTOR_EMPLOYMENT_SCREENSHOT_DIR, { recursive: true });
          const output = join(process.env.CONTRACTOR_EMPLOYMENT_SCREENSHOT_DIR, 'funcionarios-' + width + (mode === '?conflict=1' ? '-conflict' : mode ? '-edit' : '') + '.png');
          await writeFile(output, screenshot); t.diagnostic(output);
        }
      }
    }
  } finally { await server.close(); }
});
