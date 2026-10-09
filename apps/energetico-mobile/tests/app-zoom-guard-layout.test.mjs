import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('menus disable page pinch and double-tap while scrolling, signature and Power BI keep their gestures', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    const baseline = await runBrowserLayout(browser, { width: 390, height: 844, mobile: true, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-zoom-guard.html?baseline=1`, gestureProbes: [{ pinch: { x: 195, y: 150, scaleFactor: 1.8 } }] });
    t.diagnostic(`Unrestricted browser pinch baseline: ${JSON.stringify(baseline.gestureScales)}`);
    for (const width of [390, 1024]) {
      const { stdout, gestureScales, gestureDetails } = await runBrowserLayout(browser, { width, height: 844, mobile: true, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-zoom-guard.html`, gestureProbes: [
        { pinch: { x: width / 2, y: 150, scaleFactor: 1.8 } },
        { expression: "window.zoomReport.open({ accessToken: 'test', getAccessToken: async () => 'test' })", pinch: { x: width / 2, y: 400, scaleFactor: 1.8 }, ...(baseline.gestureScales[0] === 1 ? { pageScaleFactor: 1.8 } : {}) },
        { expression: 'window.zoomReport.close()' },
      ] });
      const result = JSON.parse(stdout.match(/data-layout="([^"]+)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      assert.equal(result.menu.action, 'pan-x pan-y', 'a menu button must not allow browser pinch zoom');
      assert.equal(result.menu.scroller, 'pan-x pan-y', 'scrollable menu must keep panning but not pinch');
      assert.ok(result.menu.searchSize >= 16 && result.menu.draftSize >= 16, 'input focus must not request iOS magnification');
      assert.equal(result.menu.largeSize, 22, 'already-readable larger fields must not shrink');
      assert.equal(result.menu.signature, 'none', 'signature drawing gesture lock must remain intact');
      assert.equal(result.menu.pdf, 'pan-x pan-y', 'PDF retains its own pinch controller');
      assert.deepEqual(result.powerbi, { root: 'manipulation', body: 'manipulation', section: 'manipulation', frame: 'manipulation' });
      assert.equal(result.closed, 'pan-x pan-y', 'closing Power BI restores menu pinch protection');
      assert.ok(gestureDetails[0].touches.some(touch => touch.touches > 1 && touch.cancelled), 'menu pinch events must actually be cancelled');
      const reportTouches = gestureDetails[1].touches.slice(gestureDetails[0].touches.length);
      assert.ok(reportTouches.some(touch => touch.touches > 1 && !touch.cancelled), 'report pinch events must remain available to the viewer');
      assert.equal(gestureScales[0], 1, 'real touchscreen pinch must not enlarge menus');
      assert.ok(gestureScales[1] > 1.1, `report zoom state must be reproduced: ${JSON.stringify({ width, gestureScales, gestureDetails })}`);
      assert.equal(gestureScales[2], 1, 'closing the report must restore the page scale');
    }
  } finally { await server.close(); }
});
