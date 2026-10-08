import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { decorateReportPrint, REPORT_PDF_TITLES, captureFilteredReport } from '../src/ui/report-print.js';
import { buildFilteredReportPdf } from '../src/chat/filtered-report-pdf.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const summaryApi = await import('../src/ui/general-summary-report-view.js').catch(() => ({}));

// Break: missing summary mapping, wrong toolbar, or including hidden/loading numbers in the PDF.
test('general summary shares the standard PDF and refresh toolbar, not a browser-print shortcut', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const document = dom.window.document;
  const element = document.createElement('section');
  element.innerHTML = '<section role="dialog" aria-label="Resumo geral"><header class="gsr-toolbar"><button aria-label="Atualizar resumo geral">Atualizar</button></header><h2>FINANCEIRO / COMPRAS</h2><article><p>VENCIMENTOS HOJE</p><strong>7</strong></article></section>';
  document.body.append(element);
  let captured, prepares = 0;
  const panel = { element, async preparePrint() { prepares++; }, destroy() {} };
  const decorated = decorateReportPrint(panel, {
    action: 'open-general-summary-report', loadLogo: async () => undefined,
    buildPdf: async snapshot => { captured = snapshot; return new Blob(['%PDF-test']); },
    previewMedia: async promise => { await promise; },
  });
  t.after(() => { decorated.destroy(); dom.window.close(); });
  assert.equal(REPORT_PDF_TITLES['open-general-summary-report'], 'Resumo geral');
  const printer = element.querySelector('.gsr-toolbar [data-action="print-report-pdf"]');
  assert.ok(printer);
  const pair = element.querySelector('.gsr-toolbar .report-print-actions');
  assert.equal(pair.children.length, 2);
  assert.equal(pair.lastElementChild.getAttribute('aria-label'), 'Atualizar resumo geral');
  assert.ok(pair.lastElementChild.querySelector('svg'));
  printer.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prepares, 1); assert.equal(captured.title, 'Resumo geral');
  const text = captured.pages.flatMap(page => page.blocks).flatMap(block => block.runs?.map(run => run.text) ?? []).join(' ');
  assert.match(text, /FINANCEIRO \/ COMPRAS/);
  assert.match(text, /VENCIMENTOS HOJE/); assert.match(text, /7/);
  assert.doesNotMatch(text, /Atualizar/);
});

test('general summary PDF refuses a loading snapshot', t => {
  const dom = new JSDOM('<section aria-label="Resumo geral" aria-busy="true"><p>—</p></section>');
  t.after(() => dom.window.close());
  assert.throws(() => captureFilteredReport(dom.window.document.querySelector('section')), /Aguarde o carregamento/);
});

test('the real summary exports all twelve current indicators into an actual PDF', async t => {
  assert.equal(typeof summaryApi.createGeneralSummaryReportView, 'function', 'the summary needs its own view');
  const dom = new JSDOM('<main id="app"><button id="shortcut">Resumo</button></main>');
  const snapshot = {
    today: '2026-10-07', updatedAt: '2026-10-07T15:00:00Z', warnings: [],
    metrics: { dueToday: 3, overdue: 4, auditOrders: 115, quotes: 1, documents: 18,
      pendingTasks: 69, delegatedTasks: 5, activeContracts: 2, pendingPayments: '7303.00',
      pendingDiaries: 6, commercialDocuments: 13, activePathologies: 7 },
  };
  const view = summaryApi.createGeneralSummaryReportView({ document: dom.window.document,
    data: { async loadReport() { return snapshot; } },
  });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open(); await view.preparePrint();
  const captured = captureFilteredReport(view.element, { title: 'Resumo geral' });
  assert.equal(captured.filters.length, 0);
  const blob = await buildFilteredReportPdf(captured);
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), disableFontFace: true, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) {
      text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str).join(' ') + ' ';
    }
    for (const label of ['FINANCEIRO / COMPRAS', 'DOCUMENTOS', 'TAREFAS', 'OBRAS / RH', 'COMERCIAL',
      'VENCIMENTOS HOJE', 'PGTOS VENCIDOS', 'PEDIDOS PEND. AUDITORIA', 'ORÇAMENTOS PENDENTES',
      'TAREFAS PENDENTES', 'DELEGADAS PENDENTES', 'CONTRATOS ATIVOS', 'VALOR TOTAL PEND. PGTO',
      'DIÁRIOS DE OBRA PENDENTES', 'PATOLOGIAS ATIVAS']) {
      assert.ok(text.includes(label), `PDF must preserve ${label}`);
    }
    assert.match(text, /R\$\s*7\.303,00/);
    for (const value of [115, 18, 69, 13]) assert.match(text, new RegExp(`\\b${value}\\b`));
    assert.doesNotMatch(text, /Atualizar resumo|Fechar resumo|Voltar ao início/);
  } finally { await task.destroy(); }
});
