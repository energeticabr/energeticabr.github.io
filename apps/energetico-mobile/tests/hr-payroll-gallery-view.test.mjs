import test from "node:test";
import { confirmPayrollProvisionEdit } from './helpers/payroll-provision-edit-review.mjs';
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createHrPayrollGallery } from "../src/ui/hr-payroll-gallery-view.js";

function response(gallery, page = 1, rows = [], hasMore = false) {
  return { gallery, page, pageSize: 25, fields: [], rows, hasMore, nextCursor: hasMore ? "opaque-next-page" : null };
}

test("holerites exibem funcionário, semana e PDF de cada registro sem excluir ou criar folhas", async t => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const opened = [];
  const openedDates = [];
  const rows = [
    { id: "17", FORNECEDOR: "EDGAR", SEMANA_INICIO: "2026-11-09", SEMANA_FIM: "2026-11-15", TOTAL: "285", pdfFileName: "Holerite-2026-11-09-253.pdf" },
    { id: "18", FORNECEDOR: "FELICIANO", SEMANA_INICIO: "2026-11-09", SEMANA_FIM: "2026-11-15", TOTAL: "280", pdfFileName: "Holerite-2026-11-09-260.pdf" },
  ];
  const gallery = createHrPayrollGallery({
    root, gallery: "HOLERITE",
    request: async (kind, _page, _size, _cursor, options) => {
      assert.equal(options.groupByDate, true);
      return { ...response(kind, 1, rows), dateGroups: [{ date: "2026-11-13", rows }] };
    },
    openPayslip: row => { opened.push([row.id, row.pdfFileName]); },
    openDatePayslips: date => { openedDates.push(date); },
    loadEditor: () => assert.fail("read only"), deleteItem: () => assert.fail("read only"),
  });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const group = root.querySelector(".hr-payslip-date");
  const toggle = group.querySelector("[data-action=toggle-payslip-date]");
  assert.match(toggle.textContent, /13\/11\/2026/);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const datePdf = group.querySelector("[data-action=open-payslip-date]");
  assert.match(datePdf.getAttribute("aria-label"), /Abrir.*13\/11\/2026/);
  assert.equal(datePdf.textContent, "PDF");
  datePdf.click();
  await Promise.resolve();
  assert.deepEqual(openedDates, ["2026-11-13"]);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const cards = [...root.querySelectorAll(".hr-gallery-card")];
  assert.match(cards[0].textContent, /EDGAR/);
  assert.match(cards[1].textContent, /FELICIANO[^]*09\/11\/2026[^]*15\/11\/2026[^]*280,00/);
  assert.equal(root.querySelector("[data-gallery-action], [data-action=create-payroll-record]"), null);
  for (const card of cards) {
    const pdf = card.querySelector("[data-action=open-payslip-pdf]");
    assert.equal(card.firstElementChild, pdf);
    assert.equal(pdf.nextElementSibling, card.querySelector(".gallery-record-main"));
    assert.ok(pdf.querySelector('svg[aria-hidden="true"]'));
    assert.match(pdf.getAttribute("aria-label"), /Ver PDF do holerite/);
  }
  cards[0].querySelector("[data-action=open-payslip-pdf]").click();
  await Promise.resolve();
  assert.deepEqual(opened, [["17", "Holerite-2026-11-09-253.pdf"]]);
});

