import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('retorno com aviso e anexo restaura mascotes e abre relatórios reais no celular e PC', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({ root, cacheDir: 'node_modules/.vite-home-return',
    optimizeDeps: { noDiscovery: true, force: true, include: ['decimal.js'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [resolve(root, '../..')] } }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width,height] of [[320,844],[365,844],[366,844],[375,844],[390,844],[414,844],[425,844],[426,844],[1365,844],[568,320]]) {
      const { stdout, screenshot } = await runBrowserLayout(browser, { width, height,
        captureScreenshot: Boolean(process.env.HOME_RETURN_SCREENSHOT_PREFIX),
        url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/home-return-shortcuts.html?probe` });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.submenuIcons, 0);
        assert.equal(layout.count, 27);
        const [tax,rhid]=layout.taxRhid;
        assert.ok(tax.right<=rhid.x&&Math.abs(tax.y-rhid.y)<1,'INSS imediatamente à esquerda do RHID');
        assert.equal(layout.taxCommercialOverlap,false,JSON.stringify({width,tax,rhid}));
        assert.deepEqual(layout.actions.slice(-2), ['open-holerite-report', 'open-stage-gantt']);
        assert.ok(layout.actions.includes('open-pending-payroll-links'));
        assert.equal(new Set(layout.actions).size, layout.count, 'sem atalhos duplicados');
        assert.equal(layout.payslip, 'Holerite');
        assert.deepEqual(layout.reportLabels.map(({ fits, ...label }) => label),
          ['INSS', 'RHID', 'IDFOLHA', 'Holerite', 'GANTT'].map(text => ({
            text, color: 'rgb(255, 255, 255)', background: 'rgb(160, 37, 54)', height: 14,
            fullWidth: true, atBottom: true,
          })), `faixas dos relatórios em ${width}x${height}`);
        for (const label of layout.reportLabels.slice(0, 3)) {
          assert.equal(label.fits, true, `${label.text} cabe na faixa em ${width}x${height}`);
        }
        assert.ok(layout.actions.includes('open-sicoob-transaction-report'));
        assert.ok(layout.buttons.every(button => button.external && button.loaded && button.width >= 44 && button.height >= 44
          && button.left >= 0 && button.right <= width + 1), JSON.stringify({ width, layout }));
        assert.equal(layout.overflow, false);
        assert.match(layout.notice, /OS DADOS DO FLUXO FORAM ELIMINADOS[\s\S]*OS ANEXOS FORAM TRANSFERIDOS/);
        assert.match(layout.attachment, /Documento transferido\.pdf/);
        assert.equal(layout.reportReady, true, 'o clique precisa abrir e preencher o relatório, não só emitir evento');
        assert.equal(layout.taxReportReady,true,'INSS abre dados reais da fonte da galeria');
        assert.equal(layout.taxClosedBack,true,'fechar INSS volta ao menu e ao mascote');
        assert.equal(layout.taxReportFits,true,`relatório INSS cabe na área disponível em ${width}x${height}`);
        assert.deepEqual(layout.opened, ['payments','taxGuides']);
        assert.deepEqual(layout.reads, ['payments','taxGuides']);
        assert.deepEqual(layout.selected, [], 'abrir o relatório não muda o fluxo da conversa');
        if (screenshot) writeFileSync(`${process.env.HOME_RETURN_SCREENSHOT_PREFIX}-${width}.png`, screenshot);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
