import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

function luminance(rgb) {
  const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(value => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('provision summary fits phone, tablet and desktop with scrollable details and stable composer', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await createServer({ root: resolve(fileURLToPath(new URL('..', import.meta.url))),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height, colorScheme] of [[320, 740, 'dark'], [390, 844, 'dark'],
      [320, 740, 'light'], [390, 844, 'light'], [1024, 768, 'light'], [1440, 900, 'light']]) {
      const result = await runBrowserLayout(browser, { width, height, colorScheme,
        url: 'http://127.0.0.1:' + server.httpServer.address().port + '/tests/fixtures/provision-summary.html' });
      const dom = new JSDOM(result.stdout);
      const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      t.diagnostic(JSON.stringify(layout));
      assert.equal(layout.missing, false, 'summary must render in browser');
      assert.equal(layout.width, width);
      assert.equal(layout.height, height);
      assert.equal(layout.colorScheme, colorScheme);
      assert.equal(layout.collapsed.open, false);
      assert.equal(layout.expanded.open, true);
      for (const phase of [layout.collapsed, layout.expanded]) {
        assert.equal(phase.overflow, false);
        // Collapsed children do not have layout boxes, so check wrapping when visible.
        if (phase.open) assert.equal(phase.contentOverflow, false);
        assert.equal(phase.unsupportedControls, 0);
        assert.ok(phase.tray.bottom <= phase.composer.y + 1, JSON.stringify(phase));
        assert.ok(phase.send.x >= 0 && phase.send.right <= width && phase.send.bottom <= height);
        assert.ok(phase.tray.height > 0 && phase.tray.height <= height * 0.3 + 1);
      }
      assert.ok(layout.expanded.trayScrollHeight > layout.expanded.trayClientHeight);
      assert.equal(layout.lastLineReachable, true);
      const alternatingBackgrounds = ['rgb(255, 255, 255)', 'rgb(232, 243, 255)',
        'rgb(255, 255, 255)', 'rgb(232, 243, 255)'];
      assert.deepEqual(layout.expanded.entryBackgrounds, alternatingBackgrounds,
        `consecutive provision lines alternate white and light blue (${colorScheme})`);
      layout.expanded.entryTextColors.forEach((colors, index) => {
        const background = luminance(layout.expanded.entryBackgrounds[index]);
        for (const color of colors) {
          const text = luminance(color);
          const contrast = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
          assert.ok(contrast >= 4.5, `provision text must remain readable (${colorScheme}): ${contrast}`);
        }
      });
      assert.equal(layout.sameBatch.open, true);
      assert.equal(layout.sameBatch.scroll, layout.sameBatch.previousScroll);
      assert.equal(layout.sameBatch.composerPreserved, true);
      assert.deepEqual(layout.sameBatch.entryBackgrounds, alternatingBackgrounds,
        'alternating line colors survive the next conversation render');
      assert.deepEqual(layout.changedBatch, { open: false, scroll: 0 });
    }
  } finally { await server.close(); }
});