test('o total de cada holerite expande apenas suas próprias rubricas', async t => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector('#root');
  const rows = [{ id: '17', FORNECEDOR: 'Edgar', TOTAL: 133.38, rubrics: [
    { label: 'Salário', quantity: '3', unitValue: '41.125', total: 123.38, formaPgto: 'SWILE' },
    { label: 'Vale alimentação', quantity: '2', unitValue: '5', total: 10 },
  ] }, { id: '18', FORNECEDOR: 'Rafael', TOTAL: 75, rubrics: [] }];
  const gallery = createHrPayrollGallery({ root, gallery: 'HOLERITE', request: async kind => ({
    ...response(kind, 1, rows), dateGroups: [{ date: '2026-11-13', rows }],
  }) });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  root.querySelector('[data-action=toggle-payslip-date]').click();
  const [edgar, rafael] = root.querySelectorAll('.hr-gallery-card details');
  assert.equal(edgar.open, false);
  assert.equal(rafael.open, false);
  assert.match(edgar.querySelector('summary').textContent, /Total\s*R\$\s*133,38/);
  edgar.querySelector('summary').click();
  assert.equal(edgar.open, true);
  assert.equal(rafael.open, false);
  assert.match(edgar.textContent, /Salário.*123,38.*Quantidade3.*41,125.*SWILE/);
  assert.match(edgar.textContent, /Vale alimentação.*10,00/);
  assert.match(rafael.textContent, /Rubricas indisponíveis/);
  edgar.querySelector('summary').click();
  assert.equal(edgar.open, false);
});

test("as ações por fornecedor enviam a via assinada e editam somente o holerite escolhido", async t => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const rows = [{ id: "17", FORNECEDOR: "Edgar", pdfFileName: "Holerite-edgar.pdf" },
    { id: "18", FORNECEDOR: "Rafael", pdfFileName: "Holerite-rafael.pdf" }];
  const signed = [];
  const calls = [];
  const file = new File(["scan"], "assinado.pdf", { type: "application/pdf" });
  const gallery = createHrPayrollGallery({
    root, gallery: "HOLERITE",
    request: async kind => ({ ...response(kind, 1, rows), dateGroups: [{ date: "2026-11-13", rows }] }),
    pickSignedPayslip: async source => { calls.push(["pick", source]); return [file]; },
    listSignedPayslips: async row => { calls.push(["list", row.id]); return [...signed]; },
    uploadSignedPayslips: async (row, files) => {
      calls.push(["upload", row.id, files]); signed.push({ name: "via-assinada.pdf" }); return [...signed];
    },
    openSignedPayslip: async (row, attachment) => calls.push(["open", row.id, attachment.name]),
    loadPayslipEditor: async row => ({ supplier: row.FORNECEDOR, branch: "Obra A", date: "2026-11-13",
      lines: [{ rubrica: 'salary', quantity: 1, unitValue: 20, formaPgto: 'PIX' }], total: 20,
      attachments: [{ name: 'recibo.pdf', label: 'Recibo da folha' }] }),
    savePayslipEditor: async (row, _context, draft) => {
      calls.push(["save", row.id, draft]); row.FORNECEDOR = draft.supplier;
    },
  });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await gallery.open();
  root.querySelector('[data-action="toggle-payslip-date"]').click();
  const cards = root.querySelectorAll(".hr-gallery-card");
  assert.equal(root.querySelectorAll('[data-action="upload-payslip"]').length, 2);
  assert.equal(root.querySelectorAll('[data-action="edit-payslip"]').length, 2);
  cards[1].querySelector('[data-action="upload-payslip"]').click();
  await settle();
  for (const option of ["Enviar anexo", "Escanear", "Enviar foto"]) assert.match(root.querySelector('[data-payslip-dialog]').textContent, new RegExp(option));
  root.querySelector('[data-payslip-source="scan"]').click();
  await settle();
  assert.deepEqual(calls, [["list", "18"], ["pick", "scan"]]);
  root.querySelector('[data-action="confirm-signed-payslip"]').click();
  await settle();
  assert.deepEqual(calls.at(-1), ["upload", "18", [file]]);
  root.querySelector('[data-action="open-signed-payslip"]').click();
  await settle();
  assert.deepEqual(calls.at(-1), ["open", "18", "via-assinada.pdf"]);
  root.querySelector('[data-action="close-payslip-dialog"]').click();
  cards[0].querySelector('[data-action="edit-payslip"]').click();
  await settle();
  const form = root.querySelector('[data-payslip-dialog] form');
  form.elements.supplier.value = "Edgar da Silva";
  form.querySelector('[data-payslip-line="quantity"]').value = '3';
  form.querySelector('[data-payslip-line="unitValue"]').value = '41,125';
  form.querySelector('[data-payslip-line="unitValue"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(form.querySelector('[data-payslip-total]').textContent, /123,38/);
  form.querySelector('[data-action="remove-payslip-attachment"]').click();
  form.querySelector('[data-payslip-source="files"]').click();
  await settle();
  assert.deepEqual(calls.at(-1), ['pick', 'files']);
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  assert.deepEqual(calls.at(-1), ["save", "17", { supplier: "Edgar da Silva", branch: "Obra A", date: "2026-11-13",
    lines: [{ rubrica: 'salary', quantity: '3', unitValue: '41,125', formaPgto: 'PIX' }], uploads: [file], removed: ['recibo.pdf'], restored: [] }]);
  assert.match(root.querySelector(".hr-gallery-cards").textContent, /Edgar da Silva/);
});

