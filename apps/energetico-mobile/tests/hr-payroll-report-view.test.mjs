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

test("resumo agrupa dinheiro sem incluir outras rubricas no subtotal e preserva o total da folha", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const rows = [
    { id: "1", TIPOPGTO: " salário ", VALORUNITARIO: "R$ 284,00", QTD: 1 },
    { id: "2", TIPOPGTO: "SALARIO", VALORUNITARIO: 160, QTD: 1 },
    { id: "3", TIPOPGTO: "Premiação", VALORUNITARIO: 146.13, QTD: 1 },
    { id: "4", TIPOPGTO: "PRÊMIO", VALORUNITARIO: 10.01, QTD: 2 },
    { id: "5", TIPOPGTO: "AJUDA DE CUSTO", VALORUNITARIO: 25, QTD: 2 },
    { id: "6", TIPOPGTO: "vale refeição", VALORUNITARIO: 72.72, QTD: 2 },
    { id: "7", TIPOPGTO: "VALE TRANSPORTE", VALORUNITARIO: 4.5, QTD: 10 },
    { id: "8", TIPOPGTO: "13 SALÁRIO", VALORUNITARIO: 100, QTD: 1 },
    { id: "9", TIPOPGTO: "FÉRIAS E/OU ENCARGOS", VALORUNITARIO: 200, QTD: 1 },
    { id: "10", TIPOPGTO: "OUTRO", VALORUNITARIO: 0.1, QTD: 3 },
  ];
  const before = structuredClone(rows);
  const report = createHrPayrollReport({ root, request: async () => rows });
  await report.open({ id: "4" });
  const cards = [...root.querySelectorAll(".hr-payroll-report-totals > article")];
  assert.deepEqual(cards.map(card => card.querySelector(".hr-payroll-report-total-label").textContent),
    ["DINHEIRO", "VALE REFEIÇÃO", "VALE TRANSPORTE", "TOTAL"]);
  assert.deepEqual(cards.map(card => card.querySelector("strong").textContent.replace(/\u00a0/g, " ")),
    ["R$ 660,15", "R$ 145,44", "R$ 45,00", "R$ 1.150,89"]);
  assert.equal(root.querySelectorAll(".hr-payroll-payment-card").length, 10);
  assert.deepEqual(rows, before);
  report.destroy();
  dom.window.close();
});

test("rubricas recebem cores diferentes e variantes do mesmo tipo mantêm a cor em ambas as listas", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const types = ["SALÁRIO", "PREMIAÇÃO", "AJUDA DE CUSTO", "VALE REFEIÇÃO", "VALE TRANSPORTE", "13 SALÁRIO", "FÉRIAS E/OU ENCARGOS"];
  const report = createHrPayrollReport({ root, request: async () =>
    [...types, " salario ", "PRÊMIO"].map((TIPOPGTO, index) => ({ id: String(index + 1), TIPOPGTO, VALORUNITARIO: 1, QTD: 1 })) });
  await report.open({ id: "4" });
  const cards = [...root.querySelectorAll(".hr-payroll-payment-card")];
  const color = card => card.style.getPropertyValue("--payroll-type-background");
  assert.ok(cards.every(card => color(card)), "cada linha tem cor de rubrica");
  assert.equal(new Set(cards.slice(0, 7).map(color)).size, 7);
  assert.equal(color(cards[0]), color(cards[7]));
  assert.equal(color(cards[1]), color(cards[8]));
  for (const card of cards) {
    const breakdown = root.querySelector('[data-report-total-type="' + card.dataset.paymentType + '"]').closest("details");
    assert.equal(color(card), color(breakdown));
  }
  report.destroy();
  dom.window.close();
});

test("resumo mostra grupos vazios como zero mas não apresenta dinheiro incompleto como subtotal completo", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const report = createHrPayrollReport({ root, request: async () => [
    { id: "1", TIPOPGTO: "SALÁRIO", VALORUNITARIO: 50, QTD: 1 },
    { id: "2", TIPOPGTO: "AJUDA DE CUSTO", VALORUNITARIO: null, QTD: 1 },
  ] });
  await report.open({ id: "4" });
  assert.equal(root.querySelector('[data-report-total="cash"]').textContent, "Não calculado");
  for (const group of ["meal", "transport"]) {
    assert.equal(root.querySelector('[data-report-total="' + group + '"]').textContent.replace(/\u00a0/g, " "), "R$ 0,00");
  }
  assert.match(root.querySelector(".hr-payroll-report-warning").textContent, /1 pagamento/);
  report.destroy();
  dom.window.close();
});

test("pagamentos sem rubrica inclusive espaços mantêm a mesma cor neutra do subtotal Sem tipo", async () => {
  const dom = new JSDOM("<main id='root'></main>");
  const root = dom.window.document.querySelector("#root");
  const report = createHrPayrollReport({ root, request: async () =>
    ["", "   ", null].map((TIPOPGTO, index) => ({ id: String(index + 1), TIPOPGTO, VALORUNITARIO: 1, QTD: 1 })) });
  await report.open({ id: "4" });
  const subtotal = root.querySelector('[data-report-total-type="SEMTIPO"]').closest("details");
  const color = subtotal.style.getPropertyValue("--payroll-type-background");
  for (const card of root.querySelectorAll(".hr-payroll-payment-card")) {
    assert.equal(card.dataset.paymentType, "SEMTIPO");
    assert.equal(card.style.getPropertyValue("--payroll-type-background"), color);
  }
  report.destroy();
  dom.window.close();
});
