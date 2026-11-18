import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('GANTT mostra durações curtas à direita, mantém longas dentro e recalcula ao redimensionar', {timeout:90000}, async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'silent'});
 try {
  await server.listen();
  for(const [width,height] of [[320,740],[390,844],[844,390],[1365,900]]) {
   const {stdout}=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gantt-duration.html`});
   const dom=new JSDOM(stdout);
   try {
    const result=JSON.parse(dom.window.document.documentElement.dataset.layout);
    const row=(rows,name)=>rows.find(row=>row.name===name);
    assert.deepEqual(result.initial.map(row=>row.name),['Longa','Curta','Curta no final']);
    for(const rows of [result.initial,result.resized,result.fontResized]) {
     assert.ok(row(rows,'Longa').fits,JSON.stringify(result));
     assert.ok(row(rows,'Curta no final').outside,JSON.stringify(result));
     assert.equal(row(rows,'Curta no final').text,'1 dia');
     for(const item of rows) {
      assert.equal(item.dates.length,2,'Início e fim devem aparecer nas extremidades');
      assert.deepEqual(item.dates.map(date=>date.color),['rgb(36, 114, 58)','rgb(170, 40, 57)']);
      assert.ok(item.dates.every(date=>date.rowSafe&&date.trackSafe),JSON.stringify(item));
     }
     assert.ok(row(rows,'Longa').dates.every(date=>date.inside),JSON.stringify(rows));
     for(const name of ['Curta','Curta no final']) {
      const {dates,separator}=row(rows,name);
      assert.ok(dates.every(date=>date.below),JSON.stringify(rows));
      assert.ok(Math.abs(dates[1].top-dates[0].top)<1,JSON.stringify(rows));
      assert.ok(separator?.visible&&separator.text==='—',JSON.stringify(rows));
      assert.ok(separator.left>=dates[0].left+dates[0].width+2,JSON.stringify(rows));
      assert.ok(dates[1].left>=separator.left+separator.width+2,JSON.stringify(rows));
      if(name==='Curta no final') assert.ok(Math.abs((dates[0].left+dates[1].left+dates[1].width)/2-row(rows,name).barWidth/2)<1,JSON.stringify(rows));
     }
     assert.deepEqual(row(rows,'Longa').dates.map(date=>date.text),['02/01/2026','29/04/2026']);
     assert.equal(row(rows,'Curta').dates[1].text,'Em andamento');
    }
    assert.ok(row(result.initial,'Curta').outside,JSON.stringify(result));
    assert.ok(row(result.resized,'Curta').fits,JSON.stringify(result));
    assert.ok(result.endVisible&&result.detailOpen,JSON.stringify(result));
   }finally{dom.window.close();}
  }
 }finally{await server.close();}
});
