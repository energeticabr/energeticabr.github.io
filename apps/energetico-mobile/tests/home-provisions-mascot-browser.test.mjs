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
  assert.match(css,/\.ov-table/,'PWA delivers validation table styles');
  assert.match(css,/\.ov-cards/,'PWA delivers six-card summary layout');
  assert.match(css,/\.pr-table/,'PWA preserves second provision report styles');
  assert.match(css,/\.as-daily/,'PWA delivers attendance summary table styles');
  assert.match(css,/\.sp-activities/,'PWA delivers stage activity table styles');
  assert.match(css,/\.cm-milestones/,'PWA delivers commercial milestones table styles');
  assert.match(css,/\.cd-properties/,'PWA delivers commercial document pending table styles');
  assert.match(css,/\.dcr-table/,'PWA delivers the document control table and status colors');
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
      assert.ok(ready,`fixture ${width}/${pwa}: ${JSON.stringify(await evaluate('({url:location.href,state:document.readyState,text:document.body.innerText.slice(0,500)})'))}`);
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
      const shortcuts=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.chat-main-provisions-shortcut,.chat-main-payment-ledger-shortcut')];return buttons.map(b=>{const r=b.getBoundingClientRect();return {action:b.dataset.action,y:r.y,bottom:r.bottom,image:b.querySelector('img').naturalWidth>0};});})()`);