test('payroll mutation invalidates a pending background snapshot and refreshes saved values', async t => {
  const dom = new JSDOM('<main id="root"></main>');
  const document = dom.window.document;
  const oldFormData = globalThis.FormData; globalThis.FormData = dom.window.FormData;
  let reads = 0, resolveOld, date = '2026-09-28';
  const gallery = createHrPayrollGallery({ root: document.querySelector('#root'), gallery: 'FOLHAPGTO',
    request: async () => {
      reads++;
      if (reads === 2) return new Promise(resolve => { resolveOld = resolve; });
      return response('FOLHAPGTO', 1, [{ id: '3', DATA: date }]);
    },
    loadEditor: async id => ({ entity: { id: 'test', title: 'Folha' }, contract: { hasForm: true },
      columns: [{ name: 'DATA', label: 'Data', control: 'date', editable: true }], item: { id, fields: { DATA: date } } }),
    saveEditor: async (_context, fields) => { date = fields.DATA; return { id: '3', fields }; },
  });
  t.after(() => { gallery.destroy(); dom.window.close(); globalThis.FormData = oldFormData; });
  await gallery.open();
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  document.querySelector('[data-gallery-action="edit"]').click();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  document.querySelector('[name=DATA]').value = '2026-09-29';
  document.querySelector('.gallery-record-dialog form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(date, '2026-09-28', 'first submit must not change saved payroll values');
  confirmPayrollProvisionEdit(document);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 3);
  resolveOld(response('FOLHAPGTO', 1, [{ id: '3', DATA: '2026-09-28' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(document.querySelector('.hr-gallery-cards').textContent, /29\/09\/2026/);
});

test("galeria IDFOLHA apresenta mês e fornecedor e escapa os dados", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const gallery = createHrPayrollGallery({
    root,
    gallery: "IDFOLHA",
    request: async () => response("IDFOLHA", 1, [{ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "<Edgar>" }]),
  });
  await gallery.open();
  assert.match(root.textContent, /09\/2026/);
  assert.match(root.textContent, /<Edgar>/);
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /ID 12/);
  gallery.destroy();
  dom.window.close();
});

test("galeria FOLHAPGTO mostra campos previstos e navega páginas sem editar", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const requests = [];
  const gallery = createHrPayrollGallery({
    root,
    gallery: "FOLHAPGTO",
    request: async (id, page, pageSize, cursor) => {
      requests.push([id, page, pageSize, cursor]);
      return response(id, page, [{ id: "57", FORNECEDOR: "EDGAR", TIPOPGTO: "SALÁRIO", VALORUNITARIO: "1200", QTD: "1", DATA: "25/09/2026", IDFOLHA: "12", IDLANCAMENTO: "3456" }], page === 1);
    },
  });
  await gallery.open();
  for (const field of ["Fornecedor", "Tipo de pagamento", "Valor unitário", "Quantidade", "Data", "IDFOLHA", "ID do lançamento"]) {
    assert.match(root.textContent, new RegExp(field));
  }
  root.querySelector('[data-action="next-page"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests, [["FOLHAPGTO", 1, 25, null], ["FOLHAPGTO", 2, 25, "opaque-next-page"]]);
  assert.equal(root.querySelector('.gallery-record-dialog'), null);
  assert.ok(root.querySelector('input[type="search"]'));
  gallery.destroy();
  dom.window.close();
});

test("galeria apresenta estado de erro e permite fechar", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  let closed = 0;
  const gallery = createHrPayrollGallery({ root, gallery: "IDFOLHA", request: async () => { throw new Error("offline"); }, onClose() { closed++; } });
  await gallery.open();
  assert.match(root.textContent, /Não foi possível carregar/);
  root.querySelector('[data-action="close-hr-gallery"]').click();
  assert.equal(closed, 1);
  gallery.destroy();
  dom.window.close();
});

test("retry mantém a página e o cursor que falharam ao avançar", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const requests = [];
  let failSecondPage = true;
  const gallery = createHrPayrollGallery({
    root,
    gallery: "IDFOLHA",
    request: async (_gallery, page, _pageSize, cursor) => {
      requests.push([page, cursor]);
      if (page === 2 && failSecondPage) {
        failSecondPage = false;
        throw new Error("transient SharePoint failure");
      }
      return response("IDFOLHA", page, [{ id: String(page), MESREFERENCIA: "09/2026" }], page === 1);
    },
  });
  await gallery.open();
  root.querySelector('[data-action="next-page"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  root.querySelector(".hr-gallery-retry").click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(requests, [[1, null], [2, "opaque-next-page"], [2, "opaque-next-page"]]);
  assert.match(root.textContent, /Página 2/);
  assert.doesNotMatch(root.textContent, /Tentar novamente/);
  gallery.destroy();
  dom.window.close();
});

test("galeria pode ser fechada enquanto aguarda a resposta do SharePoint", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  let resolveRequest;
  const gallery = createHrPayrollGallery({
    root,
    gallery: "IDFOLHA",
    request: () => new Promise(resolve => { resolveRequest = resolve; }),
  });
  const opening = gallery.open();
  const close = root.querySelector('[data-action="close-hr-gallery"]');
  assert.equal(close.disabled, false);
  close.click();
  assert.equal(root.querySelector(".hr-gallery-overlay").hidden, true);
  resolveRequest(response("IDFOLHA"));
  await opening;
  gallery.destroy();
  dom.window.close();
});

