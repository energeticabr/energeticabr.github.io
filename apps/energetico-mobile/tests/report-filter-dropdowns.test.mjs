import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { bindSearchableFilterSelects } from '../src/ui/searchable-filter-selects.js';

const names = ['COPIADORA ALTERNATIVA', 'ÂNGELO BRAGA', 'PREFEITURA OP', 'CREA', 'COPIADORA LIMA', 'LOJA ELÉTRICA', 'JOÃO RETROESCAVADEIRA', 'Fornecedor 8', 'Fornecedor 9'];
const css = readFileSync(new URL('../src/ui/searchable-filter-selects.css', import.meta.url), 'utf8');
function layout(dom, input, { height = 390, top = 20, bottom = 47, left = 620, width = 150 } = {}) {
  const viewport = new dom.window.EventTarget();
  Object.assign(viewport, { height, width: 844, offsetTop: 0, offsetLeft: 0 });
  Object.defineProperty(dom.window, 'visualViewport', { value: viewport, configurable: true });
  input.getBoundingClientRect = () => ({ top, bottom, left, right: left + width, width, height: bottom - top });
  return viewport;
}
function fixture(t) {
  const dom = new JSDOM('<style></style><section><select aria-label="FORNECEDOR"><option value="">Todos</option></select></section>');
  const doc = dom.window.document;
  doc.querySelector('style').textContent = css;
  const select = doc.querySelector('select');
  names.forEach((name, index) => select.add(new dom.window.Option(name, String(index + 1))));
  const binding = bindSearchableFilterSelects(doc.querySelector('section'), { report: true });
  const input = doc.querySelector('[role=combobox]');
  t.after(() => { binding.destroy(); dom.window.close(); });
  return { dom, doc, select, input, popup: doc.querySelector('.sfs-popup'), list: doc.querySelector('.sfs-list') };
}
test('report dropdown fits seven compact rows below the field instead of oversized generic options', t => {
  const ctx = fixture(t); layout(ctx.dom, ctx.input); ctx.input.click();
  assert.equal(ctx.popup.dataset.placement, 'below');
  assert.equal(ctx.list.style.maxHeight, '224px');
  const style = ctx.dom.window.getComputedStyle(ctx.list.firstElementChild);
  assert.equal(style.minHeight, '32px');
  assert.equal(style.boxSizing, 'border-box');
  assert.equal(style.whiteSpace, 'normal');
  assert.equal(ctx.list.children.length, 10, 'scrolling still reaches all existing choices');
});
test('report dropdown remains below with less room and shrinks for the visual keyboard viewport', t => {
  const ctx = fixture(t); const viewport = layout(ctx.dom, ctx.input, { height: 800, top: 300, bottom: 327 });
  ctx.input.click(); viewport.height = 400; viewport.dispatchEvent(new ctx.dom.window.Event('resize'));
  assert.equal(ctx.popup.dataset.placement, 'below');
  assert.ok(parseFloat(ctx.popup.style.maxHeight) <= 68);
  assert.ok(parseFloat(ctx.list.style.maxHeight) <= 62);
});
test('report search matches existing options without accents and does not apply a typed unknown supplier', t => {
  const ctx = fixture(t); layout(ctx.dom, ctx.input); ctx.input.click();
  ctx.input.value = 'joao'; ctx.input.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  assert.deepEqual([...ctx.list.children].map(e => e.textContent), ['JOÃO RETROESCAVADEIRA']);
  assert.equal(ctx.select.value, ''); ctx.list.firstElementChild.click(); assert.equal(ctx.select.value, '7');
  ctx.input.click(); ctx.input.value = 'not a supplier'; ctx.input.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  ctx.input.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(ctx.select.value, '7'); assert.equal(ctx.list.children.length, 0);
});
test('rightmost report filter keeps the entire dropdown inside the centered clipping dialog', t => {
  const ctx = fixture(t);
  const viewport = layout(ctx.dom, ctx.input, { height:800, left:1510, width:140 }); viewport.width=1920;
  const panel=ctx.doc.querySelector('section'); panel.style.overflowX='hidden';
  panel.getBoundingClientRect=()=>({left:260,right:1660,width:1400,top:0,bottom:800,height:800});
  ctx.input.click();
  assert.equal(ctx.popup.style.width,'240px');
  assert.equal(ctx.popup.style.left,'-96px');
  assert.equal(ctx.popup.style.right,'auto');
});
test('report dropdown shrinks to a narrow clipping ancestor instead of hiding labels and scrollbar', t => {
  const ctx=fixture(t); layout(ctx.dom,ctx.input,{left:100,width:100});
  const panel=ctx.doc.querySelector('section');panel.style.overflowX='hidden';
  panel.getBoundingClientRect=()=>({left:90,right:290,width:200,top:0,bottom:390,height:390});
  ctx.input.click();assert.equal(ctx.popup.style.width,'188px');assert.equal(ctx.popup.style.left,'-4px');
});
const reports = [
  ['payment-ledger', 'createPaymentLedgerView', 'loadPaymentsSnapshot', { launches: [] }],
  ['provision-report', 'createProvisionReportView', 'loadProvisionReportSnapshot', { provisions: [], recurrences: [] }],
  ['management-report', 'createManagementReportView', 'loadSnapshot', { launches: [], productTypes: [] }],
  ['order-validation-report', 'createOrderValidationReportView', 'loadOrderValidationSnapshot', { orders: [], launches: [] }],
  ['attendance-summary', 'createAttendanceSummaryReportView', 'loadSnapshot', { presences: [], suppliers: [] }],
  ['stage-progress', 'createStageProgressReportView', 'loadSnapshot', { complete: true, activities: [], launches: [] }],
  ['commercial-receipts', 'createCommercialReceiptsReportView', 'loadSnapshot', { complete: true, properties: [], contracts: [], clients: [], receipts: [] }],
  ['commercial-milestones', 'createCommercialMilestonesReportView', 'loadSnapshot', { complete: true, properties: [], milestones: [] }],
  ['commercial-documents', 'createCommercialDocumentsReportView', 'loadSnapshot', { complete: true, properties: [], contracts: [], documents: [], expenses: [], receipts: [] }],
  ['sac-pathologies', 'createSacPathologiesReportView', 'loadSnapshot', { complete: true, rows: [] }],
  ['document-control-report', 'createDocumentControlReportView', 'loadSnapshot', { documents: [] }],
  ['task-association-report', 'createTaskAssociationReportView', 'loadSnapshot', { tasks: [] }],
];
for (const [file, factory, method, snapshot] of reports) {
  test(`${file}: every select filter searches inline and opens a seven-row report dropdown below`, async t => {
    const dom = new JSDOM('<main id="app"></main><style></style>');
    dom.window.matchMedia = () => ({ matches: false });
    dom.window.document.querySelector('style').textContent = css;
    const create = (await import(`../src/ui/${file}-view.js`))[factory];
    const view = create({ document: dom.window.document, data: { async [method]() { return snapshot; } }, now: () => new Date('2026-10-06T12:00:00Z') });
    t.after(() => { view.destroy(); dom.window.close(); });
    await view.open();
    const inputs = [...view.element.querySelectorAll('[role=combobox]')];
    assert.ok(inputs.length > 0, view.element.textContent.slice(0,300));
    for (const input of inputs) {
      const wrapper = input.closest('.sfs'), select = wrapper.previousElementSibling;
      names.forEach((name, index) => select.add(new dom.window.Option(name, `fixture-${index}`)));
      layout(dom, input); input.click();
      assert.equal(wrapper.querySelector('.sfs-popup').dataset.placement, 'below');
      assert.equal(wrapper.querySelector('.sfs-list').style.maxHeight, '224px');
      assert.equal(input.readOnly, false);
      const original = [...select.selectedOptions].map(e => e.value);
      input.value = 'angelo'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.deepEqual([...wrapper.querySelectorAll('[role=option]')].map(e => e.textContent), ['ÂNGELO BRAGA']);
      assert.deepEqual([...select.selectedOptions].map(e => e.value), original);
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert.equal(wrapper.querySelector('.sfs-popup').hidden, true);
    }
  });
}
