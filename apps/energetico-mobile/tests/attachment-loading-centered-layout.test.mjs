import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('file and media loaders stay centered between preview navigation and actions', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host:'127.0.0.1', port:0 } });
  await server.listen(); t.after(() => server.close());
  for (const [width, height] of [[320,740], [589,1280], [844,390], [1024,768]]) {
    const { stdout } = await runBrowserLayout(browser, { width, height, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attachment-loading-centered.html` });
    const dom = new JSDOM(stdout), data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(data.results.length, 21);
    for (const result of data.results) {
      const message = JSON.stringify({ width, height, ...result });
      assert.ok(Math.abs(result.centerX - result.expectedX) <= 2, message);
      assert.ok(Math.abs(result.centerY - result.expectedY) <= 2, message);
      assert.ok(result.top >= result.headerBottom && result.bottom <= result.footerTop, message);
      assert.ok(result.closeVisible && !result.overflow, message);
    }
    assert.deepEqual(data.ready, { loaderRemoved:true, textVisible:true });
    assert.deepEqual(data.failed, { loaderRemoved:true, explanationVisible:true });
  }
});
