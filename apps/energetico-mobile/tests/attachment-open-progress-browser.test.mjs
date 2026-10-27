import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { startAttachmentDownloadServer } from './helpers/attachment-download-server.mjs';

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find(path => path && existsSync(path));

function assertMeasuredStages(data) {
  assert.equal(data.seen.includes('—%'), false, JSON.stringify(data));
  const values = data.seen.map(value => Number(value.replace('%', '')));
  assert.ok(values.length > 0, JSON.stringify(data));
  for (const [index, value] of values.entries()) {
    assert.ok(Number.isFinite(value) && value >= 33 && value <= 100, JSON.stringify(data));
    if (index) assert.ok(value >= values[index - 1], JSON.stringify(data));
  }
  assert.equal(data.completeBeforeRendered, false, JSON.stringify(data));
}

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
    assertMeasuredStages(data);
    assert.equal(data.seen[0], '33%', JSON.stringify(data));
    assert.ok(data.seen.includes('50%'), JSON.stringify(data));
    assert.ok(data.seen.includes('66%'), JSON.stringify(data));
    assert.ok(data.seen.includes('99%'), JSON.stringify(data));
    assert.ok(data.byteSamples.some(value => value.percent === 50 && value.loaded * 2 === value.total), JSON.stringify(data));
    assert.ok(data.snapshots.some(value => value.percent > 66 && value.percent < 99), JSON.stringify(data));
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
    assertMeasuredStages(data);
    assert.equal(data.seen.includes('100%'), mode === 'unknown' || mode === 'native', JSON.stringify(data));
    if (mode === 'native') {
      assert.equal(data.pageRendered, true, JSON.stringify(data));
      assert.equal(data.nativeReady, true, 'native fallback must emit its real iframe load event');
      assert.equal(data.completeBeforeRendered, false);
      assert.ok(data.seen.indexOf('82%') >= 0 && data.seen.indexOf('82%') < data.seen.indexOf('100%'), JSON.stringify(data));
      assert.ok(data.snapshots.some(value => value.percent === 82 && !value.ready), JSON.stringify(data));
      assert.equal(data.seen.at(-1), '100%'); continue;
    }
    if (mode === 'unknown') {
      assert.equal(data.seen[0], '33%');
      assert.ok(data.byteSamples.some(value => value.loaded > 0 && value.total === null && value.percent === null), JSON.stringify(data));
      assert.ok(data.snapshots.some(value => value.percent === 33 && /\d+ bytes recebidos.*total não informado/i.test(value.message)), JSON.stringify(data));
      assert.ok(data.snapshots.some(value => value.percent > 66 && value.percent < 100), JSON.stringify(data));
      assert.equal(data.pageRendered, true, JSON.stringify(data));
      assert.equal(data.seen.at(-1), '100%');
    } else if (mode === 'cancel') {
      assert.equal(data.closed, true);
      assert.equal(data.signalAborted, true);
    }
    else assert.equal(data.failed, true);
  }
});
