import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

function assertDarkGray(color) {
  const channels = color.match(/\d+/g)?.map(Number);
  assert.equal(channels?.length, 3);
  assert.ok(channels.every(channel => channel >= 50 && channel <= 100) && Math.max(...channels) - Math.min(...channels) < 32, `botão cinza: ${color}`);
}

test('Suprimentos e escolha de cadastros mantêm botão pareado e quatro destinos acessíveis no celular e desktop', { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temporaryRoot = resolve(tmpdir());
  const cacheDir = mkdtempSync(join(temporaryRoot, 'energetico-registration-menu-'));
  const screenshots = resolve(fileURLToPath(new URL('../../../work/registration-hub-screenshots', import.meta.url)));
  let server;
  try {
    server = await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, cacheDir] } } });
    await server.listen(); mkdirSync(screenshots, { recursive: true });
    for (const [width, height] of [[320, 740], [390, 844], [1200, 900]]) for (const mode of ['supplies', 'chooser']) {
      const result = await runBrowserLayout(browser, { width, height, captureScreenshot: true,
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/registration-gallery-menu.html?mode=${mode}` });
      const dom = new JSDOM(result.stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      t.diagnostic(JSON.stringify(layout));
      writeFileSync(join(screenshots, `${mode}-${width}.png`), result.screenshot);
      assert.equal(layout.overflow, false, `${mode} at ${width}: no horizontal page overflow`);
      assert.ok(layout.pair.hub.x >= layout.pair.primary.right, 'o atalho cinza fica à direita');
      assert.ok(Math.abs(layout.pair.hub.y - layout.pair.primary.y) < 1, 'os botões ficam na mesma linha');
      assertDarkGray(layout.pair.background);
      if (mode === 'chooser') {
        assert.equal(layout.menuVisible, true); assert.equal(layout.hitTargets, true);
        assert.deepEqual(layout.selected, ['group', 'family', 'subfamily', 'product']);
        for (const button of layout.choices) {
          assertDarkGray(button.background);
          assert.ok(button.x >= 0 && button.right <= width && button.y >= 0 && button.bottom <= height, `${button.label} reachable at ${width}`);
          assert.ok(button.height >= 44);
        }
      }
    }
  } finally {
    await server?.close();
    assert.equal(dirname(resolve(cacheDir)), temporaryRoot); assert.ok(basename(cacheDir).startsWith('energetico-registration-menu-'));
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