test("IDFOLHA mostra o atalho de relatório à direita e abre a folha daquele cartão", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const reportRequests = [];
  const gallery = createHrPayrollGallery({
    root,
    gallery: "IDFOLHA",
    request: async () => response("IDFOLHA", 1, [{ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "EDGAR" }]),
    requestReport: async id => {
      reportRequests.push(id);
      return [{ id: "81", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200, QTD: 1, IDFOLHA: 12 }];
    },
  });

  await gallery.open();
  const actions = root.querySelector(".hr-gallery-card .gallery-record-actions");
  const button = actions.querySelector('[data-action="open-payroll-report"]');
  assert.ok(button);
  assert.equal(button.parentElement, actions);
  assert.equal(button.querySelector("img")?.alt, "");
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(reportRequests, ["12"]);
  assert.match(root.textContent, /relatório da folha/i);
  assert.match(root.textContent.replace(/\u00a0/g, " "), /R\$ 1\.200,00/);
  root.querySelector('[data-action="close-hr-payroll-report"]').click();
  assert.equal(root.querySelector(".hr-payroll-report-overlay").hidden, true);
  assert.equal(root.querySelector(".hr-gallery-overlay").hidden, false);
  gallery.destroy();
  dom.window.close();
});

test("galeria FOLHAPGTO não ganha o botão de relatório de IDFOLHA", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const gallery = createHrPayrollGallery({
    root,
    gallery: "FOLHAPGTO",
    request: async () => response("FOLHAPGTO", 1, [{ id: "81", TIPOPGTO: "SALÁRIO" }]),
    requestReport: async () => [],
  });

  await gallery.open();
  assert.equal(root.querySelector('[data-action="open-payroll-report"]'), null);
  gallery.destroy();
  dom.window.close();
});
