import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

// Break caught: a CSS change lets shared arrows cover financial cells or clips searchable filters.
test('pending supplier report reserves both arrow edges and captures full tables on phone tablet and Windows desktop',{timeout:180000},async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server=await createServer({root:resolve(fileURLToPath(new URL('..',import.meta.url))),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  try {
    await server.listen();
    for (const [width,height] of [[844,390],[667,375],[1024,768],[1280,800],[390,844]]) {
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-supplier-payments-report-browser.html`});
      const dom=new JSDOM(stdout); let result;
      try {result=JSON.parse(dom.window.document.documentElement.dataset.layout);} finally {dom.window.close();}
      assert.equal(result.error,undefined,`${width}px: ${result.error}`);
      if (height>width) {
        assert.equal(result.loads,0); assert.equal(result.warning,true); assert.equal(result.closeVisible,true);
        assert.equal(result.busy,'true'); assert.equal(result.tables,0); continue;
      }
      assert.equal(result.logoLoaded,true); assert.equal(result.arrows.length,2);
      assert.equal(result.documentOverflow,0,`${width}px document overflow`);
      assert.ok(result.toolbarOverflow<=1,`${width}px toolbar overflow ${result.toolbarOverflow}`);
      assert.ok(result.contentOverflow<=1,`${width}px content overflow ${result.contentOverflow}`);
      assert.ok(result.contentHeight>100); assert.ok(result.contentScrollHeight>result.contentHeight);
      assert.ok(parseFloat(result.fontSize)>=11);
      assert.deepEqual(result.tables.map(table=>[table.columns,table.rows]),[[5,12],[4,12]]);
      for (const table of result.tables) {
        assert.ok(table.left>=result.arrows[0].right+2,`${width}px previous arrow overlaps table`);
        assert.ok(table.right<=result.arrows[1].left-2,`${width}px next arrow overlaps table`);
      }
      assert.deepEqual(result.backgrounds,['rgb(255, 243, 224)','rgb(255, 224, 178)','rgb(30, 136, 229)']);
      assert.deepEqual(result.capturedTables,[{columns:5,rows:15},{columns:4,rows:14}]);
      assert.deepEqual(result.actions.map(action=>action.label),['Abrir PDF do relatório','Atualizar pagamentos pendentes']);
      for (const action of result.actions) {assert.ok(action.height>=40&&action.height<=48); assert.ok(action.width>=20&&action.width<=48);}
      assert.ok(Math.abs(result.actions[0].top-result.actions[1].top)<1,'print and refresh stay aligned');
      assert.ok(result.actions[1].right<=result.firstDate.left-2,`${width}px refresh overlaps the date filter`);
      assert.equal(result.popup.placement,'expanded'); assert.equal(result.popup.searchFocused,false);
      assert.ok(result.popup.left>=0&&result.popup.right<=width);
      assert.ok(result.popup.height>150&&result.popup.height<=height);
      assert.equal(result.keyboard.focused,true);
      assert.equal(result.keyboard.height,result.popup.height,'keyboard must preserve full picker height');
      assert.equal(result.keyboard.width,result.popup.width);
      assert.equal(result.keyboard.report.height,height,'keyboard must preserve full report viewport');
      assert.ok(result.keyboard.scrollOverflow<=1);
      assert.equal(result.keyboard.fontSize,result.fontSize,'keyboard must not inflate report fonts');
      for (const table of result.keyboard.tables) {
        assert.ok(table.left>=result.keyboard.arrows[0].right+2,`${width}px keyboard previous arrow overlaps table`);
        assert.ok(table.right<=result.keyboard.arrows[1].left-2,`${width}px keyboard next arrow overlaps table`);
      }
      t.diagnostic(`${width}x${height}: tables ${Math.round(result.tables[0].width)}px, both arrows clear; full PDF 12+12 rows`);
    }
  } finally {await server.close();}
});
