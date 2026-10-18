import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('attendance supplier arrow stays right of the left-aligned name and expands inside phone width', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, plain] of [[320, false], [390, false], [1280, false], [320, true], [390, true]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height: 844, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-supplier-details.html${plain ? '?plain' : ''}` });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.before.nameAlign, 'left', JSON.stringify(layout));
        assert.ok(layout.before.arrow.left >= layout.before.name.left, JSON.stringify(layout));
        assert.ok(layout.before.arrow.right <= layout.before.card.right + 1, JSON.stringify(layout));
        assert.ok(layout.before.textRects.every(rect => rect.right <= layout.before.arrow.left + 1
          || rect.bottom <= layout.before.arrow.top || rect.top >= layout.before.arrow.bottom), JSON.stringify(layout));
        assert.ok(layout.detail.right <= layout.viewport + 1, JSON.stringify(layout));
        assert.equal(layout.shown, true);
        assert.equal(layout.checkbox, false);
        assert.deepEqual(layout.values, ['13/10/2026', '384', 'PINTURA EXTERNA']);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});

test('detail arrow has its own header space and visible solid fill, never covering hours or inconsistencies', { timeout: 180000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  const overlaps = (a,b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(value => {
    const v = value/255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
  }).reduce((sum,value,index) => sum + value*[.2126,.7152,.0722][index],0);
  const contrast = (a,b) => { const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  try {
    await server.listen();
    for (const width of [390,320,1280]) for (const mode of ['regular','irregular','missing']) for (const name of ['short','long']) {
      const result = await runBrowserLayout(browser, { width, height:844,
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/attendance-supplier-details.html?mode=${mode}&name=${name}`,
        captureScreenshot:Boolean(process.env.ATTENDANCE_ARROW_SCREENSHOT_DIR) && width===390 && name==='short' });
      const dom = new JSDOM(result.stdout);
      const layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
      const {before} = layout, diagnostic = JSON.stringify({width,mode,name,...before});
      assert.equal(overlaps(before.arrow,before.badge),false,diagnostic);
      assert.ok(before.arrow.bottom <= before.summary.top + 1,diagnostic);
      assert.ok(before.punches.every(punch => !overlaps(before.arrow,punch)),diagnostic);
      assert.ok(before.textRects.every(rect => !overlaps(before.arrow,rect)),diagnostic);
      assert.ok(before.arrow.right <= before.card.right + 1,diagnostic);
      assert.ok(before.arrow.right-before.arrow.left >= 44 && before.arrow.bottom-before.arrow.top >= 44,diagnostic);
      assert.match(before.arrowFill,/^rgb\(/, 'the detail button must have an opaque fill');
      assert.ok(contrast(before.arrowFill,before.cardFill)>=3,diagnostic);
      assert.ok(contrast(before.arrowFill,before.arrowColor)>=4.5,diagnostic);
      assert.equal(layout.shown,true); assert.equal(layout.expanded,'true'); assert.equal(layout.checkbox,false);
      if (result.screenshot) {
        await mkdir(process.env.ATTENDANCE_ARROW_SCREENSHOT_DIR,{recursive:true});
        await writeFile(join(process.env.ATTENDANCE_ARROW_SCREENSHOT_DIR,`${mode}-390.png`),result.screenshot);
      }
    }
  } finally { await server.close(); }
});
