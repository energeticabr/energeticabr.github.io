import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { startAttachmentDownloadServer } from './helpers/attachment-download-server.mjs';

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path));

test('opening attachments paints measured download progress next to spinner, then 100 only for the rendered PDF', { timeout: 120000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await startAttachmentDownloadServer(); t.after(() => server.close());
  for (const [channel, width, height, colorScheme] of [
    ['VM', 320, 740, 'light'], ['SharePoint', 390, 844, 'light'], ['editor', 1365, 768, 'light'],
    ['editor', 320, 740, 'dark'], ['VM', 390, 844, 'dark'], ['SharePoint', 1365, 768, 'dark'],
  ]) {
    const { stdout } = await runBrowserLayout(browser, { width, height, colorScheme,
      url: `${server.url}/tests/fixtures/attachment-open-progress.html?channel=${channel}` });
    const dom = new JSDOM(stdout), data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.ok(data.seen.includes('0%'), JSON.stringify(data));
    assert.ok(data.seen.includes('50%'), JSON.stringify(data));
    assert.ok(data.seen.includes('99%'), JSON.stringify(data));
    assert.equal(data.seen.at(-1), '100%');
    assert.equal(data.pageRendered, true, JSON.stringify(data));
    assert.equal(data.completeBeforeRendered, false, JSON.stringify(data));
    assert.deepEqual(data.layout, { adjacent: true, aligned: true, contained: true, overflow: false },
      JSON.stringify({ channel, width, colorScheme, data }));
  }
  assert.equal(server.requests.length, 6, 'one GET per opened preview');
  for (const request of server.requests) assert.equal(request.authorization, 'Bearer local-test-only');
});

test('unknown totals and failed/cancelled opening never fabricate completion in the real browser', { timeout: 90000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge unavailable');
  const server = await startAttachmentDownloadServer(); t.after(() => server.close());
  for (const mode of ['unknown', 'denied', 'cancel', 'native']) {
    const { stdout } = await runBrowserLayout(browser, { width: 390, height: 844,
      url: `${server.url}/tests/fixtures/attachment-open-progress.html?channel=VM&mode=${mode}` });
    const dom = new JSDOM(stdout), data = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(data.seen.includes('100%'), mode === 'unknown' || mode === 'native', JSON.stringify(data));
    if (mode === 'native') {
      assert.equal(data.pageRendered, true, JSON.stringify(data));
      assert.equal(data.nativeReady, true, 'native fallback must emit its real iframe load event');
      assert.equal(data.completeBeforeRendered, false);
      assert.ok(data.seen.indexOf('99%') >= 0 && data.seen.indexOf('99%') < data.seen.indexOf('100%'), JSON.stringify(data));
      assert.equal(data.seen.at(-1), '100%'); continue;
    }
    if (mode === 'unknown') {
      assert.ok(data.seen.includes('—%')); assert.equal(data.pageRendered, true, JSON.stringify(data));
    } else if (mode === 'cancel') assert.equal(data.closed, true);
    else assert.equal(data.failed, true);
  }
});
