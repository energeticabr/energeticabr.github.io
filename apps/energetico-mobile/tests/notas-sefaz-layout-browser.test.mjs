import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { build, createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('NF-e gallery and three-gallery launch group fit narrow phones and Windows in mobile and PWA CSS', { timeout: 120_000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const built = await build({ configFile: false, root: join(root, 'pwa'), base: '/energetico/', logLevel: 'silent', build: { write: false } });
  const css = built.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
  const server = await createServer({ root, logLevel: 'silent', plugins: [{ name: 'serve-built-notas-css', configureServer(devServer) {
    devServer.middlewares.use('/__notas-built.css', (_req, res) => { res.setHeader('Content-Type', 'text/css'); res.end(css); });
  } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(root, '../..')] } } });
  await server.listen(); t.after(() => server.close());
  for (const [width, pwa, mode, expanded, withholding, retentionNone, unified, activeFilters, aggregateWithholding, cancelled] of [[320, false, 'gallery'], [390, false, 'gallery'], [768, false, 'gallery'], [1365, false, 'gallery'],
    [320, false, 'menu'], [390, false, 'menu'], [1365, false, 'menu'], [390, true, 'gallery'], [1365, true, 'gallery'], [320, true, 'menu'], [390, false, 'gallery', true], [320, false, 'gallery', true],
    [320,false,'gallery',false,true], [390,false,'gallery',false,true], [390,true,'gallery',false,true], [320,false,'gallery',true,true], [390,false,'gallery',true,false,true], [320,false,'gallery',false,true,false,true], [390,false,'gallery',false,true,false,true], [320,false,'gallery',true,true,false,true], [390,true,'gallery',false,true,false,true],
    ...[[320,false], [390,false], [1365,false], [390,true]].map(([width,pwa]) => [width,pwa,'gallery',false,false,false,false,true]),
    ...[[320,false], [390,false], [1365,false], [390,true]].map(([width,pwa]) => [width,pwa,'gallery',false,false,false,false,false,true]),
    ...[[320,false], [390,false], [1365,false], [390,true]].map(([width,pwa]) => [width,pwa,'gallery',false,false,false,false,false,false,true])]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: unified ? (expanded ? 4400 : 2400) : expanded ? 1700 : 1100, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/notas-sefaz-responsive.html?mode=${mode}${pwa ? '&pwa' : ''}${expanded ? '&expanded' : ''}${withholding ? '&withholding' : ''}${retentionNone ? '&retentionNone' : ''}${unified ? '&unified' : ''}${activeFilters ? '&activeFilters' : ''}${aggregateWithholding ? '&aggregateWithholding' : ''}${cancelled ? '&cancelled' : ''}`,
      captureScreenshot: (width === 390 || ((unified || aggregateWithholding || cancelled) && width === 320)) && !pwa && Boolean(process.env.NOTAS_SEFAZ_SCREENSHOT_DIR) });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(layout.overflow, false, `${width}/${pwa}/${mode}: page overflow`);
    assert.deepEqual(layout.overflowingCards, [], `${width}/${pwa}/${mode}: card overflow`);
    if (activeFilters) {
      assert.equal(layout.activeFilters.outsidePanel, true);
      assert.match(layout.activeFilters.text, /Tipo fiscal: NF-e/);
      assert.match(layout.activeFilters.text, /Data inicial: 01\/09\/2026/);
      assert.match(layout.activeFilters.text, /Limpar filtros/);
      assert.ok(layout.activeFilters.scrollWidth <= layout.activeFilters.width + 1, 'aviso de filtros sem overflow');
      assert.ok(layout.activeFilters.buttonWidth >= 44 && layout.activeFilters.buttonHeight >= 44, 'limpar filtros acessível ao toque');
    }
    if (mode === 'gallery') {
      if(cancelled){
        assert.equal(layout.cancelled.text,'CANCELADA');
        assert.equal(layout.cancelled.color,'rgb(190, 30, 45)');
        assert.equal(layout.cancelled.pointerEvents,'none');
        assert.notEqual(layout.cancelled.rotation,'none');
        assert.ok(layout.cancelled.mark.left>=layout.cancelled.row.left-1&&layout.cancelled.mark.right<=layout.cancelled.row.right+1,'marca contida no cartão');
        assert.ok(layout.cancelled.mark.top>=layout.cancelled.row.top-1&&layout.cancelled.mark.bottom<=layout.cancelled.row.bottom+1,'marca contida verticalmente');
      } else assert.equal(layout.cancelled,null);
      if (withholding || aggregateWithholding) {
        assert.equal(layout.withholding.background,'rgb(255, 240, 240)');
        assert.equal(layout.withholding.border,'rgb(199, 57, 57)');
        assert.match(layout.withholding.text,/Retenção pelo comprador/);
        assert.match(layout.withholding.text.replace(/\s/g,''),aggregateWithholding ? /R\$13,02/ : /R\$196,50/);
        if (aggregateWithholding) {
          assert.match(layout.withholding.text.replace(/\s/g,''),/PIS\/COFINS\/CSLLretidos:R\$13,02/);
          assert.doesNotMatch(layout.withholding.text,/23,24|1,82|8,40/);
        }
      } else assert.equal(layout.withholding,null);
      assert.equal(layout.pdfRails.length, unified ? 5 : 2);
      if(unified) {
        assert.deepEqual(layout.types,['NF-e','CT-e','NFS-e','NFS-e','NF-e']);
        assert.deepEqual(layout.withholdingIds,['4','7']);
        assert.deepEqual(layout.pdfLabels,['PDFDANFE','PDFDACTE','PDFDANFSe','PDFDANFSe']);
      }
      assert.ok(layout.amountLines.every(lines => lines === 1), 'valores monetários visíveis sem dividir os dígitos');
      assert.ok(layout.emissionLines.every(lines => lines === 1), 'data de emissão inteira, sem quebrar os dígitos');
      assert.ok(layout.pdfRails.every(rail => rail.railRight <= rail.mainLeft), 'PDF à esquerda do conteúdo da própria nota');
      assert.equal(layout.disclosures.count, unified ? 20 : 8);
      assert.notEqual(layout.clusterColors.notes, layout.clusterColors.fisco, 'observações e fisco têm fundos distintos');
      assert.equal(layout.clusterColors.total, 'rgb(233, 245, 235)');
      assert.equal(layout.clusterColors.net, 'rgb(234, 243, 255)');
      assert.equal(layout.clusterColors.discount, 'rgb(255, 245, 223)');
      assert.equal(layout.disclosures.initiallyCollapsed, true);
      assert.equal(layout.disclosures.initiallyHiddenFields, true);
      assert.equal(layout.disclosures.expandedByClick, true);
      for (const summary of layout.disclosures.summaries) assert.ok(summary.width >= 44 && summary.height >= 44, 'cabeçalho confortável para toque');
      assert.equal(layout.cards, unified ? 5 : 2);
      assert.equal(layout.links.length, unified ? 9 : 3);
      for (const link of layout.links) assert.ok(link.width >= 44 && link.height >= 44, `${width}: document link touch area ${JSON.stringify(link)}`);
      assert.equal(layout.notes.length,2);
      for(const note of layout.notes){
        assert.equal(note.whiteSpace,'pre-wrap',`${width}: observacoes preservam linhas`);
        assert.ok(note.width >= note.containerWidth-2,`${width}: observacoes ocupam largura do cartao`);
        assert.ok(note.text.includes('\n'),`${width}: texto completo multiline`);
      }
    } else {
      assert.ok(Math.abs(layout.menu.blueHeight - layout.menu.galleriesHeight) < 1);
      assert.deepEqual(layout.menu.actions.map(action => action.id), ['action_orders_gallery', 'action_launch_gallery', 'action_notas_fiscais_sefaz_gallery']);
      assert.ok(layout.menu.actions[1].bottom <= layout.menu.actions[2].top);
      assert.ok(layout.menu.actions.every(action => action.color === 'rgb(69, 76, 83)'));
    }
    if (screenshot) writeFileSync(join(process.env.NOTAS_SEFAZ_SCREENSHOT_DIR, `notas-sefaz-${unified ? 'unified-' : ''}${mode}-${cancelled ? 'cancelada-' : aggregateWithholding ? 'agregado-' : withholding ? 'retencao-' : ''}${expanded ? 'expanded-' : ''}${width}.png`), screenshot);
    t.diagnostic(`${width}px ${pwa ? 'PWA' : 'mobile'} ${mode}: fits without horizontal overflow`);
  }
});
