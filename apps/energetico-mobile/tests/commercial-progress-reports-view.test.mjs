import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createCommercialProgressReportsView } = await import("../src/ui/commercial-progress-reports-view.js").catch(() => ({}));

const snapshot = {
  properties: [{ id: "1", branch: "Centro", property: "Casa 1", visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "", invoice: "", fiscal: "DECLARADO" }],
  contracts: [{ id: "10", branch: "Centro", property: "Casa 1", buyer: "Ana", status: "VENDIDO", total: 100, saleDate: "2026-09-01", broker: "" }],
  clients: [{ id: "1", branch: "Centro", property: "Casa 1", name: "Ana", definitive: "SIM" }],
  receipts: [{ id: "1", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", amount: 100, paidDate: "", dueDate: "2026-10-10", directBroker: "", description: "Saldo" }],
  milestones: [{ id: "2", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", type: "Assinatura", description: "Último", startDate: "2026-09-30", endDate: "2026-10-04", dueDate: "2026-10-03", status: "ATIVIDADE INICIADA" }],
};

test("visualização alterna relatórios 14 e 15 e filtra imóveis com dados da fonte", async () => {
  assert.equal(typeof createCommercialProgressReportsView, "function");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return snapshot; } } });
  dom.window.document.body.append(view.element);
  await view.open(14);
  assert.equal(view.element.querySelector('.cpr-filters').nextElementSibling?.className, 'cpr-brand', 'Filtros acima do logo, como no Power Apps');
  assert.ok(view.element.querySelector('.cpr-filters .cpr-refresh'), 'atualização deve integrar a barra de filtros acima do logo');
  assert.match(view.element.textContent, /INDICADORES|RESUMO POR IMÓVEL/i);
  assert.match(view.element.textContent, /Casa 1/);
  assert.match(view.element.textContent, /R\$\s*100,00/);
  const propertyFilter = view.element.querySelector('[name="property"]');
  assert.ok([...propertyFilter.options].some(option => option.value === "Casa 1"));
  propertyFilter.value = "Casa 1"; propertyFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(view.element.textContent, /PAGAMENTOS PREVISTOS/i);
  await view.open(15);
  assert.match(view.element.textContent, /ÚLTIMO ANDAMENTO POR IMÓVEL/i);
  assert.match(view.element.textContent, /Assinatura/);
  assert.match(view.element.textContent, /HISTÓRICO COMPLETO/i);
  view.close();
  assert.equal(view.element.hidden, true);
  view.destroy();
  assert.equal(view.element.isConnected, false);
});

test("histórico mostra ID e DATA FIM e filtro de STATUS do marco altera o último apontamento", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const completed = { ...snapshot.milestones[0], id: "3", type: "Entrega", status: "ATIVIDADE FINALIZADA", endDate: "2026-10-05" };
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: {
    async loadSnapshot() { return { ...snapshot, milestones: [...snapshot.milestones, completed] }; },
  } });
  await view.open(15);
  const status = view.element.querySelector('[name="milestoneStatus"]');
  assert.ok(status);
  assert.deepEqual([...status.options].map(option => option.value), ["", "ATIVIDADE FINALIZADA", "ATIVIDADE INICIADA"]);
  view.element.querySelector('[name="property"]').value = "Casa 1";
  view.element.querySelector('[name="property"]').dispatchEvent(new dom.window.Event("change"));
  status.value = "ATIVIDADE INICIADA"; status.dispatchEvent(new dom.window.Event("change"));
  assert.match(view.element.querySelector(".cpr-property").textContent, /Assinatura/);
  assert.match(view.element.querySelector(".cpr-detail").textContent, /ID DO REGISTRO\s*2/);
  assert.match(view.element.querySelector(".cpr-detail").textContent, /DATA FIM\s*04\/10\/2026/);
  assert.doesNotMatch(view.element.querySelector(".cpr-detail").textContent, /Entrega/);
});

test("falha na fonte impede exibir totais antigos e oferece nova tentativa", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  let calls = 0;
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: {
    async loadSnapshot() { calls++; if (calls === 1) return snapshot; throw new Error("Página incompleta"); },
  } });
  await view.open(14);
  view.element.querySelector(".cpr-refresh").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(view.element.textContent, /Página incompleta/);
  assert.equal(view.element.querySelectorAll(".cpr-property").length, 0);
  assert.ok(view.element.querySelector(".cpr-retry"));
});

test("relatório 14 apresenta logo, indicadores de receitas e forma de pagamento/conta no detalhe", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const data = { ...snapshot, receipts: [{ ...snapshot.receipts[0], paymentMethod: "PIX", account: "Conta obra", amount: 70 }] };
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return data; } } });
  await view.open(14);
  assert.match(view.element.querySelector(".cpr-brand img")?.getAttribute("src") || "", /assets\/logo-energetica-oficial\.png$/);
  const cards = [...view.element.querySelectorAll(".cpr-metric")];
  assert.deepEqual(cards.slice(0, 3).map(card => card.textContent), ["VALOR TOTALR$ 70,00", "VALOR PAGOR$ 0,00", "VALOR PENDENTER$ 70,00"]);
  assert.deepEqual(cards.slice(0, 3).map(card => card.dataset.tone), ["total", "paid", "pending"]);
  assert.equal(cards.length, 4);
  assert.match(cards[3].textContent, /STATUS DOS IMÓVEIS.*ATIVOS: 1.*INATIVOS: 0/s);
  view.element.querySelector('[name="property"]').value = "Casa 1";
  view.element.querySelector('[name="property"]').dispatchEvent(new dom.window.Event("change"));
  const receipt = view.element.querySelector(".cpr-receipt");
  assert.match(receipt.textContent, /FORMA PGTO\s*PIX/);
  assert.match(receipt.textContent, /CONTA\s*Conta obra/);
});

