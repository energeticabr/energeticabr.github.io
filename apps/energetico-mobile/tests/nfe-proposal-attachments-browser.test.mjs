import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createServer,normalizePath} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

test('proposal attachment bar remains reachable on phones and Windows and restores original files from IndexedDB',{timeout:120000},async t=>{
 const browser=[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
 if(!browser)return t.skip('Chrome unavailable');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 // Resolve installed ESM dependencies directly: Vite's dev resolver can miss pnpm symlinks on Windows.
 const esm=new Map(['decimal.js','@capacitor/screen-orientation','@capacitor/core'].map(id=>[id,normalizePath(realpathSync(fileURLToPath(import.meta.resolve(id))))]));
 const server=await createServer({root,resolve:{preserveSymlinks:true},plugins:[{name:'fixture-dependencies',enforce:'pre',resolveId(id){return esm.get(id);}}],cacheDir:'node_modules/.vite-nfe-proposal-attachments',optimizeDeps:{noDiscovery:true,exclude:[...esm.keys()]},server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[resolve(root,'../..')]}},logLevel:'silent'});
 try{await server.listen();
  for(const [width,height]of [[320,568],[390,844],[844,390],[1365,900]]){
   const result=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-proposal-attachments.html`,captureScreenshot:Boolean(process.env.NFE_CAPTURE_DIR)});
   const dom=new JSDOM(result.stdout);let state;
   try{state=JSON.parse(dom.window.document.documentElement.dataset.layout);}finally{dom.window.close();}
   assert.equal(state.error,undefined,JSON.stringify(state));assert.equal(state.choices,4);
   for(const key of ['afterLines','noOverflow','footerVisible','fileVisible','restored'])assert.equal(state[key],true,`${key} at ${width}: ${JSON.stringify(state)}`);
   for(const key of ['summaryFits','wideHeaderFields','headerChipFills'])assert.equal(state[key],true,`${key} at ${width}: ${JSON.stringify(state)}`);
   assert.deepEqual(state.summaryValues,['DENVERTEC 540 FIBRAS IMPERMEABILIZANTE 18 KG','ALVENARIA E ESTRUTURAS','2 CX','R$\u00a050,00','R$\u00a0100,00']);
   if(result.screenshot){
    mkdirSync(process.env.NFE_CAPTURE_DIR,{recursive:true});writeFileSync(join(process.env.NFE_CAPTURE_DIR,`proposal-attachments-${width}.png`),result.screenshot);
    const header=await runBrowserLayout(browser,{width,height,url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-proposal-attachments.html?preview=header`,captureScreenshot:true});
    writeFileSync(join(process.env.NFE_CAPTURE_DIR,`proposal-header-${width}.png`),header.screenshot);
   }
  }
 }finally{await server.close();}
});
