import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path));

test('navigation pairs stay left and payroll footer spans both sides at mobile and desktop widths', { timeout: 90_000 }, async t => {
  if (!browser) return t.skip('Chrome/Edge indisponível');
  const server = await createServer({ root: appRoot, server: { host: '127.0.0.1', port: 0,
    fs: { allow: [resolve(appRoot, '../..')] } }, logLevel: 'silent' });
  const profile = mkdtempSync(join(tmpdir(), 'launch-total-layout-')), pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 200 && !existsSync(portFile); attempt++) await delay(100);
    assert.ok(existsSync(portFile), 'Chrome não iniciou');
    const [port, path] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let sequence = 0;
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data), request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      response.error ? request.fail(new Error(response.error.message)) : request.done(response.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} expirou`)); }, 10_000);
      pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails)); return response.result.value;
    };
    for (const screen of ['launches','orders','tasks','payments','recurring','registration','hr','hrreport','payroll','payroll-stage','payroll-summary','payroll-summary-long','powerbi']) {
      for (const [width, height] of [[320,740],[390,844],[1365,768],[844,390]]) {
        await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false},sessionId);
        const query = '?screen='+screen+'&w='+width;
        await send('Page.navigate', {url:'http://127.0.0.1:'+server.httpServer.address().port+'/tests/fixtures/screen-navigation-responsive.html'+query},sessionId);
        let ready=false;
        for(let attempt=0;attempt<120 && !ready;attempt++) {
          ready=await evaluate('location.search === '+JSON.stringify(query)+' && document.documentElement?.dataset.ready === "true"');
          if(!ready) await delay(100);
        }
        assert.ok(ready, screen+' did not open at '+width);
        const layout=await evaluate(`(() => {
          const nav=document.querySelector('.screen-navigation'),header=nav.parentElement,title=nav.nextElementSibling;
          const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          const buttons=[...nav.children];
          const footer=document.querySelector('.supplier-payroll-footer');
          const identity=document.querySelector('.supplier-payroll-identity-table');
          return {nav:box(nav),header:box(header),title:box(title),buttons:buttons.map(box),
            icons:buttons.map(b=>getComputedStyle(b,'::before').content),
            color:buttons.map(b=>getComputedStyle(b).backgroundColor),
            radius:buttons.map(b=>getComputedStyle(b).borderRadius),
            identity:identity ? {box:box(identity),rows:[...identity.rows].map(row=>[...row.cells].map(cell=>cell.textContent)),
              overflow:identity.scrollWidth > identity.clientWidth+1 || [...identity.querySelectorAll('th,td')].some(cell=>cell.scrollWidth > cell.clientWidth+1)}:null,
            footer:footer && !footer.hidden ? {box:box(footer),back:box(footer.firstElementChild),next:box(footer.lastElementChild)}:null};
        })()`);
        assert.ok(layout.nav.left >= layout.header.left && layout.nav.right <= layout.title.left, screen+' navigation/title overlap: '+JSON.stringify(layout));
        assert.ok(layout.buttons[0].right <= layout.buttons[1].left && layout.buttons[0].top === layout.buttons[1].top,screen+' not side by side');
        assert.ok(layout.title.right <= width+1 && layout.buttons.every(b=>b.width>=44 && b.height>=44),screen+' viewport/touch target');
        assert.deepEqual(layout.icons,['"↩️"','"🏠"']);
        assert.deepEqual(layout.color,['rgb(255, 255, 255)','rgb(255, 255, 255)']);
        if(screen.startsWith('payroll')) {
          assert.ok(layout.identity && !layout.identity.overflow, 'dados longos devem caber sem corte ou rolagem lateral');
          assert.ok(layout.identity.box.left >= 0 && layout.identity.box.right <= width);
          assert.deepEqual(layout.identity.rows, [
            ['Fornecedor','CLEITON CESAR NONATO'],['Profissão','SERVENTE DE PEDREIRO'],
            ['Data','03/10/2026'],['Filial','004 - EDIFÍCIO XAVANTE'],
          ]);
        }
        if(screen==='payroll-stage') {
          assert.equal(layout.footer, null, 'seleção de etapa permanece sem retorno inferior duplicado');
          if(width===390 && process.env.PAYROLL_TABLE_SCREENSHOT) {
            const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
            writeFileSync(process.env.PAYROLL_TABLE_SCREENSHOT,Buffer.from(shot.data,'base64'));
          }
        }
        if(screen.startsWith('payroll-summary')) {
          const summary=await evaluate(`(() => {
            const tables=[...document.querySelectorAll('.supplier-payroll-summary-table')];
            return {tables:tables.map(table=>({label:table.getAttribute('aria-label'),
              rows:[...table.rows].map(row=>[...row.cells].map(cell=>cell.textContent)),
              overflow:table.scrollWidth > table.clientWidth+1 || [...table.querySelectorAll('th,td')].some(cell=>cell.scrollWidth > cell.clientWidth+1)})),
              total:document.querySelector('[data-payroll-summary-total]')?.textContent,
              files:[...document.querySelectorAll('.supplier-payroll-summary-files li')].map(file=>file.textContent),
              bodyOverflow:document.querySelector('.supplier-payroll-body').scrollWidth > document.querySelector('.supplier-payroll-body').clientWidth+1,
              post:document.querySelector('[data-payroll-post]')?.textContent};
          })()`);
          assert.equal(summary.tables.length, screen==='payroll-summary-long' ? 3 : 2);
          assert.ok(!summary.bodyOverflow && summary.tables.every(table=>!table.overflow), 'resumo sem corte ou rolagem lateral em '+width);
          assert.deepEqual(summary.tables[0].rows, [['Etapa','ALVENARIA E ESTRUTURAS'],['IDFOLHA','5'],['Referência','10/2026']]);
          if(screen==='payroll-summary-long') {
            assert.deepEqual(summary.files, ['comprovante-de-pagamento-'+'referencia'.repeat(16)+'.pdf','segundo-comprovante.pdf']);
            assert.match(summary.tables[1].rows[3][1],/DESCRIÇÃO EXTENSA/);
            assert.equal(summary.tables[2].rows[2][1],'R$\u00a020,50');
            assert.match(summary.total,/120,50/);
          } else {
            assert.deepEqual(summary.tables[1].rows, [['Quantidade','1'],['Valor unitário','R$\u00a0100,00'],['Subtotal','R$\u00a0100,00'],['Forma de pagamento','PIX'],['Comprovantes','Sem comprovantes']]);
            assert.match(summary.total,/100,00/);
          }
          assert.equal(summary.post,'Postar');
          if(screen==='payroll-summary' && width===390 && process.env.PAYROLL_SUMMARY_SCREENSHOT) {
            const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
            writeFileSync(process.env.PAYROLL_SUMMARY_SCREENSHOT,Buffer.from(shot.data,'base64'));
            await evaluate("document.querySelector('.supplier-payroll-body').scrollTop=10000");
            await delay(100);
            const bottom=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
            writeFileSync(process.env.PAYROLL_SUMMARY_SCREENSHOT.replace(/\.png$/, '-bottom.png'),Buffer.from(bottom.data,'base64'));
          }
        }
        if(screen==='payroll') {
          assert.ok(layout.footer.back.right <= layout.footer.next.left);
          assert.ok(layout.footer.back.left < width/2 && layout.footer.next.right > width/2);
          assert.ok(layout.footer.next.right-layout.footer.back.left > layout.footer.box.width*0.8,'footer must span left/right');
          if(width===390 && process.env.NAV_SCREENSHOT) {
            const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
            writeFileSync(process.env.NAV_SCREENSHOT,Buffer.from(shot.data,'base64'));
          }
        }
      }
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once('exit', done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 300 });
  }
});