assert.deepEqual(shortcuts.map(s=>s.action),['open-pending-provisions','open-provision-report','open-payment-ledger','open-management-report','open-order-validation-report','open-quotation-report','open-depreciation-report','open-document-control-report','open-task-association-report','open-delegated-deadline-report']);
      assert.ok(shortcuts.every((s,i)=>s.image&&(!i||s.y>=shortcuts[i-1].bottom+4)),JSON.stringify(shortcuts));
      const depreciationHit=await evaluate(`(()=>{const button=document.querySelector('[data-action=open-depreciation-report]'),r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-action]')?.dataset.action||'';})()`);
      assert.equal(depreciationHit,'open-depreciation-report','real touch on the seventh mascot must not hit an overlapping legacy avatar');
      const reportLayout=await evaluate(`(()=>{const r=document.querySelector('[data-action=open-payment-ledger]'),m=document.querySelector('.chat-main-provisions-shortcut'),b=document.querySelector('.chat-message--external-provisions .chat-bubble');if(!r)return null;const rr=r.getBoundingClientRect(),mr=m.getBoundingClientRect(),br=b.getBoundingClientRect(),i=r.querySelector('img');return {x:rr.x,y:rr.y,right:rr.right,bottom:rr.bottom,width:rr.width,height:rr.height,mascotBottom:mr.bottom,cardLeft:br.x,external:!b.contains(r),image:i.naturalWidth>0,fill:getComputedStyle(r).backgroundColor};})()`);
      assert.ok(reportLayout, 'novo relatório acessível na tela inicial');
      assert.ok(reportLayout.external&&reportLayout.y>=reportLayout.mascotBottom+4&&reportLayout.right<=reportLayout.cardLeft-4,JSON.stringify(reportLayout));
      assert.ok(reportLayout.width>=44&&reportLayout.height>=44&&reportLayout.x>=0&&reportLayout.image);
      assert.equal(reportLayout.fill,'rgb(0, 13, 75)');
      const mascotFit=await evaluate(`(()=>{return [...document.querySelectorAll('.chat-message--external-provisions > button,.chat-message--external-cargos > button')].map(b=>{const i=b.querySelector('img'),r=b.getBoundingClientRect(),q=i.getBoundingClientRect(),s=getComputedStyle(i);return {action:b.dataset.action,source:i.naturalWidth,fit:s.objectFit,blend:s.mixBlendMode,transform:s.transform,inside:q.left>=r.left&&q.right<=r.right&&q.top>=r.top&&q.bottom<=r.bottom,fill:getComputedStyle(b).backgroundColor};});})()`);
      assert.equal(mascotFit.length,19);
      assert.ok(mascotFit.every(m=>m.source>=256&&m.fit==='contain'&&m.blend==='normal'&&m.transform==='none'&&m.inside),'sharp full-body mascots without cropping or color blending: '+JSON.stringify(mascotFit));
      assert.ok(mascotFit.filter(m=>m.action.startsWith('open-commercial-')||m.action==='open-sac-pathologies').every(m=>m.fill==='rgb(173, 62, 8)'),'orange fills remain uniform');
      assert.ok(mascotFit.filter(m=>['open-task-association-report','open-delegated-deadline-report'].includes(m.action)).every(m=>m.fill==='rgb(97, 140, 37)'),'both green report backgrounds remain uniform');
      await evaluate(`document.querySelector('[data-action=open-payment-ledger]').click()`);
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
      const fit=await evaluate(`(()=>{const panel=document.querySelector('.pl-dialog:not(.gm-dialog)'),p=panel.getBoundingClientRect(),f=[...panel.querySelectorAll('.pl-dates,.pl-filter')].map(n=>n.getBoundingClientRect()),s=panel.querySelector('.pl-table-scroll'),t=panel.querySelector('.pl-table'),logo=panel.querySelector('.pl-logo');return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:s.scrollWidth<=s.clientWidth+1,top:p.top,bottom:p.bottom,vh:innerHeight,logo:logo?.naturalWidth>0,red:getComputedStyle(t.querySelector('[data-column=supplierTotal]')).color,bold:getComputedStyle(t.querySelector('[data-column=total]')).fontWeight};})()`);
      assert.ok(fit.aligned&&fit.fits&&fit.logo,JSON.stringify(fit));
      if(await evaluate('innerHeight<=500'))assert.ok(fit.top<=1&&fit.bottom>=fit.vh-1,'relatório ocupa altura toda');
      assert.equal(fit.red,'rgb(255, 0, 0)'); assert.ok(Number(fit.bold)>=700);
      const dateFits=await evaluate(`(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');return [...document.querySelectorAll('.pl-overlay:not([hidden]) .pl-date-display')].map(n=>{n.value='02/10/2026';const s=getComputedStyle(n);ctx.font=s.font;return {text:ctx.measureText(n.value).width,available:n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),font:s.font,width:innerWidth};});})()`);
      assert.ok(dateFits.every(n=>n.text<=n.available),'datas dd/mm/yyyy preenchidas cabem integralmente: '+JSON.stringify(dateFits));
      await evaluate(`document.querySelector('.pl-date-display').focus()`);
      for(let tab=0;tab<2;tab++)for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
      assert.equal(await evaluate(`document.activeElement.dataset.dateDisplay`),'endDate','Tab segue para a próxima data sem parada invisível');
      await evaluate(`document.querySelector('.pl-filter .sfs-arrow').click()`);
      const dropdown=await evaluate(`(()=>{const p=document.querySelector('.pl-filter .sfs-popup'),l=p.querySelector('.sfs-list'),o=[...l.children],r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:o.filter(x=>{const q=x.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(dropdown.placement,'expanded');assert.ok(dropdown.visible>=7,JSON.stringify(dropdown));
      await evaluate(`document.querySelector('.pl-filter .sfs-arrow').click()`);
      await evaluate(`document.querySelector('.pl-table td').click()`);
      assert.equal(await evaluate(`document.querySelector('.pl-overlay').hidden`),false,'clicar dentro preserva popup');
      if(width===390&&!pwa&&process.env.PAYMENT_LEDGER_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.PAYMENT_LEDGER_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.pl-overlay').hidden`),true,'clique fora fecha popup');
      const management=await evaluate(`(()=>{const m=document.querySelector('.chat-main-management-shortcut'),p=document.querySelector('[data-action=open-payment-ledger]'),b=document.querySelector('.chat-message--external-provisions .chat-bubble');const r=m.getBoundingClientRect(),q=p.getBoundingClientRect();return {external:!b.contains(m),x:r.x,right:r.right,y:r.y,bottom:q.bottom,fill:getComputedStyle(m).backgroundColor,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(management.external&&management.x>=0&&management.y>=management.bottom+4&&management.image,JSON.stringify(management));
      assert.equal(management.fill,'rgb(0, 13, 75)');
      await evaluate(`document.querySelector('.chat-main-management-shortcut').click()`);
      let managementReady=false;for(let n=0;n<80&&!managementReady;n++){managementReady=await evaluate(`document.querySelectorAll('.gm-table').length===7`);if(!managementReady)await delay(100);}
      assert.ok(managementReady,'novo relatório gerencial abre suas sete tabelas');
      const managementFit=await evaluate(`(()=>{const p=document.querySelector('.gm-dialog').getBoundingClientRect(),c=document.querySelector('.gm-content'),f=[...document.querySelectorAll('.gm-filters>.pl-filter,.gm-filters>.pl-dates')].map(n=>n.getBoundingClientRect());return {tables:[...document.querySelectorAll('.gm-table')].every(n=>{const r=n.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;}),aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),noOverflow:c.scrollWidth<=c.clientWidth+1,logo:document.querySelector('.gm-logo img').naturalWidth>0,red:getComputedStyle(document.querySelector('.gm-money')).color,bold:getComputedStyle(document.querySelector('.gm-section-title')).fontWeight,month:document.querySelector('.gm-period-filter:nth-child(2) .sfs-trigger').value};})()`);
      assert.ok(managementFit.tables&&managementFit.aligned&&managementFit.noOverflow&&managementFit.logo,JSON.stringify(managementFit));
      assert.equal(await evaluate(`(()=>{const r=document.querySelector('.gm-dialog').getBoundingClientRect();return r.top<=1&&r.bottom>=innerHeight-1;})()`),true,'resumo gerencial ocupa toda a altura também no tablet/PC');
      assert.equal(managementFit.red,'rgb(255, 0, 0)');assert.ok(Number(managementFit.bold)>=700);assert.equal(managementFit.month,'Outubro');
      await evaluate(`document.querySelector('.gm-period-filter:nth-child(2) .sfs-arrow').click()`);
      const gmDropdown=await evaluate(`(()=>{const p=document.querySelector('.gm-period-filter:nth-child(2) .sfs-popup'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(gmDropdown.placement,'expanded');assert.ok(gmDropdown.visible>=7,JSON.stringify(gmDropdown));
      await evaluate(`document.querySelector('.gm-period-filter:nth-child(2) .sfs-arrow').click()`);
      if(width===390&&!pwa&&process.env.MANAGEMENT_REPORT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.MANAGEMENT_REPORT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.gm-overlay').hidden`),true,'clique fora fecha novo relatório');
      await evaluate(`document.querySelector('[data-action=open-provision-report]').click()`);
      let provisionReady=false;for(let n=0;n<80&&!provisionReady;n++){provisionReady=await evaluate(`document.querySelectorAll('.pr-table').length===3`);if(!provisionReady)await delay(100);}
      assert.ok(provisionReady,'segundo mascote abre as três tabelas de provisões');
      const provisionFit=await evaluate(`(()=>{const c=document.querySelector('.pr-content'),f=[...document.querySelectorAll('.pr-filters .pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.pr-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,logo:document.querySelector('.pr-logo img').naturalWidth>0,columns:document.querySelector('[data-section=provisions] thead tr:last-child').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,status:document.querySelector('.pr-filters [name=paymentStatus]').value};})()`);
      assert.ok(provisionFit.aligned&&provisionFit.fits&&provisionFit.logo&&provisionFit.fullHeight,JSON.stringify(provisionFit));
      assert.equal(provisionFit.columns,7);assert.equal(provisionFit.status,'PAGAMENTO PREVISTO');
      await evaluate(`document.querySelector('.pr-filters .sfs-arrow[aria-label="Abrir opções de FORNECEDOR"]').click()`);
      const provisionDropdown=await evaluate(`(()=>{const p=document.querySelector('.pr-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(provisionDropdown.placement,'expanded');assert.ok(provisionDropdown.visible>=7,JSON.stringify(provisionDropdown));
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.pr-overlay').hidden`),true,'clique fora fecha provisões');
      await evaluate(`document.querySelector('[data-action=open-order-validation-report]').click()`);
      let validationReady=false;for(let n=0;n<80&&!validationReady;n++){validationReady=await evaluate(`document.querySelectorAll('.ov-table tbody tr[data-id]').length===12`);if(!validationReady)await delay(100);}
      assert.ok(validationReady,'quinto mascote abre a validação dos pedidos');
      const validationFit=await evaluate(`(()=>{const c=document.querySelector('.ov-content'),f=[...document.querySelectorAll('.ov-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.ov-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,logo:document.querySelector('.ov-logo img').naturalWidth>0,columns:document.querySelector('[data-section=orders] thead tr:last-child').children.length,cards:document.querySelectorAll('.ov-card').length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,status:document.querySelector('.ov-filters [name=status]').value};})()`);
      assert.ok(validationFit.aligned&&validationFit.fits&&validationFit.logo&&validationFit.fullHeight,JSON.stringify(validationFit));
      assert.equal(validationFit.columns,8);assert.equal(validationFit.cards,6);assert.equal(validationFit.status,'PENDENTE AUDITORIA');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ov-cards')).display`),'grid');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ov-tag')).color`),'rgb(153, 0, 0)');
      await evaluate(`document.querySelector('.ov-filters .sfs-arrow[aria-label="Abrir opções de ID"]').click()`);
      const validationDropdown=await evaluate(`(()=>{const p=document.querySelector('.ov-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(validationDropdown.placement,'expanded');assert.ok(validationDropdown.visible>=7,JSON.stringify(validationDropdown));
      await evaluate(`(()=>{const s=document.querySelector('.ov-filters select[name=id]');s.value='362';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await evaluate(`document.querySelectorAll('[data-section=detail]').length`),1);
      assert.equal(await evaluate(`document.querySelectorAll('[data-section=launches] tbody tr').length`),1);
      assert.equal(await evaluate(`document.querySelector('[data-section=alerts]').textContent.toLocaleUpperCase('pt-BR').includes('NOTA FISCAL')`),true);
      if(width===390&&!pwa&&process.env.ORDER_VALIDATION_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.ORDER_VALIDATION_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.ov-overlay').hidden`),true,'clique fora fecha validação');
      await evaluate(`document.querySelector('[data-action=open-attendance-summary]').click()`);
      let attendanceReady=false;for(let n=0;n<80&&!attendanceReady;n++){attendanceReady=await evaluate(`document.querySelectorAll('.as-profession').length===4`);if(!attendanceReady)await delay(100);}
      assert.ok(attendanceReady,'segundo mascote da direita abre resumo por profissão');
      const attendanceFit=await evaluate(`(()=>{const c=document.querySelector('.as-content'),f=[...document.querySelectorAll('.as-filters>.pl-filter,.as-filters>.pl-dates')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.as-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.as-daily thead tr').children.length,cards:document.querySelectorAll('.as-metric').length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,status:document.querySelector('.as-filters [name=supplierStatus]').value};})()`);
      assert.ok(attendanceFit.aligned&&attendanceFit.fits&&attendanceFit.fullHeight,JSON.stringify(attendanceFit));
      assert.equal(attendanceFit.cards,4);assert.equal(attendanceFit.columns,7);assert.equal(attendanceFit.status,'ATIVO');
      await evaluate(`document.querySelector('.as-filters [aria-label="Abrir opções de FORNECEDOR"]').click()`);
      const attendanceDropdown=await evaluate(`(()=>{const p=document.querySelector('.as-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(attendanceDropdown.placement,'expanded');assert.ok(attendanceDropdown.visible>=7,JSON.stringify(attendanceDropdown));
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.as-overlay').hidden`),true,'clique fora fecha presenças');
      await evaluate(`document.querySelector('[data-action=open-stage-progress]').click()`);
      let stageReady=false;for(let n=0;n<80&&!stageReady;n++){stageReady=await evaluate(`document.querySelectorAll('.sp-activities tbody tr').length===12`);if(!stageReady)await delay(100);}
      assert.ok(stageReady,'terceiro mascote da direita abre etapas e atividades');
      const stageFit=await evaluate(`(()=>{const c=document.querySelector('.sp-content'),f=[...document.querySelectorAll('.sp-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.sp-dialog').getBoundingClientRect(),s=document.querySelector('.sp-stage-summary').getBoundingClientRect(),d=document.querySelector('.sp-details').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.sp-activities thead tr').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,sideBySide:s.right<=d.left+1,logo:document.querySelector('.sp-brand img').naturalWidth>0,status:document.querySelector('.sp-filters [name=status]').value,red:getComputedStyle(document.querySelector('.sp-start')).color,bold:getComputedStyle(document.querySelector('.sp-activities tbody td:nth-child(2)')).fontWeight};})()`);
      assert.ok(stageFit.aligned&&stageFit.fits&&stageFit.fullHeight&&stageFit.sideBySide&&stageFit.logo,JSON.stringify(stageFit));
      assert.equal(stageFit.columns,8);assert.equal(stageFit.status,'ATIVIDADE INICIADA');assert.equal(stageFit.red,'rgb(255, 0, 0)');assert.ok(Number(stageFit.bold)>=700);
      await evaluate(`document.querySelector('.sp-filters [aria-label="Abrir opções de COLABORADOR"]').click()`);
      const stageDropdown=await evaluate(`(()=>{const p=document.querySelector('.sp-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(stageDropdown.placement,'expanded');assert.ok(stageDropdown.visible>=7,JSON.stringify(stageDropdown));
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.sp-overlay').hidden`),true,'clique fora fecha etapas');
      await evaluate(`document.querySelector('[data-action=open-commercial-receipts]').click()`);
      let commercialReady=false;for(let n=0;n<80&&!commercialReady;n++){commercialReady=await evaluate(`document.querySelectorAll('.cr-properties tbody tr').length===13`);if(!commercialReady)await delay(100);}
      assert.ok(commercialReady,'quarto mascote da direita abre relatório comercial');
      const commercialFit=await evaluate(`(()=>{const c=document.querySelector('.cr-content'),f=[...document.querySelectorAll('.cr-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.cr-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.cr-properties thead tr').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,logo:document.querySelector('.cr-brand img').naturalWidth>0,cards:document.querySelectorAll('.cr-indicators>.cr-card').length,red:getComputedStyle(document.querySelector('.cr-card[data-tone=danger]')).color,bold:getComputedStyle(document.querySelector('.cr-card>strong')).fontWeight};})()`);
      assert.ok(commercialFit.aligned&&commercialFit.fits&&commercialFit.fullHeight&&commercialFit.logo,JSON.stringify(commercialFit));assert.equal(commercialFit.columns,10);assert.equal(commercialFit.cards,4);assert.equal(commercialFit.red,'rgb(198, 40, 40)');assert.ok(Number(commercialFit.bold)>=700);
      await evaluate(`document.querySelector('.cr-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      const commercialDropdown=await evaluate(`(()=>{const p=document.querySelector('.cr-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(commercialDropdown.placement,'expanded');assert.ok(commercialDropdown.visible>=7,JSON.stringify(commercialDropdown));
      await evaluate(`document.querySelector('.cr-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      await evaluate(`(()=>{const s=document.querySelector('.cr-filters select[name=contractId]');s.value='10';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await evaluate(`document.querySelectorAll('.cr-contract').length`),1);assert.equal(await evaluate(`document.querySelectorAll('.cr-payments thead th').length`),8);
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('.cr-content');return c.scrollWidth<=c.clientWidth+1;})()`),true,'detalhe comercial também cabe horizontalmente');
      if(width===390&&!pwa&&process.env.COMMERCIAL_REPORT_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.COMMERCIAL_REPORT_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.cr-overlay').hidden`),true,'clique fora fecha comercial');
      await evaluate(`document.querySelector('[data-action=open-commercial-milestones]').click()`);
      let milestonesReady=false;for(let n=0;n<80&&!milestonesReady;n++){milestonesReady=await evaluate(`document.querySelectorAll('.cm-milestones tbody tr').length===12`);if(!milestonesReady)await delay(100);}
      assert.ok(milestonesReady,'quinto mascote da direita abre últimos andamentos');
      const milestoneColors=await evaluate(`(()=>{const row=document.querySelector('.cm-milestones tbody tr[data-tone=danger]');return {description:getComputedStyle(row.querySelector('.cm-description')).color,buyer:getComputedStyle(row.querySelector('.cm-buyer')).color,due:getComputedStyle(row.querySelector('.cm-days[data-tone=danger]')).color};})()`);
      assert.deepEqual(milestoneColors,{description:'rgb(38, 55, 70)',buyer:'rgb(38, 55, 70)',due:'rgb(180, 35, 24)'},'vencimento não altera a cor normal dos textos da linha');
      const milestonesFit=await evaluate(`(()=>{const c=document.querySelector('.cm-content'),f=[...document.querySelectorAll('.cm-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.cm-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.cm-milestones thead tr').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,logo:document.querySelector('.cm-brand img').naturalWidth>0,status:document.querySelector('.cm-filters [name=visualStatus]').value,green:getComputedStyle(document.querySelector('.cm-status[data-tone=success]')).color,bold:getComputedStyle(document.querySelector('.cm-type')).fontWeight};})()`);
      assert.ok(milestonesFit.aligned&&milestonesFit.fits&&milestonesFit.fullHeight&&milestonesFit.logo,JSON.stringify(milestonesFit));assert.equal(milestonesFit.columns,9);assert.equal(milestonesFit.status,'ATIVO');assert.equal(milestonesFit.green,'rgb(46, 107, 62)');assert.ok(Number(milestonesFit.bold)>=700);
      await evaluate(`document.querySelector('.cm-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      const milestonesDropdown=await evaluate(`(()=>{const p=document.querySelector('.cm-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(milestonesDropdown.placement,'expanded');assert.ok(milestonesDropdown.visible>=7,JSON.stringify(milestonesDropdown));
      await evaluate(`document.querySelector('.cm-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      await evaluate(`(()=>{const s=document.querySelector('.cm-filters select[name=contractId]');s.value='10';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await evaluate(`document.querySelectorAll('.cm-milestones tbody tr').length`),2);assert.equal(await evaluate(`document.querySelectorAll('.cm-milestones thead th').length`),9);
      assert.equal(await evaluate(`document.querySelector('.cm-milestones tbody .cm-property').rowSpan`),2);
      assert.equal(await evaluate(`document.querySelector('.cm-heading').textContent`),'DETALHAMENTO DOS CONTRATOS');
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('.cm-content');return c.scrollWidth<=c.clientWidth+1;})()`),true,'histórico comercial cabe horizontalmente');
      if(width===390&&!pwa&&process.env.COMMERCIAL_MILESTONES_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.COMMERCIAL_MILESTONES_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.cm-overlay').hidden`),true,'clique fora fecha andamentos');
      await evaluate(`document.querySelector('[data-action=open-commercial-documents]').click()`);
      let documentsReady=false;for(let n=0;n<80&&!documentsReady;n++){documentsReady=await evaluate(`document.querySelectorAll('.cd-properties tbody tr').length===12`);if(!documentsReady)await delay(100);}
      assert.ok(documentsReady,'sexto mascote da direita abre pendências documentais');
      const documentsFit=await evaluate(`(()=>{const c=document.querySelector('.cd-content'),f=[...document.querySelectorAll('.cd-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.cd-dialog').getBoundingClientRect();return {aligned:f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.cd-properties thead tr').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,logo:document.querySelector('.cd-brand img').naturalWidth>0,cards:document.querySelectorAll('.cd-card').length,status:document.querySelector('.cd-filters [name=saleStatus]').value,total:document.querySelector('[data-metric=total] strong').textContent,red:getComputedStyle(document.querySelector('[data-metric=bankContract]')).color,green:getComputedStyle(document.querySelector('[data-metric=proposal]')).color};})()`);
      assert.ok(documentsFit.aligned&&documentsFit.fits&&documentsFit.fullHeight&&documentsFit.logo,JSON.stringify(documentsFit));assert.equal(documentsFit.columns,13);assert.equal(documentsFit.cards,8);assert.equal(documentsFit.status,'');assert.equal(documentsFit.total,'48');assert.equal(documentsFit.red,'rgb(198, 40, 40)');assert.equal(documentsFit.green,'rgb(46, 125, 50)');
      await evaluate(`document.querySelector('.cd-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      const documentsDropdown=await evaluate(`(()=>{const p=document.querySelector('.cd-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(documentsDropdown.placement,'expanded');assert.ok(documentsDropdown.visible>=7,JSON.stringify(documentsDropdown));
      await evaluate(`document.querySelector('.cd-filters [aria-label="Abrir opções de COMPRADOR"]').click()`);
      if(width===390&&!pwa&&process.env.COMMERCIAL_DOCUMENTS_SCREENSHOT){const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(process.env.COMMERCIAL_DOCUMENTS_SCREENSHOT,Buffer.from(shot.data,'base64'));}
      await evaluate(`(()=>{const s=document.querySelector('.cd-filters select[name=contractId]');s.value='10';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.equal(await evaluate(`document.querySelectorAll('.cd-contract').length`),1);assert.equal(await evaluate(`document.querySelectorAll('.cd-payments thead th').length`),6);assert.equal(await evaluate(`document.querySelectorAll('.cd-properties').length`),0);
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('.cd-content');return c.scrollWidth<=c.clientWidth+1;})()`),true,'detalhamento documental cabe horizontalmente');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.cd-overlay').hidden`),true,'clique fora fecha pendências documentais');
      await evaluate(`document.querySelector('[data-action=open-sac-pathologies]').click()`);
      let pathologiesReady=false;for(let n=0;n<30&&!pathologiesReady;n++){pathologiesReady=await evaluate(`document.querySelectorAll('.sap-table tbody tr').length===12`);if(!pathologiesReady)await delay(100);}
      assert.ok(pathologiesReady,'sétimo mascote da direita abre patologias');
      const pathologiesFit=await evaluate(`(()=>{const c=document.querySelector('.sap-content'),f=[...document.querySelectorAll('.sap-filters>.pl-filter')].map(n=>n.getBoundingClientRect()),p=document.querySelector('.sap-dialog').getBoundingClientRect();return {aligned:f.length===6&&f.every(r=>Math.abs(r.top-f[0].top)<1),fits:c.scrollWidth<=c.clientWidth+1,columns:document.querySelector('.sap-table thead tr').children.length,fullHeight:p.top<=1&&p.bottom>=innerHeight-1,logo:document.querySelector('.sap-brand img').naturalWidth>0,cards:document.querySelectorAll('.sap-card').length,status:document.querySelector('.sap-filters [name=status]').value,total:document.querySelector('.sap-card[data-metric=total] strong').textContent};})()`);
      assert.ok(pathologiesFit.aligned&&pathologiesFit.fits&&pathologiesFit.fullHeight&&pathologiesFit.logo,JSON.stringify(pathologiesFit));assert.equal(pathologiesFit.columns,8);assert.equal(pathologiesFit.cards,4);assert.equal(pathologiesFit.status,'ATIVO');assert.equal(pathologiesFit.total,'12');
      await evaluate(`document.querySelector('.sap-filters [aria-label="Abrir opções de CLIENTE"]').click()`);
      const pathologyDropdown=await evaluate(`(()=>{const p=document.querySelector('.sap-filters .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(pathologyDropdown.placement,'expanded');assert.ok(pathologyDropdown.visible>=7,JSON.stringify(pathologyDropdown));
      await evaluate(`document.querySelector('.sap-filters [aria-label="Abrir opções de CLIENTE"]').click()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.sap-overlay').hidden`),true,'clique fora fecha patologias');
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      const cargosShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-cargos-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=b.getBoundingClientRect();return {right:r.right,x:r.x,cardRight:q.right,image:m.querySelector('img').naturalWidth>0,fill:getComputedStyle(m).backgroundColor};})()`);
      assert.ok(cargosShortcut.x>=cargosShortcut.cardRight+4&&cargosShortcut.right<=width&&cargosShortcut.image,JSON.stringify(cargosShortcut));
      assert.equal(cargosShortcut.fill,'rgb(207, 117, 122)');
      const attendanceShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-attendance-summary-shortcut'),c=document.querySelector('.chat-main-cargos-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=c.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,cargoBottom:q.bottom,cargoX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(attendanceShortcut.x>=attendanceShortcut.cardRight+4&&attendanceShortcut.right<=width&&attendanceShortcut.image&&attendanceShortcut.y>=attendanceShortcut.cargoBottom+4&&Math.abs(attendanceShortcut.x-attendanceShortcut.cargoX)<1,JSON.stringify(attendanceShortcut));
      const stageShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-stage-progress-shortcut'),a=document.querySelector('.chat-main-attendance-summary-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,previousBottom:q.bottom,previousX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(stageShortcut.x>=stageShortcut.cardRight+4&&stageShortcut.right<=width&&stageShortcut.image&&stageShortcut.y>=stageShortcut.previousBottom+4&&Math.abs(stageShortcut.x-stageShortcut.previousX)<1,JSON.stringify(stageShortcut));
      const commercialShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-commercial-receipts-shortcut'),a=document.querySelector('.chat-main-stage-progress-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,previousBottom:q.bottom,previousX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(commercialShortcut.x>=commercialShortcut.cardRight+4&&commercialShortcut.right<=width&&commercialShortcut.image&&commercialShortcut.y>=commercialShortcut.previousBottom+4&&Math.abs(commercialShortcut.x-commercialShortcut.previousX)<1,JSON.stringify(commercialShortcut));
      const milestonesShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-commercial-milestones-shortcut'),a=document.querySelector('.chat-main-commercial-receipts-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,previousBottom:q.bottom,previousX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(milestonesShortcut.x>=milestonesShortcut.cardRight+4&&milestonesShortcut.right<=width&&milestonesShortcut.image&&milestonesShortcut.y>=milestonesShortcut.previousBottom+4&&Math.abs(milestonesShortcut.x-milestonesShortcut.previousX)<1,JSON.stringify(milestonesShortcut));
      const documentsShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-commercial-documents-shortcut'),a=document.querySelector('.chat-main-commercial-milestones-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,previousBottom:q.bottom,previousX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(documentsShortcut.x>=documentsShortcut.cardRight+4&&documentsShortcut.right<=width&&documentsShortcut.image&&documentsShortcut.y>=documentsShortcut.previousBottom+4&&Math.abs(documentsShortcut.x-documentsShortcut.previousX)<1,JSON.stringify(documentsShortcut));
      const pathologyShortcut=await evaluate(`(()=>{const m=document.querySelector('.chat-main-sac-pathologies-shortcut'),a=document.querySelector('.chat-main-commercial-documents-shortcut'),b=document.querySelector('.chat-message--external-cargos .chat-bubble');const r=m.getBoundingClientRect(),q=a.getBoundingClientRect(),s=b.getBoundingClientRect();return {right:r.right,x:r.x,y:r.y,previousBottom:q.bottom,previousX:q.x,cardRight:s.right,image:m.querySelector('img').naturalWidth>0};})()`);
      assert.ok(pathologyShortcut.x>=pathologyShortcut.cardRight+4&&pathologyShortcut.right<=width&&pathologyShortcut.image&&pathologyShortcut.y>=pathologyShortcut.previousBottom+4&&Math.abs(pathologyShortcut.x-pathologyShortcut.previousX)<1,JSON.stringify(pathologyShortcut));
      await evaluate(`document.querySelector('[data-action=open-quotation-report]').click()`);
      if(width<844){
        assert.equal(await evaluate('window.quotationLoads'),0,'portrait quotes must not fetch');
        assert.equal(await evaluate(`document.querySelector('.qr-orientation').hidden`),false);
        await send('Emulation.setDeviceMetricsOverride',width===320?{width:568,height:320,deviceScaleFactor:1,mobile:false}:{width:844,height:390,deviceScaleFactor:1,mobile:false},sessionId);
      }
      let quotesReady=false;for(let n=0;n<80&&!quotesReady;n++){quotesReady=await evaluate(`document.querySelectorAll('.qr-budgets').length===2`);if(!quotesReady)await delay(100);}
      assert.ok(quotesReady,'new sixth-left shortcut loads quotation report');
      const quoteFit=await evaluate(`(()=>{const p=document.querySelector('.qr-dialog'),t=document.querySelectorAll('.qr-budgets')[1],r=p.getBoundingClientRect(),last=t.querySelector('th:last-child').getBoundingClientRect(),c=document.querySelector('.qr-content');return {x:r.x,right:r.right,top:r.top,bottom:r.bottom,height:innerHeight,last:last.right,columns:t.querySelectorAll('thead th').length,groups:t.querySelectorAll('td[rowspan="2"]').length,overflow:c.scrollWidth>c.clientWidth+1,font:parseFloat(getComputedStyle(t).fontSize)};})()`);
      assert.ok(quoteFit.top===0&&quoteFit.bottom===quoteFit.height&&!quoteFit.overflow&&quoteFit.last<=quoteFit.right&&quoteFit.font>=6,JSON.stringify(quoteFit));assert.equal(quoteFit.columns,9);assert.equal(quoteFit.groups,3);
      assert.equal(await evaluate(`document.querySelector('.qr-dialog [data-metric=pending] strong').textContent`),'1');
      await evaluate(`document.querySelector('.qr-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await evaluate(`document.querySelector('[data-action=open-depreciation-report]').click()`);
      if(width<844){
        assert.equal(await evaluate('window.depreciationLoads'),0,'portrait depreciation must not query');
        assert.equal(await evaluate(`document.querySelector('.dr-orientation').hidden`),false);
        await send('Emulation.setDeviceMetricsOverride',width===320?{width:568,height:320,deviceScaleFactor:1,mobile:false}:{width:844,height:390,deviceScaleFactor:1,mobile:false},sessionId);
      }
      let depreciationReady=false;for(let n=0;n<80&&!depreciationReady;n++){depreciationReady=await evaluate(`document.querySelectorAll('.dr-table tbody tr').length===12&&document.querySelector('.dr-brand img')?.naturalWidth>0`);if(!depreciationReady)await delay(100);}
      assert.ok(depreciationReady,'seventh left mascot opens live depreciation projection');
      const depreciationFit=await evaluate(`(()=>{const p=document.querySelector('.dr-dialog'),table=p.querySelector('table'),r=p.getBoundingClientRect(),last=table.querySelector('th:last-child').getBoundingClientRect(),c=p.querySelector('.dr-content'),cards=[...p.querySelectorAll('.dr-card')];return {top:r.top,bottom:r.bottom,height:innerHeight,last:last.right,right:r.right,columns:table.querySelectorAll('thead th').length,cardTops:cards.map(n=>n.getBoundingClientRect().top),cards:cards.length,overflow:c.scrollWidth>c.clientWidth+1,font:parseFloat(getComputedStyle(table).fontSize),dateOverdue:getComputedStyle(p.querySelector('.dr-date-overdue')).color,current:getComputedStyle(p.querySelector('.dr-current')).color};})()`);
      assert.ok(depreciationFit.top===0&&depreciationFit.bottom===depreciationFit.height&&!depreciationFit.overflow&&depreciationFit.last<=depreciationFit.right&&depreciationFit.font>=6,JSON.stringify(depreciationFit));
      assert.equal(depreciationFit.columns,11);assert.equal(depreciationFit.cards,7);assert.ok(depreciationFit.cardTops.every(value=>Math.abs(value-depreciationFit.cardTops[0])<1),'all seven cards in one row');
      assert.equal(depreciationFit.dateOverdue,'rgb(156, 0, 0)');assert.equal(depreciationFit.current,'rgb(39, 78, 19)');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:1,y:100,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:100,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.dr-overlay').hidden`),true,'outside tap closes report');
      const horizontalHit=await evaluate(`(()=>{const button=document.querySelector('[data-action=open-depreciation-report]');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {action:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-action]')?.dataset.action||'',x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(horizontalHit.action,'open-depreciation-report','landscape touch must hit the depreciation mascot, not the legacy message avatar');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:horizontalHit.x,y:horizontalHit.y,button:'left',clickCount:1},sessionId);
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:horizontalHit.x,y:horizontalHit.y,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate(`document.querySelector('.dr-overlay').hidden`),false,'real coordinate tap opens depreciation popup');
      await evaluate(`document.querySelector('.dr-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await evaluate(`document.querySelector('[data-action=open-document-control-report]').click()`);
      if(width<844){
        assert.equal(await evaluate('window.documentControlLoads'),0,'portrait document control does not read SharePoint');
        assert.equal(await evaluate(`document.querySelector('.dcr-orientation').hidden`),false);
        await send('Emulation.setDeviceMetricsOverride',width===320?{width:568,height:320,deviceScaleFactor:1,mobile:false}:{width:844,height:390,deviceScaleFactor:1,mobile:false},sessionId);
      }
      let documentReady=false;for(let n=0;n<80&&!documentReady;n++){documentReady=await evaluate(`document.querySelectorAll('.dcr-table tbody tr').length===12&&document.querySelector('.dcr-brand img')?.naturalWidth>0`);if(!documentReady)await delay(100);}
      assert.ok(documentReady,'eighth left mascot loads full document control report');
      const documentFit=await evaluate(`(()=>{const p=document.querySelector('.dcr-dialog'),table=p.querySelector('table'),r=p.getBoundingClientRect(),last=table.querySelector('th:last-child').getBoundingClientRect(),c=p.querySelector('.dcr-content'),filters=[...p.querySelectorAll('.dcr-filter,.dcr-sort')].map(n=>n.getBoundingClientRect()),cards=[...p.querySelectorAll('.dcr-card')];return {top:r.top,bottom:r.bottom,height:innerHeight,right:r.right,last:last.right,columns:table.querySelectorAll('thead th').length,filters:filters.length,aligned:filters.every(f=>Math.abs(f.top-filters[0].top)<1),cards:cards.length,cardAligned:cards.every(n=>Math.abs(n.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<1),overflow:c.scrollWidth>c.clientWidth+1,font:parseFloat(getComputedStyle(table).fontSize),id:getComputedStyle(p.querySelector('.dcr-id')).color,expired:getComputedStyle(p.querySelector('.dcr-expired')).backgroundColor};})()`);
      assert.ok(documentFit.top===0&&documentFit.bottom===documentFit.height&&!documentFit.overflow&&documentFit.last<=documentFit.right&&documentFit.aligned&&documentFit.cardAligned&&documentFit.font>=6,JSON.stringify(documentFit));assert.equal(documentFit.columns,11);assert.equal(documentFit.filters,8);assert.equal(documentFit.cards,5);assert.equal(documentFit.id,'rgb(151, 0, 0)');assert.equal(documentFit.expired,'rgb(254, 226, 226)');
      await evaluate(`document.querySelector('.dcr-filter .sfs-arrow').click()`);
      const documentDropdown=await evaluate(`(()=>{const p=document.querySelector('.dcr-filter .sfs-popup'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(documentDropdown.placement,'expanded');assert.ok(documentDropdown.visible>=7,JSON.stringify(documentDropdown));
      await evaluate(`document.querySelector('.dcr-filter .sfs-arrow').click()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:1,y:100,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:100,button:'left',clickCount:1},sessionId);assert.equal(await evaluate(`document.querySelector('.dcr-overlay').hidden`),true);
      const docHit=await evaluate(`(()=>{const b=document.querySelector('[data-action=open-document-control-report]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {action:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-action]')?.dataset.action||'',x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(docHit.action,'open-document-control-report','real landscape touch must reach the eighth mascot');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:docHit.x,y:docHit.y,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:docHit.x,y:docHit.y,button:'left',clickCount:1},sessionId);assert.equal(await evaluate(`document.querySelector('.dcr-overlay').hidden`),false);await evaluate(`document.querySelector('.dcr-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await evaluate(`document.querySelector('[data-action=open-task-association-report]').click()`);
      if(width<844){
        assert.equal(await evaluate('window.taskAssociationLoads'),0,'portrait task report does not read SharePoint');
        assert.equal(await evaluate(`document.querySelector('.tar-orientation').hidden`),false);
        await send('Emulation.setDeviceMetricsOverride',width===320?{width:568,height:320,deviceScaleFactor:1,mobile:false}:{width:844,height:390,deviceScaleFactor:1,mobile:false},sessionId);
      }
      let taskReady=false;for(let n=0;n<80&&!taskReady;n++){taskReady=await evaluate(`document.querySelectorAll('.tar-table tbody tr').length===12&&document.querySelector('.tar-brand img')?.naturalWidth>0`);if(!taskReady)await delay(100);}
      assert.ok(taskReady,'ninth left mascot loads grouped tasks and keeps pending statuses initially selected');
      const taskFit=await evaluate(`(()=>{const p=document.querySelector('.tar-dialog'),table=p.querySelector('table'),r=p.getBoundingClientRect(),last=table.querySelector('th:last-child').getBoundingClientRect(),c=p.querySelector('.tar-content'),filters=[...p.querySelectorAll('.tar-filter')].map(n=>n.getBoundingClientRect()),cards=[...p.querySelectorAll('.tar-card')];return {top:r.top,bottom:r.bottom,height:innerHeight,right:r.right,last:last.right,columns:table.querySelectorAll('thead th').length,filters:filters.length,aligned:filters.every(f=>Math.abs(f.top-filters[0].top)<1),cards:cards.length,cardAligned:cards.every(n=>Math.abs(n.getBoundingClientRect().top-cards[0].getBoundingClientRect().top)<1),overflow:c.scrollWidth>c.clientWidth+1,font:parseFloat(getComputedStyle(table).fontSize),emergency:getComputedStyle(p.querySelector('[data-task-id="1"]')).backgroundColor,metrics:[...p.querySelectorAll('.tar-card strong')].map(n=>n.textContent)};})()`);
      assert.ok(taskFit.top===0&&taskFit.bottom===taskFit.height&&!taskFit.overflow&&taskFit.last<=taskFit.right&&taskFit.aligned&&taskFit.cardAligned&&taskFit.font>=6,JSON.stringify(taskFit));assert.equal(taskFit.columns,5);assert.equal(taskFit.filters,7);assert.equal(taskFit.cards,3);assert.equal(taskFit.emergency,'rgb(255, 205, 210)');assert.deepEqual(taskFit.metrics,['12','1','13']);
      await evaluate(`document.querySelector('.tar-filter [aria-label="Abrir opções de FORNECEDOR"]').click()`);
      const taskDropdown=await evaluate(`(()=>{const p=document.querySelector('.tar-dialog .sfs-popup:not([hidden])'),l=p.querySelector('.sfs-list'),r=l.getBoundingClientRect();return {placement:p.dataset.placement,visible:[...l.children].filter(n=>{const q=n.getBoundingClientRect();return q.top>=r.top-1&&q.bottom<=r.bottom+1;}).length};})()`);
      assert.equal(taskDropdown.placement,'expanded');assert.ok(taskDropdown.visible>=7,JSON.stringify(taskDropdown));
      await evaluate(`document.querySelector('.tar-filter [aria-label="Abrir opções de FORNECEDOR"]').click()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:1,y:100,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:100,button:'left',clickCount:1},sessionId);assert.equal(await evaluate(`document.querySelector('.tar-overlay').hidden`),true);
      const taskHit=await evaluate(`(()=>{const b=document.querySelector('[data-action=open-task-association-report]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {action:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-action]')?.dataset.action||'',x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(taskHit.action,'open-task-association-report','real landscape touch reaches ninth mascot, not legacy avatar');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:taskHit.x,y:taskHit.y,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:taskHit.x,y:taskHit.y,button:'left',clickCount:1},sessionId);assert.equal(await evaluate(`document.querySelector('.tar-overlay').hidden`),false);await evaluate(`document.querySelector('.tar-overlay').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      const deadlineHit=await evaluate(`(()=>{const b=document.querySelector('[data-action=open-delegated-deadline-report]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {action:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-action]')?.dataset.action||'',x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(deadlineHit.action,'open-delegated-deadline-report','real landscape touch reaches the tenth green mascot');
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:deadlineHit.x,y:deadlineHit.y,button:'left',clickCount:1},sessionId);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:deadlineHit.x,y:deadlineHit.y,button:'left',clickCount:1},sessionId);
      assert.equal(await evaluate('window.delegatedDeadlineOpened'),1);
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false},sessionId);
      await evaluate(`document.querySelector('.chat-main-cargos-shortcut').click()`);
      const cargosFit=await evaluate(`(()=>{const r=document.querySelector('.cargos-screen').getBoundingClientRect(),s=document.querySelector('.cargos-scroll'),t=document.querySelector('.cargos-table');return {top:r.top,bottom:r.bottom,rows:t.querySelectorAll('[data-cargo]').length,groups:t.querySelectorAll('.cargos-group').length,pan:s.scrollWidth>s.clientWidth,font:parseFloat(getComputedStyle(t).fontSize),overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
      assert.ok(cargosFit.top===0&&cargosFit.bottom===844&&!cargosFit.overflow&&cargosFit.font>=14,JSON.stringify(cargosFit));assert.equal(cargosFit.rows,7);assert.equal(cargosFit.groups,2);
      if(width<870)assert.ok(cargosFit.pan);
      await evaluate(`document.querySelector('.cargos-scroll').scrollLeft=600`);
      assert.ok(await evaluate(`(()=>{const th=document.querySelector('.cargos-table tbody tr[data-cargo] th').getBoundingClientRect(),s=document.querySelector('.cargos-scroll').getBoundingClientRect();return Math.abs(th.left-s.left)<=2;})()`),'cargo permanece fixo durante a rolagem');
      await evaluate(`document.querySelector('[aria-label="Voltar ao menu inicial"]').click()`);
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
