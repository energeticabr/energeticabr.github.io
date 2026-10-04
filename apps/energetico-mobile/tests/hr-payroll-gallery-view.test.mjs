import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createHrPayrollGallery } from "../src/ui/hr-payroll-gallery-view.js";

function response(gallery, page = 1, rows = [], hasMore = false) {
  return { gallery, page, pageSize: 25, fields: [], rows, hasMore, nextCursor: hasMore ? "opaque-next-page" : null };
}

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
  assert.equal(root.querySelector("input"), null);
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
