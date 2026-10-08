import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';

// Break: the real header clips settings/mascot/sign-out, images fail to load, portrait hides the report,
// or the shared PDF loses an indicator or a partial-data warning. Run sequentially, after other browsers.
test('authenticated header and summary fit phone tablet and desktop with usable settings and complete PDF', {timeout:240000}, async t => {
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const temporaryRoot = resolve(tmpdir()), cacheRoot = await mkdtemp(join(temporaryRoot, 'general-summary-vite-'));
  let server;
  try {
    server = await createServer({root:resolve(fileURLToPath(new URL('..', import.meta.url))), cacheDir:join(cacheRoot, 'cache'),
      optimizeDeps:{noDiscovery:true, include:['decimal.js', 'pdf-lib']},
      server:{host:'127.0.0.1', port:0, hmr:false, watch:null}, logLevel:'silent'});
    await server.listen();
    for (const [width, height] of [[320,568], [390,844], [667,375], [844,390], [1024,768], [1280,800]]) {
      const {stdout} = await runBrowserLayout(browser, {width, height,
        url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/general-summary-report-browser.html`});
      const dom = new JSDOM(stdout); let result;
      try {result = JSON.parse(dom.window.document.documentElement.dataset.layout);} finally {dom.window.close();}
      assert.equal(result.error, undefined, `${width}px: ${result.error}`);
      const header = result.header;
      assert.equal(header.adjacentToSignOut, true, `${width}px: mascot must be immediately left of Sair`);
      assert.equal(header.adjacentToSettings, true);
      assert.equal(header.overflow, 0, `${width}px: header horizontal overflow`);
      assert.equal(header.documentOverflow, 0);
      assert.equal(header.logoLoaded, true); assert.match(header.logoUrl, /report-mascots\/stage-progress\.png$/);
      assert.equal(header.background, 'rgb(245, 241, 206)');
      assert.ok(header.mascot.width >= 44 && header.mascot.width <= 56);
      assert.ok(header.mascot.left >= header.bounds.left && header.mascot.right <= header.bounds.right);
      assert.ok(header.signOut.left >= header.mascot.right && header.signOut.right <= header.bounds.right);
      assert.equal(header.objectFit, 'contain');
      assert.equal(header.settings.enabled, true); assert.equal(header.settings.hitTarget, true);
      assert.equal(header.settings.focused, true); assert.equal(header.settings.opened, true); assert.equal(header.settings.closed, true);
      assert.ok(header.settings.bounds.width >= 44 && header.settings.bounds.height >= 44);
      assert.equal(result.loads, 1); assert.equal(result.portraitBlocked, false); assert.equal(result.metricCount, 12);
      assert.equal(result.logoLoaded, true); assert.equal(result.documentOverflow, 0);
      assert.ok(result.toolbarOverflow <= 1); assert.ok(result.contentOverflow <= 1);
      assert.ok(result.contentHeight > 80);
      assert.equal(result.navigationArrows, 0);
      assert.equal(result.toolbarBackground, 'rgb(245, 241, 206)');
      assert.deepEqual(result.groupColors, ['rgb(0, 16, 96)', 'rgb(136, 160, 209)', 'rgb(99, 139, 44)', 'rgb(203, 102, 102)', 'rgb(172, 62, 11)']);
      if (width >= 1024) {
        assert.ok(Math.abs(result.groupWidthRatios.documents / result.groupWidthRatios.tasks - 31 / 69) < 0.015);
        assert.ok(Math.abs(result.groupWidthRatios.works / result.groupWidthRatios.commercial - 62 / 38) < 0.025);
        assert.ok(Math.abs(result.rows.documents - result.rows.tasks) <= 1);
        assert.ok(Math.abs(result.rows.works - result.rows.commercial) <= 1);
      }
      for (const action of result.actions) assert.ok(action.width >= 40 && action.height >= 44);
      assert.deepEqual(result.actions.map(action => action.label), ['Abrir PDF do relatório', 'Atualizar resumo geral']);
      assert.equal(result.pdf.title, 'Resumo geral'); assert.equal(result.pdf.header, '%PDF-'); assert.ok(result.pdf.pages >= 1);
      for (const label of ['VENCIMENTOS HOJE', 'PGTOS VENCIDOS', 'PEDIDOS PEND. AUDITORIA', 'ORÇAMENTOS PENDENTES',
        'DOCUMENTOS PENDENTES', 'TAREFAS PENDENTES', 'DELEGADAS PENDENTES', 'CONTRATOS ATIVOS',
        'VALOR TOTAL PEND. PGTO', 'DIÁRIOS DE OBRA PENDENTES', 'PATOLOGIAS ATIVAS']) assert.ok(result.pdf.text.includes(label));
      assert.ok(result.pdf.text.includes('7.303,00')); assert.ok(result.pdf.text.includes('Conferir indicadores carregados.'));
      assert.equal(result.partial.value, '—'); assert.equal(result.partial.visible, true);
      assert.ok(result.partial.text.includes('DOCUMENTOS indisponíveis: consulta incompleta.'));
      assert.equal(result.closed, true); assert.equal(result.appInert, false); assert.equal(result.restoredHeaderFocus, true);
      t.diagnostic(`${width}x${height}: real header, settings, 12 indicators, ${result.pdf.pages} PDF page(s), printable partial warning`);
    }
  } finally {
    await server?.close();
    if (dirname(resolve(cacheRoot)) !== temporaryRoot || !basename(cacheRoot).startsWith('general-summary-vite-')) {
      throw new Error('Cache fora do diretório temporário autorizado.');
    }
    await rm(cacheRoot, {recursive:true, force:true, maxRetries:5, retryDelay:250});
  }
});
