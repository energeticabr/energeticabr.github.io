import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAuditReportsView } from "../src/ui/audit-reports-live-view.js";

function setup(t, data) {
  const dom = new JSDOM("<main></main>");
  const view = createAuditReportsView({ document: dom.window.document, data });
  dom.window.document.querySelector("main").append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("abre cada relatório com dados atuais, cartões acessíveis e tabela para desktop", async t => {
  const called = [];
  const { view, root } = setup(t, { async loadReport(number) { called.push(number); if (number === 11) return { quotes: [{ id: "5", status: "ATIVA", description: "<img src=x onerror=alert(1)>" }], budgets: [] }; if (number === 12) return { rows: [{ id: "1", branch: "A", depreciationDate: "2026-10-02", estimated: 100, residual: 80, quantity: 1, percent: 10 }] }; return { rows: [{ id: "2", status: "PENDENTE", validityDate: "2026-10-05", branch: "A" }] }; } });
  assert.equal(root.tagName, "SECTION");
  await view.open(11);
  assert.match(root.textContent, /COTAÇÕES E ORÇAMENTOS/);
  assert.match(root.textContent, /<img src=x/);
  assert.match(root.querySelector(".ar-brand img")?.getAttribute("src") || "", /logo-energetica-oficial\.png/);
  await view.open(12);
  assert.match(root.textContent, /CONTROLE DE DEPRECIAÇÃO/);
  await view.open(13);
  assert.match(root.textContent, /CONTROLE DE DOCUMENTOS/);
  assert.deepEqual(called, [11, 12, 13]);
  assert.ok(root.querySelector(".ar-desktop-table"));
});

test("11 destaca o estado da cotação e reproduz a grade de orçamentos vinculados", async t => {
  const { view, root } = setup(t, { async loadReport() { return {
    quotes: [{ id: "5", branch: "004 - EDIFÍCIO XAVANTE", stage: "ALVENARIA", status: "ATIVA", description: "Material" }],
    budgets: [{ id: "7", quotationId: "5", branch: "004 - EDIFÍCIO XAVANTE", stage: "ALVENARIA", supplier: "ABC", completedDate: "2026-10-01", total: 250, status: "APROVADO", observation: "Entrega" }],
  }; } });
  await view.open(11);
  assert.equal(root.querySelector('[data-metric="active"]').textContent, "1");
  assert.equal(root.querySelector('.ar-status[data-tone="success"]')?.textContent, "ATIVA");
  assert.deepEqual([...root.querySelectorAll('.ar-budget-table th')].map(node => node.textContent),
    ["ID", "ID COTAÇÃO", "FILIAL", "ETAPA", "FORNECEDOR", "DATA FINALIZADO", "VALOR TOTAL", "STATUS", "OBS"]);
  assert.match(root.querySelector('.ar-budget-table').textContent, /R\$\s*250,00/);
});

test("11 apresenta os dados da cotação uma vez, na ordem do Power Apps", async t => {
  const { view, root } = setup(t, { async loadReport() { return {
    quotes: [{ id: "5", branch: "004 - EDIFÍCIO XAVANTE", stage: "ALVENARIA", status: "ATIVA", description: "Material especial" }], budgets: [],
  }; } });
  await view.open(11);
  const facts = root.querySelector('.ar-quotation-facts');
  assert.ok(facts, "bloco dos dados da cotação");
  assert.deepEqual([...facts.querySelectorAll('dt')].map(node => node.textContent),
    ["ID", "Filial", "Etapa", "Qtd. fornecedores", "Status", "Descrição"]);
  assert.equal(facts.querySelector('[data-field="status"] .ar-status')?.textContent, "ATIVA");
  assert.equal(root.querySelectorAll('.ar-card > .ar-status').length, 0, "status não se repete fora da grade");
  assert.equal(facts.querySelector('[data-field="description"] dd')?.textContent, "Material especial");
  assert.match(root.querySelector('.ar-heading-subtitle')?.textContent || "", /Acompanhamento geral das cotações e dos orçamentos vinculados/);
});

test("11 não pinta cotação inativa como ativa", async t => {
  const { view, root } = setup(t, { async loadReport() { return { quotes: [{ id: "4", status: "INATIVA" }], budgets: [] }; } });
  await view.open(11);
  assert.equal(root.querySelector('.ar-quotation-facts [data-field="status"] .ar-status')?.dataset.tone, "muted");
});

test("12 mostra data de posição e os campos financeiros por filial em grade", async t => {
  const { view, root } = setup(t, { async loadReport() { return { rows: [{ id: "1", assetNumber: "70", branch: "004 - EDIFÍCIO XAVANTE", asset: "MANGOTE", group: "FERRAMENTAS", depreciationDate: "2026-10-02", estimated: 100, residual: 80, quantity: 2, percent: 3 }] }; } });
  await view.open(12);
  assert.match(root.querySelector('.ar-subtitle').textContent, /POSIÇÃO EM \d{2}\/\d{2}\/\d{4}/);
  assert.equal(root.querySelectorAll('.ar-metric').length, 7);
  assert.deepEqual([...root.querySelectorAll('.ar-asset-table th')].map(node => node.textContent),
    ["Nº PATRIM.", "DATA DEPREC.", "GRUPO", "IMOBILIZADO", "% DEPREC.", "VALOR UNIT.", "QTD.", "VALOR TOTAL", "VALOR DEPRECIADO", "VALOR ATUAL", "A DEPRECIAR"]);
});

test("12 apresenta período antes dos indicadores e total na faixa da filial", async t => {
  const { view, root, dom } = setup(t, { async loadReport() { return { rows: [{ id: "1", branch: "004 - EDIFÍCIO XAVANTE", asset: "MANGOTE", depreciationDate: "2026-10-02", estimated: 100, residual: 80, quantity: 2, percent: 3 }] }; } });
  await view.open(12);
  const subtitle = root.querySelector('.ar-report-banner .ar-subtitle');
  const metrics = root.querySelector('.ar-metrics');
  assert.ok(subtitle?.compareDocumentPosition(metrics) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  const branchHeading = root.querySelector('.ar-branch-heading');
  assert.match(branchHeading?.textContent || "", /FILIAL: 004 - EDIFÍCIO XAVANTE/);
  assert.match(branchHeading?.textContent || "", /Valor total: R\$\s*200,00/);
});

test("13 inicia em maior ID e informa há quantos dias documento foi criado e emitido", async t => {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const { view, root, dom } = setup(t, { async loadReport() { return { rows: [
    { id: "1", submittedDate: date, issuedDate: date, status: "PENDENTE", documentType: "COMPROVANTE" },
    { id: "9", submittedDate: date, issuedDate: date, status: "SUBMETIDO", documentType: "SEGURO" },
  ] }; } });
  await view.open(13);
  assert.equal(root.querySelector('[name="order"]').value, "id");
  assert.equal(root.querySelector('.ar-card').dataset.documentId, "9");
  assert.ok(root.querySelector('.ar-documents-banner').compareDocumentPosition(root.querySelector('.ar-metrics')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.match(root.querySelector('.ar-card').textContent, /Criado há 1 dia/);
  assert.match(root.querySelector('.ar-card').textContent, /Emitido há 1 dia/);
  assert.deepEqual([...root.querySelectorAll('.ar-document-table th')].map(node => node.textContent),
    ["ID", "DATA SUBMETIDO", "DATA EMITIDO", "DATA VENCIMENTO", "FILIAL", "HOMOLOGAÇÃO", "TIPO DOCUMENTO", "PESSOA RELACIONADA", "ETAPA", "IMÓVEL", "STATUS"]);
});

test("filtrar documentos recalcula indicadores; atualizar limpa totais durante erro", async t => {
  let calls = 0;
  const { view, root, dom } = setup(t, { async loadReport() { if (++calls === 2) throw new Error("Falha 503"); return { rows: [{ id: "1", branch: "A", status: "PENDENTE" }, { id: "2", branch: "B", status: "SUBMETIDO" }] }; } });
  await view.open(13);
  const branch = root.querySelector('[name="branch"]');
  branch.value = "A"; branch.dispatchEvent(new dom.window.Event("change"));
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "1");
  root.querySelector(".ar-refresh").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "—");
  assert.match(root.querySelector('[role="alert"]').textContent, /Falha 503/);
});

test("close aborta carregamento e ignora resposta tardia", async t => {
  let resolveLoad; let signal;
  const { view, root } = setup(t, { loadReport(_number, options) { signal = options.signal; return new Promise(resolve => { resolveLoad = resolve; }); } });
  const opening = view.open(11);
  view.close();
  assert.equal(signal.aborted, true);
  resolveLoad({ quotes: [{ id: "99", status: "ATIVA" }], budgets: [] });
  await opening;
  assert.equal(root.hidden, true);
  assert.doesNotMatch(root.textContent, /COTAÇÃO Nº 99/);
});
