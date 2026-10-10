import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";

const paymentOptions = [
  { id: "14", reply: "14", label: "14 - PAGO POR TERCEIRO" },
  { id: "13", reply: "13", label: "13 - DIVERSOS" },
  { id: "12", reply: "12", label: "12 - DEPRECIAÇÃO E AMORTIZAÇÃO" },
  { id: "11", reply: "11", label: "11 - ENERGÉTICA BTG" },
  { id: "10", reply: "10", label: "10 - ENERGÉTICA SICOOB" },
  { id: "9", reply: "9", label: "9 - CONTA BANCÁRIA DE TERCEIRO" },
  { id: "8", reply: "8", label: "8 - NÃO ESPECIFICADO" },
  { id: "7", reply: "7", label: "7 - SICOOB AMAEL" },
  { id: "6", reply: "6", label: "6 - BTG BERNARDO" },
  { id: "5", reply: "5", label: "5 - AMAEL SICOOB" },
  { id: "4", reply: "4", label: "4 - CONTA D" },
  { id: "3", reply: "3", label: "3 - CONTA C" },
  { id: "2", reply: "2", label: "2 - CONTA B" },
  { id: "1", reply: "1", label: "1 - CONTA A" },
];

function state({ options = paymentOptions, flow = "payment_settlement", question, draft = "" } = {}) {
  return {
    sessionStatus: "authenticated",
    account: { name: "Bernardo Notini", username: "teste@example.com" },
    draft,
    pendingFiles: [],
    activeText: null,
    activeFlow: { id: flow, title: flow === "payment_settlement" ? "APONTAR PAGAMENTO DA PROVISÃO" : "OUTRO FLUXO" },
    messages: [{
      id: "provision-payment-method",
      type: "poll",
      role: "assistant",
      question: question || "💳 QUAL É A FORMA DE PAGAMENTO? CASO DESEJE FILTRAR, DIGITE UM TEXTO.",
      databaseFilter: true,
      databaseFilterKey: "forma_pgto_baixa",
      options,
    }],
  };
}

function replies(root) {
  return [...root.querySelectorAll(".chat-choice-button[data-reply-id]")].map(button => button.dataset.replyId);
}

test("forma de pagamento da baixa de provisão usa ID numérico crescente, não ordem textual", t => {
  const before = structuredClone(paymentOptions);
  const dom = new JSDOM(renderChatMarkup(state()));
  t.after(() => dom.window.close());
  assert.deepEqual(replies(dom.window.document), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"]);
  assert.deepEqual(paymentOptions, before, "a lista recebida não deve ser alterada");
});

test("filtrar formas de pagamento conserva a ordem crescente e envia o ID original ao clicar", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const selected = [];
  view.on("select-reply", event => selected.push(event));
  view.render(state({ draft: "sicoob" }));
  assert.deepEqual(replies(root), ["5", "7", "10"]);
  root.querySelector('[data-reply-id="10"]').click();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].replyId, "10");
  assert.equal(selected[0].label, "10 - ENERGÉTICA SICOOB");
});

test("ordena pelo ID exibido preservando replies compostos, opções sem ID e empates", t => {
  const options = [
    { id: "choice:forma_pagamento:14", reply: "choice:forma_pagamento:14", label: "14 - TERCEIRO" },
    { id: "blank", reply: "blank", label: "EM BRANCO" },
    { id: "choice:forma_pagamento:2", reply: "choice:forma_pagamento:2", label: "2 - CAIXA" },
    { id: "choice:forma_pagamento:10", reply: "choice:forma_pagamento:10", label: "10 – BANCO" },
    { id: "choice:forma_pagamento:2-alias", reply: "choice:forma_pagamento:2-alias", label: "2 - CAIXA ALTERNATIVA" },
  ];
  const dom = new JSDOM(renderChatMarkup(state({ options })));
  t.after(() => dom.window.close());
  assert.deepEqual(replies(dom.window.document), ["choice:forma_pagamento:2", "blank", "choice:forma_pagamento:2-alias", "choice:forma_pagamento:10", "choice:forma_pagamento:14"]);
});

test("não reordena formas de pagamento de outros fluxos nem outras perguntas da provisão", t => {
  for (const overrides of [
    { flow: "launch" },
    { flow: "payment" },
    { flow: "scheduled_payment_settlement" },
    { question: "QUAL É O FORNECEDOR?" },
  ]) {
    const dom = new JSDOM(renderChatMarkup(state(overrides)));
    t.after(() => dom.window.close());
    assert.deepEqual(replies(dom.window.document), ["14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
  }
});
