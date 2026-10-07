import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createDelegatedDeadlineReportView } from '../src/ui/delegated-deadline-report-view.js';
import { decorateReportPrint, captureFilteredReport, REPORT_PDF_TITLES } from '../src/ui/report-print.js';
import { buildFilteredReportPdf } from '../src/chat/filtered-report-pdf.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test('PDF de tarefas por data fatal conserva filtros, totais gerais e responsáveis sem incluir tarefas excluídas', async t => {
  const dom = new JSDOM('<main id="app"><button id="origin">Mascote</button></main>');
  dom.window.matchMedia = () => ({ matches: false });
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/ui/delegated-deadline-report.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const task = { id: 1, createdDate: '2026-10-06', dueDate: '2026-10-07', description: 'PRAZO TESTADO UM',
    association: 'ESTRUTURAS', responsible: 'ALFA', status: 'ATIVIDADE CRIADA', priority: 'ATIVIDADE PRIORITÁRIA', difficulty: 'FÁCIL' };
  const snapshot = { tasks: [task, { ...task, id: 2, description: 'PRAZO TESTADO DOIS' },
    { ...task, id: 3, association: 'PINTURA', description: 'NÃO INCLUIR PINTURA' },
    { ...task, id: 4, status: 'CONCLUÍDO', description: 'NÃO INCLUIR CONCLUÍDA' }] };
  const original = createDelegatedDeadlineReportView({ document: dom.window.document,
    data: { loadSnapshot: async () => snapshot }, now: () => new Date('2026-10-07T12:00:00Z') });
  let previewCalls = 0;
  const panel = decorateReportPrint(original, { action: 'open-delegated-deadline-report', previewMedia: async () => { previewCalls++; } });
  t.after(() => { panel.destroy(); dom.window.close(); });
  await panel.open();
  const association = panel.element.querySelector('select[name="association"]');
  assert.ok(association);
  association.value = 'ESTRUTURAS';
  association.dispatchEvent(new dom.window.Event('change'));
  const pair = panel.element.querySelector('.tdr-toolbar .report-print-actions');
  assert.equal(pair.children.length, 2);
  assert.equal(pair.children[0].dataset.action, 'print-report-pdf');
  assert.match(pair.children[1].getAttribute('aria-label'), /^Atualizar/);
  const captured = captureFilteredReport(panel.element, { title: REPORT_PDF_TITLES['open-delegated-deadline-report'] });
  assert.ok(captured.filters.some(filter => filter.label === 'ETAPA OBRA' && filter.value === 'ESTRUTURAS'));
  assert.ok(captured.filters.some(filter => filter.label === 'STATUS' && /ATIVIDADE CRIADA/.test(filter.value) && /EM ATENDIMENTO/.test(filter.value)));
  const table = captured.pages.flatMap(page => page.blocks).find(block => block.type === 'table');
  assert.equal(table.widths.length, 6);
  const body = table.rows.filter(row => !row.header);
  assert.equal(panel.element.querySelector('.tdr-responsible').rowSpan, 2);
  assert.equal(body.filter(row => row.cells.some(cell => cell.column === 0 && cell.runs.map(run => run.text).join('') === 'ALFA')).length, 2,
    'PDF normalization carries the merged responsible into both task rows');
  const blob = await buildFilteredReportPdf(captured);
  const loading = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), disableFontFace: true, useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const parts = [];
    for (let index = 1; index <= pdf.numPages; index++) parts.push(...(await (await pdf.getPage(index)).getTextContent()).items.map(item => item.str));
    const text = parts.join(' ');
    assert.match(text, /PRAZO TESTADO UM/);
    assert.match(text, /PRAZO TESTADO DOIS/);
    assert.match(text, /ALFA/);
    assert.match(text, /07\/10\/2026/);
    assert.doesNotMatch(text, /NÃO INCLUIR/);
    assert.match(text, /TOTAL DE ATIVIDADES NESTA DATA:\s*2/);
    assert.match(text, /TOTAL DE ATIVIDADES\s*4/);
  } finally { await loading.destroy(); }
  assert.equal(previewCalls, 0, 'capture never shares or opens automatically');
  assert.equal(association.value, 'ESTRUTURAS');
});
