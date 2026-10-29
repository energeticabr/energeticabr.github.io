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
  for (const [width, pwa, mode, expanded] of [[320, false, 'gallery'], [390, false, 'gallery'], [768, false, 'gallery'], [1365, false, 'gallery'],
    [320, false, 'menu'], [390, false, 'menu'], [1365, false, 'menu'], [390, true, 'gallery'], [1365, true, 'gallery'], [320, true, 'menu'], [390, false, 'gallery', true], [320, false, 'gallery', true]]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width, height: expanded ? 1700 : 1100, mobile: width < 700,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/notas-sefaz-responsive.html?mode=${mode}${pwa ? '&pwa' : ''}${expanded ? '&expanded' : ''}`,
      captureScreenshot: width === 390 && !pwa && Boolean(process.env.NOTAS_SEFAZ_SCREENSHOT_DIR) });
    const dom = new JSDOM(stdout), layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.equal(layout.overflow, false, `${width}/${pwa}/${mode}: page overflow`);
    assert.deepEqual(layout.overflowingCards, [], `${width}/${pwa}/${mode}: card overflow`);
    if (mode === 'gallery') {
      assert.equal(layout.pdfRails.length, 2);
      assert.ok(layout.emissionLines.every(lines => lines === 1), 'data de emissão inteira, sem quebrar os dígitos');
      assert.ok(layout.pdfRails.every(rail => rail.railRight <= rail.mainLeft), 'PDF à esquerda do conteúdo da própria nota');
      assert.equal(layout.disclosures.count, 8);
      assert.notEqual(layout.clusterColors.notes, layout.clusterColors.fisco, 'observações e fisco têm fundos distintos');
      assert.equal(layout.clusterColors.total, 'rgb(233, 245, 235)');
      assert.equal(layout.clusterColors.net, 'rgb(234, 243, 255)');
      assert.equal(layout.clusterColors.discount, 'rgb(255, 245, 223)');
      assert.equal(layout.disclosures.initiallyCollapsed, true);
      assert.equal(layout.disclosures.initiallyHiddenFields, true);
      assert.equal(layout.disclosures.expandedByClick, true);
      for (const summary of layout.disclosures.summaries) assert.ok(summary.width >= 44 && summary.height >= 44, 'cabeçalho confortável para toque');
      assert.equal(layout.cards, 2);
      assert.equal(layout.links.length, 3);
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
    if (screenshot) writeFileSync(join(process.env.NOTAS_SEFAZ_SCREENSHOT_DIR, `notas-sefaz-${mode}-${expanded ? 'expanded-' : ''}390.png`), screenshot);
    t.diagnostic(`${width}px ${pwa ? 'PWA' : 'mobile'} ${mode}: fits without horizontal overflow`);
  }
});
