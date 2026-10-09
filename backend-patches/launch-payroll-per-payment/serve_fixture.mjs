// Actual channel messages through the app's existing conversation store and renderer.
// Local synthetic evidence only: no production API, user session, or financial writes.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const app=resolve(fileURLToPath(new URL('../../apps/energetico-mobile/',import.meta.url)));
const require=createRequire(app+'/package.json');
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'));
const page=key=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app"></main><script type="module">
import '/src/styles.css';
import {renderChatMarkup} from '/src/ui/chat-view.js';
import {createConversationStore} from '/src/chat/conversation-store.js';
const store=createConversationStore({historyMode:'current-step'});
store.ingestRemoteMessages(${JSON.stringify(fixture[key])},{activeFlow:{id:'launch',title:'EFETUAR LANÇAMENTO'}});
document.querySelector('#app').innerHTML=renderChatMarkup({sessionStatus:'authenticated',account:{name:'Teste isolado',username:'test@example.test'},draft:'',pendingFiles:[],activeText:null,error:null,...store.getState()});
document.documentElement.dataset.ready='true';
</script></body></html>`;
const server=await createServer({root:app,logLevel:'silent',server:{host:'127.0.0.1',port:5180,strictPort:true},plugins:[{
  name:'per-payment-channel-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname!=='/per-payment-fixture'){next();return;}
    const key=url.searchParams.get('payment')==='2'?'second':'first';
    res.setHeader('Content-Type','text/html');res.end(page(key));
  });}
}]});
await server.listen();
console.log('Synthetic app fixture http://127.0.0.1:5180/per-payment-fixture?payment=1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
