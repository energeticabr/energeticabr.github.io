import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createHrPayrollReport } from "../src/ui/hr-payroll-report-view.js";

test("relatório da IDFOLHA mostra pagamentos, total da folha e subtotal por tipo", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const requests = [];
  const report = createHrPayrollReport({
    root,
    request: async (id, { signal } = {}) => {
      requests.push([id, typeof signal?.addEventListener === "function"]);
      return [
        { id: "81", FORNECEDOR: "EDGAR", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200, QTD: 1, DATA: "2026-09-28T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3456 },
        { id: "82", FORNECEDOR: "EDGAR", TIPOPGTO: "VALE REFEIÇÃO", VALORUNITARIO: 50, QTD: 2, DATA: "2026-09-29T00:00:00Z", IDFOLHA: 12, IDLANCAMENTO: 3457 },
      ];
    },
  });

  await report.open({ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "<EDGAR>" });

  assert.deepEqual(requests, [["12", true]]);
  assert.match(root.textContent, /relatório da folha/i);
  assert.match(root.textContent, /<EDGAR>/);
  assert.equal(root.querySelectorAll(".hr-payroll-payment-card").length, 2);
  const normalizedMoney = node => node.textContent.replace(/\u00a0/g, " ");
  assert.equal(normalizedMoney(root.querySelector('[data-report-total="overall"]')), "R$ 1.300,00");
  assert.equal(normalizedMoney(root.querySelector('[data-report-total-type="SALARIO"]')), "R$ 1.200,00");
  assert.equal(normalizedMoney(root.querySelector('[data-report-total-type="VALEREFEICAO"]')), "R$ 100,00");
  assert.equal(normalizedMoney(root.querySelector('[data-report-line-total="82"]')), "R$ 100,00");
  assert.match(root.textContent, /3456/);
  assert.match(root.textContent, /28\/09\/2026/);
  assert.doesNotMatch(root.textContent, /Não foi possível carregar/);

  report.destroy();
  dom.window.close();
});

test("relatório permite tentar novamente e mostra folha sem pagamentos com total zero", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  let attempts = 0;
  const report = createHrPayrollReport({
    root,
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return [];
    },
  });

  await report.open({ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "EDGAR" });
  assert.match(root.textContent, /Não foi possível carregar os pagamentos/);
  root.querySelector('[data-action="retry-hr-payroll-report"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(attempts, 2);
  assert.match(root.textContent, /Nenhum pagamento vinculado a esta folha/);
  assert.equal(root.querySelector('[data-report-total="overall"]').textContent.replace(/\u00a0/g, " "), "R$ 0,00");
  report.destroy();
  dom.window.close();
});

test("fechar o relatório aborta a consulta e ignora uma resposta tardia", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  let resolveRequest;
  let signal;
  const report = createHrPayrollReport({
    root,
    request: (_id, options = {}) => {
      signal = options.signal;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  });

  const opening = report.open({ id: "12", MESREFERENCIA: "09/2026", FORNECEDOR: "EDGAR" });
  root.querySelector('[data-action="close-hr-payroll-report"]').click();
  assert.equal(signal.aborted, true);
  resolveRequest([{ id: "81", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 1200, QTD: 1 }]);
  await opening;

  assert.equal(root.querySelector(".hr-payroll-report-overlay").hidden, true);
  assert.equal(root.textContent.includes("R$ 1.200,00"), false);
  report.destroy();
  dom.window.close();
});
