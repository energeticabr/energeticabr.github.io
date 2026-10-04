import assert from 'node:assert/strict';
const base='https://www.energeticabr.com';
const response=await fetch(base+'/energetico/?single-confirmation='+Date.now(),{signal:AbortSignal.timeout(30000)});
assert.ok(response.ok);
const html=await response.text();
const entries=[...html.matchAll(/src="([^"]+\.js)"/g)].map(m=>m[1]);assert.ok(entries.length);
const queue=[...entries,...[...html.matchAll(/href="([^"]+\.css)"/g)].map(m=>m[1])].map(p=>new URL(p,base).href);
const visited=new Set(),sources=[];
const hasTable=extension=>sources.some(x=>x.url.endsWith(extension)&&x.source.includes('chat-single-launch-confirmation'));
while(queue.length&&!(hasTable('.js')&&hasTable('.css'))){
  const url=queue.shift();if(visited.has(url))continue;visited.add(url);assert.ok(visited.size<120);
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.ok(r.ok,url+': '+r.status);
  const source=await r.text();sources.push({url,source});
  for(const m of source.matchAll(/["'`]([^"'`\s]+\.(?:js|css))["'`]/g)){
    if(m[1].startsWith('http')||m[1].includes('node_modules'))continue;
    const next=new URL(m[1],m[1].startsWith('assets/')?base+'/energetico/':url);
    if(next.origin===base&&next.pathname.startsWith('/energetico/assets/'))queue.push(next.href);
  }
}
const js=sources.filter(x=>x.url.endsWith('.js')).map(x=>x.source).join('\n');
const css=sources.filter(x=>x.url.endsWith('.css')).map(x=>x.source).join('\n');
assert.ok(js.includes('chat-single-launch-confirmation')&&js.includes('Conferência do lançamento único'));
assert.ok(css.includes('chat-single-launch-confirmation'));
console.log(JSON.stringify({status:'SINGLE_CONFIRMATION_CLIENT_LIVE_VERIFIED',entries,assets:visited.size}));
