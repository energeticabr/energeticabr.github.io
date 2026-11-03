// Synthetic real-channel packets through the unchanged app store and renderer.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = resolve(fileURLToPath(new URL('../../apps/energetico-mobile/', import.meta.url)));
const require = createRequire(app + '/package.json');
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { JSDOM } = require('jsdom');
const { runBrowserLayout } = await import(pathToFileURL(app + '/tests/helpers/browser-layout-runner.mjs').href);
const packets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const temporaryRoot = resolve(tmpdir()), cacheDir = mkdtempSync(join(temporaryRoot, 'energetico-order-supplier-'));
const browser = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const page = mode => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app"></main><script type="module">
import '/src/styles.css';
import {renderChatMarkup, commandFromTarget} from '/src/ui/chat-view.js';
import {createConversationStore} from '/src/chat/conversation-store.js';
const store=createConversationStore({historyMode:'current-step'});
store.ingestRemoteMessages(${JSON.stringify(packets[mode === 'confirm' ? 0 : 1].messages)},{activeFlow:{id:'launch',title:'EFETUAR LANÇAMENTO'}});
document.querySelector('#app').innerHTML=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste',username:'teste@example.test'},draft:'',pendingFiles:[],activeText:null,error:null,...store.getState()});
await document.fonts.ready;
await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const buttons=[...document.querySelectorAll('button[data-reply-id]')].filter(b=>b.dataset.replyId.includes('single_order_supplier'));
document.documentElement.dataset.layout=JSON.stringify({mode:${JSON.stringify(mode)},overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:buttons.map(b=>({text:b.textContent.trim(),reply:b.dataset.replyId,command:commandFromTarget(b),x:b.getBoundingClientRect().x,right:b.getBoundingClientRect().right,height:b.getBoundingClientRect().height})),input:[...document.querySelectorAll('textarea,input')].map(n=>({placeholder:n.placeholder,disabled:n.disabled}))});
</script></body></html>`;
let server;
try {
  server = await createServer({root:app,cacheDir,logLevel:'silent',server:{host:'127.0.0.1',port:0},plugins:[{
    name:'single-order-supplier-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
      const url=new URL(req.url,'http://localhost');if(url.pathname!=='/order-supplier-fixture')return next();
      res.setHeader('Content-Type','text/html');res.end(page(url.searchParams.get('mode')));
    });}
  }]});
  await server.listen();
  for (const width of [320,390,1200]) for (const mode of ['confirm','select']) {
    const result=await runBrowserLayout(browser,{width,height:844,captureScreenshot:true,url:`http://127.0.0.1:${server.httpServer.address().port}/order-supplier-fixture?mode=${mode}`});
    const dom=new JSDOM(result.stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.overflow,false,`${mode} ${width}px no page overflow`);
    assert.equal(layout.buttons.length,2,JSON.stringify(layout));
    for(const button of layout.buttons){assert.ok(button.x>=0&&button.right<=width+1&&button.height>=44,JSON.stringify(button));assert.ok(button.command,JSON.stringify(button));}
    if(mode==='select')assert.ok(layout.input.some(i=>!i.disabled&&/filtrar/i.test(i.placeholder)),JSON.stringify(layout));
    writeFileSync(join(output,`${mode}-${width}.png`),result.screenshot);
    console.log(JSON.stringify({width,...layout}));
  }
} finally {
  await server?.close();
  assert.equal(dirname(resolve(cacheDir)),temporaryRoot);assert.ok(basename(cacheDir).startsWith('energetico-order-supplier-'));
  rmSync(cacheDir,{recursive:true,force:true});
}
