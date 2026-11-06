import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('payment IDs and totals stay on one line with bold readable suppliers and full-width questions', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  await server.listen();
  try {
    for(const width of [320,390,768,1365]) {
      const {stdout,screenshot}=await runBrowserLayout(browser,{width,height:1000,captureScreenshot:Boolean(process.env.PAYROLL_LAYOUT_CAPTURE),url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-assignment-layout.html`});
      if(screenshot)await writeFile(`${process.env.PAYROLL_LAYOUT_CAPTURE}-${width}.png`,screenshot);
      const dom=new JSDOM(stdout);
      const layout=JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      const context=JSON.stringify({width,...layout});
      for(const cells of layout.cells) {
        assert.equal(cells[0].lines,1,context);
        assert.equal(cells[2].lines,1,context);
        assert.ok(cells[0].weight>=700&&cells[1].weight>=700,context);
        assert.ok(cells.every(cell=>cell.fits),context);
      }
      assert.ok(layout.avatarHidden&&layout.fullWidth&&layout.tableFits&&!layout.overflow,context);
      assert.equal(layout.buttons.length,2,context);
      assert.ok(layout.buttons.every(button=>button.fits),context);
    }
  }finally{await server.close();}
});
