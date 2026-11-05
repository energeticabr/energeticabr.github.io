// Actual server polls rendered by the unchanged application, using fictitious data.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const app = resolve(fileURLToPath(new URL('../../apps/energetico-mobile/', import.meta.url)));
const require = createRequire(app + '/package.json');
const {createServer} = await import(pathToFileURL(require.resolve('vite')).href);
const {JSDOM} = require('jsdom');
const {runBrowserLayout} = await import(pathToFileURL(app + '/tests/helpers/browser-layout-runner.mjs').href);
const packets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const output = resolve(process.argv[3]); mkdirSync(output, {recursive:true});
const page = mode => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app"></main><script type="module">
import '/src/styles.css';
import {renderChatMarkup,commandFromTarget} from '/src/ui/chat-view.js';
import {createConversationStore} from '/src/chat/conversation-store.js';
const store=createConversationStore({historyMode:'current-step'});
store.ingestRemoteMessages(${JSON.stringify(packets[mode].messages)},{activeFlow:{id:'payment',title:'CRIAR UMA PROVISÃO DE PAGAMENTO'}});
document.querySelector('#app').innerHTML=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste',username:'teste@example.test'},draft:'',pendingFiles:[],activeText:null,error:null,...store.getState()});
await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const buttons=[...document.querySelectorAll('button[data-reply-id]')].filter(b=>b.dataset.replyId==='financial_catalog_create'||b.dataset.replyId.includes('tipo_despesa_produto_cadastro'));
document.documentElement.dataset.layout=JSON.stringify({overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:buttons.map(b=>({text:b.textContent.trim(),command:commandFromTarget(b),x:b.getBoundingClientRect().x,right:b.getBoundingClientRect().right,height:b.getBoundingClientRect().height})),filter:!!document.querySelector('textarea:not([disabled])')});
</script></body></html>`;
let server; const results=[];
try {
  server=await createServer({root:app,cacheDir:join(output,'vite-cache'),logLevel:'silent',server:{host:'127.0.0.1',port:0},plugins:[{name:'expense-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/expense-fixture')return next();res.setHeader('Content-Type','text/html');res.end(page(url.searchParams.get('mode')));});}}]});
  await server.listen();
  for(const width of [320,390,1200]) for(const mode of Object.keys(packets)) {
    const result=await runBrowserLayout('C:/Program Files/Google/Chrome/Application/chrome.exe',{width,height:844,captureScreenshot:true,url:`http://127.0.0.1:${server.httpServer.address().port}/expense-fixture?mode=${mode}`});
    const dom=new JSDOM(result.stdout),layout=JSON.parse(dom.window.document.documentElement.dataset.layout);dom.window.close();
    assert.equal(layout.overflow,false);assert.match(layout.buttons[0].text,/CADASTRAR TIPO DESPESA/);assert.ok(layout.filter);
    for(const b of layout.buttons){assert.ok(b.x>=0&&b.right<=width+1&&b.height>=44);assert.ok(b.command);}
    results.push({width,mode,...layout});writeFileSync(join(output,`${mode}-${width}.png`),result.screenshot);
  }
  writeFileSync(join(output,'verification.json'),JSON.stringify(results,null,2));
  console.log(`Passed ${results.length} real-renderer states at 320/390/1200px`);
} finally {await server?.close();}
