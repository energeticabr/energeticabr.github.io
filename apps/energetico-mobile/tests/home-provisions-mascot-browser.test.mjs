import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { build, createServer } from 'vite';

test('mascote externo preserva largura de Pendências e abre provisões em celular/tablet/PC/PWA', {timeout:120000}, async t=>{
  const browser=[process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!browser)return t.skip('Chrome unavailable');
  const app=resolve(fileURLToPath(new URL('..',import.meta.url)));
  const built=await build({configFile:false,root:join(app,'pwa'),base:'/energetico/',logLevel:'silent',build:{write:false}});
  const css=built.output.filter(a=>a.type==='asset'&&a.fileName.endsWith('.css')).map(a=>a.source).join('\n');
  const server=await createServer({root:app,server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  const profile=mkdtempSync(join(tmpdir(),'home-provisions-'));
  const pending=new Map();let child,socket;
  try {
    await server.listen();
    child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
    const portFile=join(profile,'DevToolsActivePort');
    for(let n=0;n<200&&!existsSync(portFile);n++)await delay(100);
    assert.ok(existsSync(portFile));
    const [port,path]=readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done,fail)=>{socket.addEventListener('open',done,{once:true});socket.addEventListener('error',fail,{once:true});});
    let seq=0;
    socket.addEventListener('message',e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.fail(new Error(r.error.message)):p.done(r.result);});
    const send=(method,params={},sessionId)=>new Promise((done,fail)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);fail(new Error(method+' timed out'));},15000);pending.set(id,{done,fail,timer});socket.send(JSON.stringify({id,method,params,sessionId}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
    for(const [width,pwa] of [[320,false],[390,false],[768,false],[1365,false],[390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await send('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-provisions-mascot.html?width=${width}&pwa=${pwa}`},sessionId);
      let ready=false;for(let n=0;n<120&&!ready;n++){ready=await evaluate(`location.search==='?width=${width}&pwa=${pwa}'&&document.documentElement?.dataset.ready==='true'`);if(!ready)await delay(100);}
      assert.ok(ready);
      if(pwa)await evaluate(`(()=>{document.querySelectorAll('style,link[rel=stylesheet]').forEach(n=>n.remove());const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);})()`);
      const layout=await evaluate(`(()=>{const m=document.querySelector('.chat-main-provisions-shortcut'),p=document.querySelector('[data-reply-id=group_pending]'),b=p.closest('.chat-bubble'),n=document.querySelector('[data-reply-id=group_supplies]'),i=m.querySelector('img'),transcript=document.querySelector('.chat-transcript');const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {m:rect(m),p:rect(p),b:rect(b),n:rect(n),i:rect(i),image:i.naturalWidth>0,external:!b.contains(m),overflow:document.documentElement.scrollWidth>innerWidth+1,transcriptOverflow:transcript.scrollWidth>transcript.clientWidth+1};})()`);
      assert.ok(layout.external,'mascote deve ficar fora do cartão branco');
      assert.ok(layout.m.right<=layout.b.x-4,'mascote não deve invadir o cartão');
      assert.ok(Math.abs(layout.m.y-layout.p.y)<=1,'mascote alinhado ao topo de Pendências');
      assert.ok(Math.abs(layout.p.width-layout.n.width)<=1,'Pendências ocupa a mesma largura dos demais botões: '+JSON.stringify(layout));
      if(width<=768)assert.ok(Math.abs(layout.p.x-layout.n.x)<=1,'botões móveis alinhados na mesma coluna');
      assert.ok(layout.m.x>=0&&layout.m.width>=44&&layout.m.height>=44&&!layout.overflow,JSON.stringify(layout));
      assert.equal(layout.transcriptOverflow,false,'área rolável sem overflow lateral');
      assert.ok(layout.image&&layout.i.x>=layout.m.x&&layout.i.right<=layout.m.right&&layout.i.bottom<=layout.m.bottom);
      const reportLayout=await evaluate(`(()=>{const r=document.querySelector('.chat-main-payment-ledger-shortcut'),m=document.querySelector('.chat-main-provisions-shortcut'),b=document.querySelector('.chat-message--external-provisions .chat-bubble');if(!r)return null;const rr=r.getBoundingClientRect(),mr=m.getBoundingClientRect(),br=b.getBoundingClientRect(),i=r.querySelector('img');return {x:rr.x,y:rr.y,right:rr.right,bottom:rr.bottom,width:rr.width,height:rr.height,mascotBottom:mr.bottom,cardLeft:br.x,external:!b.contains(r),image:i.naturalWidth>0,fill:getComputedStyle(r).backgroundColor};})()`);
      assert.ok(reportLayout, 'novo relatório acessível na tela inicial');
      assert.ok(reportLayout.external&&reportLayout.y>=reportLayout.mascotBottom+4&&reportLayout.right<=reportLayout.cardLeft-4,JSON.stringify(reportLayout));
      assert.ok(reportLayout.width>=44&&reportLayout.height>=44&&reportLayout.x>=0&&reportLayout.image);
      assert.equal(reportLayout.fill,'rgb(0, 13, 75)');
      assert.equal(await evaluate(`(()=>{const b=document.querySelector('.chat-main-payment-ledger-shortcut'),i=b.querySelector('img');return getComputedStyle(b).overflow==='hidden'&&i.getBoundingClientRect().width>b.getBoundingClientRect().width*1.4;})()`),true,'mascote ampliado, bordas internas recortadas');
      await evaluate(`document.querySelector('.chat-main-payment-ledger-shortcut').click()`);
      assert.equal(await evaluate('window.reportOpened'),1);
      if(width<844){
        assert.equal(await evaluate('window.reportLoads'),0,'vertical não consulta dados');
        assert.equal(await evaluate(`document.querySelector('.pl-orientation').hidden`),false);
        assert.equal(await evaluate(`document.querySelector('.pl-report').hidden`),true);
        const landscape=width===320?{width:568,height:320}:width===768?{width:1024,height:768}:{width:844,height:390};
        await send('Emulation.setDeviceMetricsOverride',{...landscape,deviceScaleFactor:1,mobile:false},sessionId);
      }
      let loaded=false;for(let n=0;n<80&&!loaded;n++){loaded=await evaluate(`document.querySelectorAll('.pl-table tbody tr').length===10`);if(!loaded)await delay(100);}
      assert.ok(loaded,'horizontal carrega relatório real');
      assert.equal(await evaluate('window.reportLoads'),1);
      assert.equal(await evaluate(`document.querySelector('.pl-table [data-column="supplierTotal"]').textContent.includes('543,23')`),true);
      const modal=await evaluate(`(()=>{const p=document.querySelector('.pl-dialog').getBoundingClientRect();return {x:p.x,right:p.right,y:p.y,bottom:p.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
      assert.ok(modal.x>=8&&modal.right<=await evaluate('innerWidth')-8&&!modal.overflow,JSON.stringify(modal));
      assert.equal(await evaluate(`(()=>{const p=document.querySelector('.pl-dialog').getBoundingClientRect(),h=document.querySelector('.pl-table thead').getBoundingClientRect();return h.top>=p.top&&h.bottom<p.bottom;})()`),true,'cabeçalho da tabela visível sem rolar o relatório na horizontal');
      const fit=await evaluate(`(()=>{const p=document.querySelector('.pl-dialog').getBoundingClientRect(),f=[...document.querySelectorAll('.pl-dates,.pl-filter')].map(n=>n.getBoundingClientRect()),s=document.querySelector('.pl-table-scroll'),t=document.querySelector('.pl-table'),logo=document.querySelector('.pl-logo');return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:s.scrollWidth<=s.clientWidth+1,top:p.top,bottom:p.bottom,vh:innerHeight,logo:logo?.naturalWidth>0,red:getComputedStyle(t.querySelector('[data-column=supplierTotal]')).color,bold:getComputedStyle(t.querySelector('[data-column=total]')).fontWeight};})()`);
      assert.ok(fit.aligned&&fit.fits&&fit.logo,JSON.stringify(fit));
      if(await evaluate('innerHeight<=500'))assert.ok(fit.top<=1&&fit.bottom>=fit.vh-1,'relatório ocupa altura toda');
      assert.equal(fit.red,'rgb(255, 0, 0)'); assert.ok(Number(fit.bold)>=700);
      assert.ok(await evaluate(`(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');return [...document.querySelectorAll('.pl-date-display')].every(n=>{n.value='02/10/2026';const s=getComputedStyle(n);ctx.font=s.font;return ctx.measureText(n.value).width<=n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);});})()`),'datas dd/mm/yyyy preenchidas cabem integralmente');
      await evaluate(`document.querySelector('.pl-date-display').focus()`);
      for(let tab=0;tab<2;tab++)for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
      assert.equal(await evaluate(`document.activeElement.dataset.dateDisplay`),'endDate','Tab segue para a próxima data sem parada invisível');
      await evaluate(`document.querySelector('.pl-filter .sfs-arrow').click()`);
      const dropdown=await evaluate(`(()=>{const p=document.querySelector('.pl-filter .sfs-popup'),l=p.querySelector('.sfs-list'),o=[...l.children],r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:o.filter(x=>{const q=x.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(dropdown.placement,'below');assert.ok(dropdown.visible>=7,JSON.stringify(dropdown));
      await evaluate(`document.querySelector('.pl-filter .sfs-arrow').click()`);
      await evaluate(`document.querySelector('.pl-table td').click()`);
      assert.equal(await evaluate(`document.querySelector('.pl-overlay').hidden`),false,'clicar dentro preserva popup');
      if(width===390&&!pwa&&process.env.PAYMENT_LEDGER_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.PAYMENT_LEDGER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.pl-overlay').hidden`),true,'clique fora fecha popup');
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      if(width===390&&!pwa&&process.env.HOME_MASCOT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.HOME_MASCOT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:layout.m.x+22,y:layout.m.y+22,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:layout.m.x+22,y:layout.m.y+22,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate('window.opened'),1);
      assert.deepEqual(await evaluate('window.selected'),[]);
      await evaluate(`document.querySelector('[data-reply-id=group_pending]').click()`);
      assert.deepEqual(await evaluate('window.selected'),['group_pending']);
    }
  } finally {
    for(const p of pending.values())clearTimeout(p.timer);socket?.close();
    if(child&&child.exitCode===null){const exited=new Promise(done=>child.once('exit',done));child.kill();await Promise.race([exited,delay(3000)]);}
    await server.close();
    try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});}catch(e){if(!['EPERM','EBUSY'].includes(e.code))throw e;}
  }
});
