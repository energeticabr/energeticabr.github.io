import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

// Break caught: portrait rotation, horizontal clipping, hidden card digits, overlapping controls, or low/normal balances using the same color.
test('Trancid report fits portrait 320/390 and Windows with full card names, tappable DATA and expandable history', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for (const [width,height] of [[320,740],[390,844],[1280,800]]) {
      const {stdout,screenshot}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/trancid-report-browser.html`,captureScreenshot:Boolean(process.env.TRANCID_SCREENSHOT_DIR)});
      if (screenshot) await writeFile(join(process.env.TRANCID_SCREENSHOT_DIR,`trancid-${width}.png`),screenshot);
      const dom=new JSDOM(stdout); let result;
      try { result=JSON.parse(dom.window.document.documentElement.dataset.layout); } finally { dom.window.close(); }
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      assert.equal(result.transform,'none',`${width}px must remain upright`);
      assert.equal(result.busy,'false'); assert.equal(result.loads,0); assert.equal(result.month,'11'); assert.equal(result.year,'2026');
      assert.ok(result.dialog.left>=0&&result.dialog.right<=width&&result.dialog.top>=0&&result.dialog.bottom<=height,`${width}px dialog outside viewport`);
      assert.equal(result.documentOverflow,0); assert.ok(result.bodyOverflow<=1); assert.ok(result.toolbarOverflow<=1);
      assert.equal(result.scrollable,true); assert.equal(result.cards.length,8);
      for (const card of result.cards) assert.ok(card.left>=result.dialog.left&&card.right<=result.dialog.right,`${width}px card clipping`);
      for (const control of result.controls) { assert.ok(control.width>=44&&control.height>=44,`${width}px touch target ${control.label}`); assert.ok(control.left>=result.dialog.left&&control.right<=result.dialog.right); }
      assert.ok(result.name.height>20,'the long name must wrap and remain readable');
      assert.ok(result.cardNumber.right<=result.cards[0].right&&result.cardNumber.left>=result.cards[0].left);
      assert.ok(result.tableOverflow<=1); assert.ok(result.table.left>=result.cards[0].left&&result.table.right<=result.cards[0].right);
      assert.deepEqual(result.headerCells.map(cell=>cell.text),['DATA','SALDO','VARIAÇÃO']);
      assert.equal(result.balanceColors[0],'rgb(191, 32, 27)'); assert.notEqual(result.balanceColors[1],result.balanceColors[0]);
      assert.equal(result.arrows.length,2); assert.equal(result.actions.length,2,'PDF and refresh must both be available');
      assert.ok(result.navigation.top>=result.body.bottom-1,`${width}px navigation must not overlap report contents`);
      for (const arrow of result.arrows) assert.ok(arrow.top>=result.body.bottom&&arrow.bottom<=result.dialog.bottom,`${width}px navigation overlaps a card`);
      assert.deepEqual(result.pdfFilters.map(filter=>filter.value),['Novembro','2026']);
      assert.deepEqual(result.pdfTables,[5,5,5,5,5,5,5,5],'PDF must include the selected month for every card, including collapsed cards');
      t.diagnostic(`${width}x${height}: upright, no overflow, 14 card digits, history and touch targets visible`);
    }
  } finally { await server.close(); }
});
