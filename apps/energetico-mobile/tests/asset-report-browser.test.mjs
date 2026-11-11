import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => path && existsSync(path));
const trigger = '[data-asset-report-trigger]';
const close = '[data-action="close-asset-report"]';
async function key(api, value, code, number) {
  await api.command('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code, windowsVirtualKeyCode: number, ...(value === 'Enter' ? { text: '\r' } : {}) });
  await api.command('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code, windowsVirtualKeyCode: number });
}
async function shot(api, name) {
  if (!process.env.ASSET_REPORT_ARTIFACT_DIR) return;
  const directory = resolve(process.env.ASSET_REPORT_ARTIFACT_DIR); await mkdir(directory, { recursive: true });
  await api.evaluate('new Promise(resolve => setTimeout(resolve, 350))');
  const { data } = await api.command('Page.captureScreenshot', { format: 'png' }); await writeFile(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}
test('toque, teclado, cadastro e 31 depreciações cabem em 320/390/1365px sem perder o contexto', { timeout: 180_000, skip: !browser && 'Chrome unavailable' }, async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'asset-report-vite-'));
  const server = await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..'), cacheDir] } } });
  t.after(async () => { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }); await server.listen();
  for (const width of [320, 390, 1365]) for (const kind of ['assetLaunches', 'asset']) {
    await withAttachmentBrowser(browser, { width, height: 900 }, async api => {
      await api.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/asset-report.html?kind=${kind}`);
      await api.wait('window.assetReportFixture?.ready');
      {
        const cluster = await api.evaluate(`(() => { const button = document.querySelector('${trigger}'), style = getComputedStyle(button); return {tag:button.tagName,fill:style.backgroundColor,border:style.borderStyle,borderWidth:parseFloat(style.borderWidth),text:button.textContent,overflow:button.scrollWidth>button.clientWidth+1}; })()`);
        assert.equal(cluster.tag, 'BUTTON'); assert.equal(cluster.border, 'solid'); assert.ok(cluster.borderWidth >= 1);
        assert.notEqual(cluster.fill, 'rgba(0, 0, 0, 0)'); assert.match(cluster.text, /Ver .*depreciações/); assert.equal(cluster.overflow, false);
        if (width === 390) await shot(api, `${kind}-nome-selecionavel-390`);
      }
      await api.evaluate(`(() => { const input = document.querySelector('input[type="search"]'); input.value='GUINCHO'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
      const before = await api.evaluate(`({page:document.querySelector('.rg-pagination').textContent, search:document.querySelector('input[type="search"]').value, scroll:document.querySelector('.rg-overlay').scrollTop})`);
      await api.tap(`${trigger} .rg-row-title`); await api.wait('document.querySelector("[data-asset-history-row]")');
      const layout = await api.evaluate(`(() => {
        const dialog = document.querySelector('[data-asset-report]'), button = document.querySelector('${close}'), bounds = button.getBoundingClientRect();
        return { id:dialog.dataset.assetReport, cards:dialog.querySelectorAll('[data-asset-history-row]').length,
          overflow:dialog.scrollWidth>dialog.clientWidth+1, documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
          fieldOverflow:[...dialog.querySelectorAll('.asset-report-field')].some(n=>n.scrollWidth>n.clientWidth+1),
          width:dialog.getBoundingClientRect().width, buttonHeight:bounds.height,
          order:dialog.querySelector('[data-asset-registration]').getBoundingClientRect().top < dialog.querySelector('.asset-report-history').getBoundingClientRect().top,
          text:dialog.textContent, calls:window.assetReportFixture.calls, minFont:Math.min(...[...dialog.querySelectorAll('dt,dd')].map(n=>parseFloat(getComputedStyle(n).fontSize))) };
      })()`);
      assert.equal(layout.id, '96'); assert.equal(layout.cards, 31); assert.deepEqual(layout.calls, ['96']);
      assert.equal(layout.overflow, false); assert.equal(layout.documentOverflow, false); assert.equal(layout.fieldOverflow, false);
      assert.equal(layout.order, true); assert.ok(layout.buttonHeight >= 44); assert.ok(layout.width <= width); assert.ok(layout.minFont >= 12);
      assert.match(layout.text, /4\.723,90/); assert.match(layout.text, /3%/); assert.doesNotMatch(layout.text, /300%/);
      assert.match(layout.text, /123456789012345/);
      assert.match(layout.text, /NÚMERO DO PEDIDO494/);
      assert.match(layout.text, /Valor residualR\$\s*4\.723,90\s*\(5,5% depreciado\)/);
      assert.doesNotMatch(layout.text, /NÃO DEVE APARECER/);
      const registration = await api.evaluate(`(() => {
        const root = document.querySelector('[data-asset-registration]'), purchase = root.querySelector('[data-asset-field="COMPRA"]'), status = root.querySelector('[data-asset-field="STATUS"] dd span');
        const residual=purchase.nextElementSibling, badge=residual.querySelector('[data-depreciated-percent]');
        const palette=Object.fromEntries(['green','yellow','orange','red'].map(band=>{
          const sample=badge.cloneNode(true);sample.className='asset-report-depreciated asset-report-depreciated--'+band;
          residual.append(sample);const color=getComputedStyle(sample).color;sample.remove();return [band,color];
        }));
        return { count:root.querySelectorAll('[data-asset-field]').length, next:residual.dataset.assetField, status:status.textContent, background:getComputedStyle(status).backgroundColor,
          residualLabel:residual.querySelector('dt').textContent, residualValue:residual.querySelector('dd').textContent,
          badgeColor:getComputedStyle(badge).color,badgeBackground:getComputedStyle(badge).backgroundColor,
          badgeOverflow:badge.scrollWidth>badge.clientWidth+1,palette };
      })()`);
      assert.equal(registration.count, 13); assert.equal(registration.next, 'RESIDUAL');
      assert.equal(registration.status, kind === 'asset' ? 'INATIVO' : 'ATIVO');
      assert.equal(registration.background, kind === 'asset' ? 'rgb(254, 226, 226)' : 'rgb(220, 252, 231)');
      assert.equal(registration.residualLabel, 'Valor residual');
      assert.match(registration.residualValue, /^R\$\s*4\.723,90\s*\(5,5% depreciado\)$/);
      assert.equal(registration.badgeColor, 'rgb(22, 101, 52)');
      assert.equal(registration.badgeBackground, 'rgb(220, 252, 231)');
      assert.equal(registration.badgeOverflow, false);
      assert.deepEqual(registration.palette,{green:'rgb(22, 101, 52)',yellow:'rgb(113, 63, 18)',orange:'rgb(154, 52, 18)',red:'rgb(153, 27, 27)'});
      await shot(api, `${kind}-cadastro-${width}`);
      const chartTrigger = '[data-action="open-depreciation-chart"]';
      const cue = await api.evaluate(`(() => { const button=document.querySelector('${chartTrigger}'), field=button.parentElement, b=button.getBoundingClientRect(), f=field.getBoundingClientRect(); return {text:button.textContent, cover:b.width>=f.width-5 && b.height>=f.height-5}; })()`);
      assert.match(cue.text, /gráfico/i); assert.equal(cue.cover, true);
      await api.tap(chartTrigger); await api.wait('document.querySelector("[data-depreciation-chart]")');
      const chartLayout = await api.evaluate(`(() => { const chart=document.querySelector('[data-depreciation-chart]'), svg=chart.querySelector('svg'); return {overflow:chart.scrollWidth>chart.clientWidth+1, viewport:document.documentElement.scrollWidth>innerWidth+1, dots:svg.querySelectorAll('circle').length, points:chart.querySelectorAll('[data-chart-point]').length, focus:document.activeElement.textContent}; })()`);
      assert.equal(chartLayout.overflow, false); assert.equal(chartLayout.viewport, false);
      assert.equal(chartLayout.dots, chartLayout.points); assert.ok(chartLayout.dots >= 31); assert.equal(chartLayout.focus, 'Fechar');
      const recorded = await api.evaluate(`(() => { const items=[...document.querySelectorAll('[data-chart-point]')]; return {last:items.at(-1).textContent, overflow:items.some(node=>node.scrollWidth>node.clientWidth+1)}; })()`);
      assert.match(recorded.last, /Depreciado: R\$\s*146,10 · Residual: R\$\s*4\.723,90/);
      assert.equal(recorded.overflow, false);
      await api.wait(`(() => { const labels=[...document.querySelectorAll('[data-chart-label]')]; return labels.length === 3 && labels.every(n => n.dataset.positioned === 'true'); })()`);
      const labels = await api.evaluate(`(() => { const root=document.querySelector('.depreciation-chart-plot-area').getBoundingClientRect(); return [...document.querySelectorAll('[data-chart-label]')].map(node=>{const r=node.getBoundingClientRect();return {text:node.textContent,value:node.dataset.value,left:r.left,right:r.right,top:r.top,bottom:r.bottom,inside:r.left>=root.left-1&&r.right<=root.right+1&&r.top>=root.top-1&&r.bottom<=root.bottom+1};}); })()`);
      assert.equal(labels.length,3); assert.equal(labels.at(-1).value,'4723.9'); assert.match(labels.at(-1).text,/4\.723,90/);
      assert.ok(labels.every(label=>label.inside), 'rótulos devem caber no gráfico');
      assert.ok(labels.every((a,i)=>labels.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)), 'rótulos não devem se sobrepor');
      await shot(api, `${kind}-grafico-${width}`);
      await api.evaluate(`document.querySelector('[data-depreciation-branches]').scrollIntoView({block:'start'})`);
      const barLayout = await api.evaluate(`(() => { const section=document.querySelector('[data-depreciation-branches]'), scroll=section.querySelector('.depreciation-branches-scroll'); const bars=[...section.querySelectorAll('[data-branch-bar]')]; return {bars:bars.map(b=>({name:b.dataset.branch,amount:b.dataset.amount,color:getComputedStyle(b.querySelector('.depreciation-branch-fill')).backgroundColor})), scrolling:scroll.scrollWidth>scroll.clientWidth, overflow:section.scrollWidth>section.clientWidth+1, hint:section.textContent.includes('Deslize')}; })()`);
      assert.equal(barLayout.bars.length,4); assert.equal(barLayout.bars.at(-1).name,'Total'); assert.equal(barLayout.bars.at(-1).amount,'4529.1');
      assert.notEqual(barLayout.bars[0].color,barLayout.bars.at(-1).color); assert.equal(barLayout.overflow,false);
      if (width<=390) assert.equal(barLayout.scrolling,true); assert.equal(barLayout.hint,true);
      await shot(api, `${kind}-barras-inicio-${width}`);
      await api.evaluate(`(() => {const scroll=document.querySelector('.depreciation-branches-scroll');scroll.scrollLeft=scroll.scrollWidth;})()`);
      assert.equal(await api.evaluate(`(() => {const s=document.querySelector('.depreciation-branches-scroll').getBoundingClientRect(), b=document.querySelector('.depreciation-branch-bar--total').getBoundingClientRect();return b.right<=s.right+1 && b.left>=s.left-1})()`),true);
      await shot(api, `${kind}-barras-total-${width}`);
      await api.evaluate(`document.querySelector('.depreciation-chart-list').scrollIntoView({block:'start'})`);
      await shot(api, `${kind}-valores-registrados-${width}`);
      await key(api, 'Escape', 'Escape', 27); await api.wait('!document.querySelector("[data-depreciation-chart]")');
      assert.equal(await api.evaluate(`document.activeElement===document.querySelector('${chartTrigger}')`), true);
      await api.evaluate(`(() => { const dialog = document.querySelector('[data-asset-report]'); dialog.scrollTop += dialog.querySelector('.asset-report-history').getBoundingClientRect().top-dialog.getBoundingClientRect().top-95; })()`);
      const historyClusters = await api.evaluate(`(() => {
        const card = document.querySelector('[data-asset-history-row]');
        return [...card.querySelectorAll('.asset-report-field')].map(node => { const style=getComputedStyle(node); return {background:style.backgroundColor,border:parseFloat(style.borderWidth),padding:parseFloat(style.paddingTop)}; });
      })()`);
      assert.equal(historyClusters.length, 6);
      assert.ok(historyClusters.every(field => field.background !== 'rgba(0, 0, 0, 0)' && field.border >= 1 && field.padding >= 8), 'cada informação histórica deve ter caixa visual própria');
      const historyColors = await api.evaluate(`(() => [...document.querySelectorAll('[data-asset-history-row]')].map(card => Object.fromEntries([...card.querySelectorAll('.asset-report-field')].map(field => [field.querySelector('dt').textContent, getComputedStyle(field).backgroundColor]))))()`);
      assert.ok(historyColors.every(colors => colors['VALOR DEPRECIAÇÃO'] === 'rgb(254, 226, 226)' && colors['% DEPRECIAÇÃO'] === 'rgb(219, 234, 254)' && colors['VALOR RESIDUAL'] === 'rgb(220, 252, 231)'), 'todos os registros devem destacar valor depreciado em vermelho, percentual em azul e residual em verde');
      await shot(api, `${kind}-historico-${width}`);
      await api.tap(close); await api.wait('!document.querySelector("[data-asset-report]")');
      assert.deepEqual(await api.evaluate(`({page:document.querySelector('.rg-pagination').textContent, search:document.querySelector('input[type="search"]').value, scroll:document.querySelector('.rg-overlay').scrollTop})`), before);
      assert.equal(await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`), true);
      await api.evaluate(`document.querySelector('.rg-overlay summary').focus()`);
      for (let tabs = 0; tabs < 20 && !await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`); tabs++) await key(api, 'Tab', 'Tab', 9);
      assert.equal(await api.evaluate(`document.activeElement===document.querySelector('${trigger}')`), true, 'Tab deve alcançar o cartão');
      await key(api, 'Enter', 'Enter', 13); await api.wait('document.querySelector("[data-asset-history-row]")');
      await key(api, 'Escape', 'Escape', 27); await api.wait('!document.querySelector("[data-asset-report]")');
      await key(api, ' ', 'Space', 32); await api.wait('document.querySelector("[data-asset-history-row]")');
      await key(api, 'Escape', 'Escape', 27); await api.wait('!document.querySelector("[data-asset-report]")');
      assert.deepEqual(await api.evaluate('window.assetReportFixture.calls'), ['96', '96', '96']);
      t.diagnostic(JSON.stringify({ width, kind, id: layout.id, cards: layout.cards, overflow: layout.overflow, fieldOverflow: layout.fieldOverflow, buttonHeight: layout.buttonHeight }));
    });
  }
});

test('rótulos não se sobrepõem quando pontos têm a mesma data e o mesmo valor', { timeout: 60_000, skip: !browser && 'Chrome unavailable' }, async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'asset-chart-flat-'));
  const server = await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..'), cacheDir] } } });
  t.after(async () => { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }); await server.listen();
  await withAttachmentBrowser(browser, { width: 320, height: 900 }, async api => {
    await api.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/asset-report.html?kind=asset&scenario=flat`);
    await api.wait('window.assetReportFixture?.ready');
    await api.tap(trigger); await api.wait('document.querySelector("[data-asset-history-row]")');
    await api.tap('[data-action="open-depreciation-chart"]');
    await api.wait(`(() => {const a=[...document.querySelectorAll('[data-chart-label]')];return a.length===3&&a.every(n=>n.dataset.positioned==='true')})()`);
    const labels=await api.evaluate(`[...document.querySelectorAll('[data-chart-label]')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})`);
    assert.ok(labels.every((a,i)=>labels.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)));
    await shot(api,'flat-grafico-320');
  });
});
