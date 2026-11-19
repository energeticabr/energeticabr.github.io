import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('selected chips fit compact reports and hide the original field text', {timeout:90000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser)return t.skip('Chrome unavailable');
  const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const server=await createServer({root,server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
  try {
    await server.listen();
    for(const [width,height] of [[568,320],[320,568],[390,844],[1365,900]]) {
      const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/selected-filter-chips.html`});
      const dom=new JSDOM(stdout);
      try {
        const state=JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.deepEqual(state.results,Array.from({length:4},()=>({transparent:true,fits:true,hit:true,cleared:true})),`${width}x${height}`);
        assert.equal(state.visibleAtLeastSeven,true,`selected chip leaves at least seven choices visible at ${width}x${height}`);
      }finally{dom.window.close();}
    }
  }finally{await server.close();}
});
