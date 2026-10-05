import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createSpendingReportsView } = await import("../src/ui/spending-reports-view.js").catch(() => ({}));
const settle = () => new Promise(resolve => setImmediate(resolve));
const row = (id, changes = {}) => ({ id: String(id), date: "2026-09-12", paymentDate: "2026-09-25", supplier: "Fornecedor muito longo Alfa",
  product: "Cimento", branch: "Filial A", disbursement: "SIM", order: "42", stage: "Fundação", account: "Obra",
  description: "Entrega", unit: 20, quantity: 2, freight: 5, total: 45, ...changes });

function setup(t, data) {
  assert.equal(typeof createSpendingReportsView, "function");
  const dom = new JSDOM("<main></main>");
  const view = createSpendingReportsView({ document: dom.window.document, data });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("9 preserva marca, período, faixas gerenciais, quantidades e cor de total; 10 apresenta provisões reais", async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T12:00:00Z') });
  const calls = [];
  const { view, root } = setup(t, { async loadSnapshot({ reportNumber }) { calls.push(reportNumber); return reportNumber === 9
    ? { launches: [row(1)], productTypes: [{ product: "Cimento", expenseType: "Material" }] }
    : { recurrences: [{ id: "7", status: "ATIVO" }], provisions: [{ id: "41", recurrenceId: "7", branch: "Filial A", supplier: "VIVO", product: "Internet", dueDate: "2026-10-04", schedule: "PENDENTE", total: 89.99, status: "PAGAMENTO PREVISTO" }] }; } });
  assert.equal(root.tagName, "SECTION");
  await view.open(9);
  assert.match(root.querySelector(".sr-heading img")?.src || "", /logo-energetica-oficial\.png/);
  assert.equal(root.firstElementChild?.className, "sr-filters", "Filtros acima da marca, como no Power Apps");
  assert.match(root.textContent, /RESUMO GERENCIAL DE GASTOS/);
  assert.match(root.textContent, /PERÍODO/);
  assert.equal(root.querySelector('[name="stage"]').parentElement.hidden, false);
  assert.match(root.textContent, /QTD TOTAL/);
  assert.ok(root.querySelector(".sr-category--products"));
  assert.ok(root.querySelector(".sr-field--money"));
  assert.match(root.textContent, /PERCENTUAL POR TIPO DE DESPESA/);
  assert.ok(root.querySelector(".sr-category-table"), "o resumo 9 preserva a organização tabular do Power Apps");
  assert.deepEqual([...root.querySelector(".sr-category-table thead").querySelectorAll("th")].map(cell => cell.textContent),
    ["TIPO DE DESPESA", "QTDE. LINHAS", "QTD TOTAL", "TOTAL GASTO", "% DA FILIAL"]);
  await view.open(10);
  assert.equal(root.querySelector(".sr-content").nextElementSibling, root.querySelector(".sr-metrics"),
    "no relatório 10 a grade de provisões vem antes dos totais, como na referência");
  assert.equal(root.querySelector('[name="stage"]').parentElement.hidden, true);
  assert.deepEqual(["branch", "supplier", "product", "paymentStatus", "status"].map(name =>
    root.querySelector(`[name="${name}"]`).parentElement.style.order), ["0", "1", "2", "3", "4"]);
  assert.match(root.textContent, /DESPESAS RECORRENTES/);
  assert.match(root.textContent, /04\/10\/2026/);
  assert.match(root.textContent, /AGENDAMENTO/);
  assert.match(root.textContent, /VIVO/);
  const provisionTable = root.querySelector(".sr-provision-table");
  assert.ok(provisionTable, "o relatório 10 conserva a grade do Power Apps em tela grande");
  assert.deepEqual([...provisionTable.querySelectorAll("thead th")].map(cell => cell.textContent),
    ["FILIAL", "FORNECEDOR", "PRODUTO", "DATA VENCIMENTO", "AGENDAMENTO", "VALOR", "STATUS"]);
  assert.equal(provisionTable.querySelectorAll("tbody tr").length, 1);
  assert.match(provisionTable.querySelector('[data-label="STATUS"]').textContent, /VENCE HOJE/);
  assert.doesNotMatch(root.textContent, /PEDIDO 42/);
  assert.deepEqual(calls, [9, 10]);
});

test("valor incompleto aparece explicitamente sem total definitivo", async t => {
  const { view, root } = setup(t, { async loadSnapshot() { return { recurrences: [{ id: "7", status: "ATIVO" }],
    provisions: [{ id: "1", recurrenceId: "7", status: "PAGAMENTO PREVISTO", total: null }] }; } });
  await view.open(10);
  assert.match(root.querySelector('[data-metric="total"]').textContent, /INCOMPLETO/);
  assert.doesNotMatch(root.querySelector('[data-metric="total"]').textContent, /45,00/);
});

test("agendamento confirmado mostra a data, sem perder o status", async t => {
  const { view, root } = setup(t, { async loadSnapshot() { return { recurrences: [{ id: "7", status: "ATIVO" }],
    provisions: [{ id: "41", recurrenceId: "7", branch: "Filial A", supplier: "VIVO", product: "Internet",
      dueDate: "2026-10-04", schedule: "AGENDADO", scheduledDate: "2026-10-03", total: 89.99,
      status: "PAGAMENTO PREVISTO" }] }; } });
  await view.open(10);
  assert.match(root.textContent, /AGENDADO.*03\/10\/2026/);
});

test("fechar aborta carregamento, limpa números e ignora resposta tardia", async t => {
  let resolve; let signal;
  const { view, root } = setup(t, { loadSnapshot({ signal: activeSignal }) { signal = activeSignal; return new Promise(done => { resolve = done; }); } });
  const opening = view.open(9); await settle(); view.close();
  assert.equal(signal.aborted, true);
  resolve({ launches: [row(1)], productTypes: [] }); await opening;
  assert.equal(root.hidden, true);
  assert.equal(root.querySelector('[data-metric="total"]')?.textContent ?? "", "");
});

test("erro de consulta remove dados antigos e permite tentar novamente sem HTML de origem", async t => {
  let calls = 0;
  const { view, root } = setup(t, { async loadSnapshot() { if (++calls === 2) throw new Error("Falha 503");
    return { launches: [row(1, { product: '<img src=x onerror="alert(1)">' })], productTypes: [] }; } });
  await view.open(9);
  assert.equal(root.querySelectorAll("img").length, 1);
  assert.match(root.querySelector("img")?.src || "", /logo-energetica-oficial\.png/);
  assert.match(root.textContent, /<img src=x/);
  root.querySelector(".sr-refresh").click(); await settle();
  assert.match(root.querySelector("[role=alert]").textContent, /Falha 503/);
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "—");
  root.querySelector(".sr-retry").click(); await settle();
  assert.match(root.querySelector('[data-metric="total"]').textContent, /45,00/);
});
