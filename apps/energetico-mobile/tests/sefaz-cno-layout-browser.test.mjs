import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { build, createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('CNO clusters keep their correct colors, position and readable numbers on phones, PWA and Windows', {timeout:240_000}, async t => {
  const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
  if(!browser) return t.skip('Chrome unavailable');
  const root=fileURLToPath(new URL('..',import.meta.url));
  const built=await build({configFile:false,root:join(root,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false}});
  const css=built.output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>item.source).join('\n');
  const server=await createServer({root,cacheDir:join(root,'node_modules/.vite-cno-layout'),logLevel:'silent',
    plugins:[{name:'cno-built-css',configureServer(dev){dev.middlewares.use('/__notas-built.css',(_req,res)=>{res.setHeader('Content-Type','text/css');res.end(css);});}}],
    server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'../..')]}}});
  await server.listen();t.after(()=>server.close());
  const screenshots=process.env.NOTAS_SEFAZ_SCREENSHOT_DIR;
  if(screenshots)mkdirSync(screenshots,{recursive:true});
  for(const state of ['corrected','valid','missing','conflict']) for(const [width,pwa] of [[320,false],[390,false],[1365,false],[390,true]]){
    const {stdout,screenshot}=await runBrowserLayout(browser,{width,height:1500,mobile:width<700,
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/notas-sefaz-responsive.html?cno=${state}&withholding${pwa?'&pwa':''}`,
      captureScreenshot:Boolean(screenshots)&&!pwa&&(width===390||(state==='corrected')||(width===320&&state==='conflict'))});
    const dom=new JSDOM(stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.overflow,false,`${state}/${width}/${pwa}: no page overflow`);
    assert.deepEqual(layout.overflowingCards,[]);
    assert.equal(layout.cno.status,state==='corrected'?'valid':state);
    const green=state==='valid'||state==='corrected';
    assert.equal(layout.cno.background,green?'rgb(233, 245, 235)':'rgb(255, 240, 240)');
    assert.equal(layout.cno.color,green?'rgb(33, 98, 61)':'rgb(163, 30, 44)');
    assert.equal(layout.cno.belowSupplier,true);
    assert.equal(layout.cno.aboveOtherClusters,true);
    assert.ok(Math.abs(layout.cno.width-layout.cno.mainWidth)<2,'CNO fills the card width');
    assert.ok(layout.cno.scrollWidth<=layout.cno.width+1);
    if(state==='corrected')assert.equal(layout.cno.text,'CNO: 90.025.44060/72 - NOTA DE CORREÇÃO');
    else assert.match(layout.cno.text,state==='missing'?/CNO não informada/:state==='valid'?/90\.025\.44060\/72/:/CNO errada.*90\.025\.44069\/72.*CNO correto da obra: 90\.025\.44060\/72/);
    if(screenshot)writeFileSync(join(screenshots,`cno-${state}-${width}.png`),screenshot);
    t.diagnostic(`${state}: ${width}px ${pwa?'PWA':'mobile'} verified`);
  }
});
