import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

// Break caught: missing landscape rotation, clipped cards, footer navigation, or a dialog that stops short of the viewport.
test('Trancid report opens in landscape on phones and Windows with full card names, tappable DATA and expandable history', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for (const [width,height,safeAreaInsets] of [[320,568],[390,844,{top:59,bottom:34,left:0,right:0}],[568,320],[844,390,{top:0,bottom:21,left:59,right:59}],[1280,1000]]) {
      const mobile=width<1000;
      const iPhone=mobile&&width!==568;
      const userAgent=iPhone?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15':undefined;
      const {stdout,screenshot}=await runBrowserLayout(browser,{width,height,mobile,userAgent,safeAreaInsets,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/trancid-report-browser.html`,captureScreenshot:Boolean(process.env.TRANCID_SCREENSHOT_DIR)});
      if (screenshot) await writeFile(join(process.env.TRANCID_SCREENSHOT_DIR,`trancid-${width}.png`),screenshot);
      const dom=new JSDOM(stdout); let result;
      try { result=JSON.parse(dom.window.document.documentElement.dataset.layout); } finally { dom.window.close(); }
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      assert.equal(result.rotated,height>width,`${width}px must use landscape`);
      assert.equal(result.transform==='none',height<=width);
      assert.equal(result.busy,'false'); assert.equal(result.loads,0); assert.equal(result.month,'11'); assert.equal(result.year,'2026');
      assert.ok(result.dialog.left>=0&&result.dialog.right<=Math.max(width,height)&&result.dialog.top>=0&&result.dialog.bottom<=Math.min(width,height),`${width}px dialog outside viewport`);
      if(iPhone) assert.ok(result.dialog.left>=68,`${width}px must clear the iPhone camera area even with zero insets`);
      const logicalHeight=Math.min(width,height);
      assert.ok(Math.abs(result.dialog.top)<=1&&Math.abs(result.dialog.bottom-logicalHeight)<=1,`${width}px dialog must reach both vertical edges`);
      const safeBottom=(result.rotated?safeAreaInsets?.left:safeAreaInsets?.bottom)||0;
      assert.ok(result.dialog.bottom-result.body.bottom<=Math.max(3,safeBottom)+1,`${width}px only the safe area may sit below the scrolling body`);
      assert.ok(result.body.height>=80,`${width}px must leave room to scroll balances and history`);
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
      const [previous,next]=result.arrows;
      assert.ok(previous.right<=result.dialog.left&&next.left>=result.dialog.right,`${width}px navigation must sit beside the panel`);
      for (const arrow of result.arrows) {
        assert.ok(arrow.width>=44&&arrow.height>=44,`${width}px navigation touch target`);
        assert.ok(Math.abs((arrow.top+arrow.bottom)/2-logicalHeight/2)<=1,`${width}px navigation must sit at mid-height`);
      }
      assert.deepEqual(result.arrowsAfterScroll,result.arrows);
      assert.ok(result.lastCardBottom<=result.body.bottom,`${width}px last card must be fully scrollable`);
      assert.deepEqual(result.destinations,['open-supplier-payroll-report','open-contractor-control-report']);
      assert.deepEqual(result.pdfFilters.map(filter=>filter.value),['Novembro','2026']);
      assert.deepEqual(result.pdfTables,[5,5,5,5,5,5,5,5],'PDF must include the selected month for every card, including collapsed cards');
      t.diagnostic(`${width}x${height}: landscape, no overflow, 14 card digits, history and touch targets visible`);
    }
  } finally { await server.close(); }
});