test("detalhe do relatório 14 inclui receita com FORNECEDOR vazio vinculada ao comprador pelo contrato", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const data = { ...snapshot, receipts: [
    { ...snapshot.receipts[0], amount: 70, description: "Parcela Ana" },
    { ...snapshot.receipts[0], id: "2", buyer: "", amount: 900, description: "Parcela sem fornecedor" },
  ] };
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return data; } } });
  await view.open(14);
  const buyer = view.element.querySelector('[name="buyer"]');
  buyer.value = "Ana"; buyer.dispatchEvent(new dom.window.Event("change"));
  assert.match(view.element.querySelector(".cpr-metric")?.textContent || "", /R\$\s*970,00/);
  assert.equal(view.element.querySelectorAll(".cpr-detail .cpr-receipt").length, 2);
  assert.match(view.element.querySelector(".cpr-detail")?.textContent || "", /Parcela Ana/);
  assert.match(view.element.querySelector(".cpr-detail")?.textContent || "", /Parcela sem fornecedor/);
});

test("relatório 15 preserva subtítulo e grupos tabulares desktop com os mesmos dados dos cartões móveis", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return snapshot; } } });
  await view.open(15);
  assert.equal(view.element.querySelectorAll(".cpr-metric").length, 0);
  assert.match(view.element.querySelector(".cpr-intro")?.textContent || "", /DATA DE INÍCIO MAIS RECENTE/);
  const headings = [...view.element.querySelectorAll(".cpr-table thead th")].map(node => node.textContent.trim());
  assert.deepEqual(headings, ["FILIAL", "IMÓVEL", "COMPRADOR", "ID CONTRATO", "ÚLTIMO TIPO MARCO", "DESCRIÇÃO", "INÍCIO", "DATA FATAL", "STATUS"]);
  assert.match(view.element.querySelector(".cpr-table tbody")?.textContent || "", /Casa 1.*Ana.*10.*Assinatura/s);
  assert.match(view.element.querySelector(".cpr-table tbody")?.textContent || "", /\d+ DIA\(S\) DE ANDAMENTO/);
  assert.match(view.element.querySelector(".cpr-property")?.textContent || "", /Casa 1.*Ana.*10.*Assinatura/s);
  assert.match(view.element.querySelector(".cpr-branch-footer")?.textContent || "", /TOTAL DE IMÓVEIS NA FILIAL: 1/);
});

test("14 reproduz aviso de seleção e troca contagem por status único ao filtrar imóvel", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return snapshot; } } });
  await view.open(14);
  assert.match(view.element.querySelector(".cpr-detail-hint")?.textContent || "", /SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL/);
  assert.match(view.element.querySelector(".cpr-section-title")?.textContent || "", /🏠 RESUMO POR IMÓVEL/);
  assert.match(view.element.querySelector(".cpr-status-counts")?.textContent || "", /ATIVOS: 1.*INATIVOS: 0/s);
  assert.equal(view.element.querySelector('.cpr-property [data-field="PAGO"] .cpr-field-value')?.textContent, "R$ 0,00");
  const property = view.element.querySelector('[name="property"]');
  property.value = "Casa 1"; property.dispatchEvent(new dom.window.Event("change"));
  assert.equal(view.element.querySelector(".cpr-detail-hint"), null);
  assert.match(view.element.querySelector(".cpr-status-metric")?.textContent || "", /STATUS DO IMÓVEL.*ATIVO/s);
  assert.equal(view.element.querySelector(".cpr-status-counts"), null);
});

test("14 mantém contagem de status quando comprador reúne imóveis diferentes", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const second = { ...snapshot.properties[0], id: "2", property: "Casa 2", visualStatus: "INATIVO" };
  const data = {
    ...snapshot,
    properties: [...snapshot.properties, second],
    contracts: [...snapshot.contracts, { ...snapshot.contracts[0], id: "11", property: "Casa 2" }],
  };
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return data; } } });
  await view.open(14);
  const buyer = view.element.querySelector('[name="buyer"]');
  buyer.value = "Ana"; buyer.dispatchEvent(new dom.window.Event("change"));
  assert.match(view.element.querySelector(".cpr-status-counts")?.textContent || "", /ATIVOS: 1.*INATIVOS: 1/s);
  assert.equal(view.element.querySelector(".cpr-status-single"), null);
});

test("15 mantém título antes da explicação e revela histórico apenas com filtro específico", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return snapshot; } } });
  await view.open(15);
  const content = view.element.querySelector(".cpr-content");
  assert.match(content.firstElementChild?.textContent || "", /ÚLTIMO ANDAMENTO POR IMÓVEL/);
  assert.match(content.children[1]?.textContent || "", /UM REGISTRO POR IMÓVEL/);
  assert.equal(content.querySelector(".cpr-detail"), null);
  const property = view.element.querySelector('[name="property"]');
  property.value = "Casa 1"; property.dispatchEvent(new dom.window.Event("change"));
  assert.match(content.querySelector(".cpr-detail")?.textContent || "", /HISTÓRICO COMPLETO/);
});
