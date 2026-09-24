import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  commandFromTarget,
  createChatView,
  renderChatMarkup,
  resizeSignatureCanvasToDisplay,
  signaturePointFromEvent,
} from "../src/ui/chat-view.js";
import { JSDOM } from "jsdom";

function signedInState(overrides = {}) {
  return {
    sessionStatus: "authenticated",
    account: { name: "Bernardo Notini", username: "bernardonotini@energeticabr.com" },
    draft: "",
    messages: [],
    pendingFiles: [],
    activeText: null,
    error: null,
    ...overrides,
  };
}

test("cancelar assinatura da galeria devolve contexto ao chamador", () => {
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  const cancelled = [];
  view.on('signature-cancelled', event => cancelled.push(event));
  view.render(signedInState());
  view.openSignaturePad('launch-gallery');
  root.querySelector('[data-action="cancel-signature-pad"]').click();
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].fileId, 'launch-gallery');
  assert.equal(root.querySelector('[data-action="cancel-signature-pad"]'), null);
  view.destroy();
  dom.window.close();
});

test("mostra somente a entrada Microsoft quando não há sessão", () => {
  const markup = renderChatMarkup({ sessionStatus: "signed-out" });

  assert.match(markup, /data-action="sign-in"/);
  assert.match(markup, /Entrar com a Microsoft/);
  assert.doesNotMatch(markup, /data-action="capture-photo"/);
});

test("renderiza conversa acessível com câmera, anexo e compositor", () => {
  const markup = renderChatMarkup(signedInState());

  assert.match(markup, /role="log"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /data-action="capture-photo"/);
  assert.match(markup, /data-action="pick-files"/);
  assert.match(markup, /data-action="send-text"/);
  assert.match(markup, /alt="Mascote Energético"/);
  assert.doesNotMatch(markup, /Painel inicial|Instalar aplicativo/);
  assert.ok(markup.indexOf('data-action="pick-files"') < markup.indexOf('data-action="capture-photo"'),
    "o clipe deve ficar acima da câmera na coluna de anexos");
});

test("escapa conteúdo do usuário e da VM", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "<img onerror=alert(1)>",
    messages: [{
      id: "m1",
      role: "assistant",
      type: "text",
      text: "<script>alert(1)</script>",
    }],
  }));

  assert.doesNotMatch(markup, /<img onerror/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});

test("renderiza confirmação de presença com fornecedor e status colorido", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [
      {
        id: "presence-present",
        role: "assistant",
        type: "text",
        text: "ID 42: PRESENÇA DE DIBRITA APONTADA COMO PRESENTE.",
        presence_confirmation: { id: 42, supplier: "DIBRITA", presence: "PRESENTE" },
      },
      {
        id: "presence-absent",
        role: "assistant",
        type: "text",
        text: "ID 43: PRESENÇA DE OUTRO FORNECEDOR APONTADA COMO AUSENTE.",
        presence_confirmation: { id: 43, supplier: "OUTRO FORNECEDOR", presence: "AUSENTE" },
      },
    ],
  }));

  assert.match(markup, /ID 42: PRESENÇA DE DIBRITA APONTADA COMO/);
  assert.match(markup, /chat-presence-confirmation__status--present">PRESENTE</);
  assert.match(markup, /chat-presence-confirmation__status--absent">AUSENTE</);
  assert.doesNotMatch(markup, /PRESENÇA ALTERADA PARA/);
});

test("renderiza dados da presença em tabela compacta", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "presence-detail",
      role: "assistant",
      type: "poll",
      question: "👷 VALIDAR PRESENÇA\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
      detail_table: {
        title: "📋 DADOS DA PRESENÇA",
        kind: "presence",
        rows: [[
          { label: "DATA", value: "09/09/2026" },
          { label: "FILIAL", value: "004 - EDIFÍCIO XAVANTE" },
        ], [
          { label: "FORMA PGTO", value: "DIÁRIA" },
          { label: "IDCONTRATO", value: "-", muted: true },
        ]],
      },
      options: [
        { id: "present", label: "🟢 PRESENTE", reply: "present" },
        { id: "absent", label: "🔴 AUSENTE", reply: "absent" },
        { id: "edit", label: "⚪ EDITAR", reply: "edit" },
      ],
    }],
  }));

  assert.match(markup, /chat-presence-table/);
  assert.match(markup, /004 - EDIFÍCIO XAVANTE/);
  assert.match(markup, /chat-presence-table-cell is-muted/);
  assert.match(markup, /data-reply-id="present"/);
});

test("renderiza a conferência da auditoria de pagamento com IDs e totais", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "payment_audit", title: "AUDITORIA COMPROVANTE PGTO" },
    messages: [{
      id: "payment-audit",
      role: "assistant",
      type: "poll",
      question: "FORAM ENCONTRADOS PAGAMENTOS PENDENTES.",
      payment_audit_table: {
        title: "📊 COMPARAÇÃO DOS VALORES",
        headers: ["ID", "VALOR DIÁRIO", "VALOR DO LANÇAMENTO"],
        rows: [
          { id: "2062", dailyValue: "R$ 250,00", launchValue: "R$ 341,00" },
          { id: "2063", dailyValue: "R$ 125,00", launchValue: "R$ 125,00" },
        ],
        totals: { dailyValue: "R$ 375,00", launchValue: "R$ 466,00" },
      },
      options: [{ id: "confirm", label: "✅ SIM", reply: "confirm" }],
    }],
  }));

  assert.match(markup, /chat-payment-audit-table/);
  assert.match(markup, /VALOR DIÁRIO/);
  assert.match(markup, /VALOR DO LANÇAMENTO/);
  assert.match(markup, /2062/);
  assert.match(markup, /R\$ 375,00/);
  assert.match(markup, /R\$ 466,00/);
});

test("mantém o FINALIZAR fornecido pelo servidor antes dos produtos", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "product-selector",
      role: "assistant",
      type: "poll",
      question: "📦 QUAL PRODUTO FOI PAGO?",
      options: [
        { id: "document_line_finalize", reply: "document_line_finalize", label: "✅ FINALIZAR" },
        { id: "3", reply: "3", label: "3 - ARGAMASSA" },
        { id: "4", reply: "4", label: "4 - GESSO" },
      ],
    }],
  }));

  const firstChoice = markup.indexOf('data-reply-id="document_line_finalize"');
  const firstProduct = markup.indexOf('data-reply-id="3"');
  assert.ok(firstChoice >= 0);
  assert.ok(firstChoice < firstProduct);
  assert.match(markup, />✅ FINALIZAR</);
});

test("não inventa FINALIZAR na primeira lista de produtos nem na escolha da data do EPI", () => {
  const firstProductMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "first-product-selector",
      role: "assistant",
      type: "poll",
      question: "📦 QUAL PRODUTO FOI PAGO?",
      options: [{ id: "3", reply: "3", label: "3 - ARGAMASSA" }],
    }],
  }));
  assert.doesNotMatch(firstProductMarkup, /data-reply-id="document_line_finalize"/);

  const epiDateMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "epi-date-selector",
      role: "assistant",
      type: "poll",
      question: "📅 QUAL A DATA DE ENTREGA DO EPI? ESCOLHA HOJE, USE O CALENDÁRIO OU DIGITE UMA DATA.",
      options: [
        { id: "document_signing_epi_date_today", reply: "document_signing_epi_date_today", label: "📅 HOJE" },
        { id: "document_signing_epi_date_other", reply: "document_signing_epi_date_other", label: "✍️ DIGITAR DATA" },
      ],
    }],
  }));
  assert.doesNotMatch(epiDateMarkup, /data-reply-id="document_line_finalize"/);
});

test("exibe data e quantidade quando a data da última validação não tem pendências", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "presence_validation", title: "VALIDAR PRESENÇAS APONTADAS" },
    messages: [{
      id: "presence-no-match",
      role: "assistant",
      type: "poll",
      question: "OS SEGUINTES ITENS AINDA ESTÃO PENDENTES DE VALIDAÇÃO DE PRESENÇA.",
      presenceDateSummary: { date: "2026-09-12", count: 2 },
      options: [{ id: "presence_other_dates", reply: "presence_other_dates", label: "📅 VER OUTRAS DATAS" }],
    }],
  }));

  assert.match(markup, /chat-presence-date-summary/);
  assert.match(markup, /12\/09\/2026/);
  assert.match(markup, /2/);
  assert.match(markup, /VER OUTRAS DATAS/);
});

test("abre a lista de provisões vencidas com X e opções de lembrete", () => {
  const markup = renderChatMarkup(signedInState({
    pendingProvisions: {
      due: true,
      rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026", product: "Material", total: "R$ 120,00" }],
    },
  }));
  assert.match(markup, /data-action="close-pending-provisions"/);
  assert.match(markup, /Fornecedor A/);
  const reminder = renderChatMarkup(signedInState({
    pendingProvisions: { due: true, rows: [{ supplier: "Fornecedor A" }] },
    pendingProvisionReminderOpen: true,
  }));
  assert.match(reminder, /Deseja voltar a ser lembrado em quantas horas\?/);
  assert.match(reminder, /data-value="always"/);
  assert.match(reminder, /data-value="2h"/);
  assert.match(reminder, /data-value="today"/);
  assert.match(reminder, /data-role="pending-provisions-hours"/);
  const dom = new JSDOM(reminder);
  const command = commandFromTarget(dom.window.document.querySelector('[data-value="2h"]'));
  assert.equal(command.type, "pending-provisions-reminder-choice");
  assert.equal(command.value, "2h");
  dom.window.close();
});

test("mostra notas sem lançamento em popup e fecha pela ação do botão", () => {
  const markup = renderChatMarkup(signedInState({ pendingNotes: {
    count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }],
  } }));
  assert.match(markup, /data-pending-notes-dialog/);
  assert.match(markup, /13 - Terceiro/);
  assert.match(markup, /data-action="dismiss-pending-notes"/);

  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let closed = 0;
  view.on("dismiss-pending-notes", () => { closed++; });
  view.render(signedInState({ pendingNotes: {
    count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }],
  } }));
  root.querySelector('[data-action="dismiss-pending-notes"]').click();
  assert.equal(closed, 1);
  view.destroy();
  dom.window.close();
});

test("remove o popup das notas no mesmo render em que a dispensa limpa o estado", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const initial = signedInState({ pendingNotes: {
    count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }],
  } });
  view.on("dismiss-pending-notes", () => view.render({ ...initial, pendingNotes: null }));
  view.render(initial);
  root.querySelector('[data-action="dismiss-pending-notes"]').click();
  assert.equal(root.querySelector('[data-pending-notes-dialog]'), null);
  view.destroy();
  dom.window.close();
});

test("toque no X das notas fecha uma vez e consome o clique atrasado do iPhone", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const initial = signedInState({ pendingNotes: { rows: [{ id: "13", label: "13 - Terceiro" }] } });
  let closes = 0;
  view.on("dismiss-pending-notes", () => { closes++; view.render({ ...initial, pendingNotes: null }); });
  view.render(initial);
  const close = root.querySelector('[data-action="dismiss-pending-notes"]');
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { isPrimary: { value: true }, pointerType: { value: "touch" } });
    close.dispatchEvent(event);
  }
  close.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
  assert.equal(closes, 1);
  assert.equal(root.querySelector('[data-pending-notes-dialog]'), null);
  view.destroy();
  dom.window.close();
});

test("exibe um check de baixa antes da seta e associa a ação ao pagamento correto", () => {
  const markup = renderChatMarkup(signedInState({
    pendingProvisions: {
      due: true,
      rows: [{ id: "306", supplier: "DIBRITA", dueDate: "23/09/2026" }],
    },
    pendingProvisionAttachments: { 306: { status: "available", items: [] } },
  }));
  const dom = new JSDOM(markup);
  const check = dom.window.document.querySelector('[data-action="settle-pending-provision"]');
  const arrow = dom.window.document.querySelector('[data-action="toggle-pending-provision-attachments"]');

  assert.ok(check);
  assert.equal(check.dataset.paymentId, "306");
  assert.match(check.getAttribute("aria-label"), /DIBRITA/);
  assert.ok(check.compareDocumentPosition(arrow) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(commandFromTarget(check).type, "settle-pending-provision");
  assert.equal(commandFromTarget(check).paymentId, "306");
  dom.window.close();

  const busyDom = new JSDOM(renderChatMarkup(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306" }, { id: "307" }] },
    pendingProvisionSettlementPaymentId: "306",
  })));
  const checks = [...busyDom.window.document.querySelectorAll('[data-action="settle-pending-provision"]')];
  assert.equal(checks.length, 2);
  assert.ok(checks.every(button => button.disabled), "não deve permitir iniciar outro pagamento durante a baixa");
  busyDom.window.close();
});

test("oferece lápis de edição de vencimento antes do check da provisão", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA", dueDate: "2026-09-23T03:00:00Z" }] },
    pendingProvisionAttachments: { 306: { status: "empty", items: [] } },
  })));
  const root = dom.window.document;
  const edit = root.querySelector('[data-action="edit-pending-provision-due-date"]');
  const check = root.querySelector('[data-action="settle-pending-provision"]');

  assert.ok(edit);
  assert.equal(edit.dataset.paymentId, "306");
  assert.equal(edit.textContent, "✎");
  assert.match(edit.getAttribute("aria-label"), /DIBRITA/);
  assert.ok(edit.compareDocumentPosition(check) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("tela de vencimento preenche DD/MM/AAAA, mascara a digitação e envia o pagamento correto", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("save-pending-provision-due-date", command => commands.push(command));
  view.render(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA", dueDate: "2026-09-23T03:00:00Z" }] },
    pendingProvisionDateEditPaymentId: "306",
    pendingProvisionDateEditValue: "23/09/2026",
  }));

  const input = root.querySelector('[data-role="pending-provision-due-date"]');
  assert.equal(input.value, "23/09/2026");
  assert.equal(input.placeholder, "DD/MM/AAAA");
  input.value = "24102026";
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
  assert.equal(input.value, "24/10/2026");
  const save = root.querySelector('[data-action="save-pending-provision-due-date"]');
  save.click();
  assert.deepEqual(commands.map(({ paymentId, value }) => ({ paymentId, value })), [
    { paymentId: "306", value: "24/10/2026" },
  ]);
  view.destroy();
  dom.window.close();
});

test("lista expandida termina com Adicionar mais anexos e mostra fila para envio múltiplo", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("pick-pending-provision-attachments", command => commands.push(command));
  view.on("remove-pending-provision-upload", command => commands.push(command));
  view.on("send-pending-provision-attachments", command => commands.push(command));
  view.render(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA" }] },
    pendingProvisionAttachments: { 306: { status: "available", items: [{ fileName: "existente.pdf", mimeType: "application/pdf", size: 2048 }] } },
    pendingProvisionExpandedPaymentId: "306",
    pendingProvisionUploads: { 306: { items: [{ fileName: "novo.pdf", size: 8, status: "ready" }], busy: false } },
  }));

  const items = [...root.querySelectorAll(".chat-pending-provision__attachments > li")];
  const add = root.querySelector('[data-action="pick-pending-provision-attachments"]');
  assert.equal(items.at(-1).querySelector("[data-action]")?.dataset.action, "pick-pending-provision-attachments");
  assert.match(items.at(-1).textContent, /Adicionar mais anexos/i);
  assert.match(root.textContent, /novo\.pdf/);
  assert.ok(root.querySelector('[data-action="send-pending-provision-attachments"]'));
  add.click();
  root.querySelector('[data-action="remove-pending-provision-upload"]').click();
  root.querySelector('[data-action="send-pending-provision-attachments"]').click();
  assert.deepEqual(commands.map(command => command.type), [
    "pick-pending-provision-attachments", "remove-pending-provision-upload", "send-pending-provision-attachments",
  ]);
  assert.ok(commands.every(command => command.paymentId === "306"));
  assert.equal(commands[1].uploadId, "novo.pdf");
  view.destroy();
  dom.window.close();
});

test("fila sem arquivos enviáveis explica conflitos e não habilita o envio", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA" }] },
    pendingProvisionAttachments: { 306: { status: "available", items: [{ fileName: "existente.pdf", size: 10 }] } },
    pendingProvisionExpandedPaymentId: "306",
    pendingProvisionUploads: {
      306: {
        items: [{ fileName: "existente.pdf", size: 10, status: "conflict" }],
        busy: false,
        error: "Um arquivo com esse nome já existe.",
      },
    },
  }));

  const send = root.querySelector('[data-action="send-pending-provision-attachments"]');
  assert.equal(send.disabled, true);
  assert.match(root.textContent, /Nome repetido/);
  assert.match(root.textContent, /já existe/i);
  view.destroy();
  dom.window.close();
});

test("atualiza o estado desabilitado dos checks sem exigir uma mudança na conversa", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA" }] },
  });
  view.render(state);
  assert.equal(root.querySelector('[data-action="settle-pending-provision"]').disabled, false);

  view.render({ ...state, pendingProvisionSettlementPaymentId: "306" });

  assert.equal(root.querySelector('[data-action="settle-pending-provision"]').disabled, true);
  view.destroy();
  dom.window.close();
});

test("o X das provisões abre a escolha de lembrete no início do toque do iPhone", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let closeRequests = 0;
  const reminderState = signedInState({
    pendingProvisions: { due: true, rows: [{ supplier: "Fornecedor A" }] },
    pendingProvisionReminderOpen: true,
  });
  view.on("close-pending-provisions", () => {
    closeRequests += 1;
    view.render(reminderState);
  });
  view.render(signedInState({
    pendingProvisions: {
      due: true,
      rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
    },
  }));

  const close = root.querySelector('[data-action="close-pending-provisions"]');
  const touchStart = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(touchStart, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(touchStart);

  const touchEnd = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperties(touchEnd, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(touchEnd);

  assert.equal(closeRequests, 1);
  assert.ok(root.querySelector('[data-action="pending-provisions-reminder-choice"][data-value="2h"]'));
  dom.window.close();
});

test("ações dos botões só respondem ao toque sem arraste e não duplicam no click tardio", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("select-reply", command => commands.push(command));
  view.render(signedInState({
    messages: [{
      id: "first-touch-choice",
      role: "assistant",
      type: "poll",
      question: "ESCOLHA UMA OPÇÃO",
      options: [{ id: "yes", reply: "yes", label: "SIM" }],
    }],
  }));

  const button = root.querySelector('[data-action="select-reply"]');
  const touchStart = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(touchStart, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  button.dispatchEvent(touchStart);

  assert.deepEqual(commands, []);

  const touchEnd = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperties(touchEnd, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  button.dispatchEvent(touchEnd);
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(commands.length, 1, "o click sintético posterior não pode enviar a mesma ação novamente");
  dom.window.close();
});

test("rolar a lista sobre um botão não seleciona a opção tocada", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("select-reply", command => commands.push(command));
  view.render(signedInState({
    messages: [{
      id: "scroll-over-choice",
      role: "assistant",
      type: "poll",
      question: "ESCOLHA UMA OPÇÃO",
      options: [{ id: "yes", reply: "yes", label: "SIM" }],
    }],
  }));

  const pointer = (type, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 80,
      clientY,
      pointerId: 12,
      pointerType: "touch",
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  const button = root.querySelector('[data-action="select-reply"]');
  button.dispatchEvent(pointer("pointerdown", 40));
  root.dispatchEvent(pointer("pointermove", 160));
  root.dispatchEvent(pointer("pointerup", 160));
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.deepEqual(commands, []);

  const touchEvent = (type, clientY, target = root) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", {
      value: type === "touchend" ? [] : [{ identifier: 2, clientX: 80, clientY }],
      configurable: true,
    });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 2, clientX: 80, clientY }],
      configurable: true,
    });
    target.dispatchEvent(event);
  };
  touchEvent("touchstart", 40, button);
  touchEvent("touchmove", 160);
  touchEvent("touchend", 160);
  assert.deepEqual(commands, [], "a sequência touch também deve cancelar a seleção durante a rolagem");

  view.destroy();
  dom.window.close();
});

test("toque usa a coordenada visual atual e não o alvo antigo informado pela WebView", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("select-reply", command => commands.push(command));
  view.render(signedInState({
    messages: [{
      id: "stale-touch-target",
      role: "assistant",
      type: "poll",
      question: "PODE SUBMETER ESTA PROVISÃO?",
      options: [
        { id: "yes", reply: "yes", label: "SIM" },
        { id: "edit", reply: "edit", label: "EDITAR" },
      ],
    }],
  }));

  const yes = root.querySelector('[data-reply-id="yes"]');
  const edit = root.querySelector('[data-reply-id="edit"]');
  const emptyArea = root.querySelector(".chat-message");
  yes.getBoundingClientRect = () => ({ left: 20, right: 320, top: 100, bottom: 160, width: 300, height: 60 });
  edit.getBoundingClientRect = () => ({ left: 20, right: 320, top: 170, bottom: 230, width: 300, height: 60 });
  dom.window.document.elementFromPoint = (_x, y) => y >= 100 && y <= 160 ? edit : emptyArea;

  const stalePointerDown = y => {
    const event = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 100,
      clientY: y,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    edit.dispatchEvent(event);
  };

  stalePointerDown(130);
  const stalePointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ clientX: 100, clientY: 130, pointerId: 7, pointerType: "touch", isPrimary: true })) {
    Object.defineProperty(stalePointerUp, key, { value, configurable: true });
  }
  edit.dispatchEvent(stalePointerUp);
  assert.deepEqual(
    commands.map(command => command.replyId),
    ["yes"],
    "a opção sob a coordenada visível deve prevalecer sobre a região antiga da WebView",
  );

  stalePointerDown(40);
  edit.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 40,
    detail: 1,
  }));
  assert.deepEqual(
    commands.map(command => command.replyId),
    ["yes"],
    "uma área visualmente vazia nunca pode reutilizar o alvo antigo de um botão",
  );

  view.destroy();
  dom.window.close();
});

test("área vazia de um modal não aciona botão coberto pelo popup", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("select-reply", command => commands.push(command));
  view.render(signedInState({
    messages: [{
      id: "covered-choice",
      role: "assistant",
      type: "poll",
      question: "ESCOLHA",
      options: [{ id: "covered", reply: "covered", label: "BOTÃO COBERTO" }],
    }],
  }));

  const covered = root.querySelector('[data-reply-id="covered"]');
  covered.getBoundingClientRect = () => ({ left: 20, right: 320, top: 100, bottom: 160, width: 300, height: 60 });
  const backdrop = dom.window.document.createElement("div");
  backdrop.dataset.popupBackdrop = "true";
  const dialog = dom.window.document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.getBoundingClientRect = () => ({ left: 40, right: 300, top: 80, bottom: 220, width: 260, height: 140 });
  backdrop.append(dialog);
  root.append(backdrop);
  dom.window.document.elementFromPoint = () => covered;

  const stalePointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 100,
    clientY: 130,
    pointerId: 8,
    pointerType: "touch",
    isPrimary: true,
  })) Object.defineProperty(stalePointerDown, key, { value, configurable: true });
  covered.dispatchEvent(stalePointerDown);

  assert.deepEqual(commands, [], "o conteúdo visível do modal deve bloquear controles que estão atrás dele");
  view.destroy();
  dom.window.close();
});

test("alvo antigo do backdrop não fecha o modal quando a coordenada está dentro do diálogo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let closes = 0;
  view.on("test-popup-close", () => { closes += 1; });
  view.render(signedInState());

  const backdrop = dom.window.document.createElement("div");
  backdrop.dataset.popupBackdrop = "true";
  backdrop.dataset.popupCloseAction = "test-popup-close";
  const dialog = dom.window.document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.getBoundingClientRect = () => ({ left: 40, right: 300, top: 80, bottom: 220, width: 260, height: 140 });
  backdrop.append(dialog);
  root.append(backdrop);
  dom.window.document.elementFromPoint = () => backdrop;

  backdrop.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 130,
    detail: 1,
  }));

  assert.equal(closes, 0, "o hit-test antigo do backdrop não pode atravessar a área atual do diálogo");
  view.destroy();
  dom.window.close();
});

test("modal com maior z-index recebe o toque mesmo quando outro aparece depois no DOM", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let upperActions = 0;
  view.on("test-upper-action", () => { upperActions += 1; });
  view.render(signedInState());

  const upperBackdrop = dom.window.document.createElement("div");
  upperBackdrop.style.zIndex = "30";
  const upperDialog = dom.window.document.createElement("div");
  upperDialog.setAttribute("role", "dialog");
  upperDialog.setAttribute("aria-modal", "true");
  const upperButton = dom.window.document.createElement("button");
  upperButton.dataset.action = "test-upper-action";
  upperButton.getBoundingClientRect = () => ({ left: 20, right: 320, top: 100, bottom: 160, width: 300, height: 60 });
  upperDialog.append(upperButton);
  upperBackdrop.append(upperDialog);
  root.append(upperBackdrop);

  const lowerBackdrop = dom.window.document.createElement("div");
  lowerBackdrop.style.zIndex = "20";
  const lowerDialog = dom.window.document.createElement("div");
  lowerDialog.setAttribute("role", "dialog");
  lowerDialog.setAttribute("aria-modal", "true");
  lowerBackdrop.append(lowerDialog);
  root.append(lowerBackdrop);
  dom.window.document.elementFromPoint = () => upperButton;

  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 100,
    clientY: 130,
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  upperButton.dispatchEvent(pointerDown);

  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 100,
    clientY: 130,
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
  })) Object.defineProperty(pointerUp, key, { value, configurable: true });
  upperButton.dispatchEvent(pointerUp);

  assert.equal(upperActions, 1, "a ordem DOM não pode bloquear o modal visualmente superior");
  view.destroy();
  dom.window.close();
});

test("click sintético do iPhone não aciona o botão novo renderizado sob o dedo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  const stateWithChoice = (id, label) => signedInState({
    messages: [{
      id: `choice-${id}`,
      role: "assistant",
      type: "poll",
      question: "ESCOLHA UMA OPÇÃO",
      options: [{ id, reply: id, label }],
    }],
  });
  view.on("select-reply", command => {
    commands.push(command);
    if (command.replyId === "first") view.render(stateWithChoice("second", "SEGUNDO"));
  });
  view.render(stateWithChoice("first", "PRIMEIRO"));

  const first = root.querySelector('[data-reply-id="first"]');
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerDown, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
    pointerId: { value: 7 },
  });
  first.dispatchEvent(pointerDown);
  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerUp, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
    pointerId: { value: 7 },
  });
  first.dispatchEvent(pointerUp);
  assert.deepEqual(commands.map(command => command.replyId), ["first"]);

  const replacement = root.querySelector('[data-reply-id="second"]');
  replacement.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.deepEqual(
    commands.map(command => command.replyId),
    ["first"],
    "o click final do mesmo toque deve ser consumido mesmo após a tela mudar",
  );
  view.destroy();
  dom.window.close();
});

test("anexo e resumo só abrem depois que o dedo é retirado", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("open-file", command => commands.push(command));
  view.on("show-summary", command => commands.push(command));
  view.render(signedInState({
    activeFlow: { id: "expenses", title: "GASTOS PESSOAIS" },
    attachments: [{ id: "receipt", fileName: "recibo.pdf", mimeType: "application/pdf", size: 2300 }],
  }));

  const pointer = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 40,
      clientY: 100,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  const attachment = root.querySelector('[data-action="open-file"]');
  attachment.dispatchEvent(pointer("pointerdown"));
  assert.equal(commands.length, 0, "encostar no anexo não pode abri-lo");
  attachment.dispatchEvent(pointer("pointerup"));
  attachment.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(commands, [{ type: "open-file", fileId: "receipt" }]);

  commands.length = 0;
  const summary = root.querySelector('[data-action="show-summary"]');
  summary.dispatchEvent(pointer("pointerdown", { pointerId: 8 }));
  assert.equal(commands.length, 0, "encostar no resumo não pode abri-lo");
  summary.dispatchEvent(pointer("pointerup", { pointerId: 8 }));
  summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(commands, [{ type: "show-summary" }]);

  view.destroy();
  dom.window.close();
});

test("arrastar sobre anexo ou prévia de resumo cancela a abertura", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("open-file", command => commands.push(command));
  view.on("open-media", command => commands.push(command));
  view.render(signedInState({
    attachments: [{ id: "receipt", fileName: "recibo.pdf", mimeType: "application/pdf", size: 2300 }],
    messages: [{
      id: "summary-image",
      role: "assistant",
      type: "image",
      fileName: "resumo.png",
      mediaUrl: "/api/portal-media/summary",
    }],
  }));

  const pointer = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 40,
      clientY: 100,
      pointerId: 9,
      pointerType: "touch",
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  for (const target of [
    root.querySelector('[data-action="open-file"]'),
    root.querySelector('[data-action="open-media"]'),
  ]) {
    target.dispatchEvent(pointer("pointerdown"));
    target.dispatchEvent(pointer("pointermove", { clientY: 128 }));
    target.dispatchEvent(pointer("pointerup", { clientY: 128 }));
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  const cancelledAttachment = root.querySelector('[data-action="open-file"]');
  cancelledAttachment.dispatchEvent(pointer("pointerdown", { pointerId: 10 }));
  cancelledAttachment.dispatchEvent(pointer("pointercancel", { pointerId: 10 }));
  cancelledAttachment.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.deepEqual(commands, [], "a rolagem ou o cancelamento do toque não pode abrir o item tocado");

  cancelledAttachment.dispatchEvent(pointer("pointerdown", { pointerId: 11 }));
  cancelledAttachment.dispatchEvent(pointer("pointerup", { pointerId: 11 }));
  cancelledAttachment.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(commands, [{ type: "open-file", fileId: "receipt" }],
    "um novo toque intencional deve funcionar logo depois da rolagem");
  view.destroy();
  dom.window.close();
});

test("arrastar de um anexo até outro consome o clique sintético no segundo arquivo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("open-file", command => commands.push(command));
  view.render(signedInState({
    attachments: [
      { id: "first", fileName: "primeiro.pdf", mimeType: "application/pdf", size: 2300 },
      { id: "second", fileName: "segundo.pdf", mimeType: "application/pdf", size: 2400 },
    ],
  }));

  const first = root.querySelector('[data-file-id="first"]');
  const second = root.querySelector('[data-file-id="second"]');
  first.getBoundingClientRect = () => ({ left: 20, right: 320, top: 80, bottom: 140, width: 300, height: 60 });
  second.getBoundingClientRect = () => ({ left: 20, right: 320, top: 180, bottom: 240, width: 300, height: 60 });
  dom.window.document.elementFromPoint = (_x, y) => y >= 180 ? second : first;
  const pointer = (type, y, buttons = 1) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 100,
      clientY: y,
      pointerId: 9,
      pointerType: "touch",
      buttons,
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  first.dispatchEvent(pointer("pointerdown", 110));
  first.dispatchEvent(pointer("pointermove", 210));
  first.dispatchEvent(pointer("pointerup", 210, 0));
  second.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 210,
    detail: 1,
  }));

  assert.deepEqual(commands, [], "terminar o arraste sobre outro anexo não pode abri-lo");

  second.dispatchEvent(pointer("pointerdown", 210));
  second.dispatchEvent(pointer("pointerup", 210, 0));
  second.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 210,
    detail: 1,
  }));
  assert.deepEqual(
    commands,
    [{ type: "open-file", fileId: "second" }],
    "um novo pointerdown deve liberar a supressão e aceitar o toque deliberado seguinte",
  );
  view.destroy();
  dom.window.close();
});

test("reduz a tipografia da lista de presenças pendentes e acomoda nomes longos", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-attendance-records",
      role: "assistant",
      type: "poll",
      presentation: "accordion",
      question: "PRESENÇAS PENDENTES",
      options: [{ id: "1985", label: "1985 - JOSÉ GERALDO DOS SANTOS", reply: "1985" }],
    }],
  }));

  assert.match(markup, /chat-choice-card--pending-attendance/);
  assert.match(markup, /1985 - JOSÉ GERALDO DOS SANTOS/);
});

test("lista de presenças mostra caixas vazias à esquerda e prosseguir após os IDs", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "attendance-options",
      role: "assistant",
      type: "poll",
      presentation: "attendance_multi_select",
      question: "QUAL PRESENÇA DESEJA VALIDAR?",
      options: [
        { id: "choice:registro_presenca_pendente:2109", reply: "choice:registro_presenca_pendente:2109", label: "2109 - LUIZ" },
        { id: "choice:registro_presenca_pendente:2108", reply: "choice:registro_presenca_pendente:2108", label: "2108 - CLEITON" },
      ],
    }],
  }));
  assert.equal((markup.match(/type="checkbox"/g) || []).length, 2);
  assert.match(markup, /data-action="attendance-select-toggle"[^>]*data-reply-id="2109"/);
  assert.ok(markup.indexOf('data-reply-id="2109"') < markup.indexOf('2109 - LUIZ'));
  assert.ok(markup.indexOf('2108 - CLEITON') < markup.indexOf('data-action="attendance-select-proceed"'));
  assert.match(markup, /data-action="attendance-select-proceed"[^>]*disabled/);
});

test("permite marcar e desmarcar vários IDs antes de prosseguir uma única vez", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "attendance-options",
    role: "assistant",
    type: "poll",
    presentation: "attendance_multi_select",
    question: "QUAL PRESENÇA DESEJA VALIDAR?",
    options: [
      { id: "choice:registro_presenca_pendente:2109", reply: "choice:registro_presenca_pendente:2109", label: "2109 - LUIZ" },
      { id: "choice:registro_presenca_pendente:2108", reply: "choice:registro_presenca_pendente:2108", label: "2108 - CLEITON" },
    ],
  }] }));
  root.querySelector('[data-reply-id="2109"]').click();
  root.querySelector('[data-reply-id="2108"]').click();
  assert.equal(root.querySelectorAll('input[type="checkbox"]:checked').length, 2);
  root.querySelector('[data-reply-id="2109"]').click();
  assert.equal(root.querySelectorAll('input[type="checkbox"]:checked').length, 1);
  root.querySelector('[data-action="attendance-select-proceed"]').click();
  assert.deepEqual(replies, ["attendance_batch:2108"]);
  view.destroy();
  dom.window.close();
});

test("tocar no nome do último fornecedor seleciona Rafael mesmo quando o clique da caixa mantém a coordenada do rótulo", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "attendance-options",
    role: "assistant",
    type: "poll",
    presentation: "attendance_multi_select",
    question: "QUAL PRESENÇA DESEJA VALIDAR?",
    options: [
      { id: "choice:registro_presenca_pendente:2101", reply: "choice:registro_presenca_pendente:2101", label: "2101 - ISRAEL ESCORAMENTO" },
      { id: "choice:registro_presenca_pendente:2100", reply: "choice:registro_presenca_pendente:2100", label: "2100 - RAFAEL GONTIJO" },
    ],
  }] }));

  const rafael = root.querySelector('[data-reply-id="2100"]');
  const labelText = rafael.nextElementSibling;
  dom.window.document.elementFromPoint = () => labelText;
  labelText.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true, cancelable: true, detail: 1, clientX: 200, clientY: 950,
  }));

  assert.equal(root.querySelector('[data-reply-id="2100"]').checked, true);
  root.querySelector('[data-action="attendance-select-proceed"]').click();
  assert.deepEqual(replies, ["attendance_batch:2100"]);
  view.destroy();
  dom.window.close();
});

test("resumo em lote colore presença presente e ausente por fornecedor", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "attendance-summary",
    role: "assistant",
    type: "poll",
    question: "CONFIRMA A ATUALIZAÇÃO DESTAS PRESENÇAS?",
    detail_table: {
      kind: "presence",
      rows: [[
        { label: "FORNECEDOR", value: "LUIZ" },
        { label: "IDDESCRITIVO", value: "119 - ALVENARIA" },
        { label: "ATIVIDADEEXECUTADA", value: "ALVENARIA" },
        { label: "PRESENÇA", value: "AUSENTE", tone: "absent" },
      ]],
    },
    options: [{ id: "attendance_batch_confirm", reply: "attendance_batch_confirm", label: "✅ SUBMETER TODOS" }],
  }] }));
  assert.match(markup, /chat-presence-table-cell--absent/);
  assert.match(markup, /119 - ALVENARIA/);
  assert.match(markup, /LUIZ/);
});

test("resumo em lote mostra somente a pergunta antes da tabela", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "attendance-summary-question",
    role: "assistant",
    type: "poll",
    question: "CONFIRMA A ATUALIZAÇÃO DESTAS PRESENÇAS?\nLUIZ | 126 - ALVENARIA | ALVENARIA | PRESENTE\nANA | 127 - PINTURA | PINTURA | AUSENTE",
    detail_table: {
      kind: "presence",
      rows: [[
        { label: "FORNECEDOR", value: "LUIZ" },
        { label: "IDDESCRITIVO", value: "126 - ALVENARIA" },
        { label: "ATIVIDADEEXECUTADA", value: "ALVENARIA" },
        { label: "PRESENÇA", value: "PRESENTE", tone: "present" },
      ], [
        { label: "FORNECEDOR", value: "ANA" },
        { label: "IDDESCRITIVO", value: "127 - PINTURA" },
        { label: "ATIVIDADEEXECUTADA", value: "PINTURA" },
        { label: "PRESENÇA", value: "AUSENTE", tone: "absent" },
      ]],
    },
    options: [{ id: "attendance_batch_confirm", reply: "attendance_batch_confirm", label: "✅ SUBMETER TODOS" }],
  }] }));
  const dom = new JSDOM(markup);
  assert.equal(dom.window.document.querySelector(".chat-choice-card > p")?.textContent?.trim(), "✅ CONFIRMA A ATUALIZAÇÃO DESTAS PRESENÇAS?");
  assert.equal(dom.window.document.querySelectorAll(".chat-presence-table-row").length, 2);
  assert.match(markup, /126 - ALVENARIA/);
  assert.match(markup, /127 - PINTURA/);
  dom.window.close();
});

test("resumo de presenças múltiplas empilha campos sem comprimir textos no celular", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.chat-presence-table--batch \.chat-presence-table-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.chat-presence-table--batch \.chat-presence-table-cell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.chat-presence-table--batch \.chat-presence-table-cell \+ \.chat-presence-table-cell\s*\{[^}]*border-left:\s*0/);
  assert.match(css, /\.chat-bubble:has\(\.chat-presence-table--batch\)\s*\{[^}]*flex:\s*1 1 0/);
});

test("mantém ver outras datas visível durante o filtro das presenças", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "pessoa",
    messages: [{
      id: "pending-attendance-filter",
      role: "assistant",
      type: "poll",
      presentation: "accordion",
      databaseFilter: true,
      databaseFilterKey: "presence",
      question: "PRESENÇAS PENDENTES",
      options: [
        { id: "1985", label: "1985 - PESSOA DOZE (12/09/2026)", reply: "1985" },
        { id: "presence_other_dates", label: "📅 VER OUTRAS DATAS", reply: "presence_other_dates" },
      ],
    }],
  }));

  assert.match(markup, /📅 VER OUTRAS DATAS/);
});

test("não mostra tabela de fornecedor vazia no menu principal", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      change_table: { title: "⚠️ ALTERAÇÕES NO CADASTRO DO FORNECEDOR", rows: [] },
      options: [{ id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" }],
    }],
  }));

  assert.doesNotMatch(markup, /chat-change-table/);
  assert.doesNotMatch(markup, /Nenhuma alteração identificada/);
});

test("menu principal não exibe APPS nem o acesso direto à galeria", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu-apps",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [
        { id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" },
        { id: "action_launch_gallery", label: "GALERIA LANÇAMENTOS", reply: "action_launch_gallery" },
      ],
    }],
  }));

  assert.doesNotMatch(markup, /data-reply-id="action_apps"/);
  assert.doesNotMatch(markup, /data-reply-id="action_launch_gallery"/);
  assert.doesNotMatch(markup, /📱 APPS/);
});

test("menu inicial põe COMEÇAR DIÁRIO DE OBRAS por último e em vermelho", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu-diary-start",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [
        { id: "start_pending_construction_diary", reply: "start_pending_construction_diary", label: "📔 COMEÇAR DIÁRIO DE OBRAS (24/09/2026)" },
        { id: "group_supplies", reply: "group_supplies", label: "📦 SUPRIMENTOS" },
        { id: "append_today_construction_diary_photos", reply: "append_today_construction_diary_photos", label: "📷 ADICIONAR MAIS IMAGENS AO DIÁRIO DE OBRAS (24/09/2026)" },
        { id: "group_demands", reply: "group_demands", label: "📋 DEMANDAS" },
      ],
    }],
  }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list > .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), [
    "group_supplies",
    "group_demands",
    "append_today_construction_diary_photos",
    "start_pending_construction_diary",
  ]);
  assert.equal(buttons.at(-1).classList.contains("chat-choice-button--danger"), true);
  assert.equal(buttons.at(-1).dataset.label, "📔 COMEÇAR DIÁRIO DE OBRAS (24/09/2026)");
  dom.window.close();
});

test("menu inicial mantém apenas adicionar fotos no último botão azul", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu-diary-photos",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [
        { id: "append_today_construction_diary_photos", reply: "append_today_construction_diary_photos", label: "📷 ADICIONAR MAIS IMAGENS AO DIÁRIO DE OBRAS (24/09/2026)", tone: "danger" },
        { id: "group_supplies", reply: "group_supplies", label: "📦 SUPRIMENTOS" },
      ],
    }],
  }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list > .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), [
    "group_supplies",
    "append_today_construction_diary_photos",
  ]);
  assert.equal(buttons.at(-1).classList.contains("chat-choice-button--danger"), false);
  assert.equal(dom.window.document.querySelector('[data-reply-id="start_pending_construction_diary"]'), null);
  dom.window.close();
});

test("menu com anexos põe COMEÇAR DIÁRIO latente depois de fotos e em vermelho", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "main-menu-with-attachments",
    role: "assistant",
    type: "poll",
    question: "1 ANEXO(S) RECEBIDO(S), DESEJA UTILIZAR ELES EM QUAL FLUXO?",
    options: [
      { id: "resume_latent_construction_diary", reply: "resume_latent_construction_diary", label: "▶️ COMEÇAR DIÁRIO DE OBRAS (24/09/2026)" },
      { id: "group_supplies", reply: "group_supplies", label: "📦 SUPRIMENTOS" },
      { id: "append_today_construction_diary_photos", reply: "append_today_construction_diary_photos", label: "📷 ADICIONAR MAIS IMAGENS AO DIÁRIO DE OBRAS" },
      { id: "group_demands", reply: "group_demands", label: "📋 DEMANDAS" },
    ],
  }] }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list > .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), [
    "group_supplies", "group_demands", "append_today_construction_diary_photos", "resume_latent_construction_diary",
  ]);
  assert.equal(buttons.at(-1).classList.contains("chat-choice-button--danger"), true);
  dom.window.close();
});

test("CONTINUAR DIÁRIO latente fica no fim sem destaque vermelho", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "main-menu-continue-diary",
    role: "assistant",
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      { id: "resume_latent_construction_diary", reply: "resume_latent_construction_diary", label: "▶️ CONTINUAR DIÁRIO DE OBRAS", tone: "danger" },
      { id: "group_supplies", reply: "group_supplies", label: "📦 SUPRIMENTOS" },
    ],
  }] }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list > .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), ["group_supplies", "resume_latent_construction_diary"]);
  assert.equal(buttons.at(-1).classList.contains("chat-choice-button--danger"), false);
  dom.window.close();
});

test("visita em obra aparece apenas no submenu Lançamentos, abaixo do anexo a pedido", () => {
  const suppliesMarkup = renderChatMarkup(signedInState({
    messages: [{
      id: "supplies-launch-menu",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" },
        { id: "action_construction_visit", label: "🏗️ APONTAR VISITA EM OBRA", reply: "action_construction_visit" },
        { id: "payment", label: "💳 PROVISÃO DE PAGAMENTO E DESPESAS RECORRENTES", reply: "payment" },
        { id: "registrations", label: "🗂️ EFETUAR CADASTROS", reply: "registrations" },
      ],
    }],
  }));

  assert.match(suppliesMarkup, /chat-message chat-message--assistant chat-message--launch-menu/);
  assert.match(suppliesMarkup, /class="chat-choice-columns chat-choice-columns--launch-menu"/);
  const suppliesDom = new JSDOM(suppliesMarkup);
  assert.equal(suppliesDom.window.document.querySelector('[data-reply-id="action_construction_visit"]'), null);
  assert.match(suppliesMarkup, /class="chat-choice-columns__secondary"[\s\S]*data-reply-id="action_orders_gallery"[^>]*>GALERIA PEDIDOS[\s\S]*data-reply-id="action_launch_gallery"[^>]*>GAL\. LANÇAMENTOS[\s\S]*data-reply-id="action_payment_programming_gallery"[^>]*>GAL\. PGTOS PREVISTOS[\s\S]*data-reply-id="action_recurring_expenses_gallery"[^>]*>GAL\. DESPESAS RECORRENTES/);
  assert.match(suppliesMarkup, /class="chat-choice-columns__primary"[\s\S]*data-reply-id="new_document"[\s\S]*class="chat-choice-columns__secondary"/);
  assert.equal((suppliesMarkup.match(/data-gallery-button/g) || []).length, 4);
  assert.doesNotMatch(suppliesMarkup, /data-reply-id="action_orders_gallery"[\s\S]*data-reply-id="new_document"/);
  assert.doesNotMatch(suppliesMarkup, /<article class="chat-message chat-message--assistant chat-message--launch-menu"><span class="chat-avatar/);
  assert.doesNotMatch(suppliesMarkup, /📱 APPS/);
  suppliesDom.window.close();

  const launchesMarkup = renderChatMarkup(signedInState({
    messages: [{
      id: "supply-launches-submenu",
      role: "assistant",
      type: "poll",
      question: "🧾 EFETUAR LANÇAMENTO\nQUAL OPERAÇÃO DE LANÇAMENTO VOCÊ DESEJA EFETUAR?",
      options: [
        { id: "action_launch", label: "🧾 EFETUAR LANÇAMENTO", reply: "action_launch" },
        { id: "action_pending_order_registration", label: "🛒 EFETUAR CADASTRO DE PEDIDO (NOTAS PENDENTES)", reply: "action_pending_order_registration" },
        { id: "action_pending_order_attachment", label: "📎 ADICIONAR UM ANEXO A UM PEDIDO", reply: "action_pending_order_attachment" },
        { id: "action_construction_visit", label: "🏗️ APONTAR VISITA EM OBRA", reply: "action_construction_visit" },
      ],
    }],
  }));
  const launchesDom = new JSDOM(launchesMarkup);
  assert.deepEqual(
    [...launchesDom.window.document.querySelectorAll(".chat-choice-list [data-reply-id]")].map(button => button.dataset.replyId),
    ["action_launch", "action_pending_order_registration", "action_pending_order_attachment", "action_construction_visit"],
  );
  launchesDom.window.close();
});

test("menu de Suprimentos não restaura visita em obra antiga quando o rótulo mudou", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "supplies-legacy-visit",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "action_supply_launches", label: "🧾 LANÇAMENTOS", reply: "action_supply_launches" },
        { id: "action_construction_visit", label: "🏗️ VISITA EM OBRA", reply: "action_construction_visit" },
      ],
    }],
  }));
  const dom = new JSDOM(markup);
  assert.equal(dom.window.document.querySelector('[data-reply-id="action_construction_visit"]'), null);
  dom.window.close();
});

test("Efetuar Cadastros alinha as quatro galerias aos cadastros e remove o mascote", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "supply-registrations", role: "assistant", type: "poll",
      question: "📦 SUPRIMENTOS\nEFETUAR CADASTROS\nQUAL CADASTRO VOCÊ DESEJA EFETUAR?",
      options: [
        { id: "register_group", label: "📁 CADASTRAR GRUPO", reply: "register_group" },
        { id: "register_family", label: "📁 CADASTRAR FAMÍLIA", reply: "register_family" },
        { id: "register_subfamily", label: "📁 CADASTRAR SUBFAMÍLIA", reply: "register_subfamily" },
        { id: "register_product", label: "📦 CADASTRAR PRODUTO", reply: "register_product" },
        { id: "register_supplier", label: "CADASTRAR FORNECEDOR", reply: "register_supplier" },
      ],
    }],
  }));
  const doc = new JSDOM(markup).window.document;
  const columns = doc.querySelector(".chat-choice-columns--registration-menu");
  assert.ok(columns);
  assert.equal(doc.querySelector(".chat-message--registration-menu .chat-avatar"), null);
  assert.deepEqual([...columns.querySelectorAll(".chat-choice-columns__primary [data-reply-id]")].map(button => button.dataset.replyId),
    ["register_group", "register_family", "register_subfamily", "register_product", "register_supplier"]);
  assert.deepEqual([...columns.querySelectorAll(".chat-choice-columns__secondary [data-reply-id]")].map(button => [button.dataset.replyId, button.textContent]), [
    ["action_group_gallery", "GALERIA GRUPO"],
    ["action_family_gallery", "GALERIA FAMÍLIA"],
    ["action_subfamily_gallery", "GALERIA SUBFAMÍLIA"],
    ["action_product_gallery", "GALERIA PRODUTO"],
  ]);
});

test("botão Lançamentos ocupa a altura das duas galerias iguais no menu de Suprimentos", () => {
  const suppliesMarkup = renderChatMarkup(signedInState({
    messages: [{
      id: "supplies-launch-menu-height",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" },
        { id: "action_construction_visit", label: "🏗️ APONTAR VISITA EM OBRA", reply: "action_construction_visit" },
        { id: "payment", label: "💳 PROVISÃO DE PAGAMENTO", reply: "payment" },
      ],
    }],
  }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  const dom = new JSDOM(suppliesMarkup);
  const primary = dom.window.document.querySelector(".chat-choice-columns__primary");
  const secondary = dom.window.document.querySelector(".chat-choice-columns__secondary");
  assert.equal(primary.querySelector(".chat-choice-list").firstElementChild.dataset.replyId, "new_document");
  assert.deepEqual([...primary.querySelectorAll("[data-reply-id]")].map(button => button.dataset.replyId), ["new_document", "payment"]);
  assert.deepEqual([...secondary.querySelectorAll("[data-reply-id]")].map(button => button.textContent), ["GALERIA PEDIDOS", "GAL. LANÇAMENTOS", "GAL. PGTOS PREVISTOS", "GAL. DESPESAS RECORRENTES"]);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-gallery-actions\s*\{[^}]*grid-template-rows:\s*repeat\(4,\s*var\(--launch-gallery-button-height\)\)/s);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-choice-button--launch-menu-primary\s*\{[^}]*min-height:\s*calc\(2\s*\*\s*var\(--launch-gallery-button-height\)\s*\+\s*var\(--launch-gallery-gap\)\)/s);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-choice-button--gallery\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-choice-button--gallery\s*\{[^}]*min-width:\s*0/s);
  assert.match(styles, /@media \(max-width: 320px\)\s*\{[^}]*\.chat-choice-columns--launch-menu\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.85fr\) minmax\(0,\s*1\.15fr\)/s);
  dom.window.close();
});

test("Galeria Pgtos Previstos fica abaixo de Gal. Lançamentos e à direita da Provisão", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "supplies-payment-gallery-menu",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" },
        { id: "payment", label: "💳 PROVISÃO DE PAGAMENTO E DESPESAS RECORRENTES", reply: "payment" },
        { id: "registrations", label: "🗂️ EFETUAR CADASTROS", reply: "registrations" },
      ],
    }],
  }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(markup);
  const primary = dom.window.document.querySelector(".chat-choice-columns__primary");
  const secondary = dom.window.document.querySelector(".chat-choice-columns__secondary");

  assert.deepEqual([...secondary.querySelectorAll("[data-reply-id]")].map(button => [button.dataset.replyId, button.textContent]), [
    ["action_orders_gallery", "GALERIA PEDIDOS"],
    ["action_launch_gallery", "GAL. LANÇAMENTOS"],
    ["action_payment_programming_gallery", "GAL. PGTOS PREVISTOS"],
    ["action_recurring_expenses_gallery", "GAL. DESPESAS RECORRENTES"],
  ]);
  assert.deepEqual([...primary.querySelectorAll("[data-reply-id]")].slice(0, 2).map(button => button.dataset.replyId), ["new_document", "payment"]);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-gallery-actions\s*\{[^}]*grid-template-rows:\s*repeat\(4,\s*var\(--launch-gallery-button-height\)\)/s);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-choice-button--launch-menu-primary\s*\{[^}]*min-height:\s*calc\(2\s*\*\s*var\(--launch-gallery-button-height\)\s*\+\s*var\(--launch-gallery-gap\)\)/s);
  dom.window.close();
});

test("menu de Demandas remove o avatar e coloca Galeria Tarefas à direita de Adicionar uma nova tarefa", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "demands-task-menu",
      role: "assistant",
      type: "poll",
      question: "👉 📋 DEMANDAS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "add_task", label: "📝 ADICIONAR UMA NOVA TAREFA", reply: "add_task" },
        { id: "finish_task", label: "✅ FINALIZAR UMA TAREFA", reply: "finish_task" },
        { id: "delegate_task", label: "👥 CRIAR UMA TAREFA DELEGADA", reply: "delegate_task" },
        { id: "recurring_task", label: "🔁 CADASTRAR TAREFA RECORRENTE", reply: "recurring_task" },
      ],
    }],
  }));
  const dom = new JSDOM(markup);
  const message = dom.window.document.querySelector(".chat-message--demand-menu");
  const primary = message.querySelector(".chat-choice-columns__primary");
  const secondary = message.querySelector(".chat-choice-columns__secondary");
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.equal(primary.querySelector("[data-reply-id]").dataset.replyId, "add_task");
  assert.deepEqual([...primary.querySelectorAll("[data-reply-id]")].map(button => button.dataset.replyId), ["add_task", "finish_task", "delegate_task", "recurring_task"]);
  assert.deepEqual([...secondary.querySelectorAll("[data-reply-id]")].map(button => [button.dataset.replyId, button.textContent]), [["action_tasks_gallery", "GALERIA TAREFAS"]]);
  assert.equal(message.querySelectorAll("[data-gallery-button]").length, 1);
  assert.doesNotMatch(markup, /📱 APPS/);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.chat-choice-columns--task-menu\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/s);
  dom.window.close();
});

test("exibe tamanhos da compactação em KB ou MB, nunca em bytes", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "compression-preview",
      role: "assistant",
      type: "text",
      text: "🗜️ PRÉVIA COMPRIMIDA — 495152 → 313057 bytes.",
    }, {
      id: "compression-large",
      role: "assistant",
      type: "text",
      text: "Original 2500000 bytes; compactado 1250000 bytes.",
    }],
  }));

  assert.match(markup, /495\.2 KB → 313\.1 KB \(36\.8% de redução\)/);
  assert.match(markup, /Original 2\.5 MB; compactado 1\.3 MB \(50\.0% de redução\)/);
  assert.doesNotMatch(markup, /bytes/);
});

test("renderiza comparação lado a lado do anexo original e comprimido com escolhas separadas", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "compression-choice",
      role: "assistant",
      type: "poll",
      question: "Deseja escolher uma versão do anexo?",
      attachment_compression_preview: {
        original: {
          fileName: "comprovante.pdf",
          mimeType: "application/pdf",
          size: 6_400_000,
          previewUrl: "/media/original-preview",
        },
        compressed: {
          fileName: "comprovante.pdf",
          mimeType: "application/pdf",
          size: 232_780,
          previewUrl: "/media/compressed-preview",
        },
      },
      options: [
        { id: "attachment_compression_use", reply: "attachment_compression_use", label: "SIM" },
        { id: "attachment_compression_keep", reply: "attachment_compression_keep", label: "NÃO" },
      ],
    }],
  }));

  assert.match(markup, /class="chat-compression-preview"/);
  assert.match(markup, /ORIGINAL — 6\.4 MB/);
  assert.match(markup, /COMPRIMIDA — 232\.8 KB/);
  assert.ok(markup.indexOf("ORIGINAL — 6.4 MB") < markup.indexOf("COMPRIMIDA — 232.8 KB"));
  assert.match(markup, /src="\/media\/original-preview"/);
  assert.match(markup, /src="\/media\/compressed-preview"/);
  assert.match(markup, /data-reply-id="attachment_compression_keep"[^>]*>Usar original/);
  assert.match(markup, /data-reply-id="attachment_compression_use"[^>]*>Usar comprimida/);
});

test("renderiza enquete como opções grandes e mídia como ação protegida", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [
      {
        id: "poll-1",
        role: "assistant",
        type: "poll",
        question: "Escolha",
        options: [{ id: "yes", label: "Sim", reply: "reply_yes" }],
      },
      {
        id: "media-1",
        role: "assistant",
        type: "document",
        fileName: "resumo.pdf",
        mediaUrl: "/api/portal-media/id",
      },
    ],
  }));

  assert.match(markup, /data-action="select-reply"/);
  assert.match(markup, /data-reply-id="reply_yes"/);
  assert.match(markup, /data-action="open-media"/);
  assert.match(markup, /data-message-id="media-1"/);
});

test("envia o identificador vinculado à etapa quando a opção também possui resposta numérica", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "branch-poll",
      role: "assistant",
      type: "poll",
      question: "QUAL É A FILIAL?",
      options: [{
        id: "choice:filial_despesa_recorrente:5",
        reply: "5",
        label: "5 - 004 - EDIFÍCIO XAVANTE",
      }],
    }],
  }));

  assert.match(markup, /data-reply-id="choice:filial_despesa_recorrente:5"/);
  assert.doesNotMatch(markup, /data-reply-id="5"/);
});

test("digitação em lista de banco solicita filtro sem precisar enviar", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const filters = [];
  view.on("database-filter-changed", command => filters.push(command));
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "products",
      role: "assistant",
      type: "poll",
      question: "QUAL O PRODUTO?",
      databaseFilter: true,
      databaseFilterKey: "document_signing_payment_product",
      options: [{ id: "3", label: "ARGAMASSA", reply: "3" }],
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  assert.equal(draft.dataset.databaseFilterKey, "document_signing_payment_product");
  draft.value = "are";
  draft.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.deepEqual(filters.map(({ value, filterKey }) => ({ value, filterKey })), [{
    value: "are",
    filterKey: "document_signing_payment_product",
  }]);

  view.destroy();
  dom.window.close();
});

test("filtra localmente opções de pessoa vindas do SharePoint enquanto digita", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "Felic",
    messages: [{
      id: "people",
      role: "assistant",
      type: "poll",
      question: "QUAL A PESSOA RELACIONADA?",
      databaseFilter: true,
      databaseFilterKey: "document_person",
      options: [
        { id: "269", label: "269 - LUIZ BERNARDO DOS SANTOS (ATIVO — EMPREITEIRO: SIM)", reply: "269" },
        { id: "260", label: "260 - FELICIANO ROGÉRIO DA SILVA (ATIVO — EMPREITEIRO: SIM)", reply: "260" },
      ],
    }],
  }));

  assert.match(markup, /FELICIANO ROGÉRIO DA SILVA/);
  assert.doesNotMatch(markup, /LUIZ BERNARDO DOS SANTOS/);
});

test("atualiza a lista de pessoa relacionada enquanto o usuário digita", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    messages: [{
      id: "people",
      role: "assistant",
      type: "poll",
      question: "QUAL A PESSOA RELACIONADA?",
      databaseFilter: true,
      databaseFilterKey: "document_person",
      options: [
        { id: "269", label: "269 - LUIZ BERNARDO DOS SANTOS", reply: "269" },
        { id: "260", label: "260 - FELICIANO ROGÉRIO DA SILVA", reply: "260" },
      ],
    }],
  });
  view.on("draft-changed", command => view.render({ ...state, draft: command.value }));
  view.render(state);

  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "Fel";
  draft.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.equal(root.querySelectorAll(".chat-choice-button").length, 1);
  assert.match(root.textContent, /FELICIANO ROGÉRIO DA SILVA/);
  assert.doesNotMatch(root.textContent, /LUIZ BERNARDO DOS SANTOS/);

  view.destroy();
  dom.window.close();
});

test("não filtra localmente mais de duas palavras antes do envio manual", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "Luiz Bernardo dos",
    messages: [{
      id: "people",
      role: "assistant",
      type: "poll",
      question: "QUAL A PESSOA RELACIONADA?",
      databaseFilter: true,
      databaseFilterKey: "document_person",
      options: [
        { id: "269", label: "269 - LUIZ BERNARDO DOS SANTOS", reply: "269" },
        { id: "260", label: "260 - FELICIANO ROGÉRIO DA SILVA", reply: "260" },
      ],
    }],
  }));

  assert.match(markup, /LUIZ BERNARDO DOS SANTOS/);
  assert.match(markup, /FELICIANO ROGÉRIO DA SILVA/);
});

test("filtra somente a pergunta de banco atual e preserva listas anteriores", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "Felic",
    messages: [
      {
        id: "previous-people",
        role: "assistant",
        type: "poll",
        question: "QUAL A PESSOA RELACIONADA?",
        databaseFilter: true,
        databaseFilterKey: "document_person",
        options: [{ id: "2058", label: "2058 - EDGAR NELSON DA SILVA", reply: "2058" }],
      },
      {
        id: "current-people",
        role: "assistant",
        type: "poll",
        question: "QUAL A PESSOA RELACIONADA?",
        databaseFilter: true,
        databaseFilterKey: "document_person",
        options: [{ id: "260", label: "260 - FELICIANO ROGÉRIO DA SILVA", reply: "260" }],
      },
    ],
  }));

  assert.match(markup, /EDGAR NELSON DA SILVA/);
  assert.match(markup, /FELICIANO ROGÉRIO DA SILVA/);
});

test("digitação em pergunta estática não aciona filtro de banco", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const filters = [];
  view.on("database-filter-changed", command => filters.push(command));
  view.render(signedInState({
    messages: [{
      id: "confirmation",
      role: "assistant",
      type: "poll",
      question: "DESEJA CONTINUAR?",
      options: [{ id: "yes", label: "SIM", reply: "yes" }],
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "sim";
  draft.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.deepEqual(filters, []);
  view.destroy();
  dom.window.close();
});

test("renderiza galeria de tarefas delegadas com busca, arraste e check", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "delegated-tasks",
      role: "assistant",
      type: "poll",
      presentation: "delegated_tasks",
      question: "📋 TAREFAS DELEGADAS PENDENTES",
      options: [{
        id: "choice:pending_delegated_task:delegated_task:501",
        label: "⭐ 501 - Enviar contrato · Bernardo",
        reply: "delegated_task:501",
        value: "501",
        task: { id: "501", task: "Enviar contrato", responsible: "Bernardo", priority: true },
      }],
    }],
  }));

  assert.match(markup, /data-role="delegated-tasks-search"/);
  assert.match(markup, /data-action="complete-delegated-task"/);
  assert.match(markup, /data-task-id="501"/);
  assert.match(markup, /draggable="true"/);
  assert.match(markup, /Enviar contrato/);
});

test("oferece redimensionar assinatura no PDF gerado", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "signed-pdf-1",
      role: "assistant",
      type: "document",
      fileName: "contrato-ASSINADO.pdf",
      mediaUrl: "/api/portal-media/signed-pdf-1",
      caption: "✍️ DOCUMENTO ASSINADO E ENVIADO.",
      signatureEdit: {
        document: { fileName: "contrato.pdf", mediaUrl: "/api/portal-media/source-pdf" },
        signature: { fileName: "assinatura.png", mediaUrl: "/api/portal-media/source-signature" },
      },
    }],
  }));

  assert.match(markup, /data-action="resize-signature"/);
  assert.match(markup, /REDIMENSIONAR ASSINATURA/);
  assert.match(markup, /data-message-id="signed-pdf-1"/);
});

test("mantém redimensionar disponível quando a fonte temporária não foi publicada", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "signed-pdf-without-sources",
      role: "assistant",
      type: "document",
      fileName: "contrato-ASSINADO.pdf",
      mediaUrl: "/api/portal-media/signed-pdf-2",
      caption: "✍️ DOCUMENTO ASSINADO — ASSINATURA APLICADA EM UM ÚNICO LOCAL",
      signatureEditAvailable: true,
    }],
  }));

  assert.match(markup, /data-action="resize-signature"/);
  assert.match(markup, /data-message-id="signed-pdf-without-sources"/);
});

test("tela final do documento assinado troca o menu automático pelos dois controles", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "signed-pdf-final",
      role: "assistant",
      type: "document",
      fileName: "contrato-ASSINADO.pdf",
      mediaUrl: "/api/portal-media/signed-pdf-final",
      caption: "✍️ DOCUMENTO ASSINADO — ASSINATURA APLICADA EM UM ÚNICO LOCAL (PÁGINA 2).",
    }, {
      id: "signed-pdf-menu",
      role: "assistant",
      type: "poll",
      question: "✅ DOCUMENTO ASSINADO E ENVIADO.\nQUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [{ id: "document_signing", label: "✍️ ASSINAR DOCUMENTOS" }],
    }],
  }));

  assert.match(markup, /data-action="resize-signature"[^>]*data-message-id="signed-pdf-final"/);
  assert.match(markup, /REDIMENSIONAR ASSINATURA/);
  assert.match(markup, /data-action="select-reply"[^>]*data-reply-id="navigation_main_menu"/);
  assert.match(markup, /RETORNAR AO MENU INICIAL/);
  assert.doesNotMatch(markup, /QUAL ÁREA VOCÊ DESEJA ACESSAR/);
});

test("oferece assinatura desenhada somente na etapa de assinatura de documentos", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{
      id: "signature-question",
      role: "assistant",
      type: "text",
      text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA.",
    }],
  }));

  assert.match(markup, /data-action="open-signature-pad"/);
  assert.match(markup, /ASSINAR NA TELA/);
  const pad = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-question", role: "assistant", type: "text", text: "Envie o documento PDF." }],
  }), { signaturePad: true });
  assert.match(pad, /data-role="signature-pad"/);
  assert.match(pad, /<canvas[^>]*width="900"[^>]*height="360"/);
  assert.match(pad, /data-action="confirm-signature-pad"/);
  assert.match(pad, /fundo branco será removido/);
});

test("comprovante gerado oferece assinar agora ou depois dentro da mensagem sem upload", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    attachments: [{ id: "generated-pdf", fileName: "COMPROVANTE-EPI.pdf", mimeType: "application/pdf", size: 2300 }],
    messages: [{
      id: "generated-document-signature-choice",
      role: "assistant",
      type: "poll",
      question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
      options: [
        { id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" },
        { id: "document_signing_sign_later", label: "⏭️ ASSINAR DEPOIS" },
      ],
    }],
  }));

  assert.match(markup, /data-action="open-signature-pad"[^>]*>✍️ ASSINAR NA TELA/);
  assert.match(markup, /data-reply-id="document_signing_sign_later"/);
  assert.doesNotMatch(markup, /ENVIAR ANEXO/);
  assert.doesNotMatch(markup, /data-action="pick-files"/);
  assert.doesNotMatch(markup, /data-action="capture-photo"/);
  assert.doesNotMatch(markup, /chat-file-tray/);
  assert.doesNotMatch(markup, /COMPROVANTE-EPI\.pdf/);
  assert.equal((markup.match(/data-action="open-signature-pad"/g) || []).length, 1);
});

test("assinar na tela do comprovante gerado abre o campo no primeiro toque", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{
      id: "generated-document-signature-choice",
      role: "assistant",
      type: "poll",
      question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
      options: [
        { id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" },
        { id: "document_signing_sign_later", label: "⏭️ ASSINAR DEPOIS" },
      ],
    }],
  }));

  root.querySelector('[data-action="open-signature-pad"]').click();
  assert.ok(root.querySelector('[data-role="signature-pad"]'));
  view.destroy();
  dom.window.close();
});

test("normaliza coordenadas da assinatura em canvas responsivo e aceita eventos de toque", () => {
  const dom = new JSDOM('<canvas></canvas>');
  const canvas = dom.window.document.querySelector("canvas");
  canvas.width = 900;
  canvas.height = 360;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 40, width: 300, height: 180 });

  assert.deepEqual(signaturePointFromEvent(canvas, { clientX: 170, clientY: 130 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(signaturePointFromEvent(canvas, {
    changedTouches: [{ clientX: 305, clientY: 205 }],
  }), { x: 0.95, y: 0.9166666666666666 });
  // Coordinates outside the visible area are clamped instead of becoming
  // NaN, so strokes near an edge remain drawable.
  assert.deepEqual(signaturePointFromEvent(canvas, { pageX: -10, pageY: 9999 }), { x: 0, y: 1 });
  dom.window.close();
});

test("não inventa um ponto central quando o WebView entrega um evento sem coordenadas", () => {
  const dom = new JSDOM('<canvas></canvas>');
  const canvas = dom.window.document.querySelector("canvas");
  canvas.width = 900;
  canvas.height = 360;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 40, width: 300, height: 180 });

  assert.equal(signaturePointFromEvent(canvas, { type: "pointermove", pointerId: 4 }), null);
  assert.equal(signaturePointFromEvent(canvas, { type: "touchmove", touches: [{}] }), null);
  dom.window.close();
});

test("dimensiona o bitmap da assinatura conforme a área visível ampliada", () => {
  const dom = new JSDOM('<canvas width="900" height="360"></canvas>');
  const canvas = dom.window.document.querySelector("canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 480 });

  assert.equal(resizeSignatureCanvasToDisplay(canvas, 2), true);
  assert.equal(canvas.width, 1440);
  assert.equal(canvas.height, 960);
  assert.equal(resizeSignatureCanvasToDisplay(canvas, 2), false);
  dom.window.close();
});

test("sincroniza o canvas antes do primeiro traço quando o modal abriu antes do layout", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-first-layout", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  let layoutReady = false;
  canvas.getBoundingClientRect = () => layoutReady
    ? { left: 10, top: 20, width: 300, height: 120 }
    : { left: 0, top: 0, width: 0, height: 0 };
  layoutReady = true;
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 160,
      clientY: 130,
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown"));
  dom.window.document.dispatchEvent(pointerEvent("pointermove", { clientY: 80 }));

  assert.equal(canvas.width, 300, "o bitmap deve acompanhar a área visível antes do primeiro traço");
  assert.equal(canvas.height, 120, "a altura do bitmap deve acompanhar o modal antes do primeiro traço");
  assert.equal(lines.length, 1, "o primeiro traço ascendente deve ser registrado");
  view.destroy();
  dom.window.close();
});

test("mantém o traço depois de pointerleave e registra tinta desde o primeiro toque", () => {
  const dom = new JSDOM('<div id="app"></div>');
  dom.window.PointerEvent = dom.window.Event;
  const calls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    beginPath: () => calls.push(["beginPath"]),
    arc: (...args) => calls.push(["arc", ...args]),
    fill: () => calls.push(["fill"]),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    stroke: () => calls.push(["stroke"]),
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-question", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const captured = [];
  canvas.setPointerCapture = id => captured.push(["set", id]);
  canvas.releasePointerCapture = id => captured.push(["release", id]);
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 20,
      clientY: 30,
      pointerId: 7,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown"));
  assert.equal(canvas.dataset.ink, "true");
  canvas.dispatchEvent(pointerEvent("lostpointercapture", { buttons: 1 }));
  assert.ok(calls.some(call => call[0] === "arc"), "o ponto inicial deve desenhar uma marca visível");
  canvas.dispatchEvent(pointerEvent("pointerleave", { buttons: 0, clientX: 320, clientY: 130 }));
  canvas.dispatchEvent(pointerEvent("pointermove", { clientX: 290, clientY: 110 }));
  assert.ok(calls.some(call => call[0] === "lineTo"), "o movimento deve continuar após sair momentaneamente do canvas");
  canvas.dispatchEvent(pointerEvent("pointerup"));
  assert.deepEqual(captured, [["set", 7], ["release", 7]]);
  view.destroy();
  dom.window.close();
});

test("a caneta por toque continua desenhando nos movimentos verticais", async () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  const calls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath: () => calls.push(["beginPath"]),
    arc: (...args) => calls.push(["arc", ...args]),
    fill: () => calls.push(["fill"]),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    stroke: () => calls.push(["stroke"]),
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-question-touch", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const touchEvent = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 8, clientX, clientY }],
      configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: type === "touchend" ? [] : [{ identifier: 8, clientX, clientY }],
      configurable: true,
    });
    return event;
  };
  canvas.dispatchEvent(touchEvent("touchstart", 160, 130));
  dom.window.document.dispatchEvent(touchEvent("touchmove", 160, 80));
  dom.window.document.dispatchEvent(touchEvent("touchend", 160, 80));
  assert.ok(calls.some(call => call[0] === "lineTo"), "o traço deve acompanhar o movimento de baixo para cima");
  view.destroy();
  dom.window.close();
});

test("combina pointerdown e touchmove no traço vertical em WebViews iOS", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const calls = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath: () => calls.push(["beginPath"]),
    arc: (...args) => calls.push(["arc", ...args]),
    fill: () => calls.push(["fill"]),
    moveTo: (...args) => calls.push(["moveTo", ...args]),
    lineTo: (...args) => calls.push(["lineTo", ...args]),
    stroke: () => calls.push(["stroke"]),
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-question-mixed", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 160,
      clientY: 130,
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  const touchEvent = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 8, clientX, clientY }],
      configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: type === "touchend" ? [] : [{ identifier: 8, clientX, clientY }],
      configurable: true,
    });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown"));
  dom.window.document.dispatchEvent(touchEvent("touchmove", 160, 80));
  dom.window.document.dispatchEvent(touchEvent("touchend", 160, 80));

  assert.ok(calls.some(call => call[0] === "lineTo"), "o touchmove vertical deve continuar o pointerdown");
  view.destroy();
  dom.window.close();
});

test("não trava o traço ascendente quando o iPhone envia pointermove sem coordenadas", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-coordinate-handoff", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  const touchEvent = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 8, clientX, clientY }], configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: [{ identifier: 8, clientX, clientY }], configurable: true,
    });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown", { clientX: 160, clientY: 130 }));
  dom.window.document.dispatchEvent(pointerEvent("pointermove"));
  dom.window.document.dispatchEvent(touchEvent("touchmove", 160, 80));

  assert.equal(lines.length, 1, "o touchmove válido deve assumir o traço após o pointermove sem coordenadas");
  assert.equal(lines[0][1], canvas.height * 0.5, "o traço precisa realmente subir no canvas");
  dom.window.document.dispatchEvent(touchEvent("touchend", 160, 80));
  dom.window.document.dispatchEvent(touchEvent("touchmove", 160, 60));
  assert.equal(lines.length, 1, "o movimento após touchend não pode continuar o traço encerrado");
  view.destroy();
  dom.window.close();
});

test("mantém o traço ascendente quando o iPhone inicia em touch e continua em pointer", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-reverse-coordinate-handoff", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const touch = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 3, clientX, clientY }], configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: [{ identifier: 3, clientX, clientY }], configurable: true,
    });
    return event;
  };
  const pointerMove = new dom.window.Event("pointermove", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerId: 9,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
    clientX: 160,
    clientY: 80,
  })) Object.defineProperty(pointerMove, key, { value, configurable: true });

  canvas.dispatchEvent(touch("touchstart", 160, 130));
  dom.window.document.dispatchEvent(pointerMove);
  dom.window.document.dispatchEvent(touch("touchmove", 290, 30));

  assert.equal(lines.length, 1, "o fluxo touch → pointer deve produzir um único movimento, sem feixe duplicado");
  assert.equal(lines[0][1], canvas.height * 0.5, "o primeiro movimento para cima deve ser preservado");
  view.destroy();
  dom.window.close();
});

test("segundo dedo não encerra o traço principal no handoff do iPhone", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-secondary-touch", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 160,
    clientY: 130,
    pointerId: 8,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    isPrimary: true,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primaryAt100 = { identifier: 3, clientX: 160, clientY: 100 };
  const primaryAt80 = { identifier: 3, clientX: 160, clientY: 80 };
  const secondary = { identifier: 4, clientX: 220, clientY: 90 };

  canvas.dispatchEvent(pointerDown);
  dom.window.document.dispatchEvent(touch("touchmove", [primaryAt100], [primaryAt100]));
  canvas.dispatchEvent(touch("touchstart", [secondary], [primaryAt100, secondary]));
  dom.window.document.dispatchEvent(touch("touchend", [secondary], [primaryAt100]));
  dom.window.document.dispatchEvent(touch("touchmove", [primaryAt80], [primaryAt80]));

  assert.equal(lines.length, 3, "o redesenho acumulado prova que o dedo principal continuou após o segundo sair");
  view.destroy();
  dom.window.close();
});

test("segundo dedo não herda o traço quando o dedo principal sai primeiro", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-primary-leaves-first", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 160,
    clientY: 130,
    pointerId: 8,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    isPrimary: true,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primary = { identifier: 3, clientX: 160, clientY: 125 };
  const secondary = { identifier: 4, clientX: 240, clientY: 70 };

  canvas.dispatchEvent(pointerDown);
  canvas.dispatchEvent(touch("touchstart", [secondary], [primary, secondary]));
  dom.window.document.dispatchEvent(touch("touchend", [primary], [secondary]));
  dom.window.document.dispatchEvent(touch("touchmove", [{ ...secondary, clientY: 50 }], [{ ...secondary, clientY: 50 }]));

  assert.equal(lines.length, 0, "o dedo restante não pode continuar o traço do dedo principal");
  view.destroy();
  dom.window.close();
});

test("touchend direto após pointerdown não transfere o traço ao dedo restante", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-direct-touchend", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    clientX: 160,
    clientY: 130,
    pointerId: 8,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    isPrimary: true,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  const touch = (type, changed, active) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", { value: changed, configurable: true });
    Object.defineProperty(event, "touches", { value: active, configurable: true });
    return event;
  };
  const primary = { identifier: 3, clientX: 160, clientY: 125 };
  const secondary = { identifier: 4, clientX: 240, clientY: 70 };

  canvas.dispatchEvent(pointerDown);
  dom.window.document.dispatchEvent(touch("touchend", [primary], [secondary]));
  dom.window.document.dispatchEvent(touch("touchmove", [{ ...secondary, clientY: 50 }], [{ ...secondary, clientY: 50 }]));

  assert.equal(lines.length, 0, "o touchend direto deve encerrar o dedo que iniciou o traço");
  view.destroy();
  dom.window.close();
});

test("mantém o traço vertical de toque quando o iPhone informa buttons zero", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-buttons-zero", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 160,
      clientY: 130,
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      buttons: 0,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown"));
  dom.window.document.dispatchEvent(pointerEvent("pointermove", { clientY: 80 }));

  assert.equal(lines.length, 1, "buttons=0 não encerra um toque ainda ativo no iPhone");
  view.destroy();
  dom.window.close();
});

test("processa apenas uma família de eventos por traço de assinatura", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-duplicate-stream", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX,
      clientY,
      pointerId: 8,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  const touchEvent = (type, clientX, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "changedTouches", {
      value: [{ identifier: 8, clientX, clientY }], configurable: true,
    });
    Object.defineProperty(event, "touches", {
      value: [{ identifier: 8, clientX, clientY }], configurable: true,
    });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown", 120, 100));
  dom.window.document.dispatchEvent(pointerEvent("pointermove", 140, 80));
  const afterPointerMove = lines.length;
  dom.window.document.dispatchEvent(touchEvent("touchmove", 290, 25));

  assert.equal(afterPointerMove, 1);
  assert.equal(lines.length, afterPointerMove, "o touchmove duplicado não pode criar um feixe");
  view.destroy();
  dom.window.close();
});

test("preserva o canvas e o primeiro traço depois de atualizar o chat durante a assinatura", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-rerender", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  });
  view.render(state);
  root.querySelector('[data-action="open-signature-pad"]').click();
  const firstCanvas = root.querySelector('[data-role="signature-pad"]');
  firstCanvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 160,
      clientY: 130,
      pointerId: 7,
      pointerType: "touch",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  firstCanvas.dispatchEvent(pointerEvent("pointerdown"));
  const lineCountBeforeUpdate = lines.length;
  view.render({ ...state, messages: [...state.messages] });
  const currentCanvas = root.querySelector('[data-role="signature-pad"]');
  assert.equal(currentCanvas, firstCanvas, "uma atualização transitória não pode trocar o canvas visível");
  currentCanvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  currentCanvas.dispatchEvent(pointerEvent("pointermove", { clientX: 290, clientY: 110 }));

  assert.equal(lines.length - lineCountBeforeUpdate, 1, "um movimento deve ser processado uma única vez");
  view.destroy();
  dom.window.close();
});

test("encerra o traço do mouse quando o WebView informa que o contato foi perdido", () => {
  const dom = new JSDOM("<div id=app></div>", { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const lines = [];
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo: (...args) => lines.push(args),
    stroke() {},
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-release", role: "assistant", type: "text", text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA." }],
  }));
  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 120 });
  const pointerEvent = (type, values = {}) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 160,
      clientY: 130,
      pointerId: 7,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      isPrimary: true,
      ...values,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  canvas.dispatchEvent(pointerEvent("pointerdown"));
  const lineCountBeforeRelease = lines.length;
  dom.window.document.dispatchEvent(pointerEvent("pointermove", { buttons: 0, clientX: 290, clientY: 30 }));
  dom.window.document.dispatchEvent(pointerEvent("pointermove", { buttons: 1, clientX: 280, clientY: 40 }));

  assert.equal(lines.length, lineCountBeforeRelease, "movimentos depois da perda de contato não podem virar linhas");
  view.destroy();
  dom.window.close();
});

test("exibe o PDF com a assinatura, editar assinatura e Continuar", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      id: "document_signing",
      title: "✍️ ASSINAR DOCUMENTOS",
      documentSigningPlacement: {
        stage: "document_signing_waiting_position",
      },
    },
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: null,
    },
  }));

  assert.match(markup, /data-signature-placement-dialog/);
  assert.match(markup, /data-role="signature-placement-document"/);
  assert.match(markup, /data-action="signature-placement-add-stamp"[^>]*>.*BERNARDO/);
  assert.doesNotMatch(markup, /A assinatura enviada aparece sobre o documento/i);
  assert.doesNotMatch(markup, /Toque no PDF|arraste a assinatura/i);
  assert.doesNotMatch(markup, /signature-placement-page-button/);
  assert.match(markup, /data-action="signature-placement-edit"[^>]*>✍️ Editar assinatura</);
  assert.match(markup, /data-action="signature-placement-shrink"/);
  assert.match(markup, /data-action="signature-placement-grow"/);
  assert.match(markup, /data-action="signature-placement-confirm"[^>]*>✅ Continuar</);
  assert.doesNotMatch(markup, /signature-placement-scope/);
  assert.doesNotMatch(markup, /TODAS AS PÁGINAS/);
  assert.match(markup, /data-role="signature-placement-scale">50%<\/strong>/);
});

test("troca o botão inferior para SUBSTITUIR PDF depois de adicionar o carimbo", () => {
  const markup = renderChatMarkup(signedInState({
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      stampApplied: true,
      selection: { page: 1, x: 0.5, y: 0.5 },
    },
  }));

  assert.match(markup, /data-action="signature-placement-confirm"[^>]*>✅ SUBSTITUIR PDF</);
  assert.doesNotMatch(markup, /data-action="signature-placement-confirm"[^>]*>✅ Continuar</);
});

test("o botão Continuar fica desabilitado até o usuário escolher o local", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      id: "document_signing",
      title: "✍️ ASSINAR DOCUMENTOS",
      documentSigningPlacement: {
        stage: "document_signing_waiting_position",
      },
    },
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: null,
    },
  }));

  assert.match(markup, /data-action="signature-placement-confirm" disabled[^>]*>✅ Continuar</);
});

test("exibe o limite mínimo de 20% para a assinatura selecionada", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      id: "document_signing",
      title: "✍️ ASSINAR DOCUMENTOS",
      documentSigningPlacement: {
        stage: "document_signing_waiting_position",
      },
    },
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: { page: 1, x: 0.5, y: 0.5, scale: 0.2 },
    },
  }));

  assert.match(markup, /data-role="signature-placement-scale">20%</);
});

test("durante a geração do PDF assinado preserva o original e impede fechar a operação", () => {
  const markup = renderChatMarkup(signedInState({
    signaturePlacement: {
      status: "signing",
      key: "pdf-1:signature-1:signing",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: { page: 1, x: 0.5, y: 0.5, scale: 0.5 },
    },
  }));

  assert.match(markup, /Gerando PDF assinado/);
  assert.match(markup, /original continuará preservado/i);
  assert.doesNotMatch(markup, /data-action="close-signature-placement"/);
  assert.doesNotMatch(markup, /data-popup-close-action/);
});

test("marca o layout específico do comprovante de pagamento na prévia", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "ready",
      key: "payment-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "comprovante-pagamento-2026-09-20.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: { page: 1, x: 0.5, y: 0.25, scale: 0.5 },
    },
  }));

  assert.match(markup, /data-signature-document-layout="payment"/);
});

test("marca o layout específico do comprovante de entrega de EPI na prévia", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "ready",
      key: "epi-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "comprovante-entrega-epi-2026.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: { page: 1, x: 0.5, y: 0.3, scale: 0.5 },
    },
  }));
  assert.match(markup, /data-signature-document-layout="epi"/);
});

test("X do posicionamento retorna à conversa anterior mesmo se o PDF ainda estiver carregando", async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const events = [];
  view.on("signature-placement-close", command => events.push(command.type));
  const state = signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "loading",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
    },
  });

  view.render(state);
  root.querySelector('[data-action="close-signature-placement"]').click();
  assert.equal(root.querySelector('[data-signature-placement-dialog]'), null);
  assert.deepEqual(events, ["signature-placement-close"]);

  view.render({ ...state, signaturePlacement: { ...state.signaturePlacement, status: "ready" } });
  assert.equal(root.querySelector('[data-signature-placement-dialog]'), null);
  assert.ok(root.querySelector('[data-action="open-signature-placement"]'));
  view.destroy();
  dom.window.close();
});

test("botões locais do posicionamento respondem ao primeiro toque no celular", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "loading",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
    },
  }));

  const close = root.querySelector('[data-action="close-signature-placement"]');
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerType: "touch", isPrimary: true, button: 0, buttons: 1 })) {
    Object.defineProperty(pointerDown, key, { value, configurable: true });
  }
  close.dispatchEvent(pointerDown);

  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerType: "touch", isPrimary: true, button: 0, buttons: 0 })) {
    Object.defineProperty(pointerUp, key, { value, configurable: true });
  }
  close.dispatchEvent(pointerUp);

  assert.equal(root.querySelector("[data-signature-placement-dialog]"), null);
  view.destroy();
  dom.window.close();
});

test("Editar assinatura fecha a prévia e emite uma ação para solicitar outra imagem", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const events = [];
  view.on("signature-placement-edit", command => events.push(command.type));
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: { page: 1, x: 0.5, y: 0.5 },
    },
  }));
  root.querySelector('[data-action="signature-placement-edit"]').click();
  assert.equal(root.querySelector('[data-signature-placement-dialog]'), null);
  assert.deepEqual(events, ["signature-placement-edit"]);
  view.destroy();
  dom.window.close();
});

test("preserva a prévia e o contêiner do PDF durante uma atualização transitória do chat", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    signaturePlacement: {
      status: "ready",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
      selection: null,
    },
  });

  view.render(state);
  const firstPdf = root.querySelector(".signature-placement-pdf");
  assert.ok(firstPdf);
  view.render({ ...state, error: "Atualização transitória" });
  assert.equal(root.querySelector(".signature-placement-pdf"), firstPdf, "a atualização transitória não pode trocar o visualizador ativo");
  view.destroy();
  dom.window.close();
});

test("renderiza ação marcada como perigosa com botão vermelho", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-menu",
      role: "assistant",
      type: "poll",
      question: "⏳ PENDÊNCIAS",
      options: [
        { id: "pending", label: "💳 PROVISÕES PGTO PENDENTES (1)", reply: "pending", tone: "danger" },
        { id: "documents", label: "📄 DOCUMENTOS PENDENTES", reply: "documents" },
      ],
    }],
  }));

  assert.match(markup, /class="chat-choice-button chat-choice-button--danger"[^>]*data-reply-id="pending"/);
  assert.match(markup, /class="chat-choice-button"[^>]*data-reply-id="documents"/);
});

test("renderiza lixeira ao lado de cada documento pendente", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-documents",
      role: "assistant",
      type: "poll",
      question: "📄 QUAL DOCUMENTO PENDENTE DESEJA ATUALIZAR?",
      options: [{
        id: "262",
        label: "262 - RAYNER CORREIA DE CASTRO (CONTRATO)",
        reply: "262",
        delete_action: {
          id: "pending_document_delete:262",
          reply: "pending_document_delete:262",
          title: "🗑️",
        },
      }],
    }],
  }));

  assert.match(markup, /class="chat-document-option"/);
  assert.match(markup, /data-reply-id="262"/);
  assert.match(markup, /class="chat-document-option__delete"[^>]*data-reply-id="pending_document_delete:262"/);
});

test("renderiza confirmação de saída com Sim e Não quando solicitada", () => {
  const markup = renderChatMarkup(signedInState(), { signOutConfirm: true });

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Tem certeza que deseja sair\?/);
  assert.match(markup, /data-action="cancel-sign-out"[^>]*>Não</);
  assert.match(markup, /data-action="confirm-sign-out"[^>]*>Sim</);
});

test("marca cada popup do chat com a ação equivalente ao cancelamento no fundo", () => {
  const base = signedInState({
    pendingProvisions: { due: true, rows: [{ supplier: "Fornecedor A" }] },
    signaturePlacement: {
      status: "loading",
      key: "pdf-1:signature-1:position",
      stage: "document_signing_waiting_position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
    },
  });
  const dom = new JSDOM(renderChatMarkup(base, {
    signOutConfirm: true,
    attachmentSource: true,
    datePicker: true,
    signaturePad: true,
  }));

  const expected = [
    ["[data-sign-out-dialog]", "cancel-sign-out"],
    ["[data-attachment-source-dialog]", "cancel-attachment-source"],
    ["[data-date-picker-dialog]", "cancel-date-picker"],
    ["[data-signature-pad-dialog]", "cancel-signature-pad"],
    ["[data-signature-placement-dialog]", "close-signature-placement"],
    ["[data-pending-provisions-dialog]", "close-pending-provisions"],
  ];
  for (const [selector, action] of expected) {
    assert.equal(dom.window.document.querySelector(selector)?.dataset.popupCloseAction, action, selector);
    assert.equal(dom.window.document.querySelector(selector)?.dataset.popupBackdrop, "true", selector);
  }
  dom.window.close();
});

test("fecha pelo fundo os popups locais do chat com a mesma ação de cancelar", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const dateState = signedInState({
    messages: [{
      id: "date",
      role: "assistant",
      type: "poll",
      question: "Qual é a data de pagamento?",
      options: [{ id: "today", label: "HOJE" }],
    }],
  });
  const signatureState = signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature", role: "assistant", type: "text", text: "Envie uma foto da assinatura." }],
  });

  const closeByBackdrop = selector => {
    const backdrop = root.querySelector(selector);
    assert.ok(backdrop, selector);
    backdrop.click();
    assert.equal(root.querySelector(selector), null, selector);
  };

  view.render(signedInState());
  root.querySelector('[data-action="sign-out"]').click();
  closeByBackdrop("[data-sign-out-dialog]");

  root.querySelector('[data-action="pick-files"]').click();
  closeByBackdrop("[data-attachment-source-dialog]");

  view.render(dateState);
  root.querySelector('[data-action="open-date-picker"]').click();
  closeByBackdrop("[data-date-picker-dialog]");

  view.render(signatureState);
  root.querySelector('[data-action="open-signature-pad"]').click();
  closeByBackdrop("[data-signature-pad-dialog]");

  view.render(signedInState({
    signaturePlacement: {
      status: "loading",
      key: "pdf-1:signature-1:position",
      document: { fileName: "contrato.pdf" },
      signature: { fileName: "assinatura.png" },
    },
  }));
  closeByBackdrop("[data-signature-placement-dialog]");

  view.destroy();
  dom.window.close();
});

test("clipe abre escolha entre foto e arquivo antes de iniciar a seleção", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState();
  let selected;
  view.on("pick-photos", () => { selected = "foto"; });
  view.render(state);

  root.querySelector('[data-action="pick-files"]').click();
  assert.match(root.textContent, /Escolha se deseja selecionar uma foto ou um arquivo/);
  assert.ok(root.querySelector('[data-action="pick-photos"]'));
  assert.ok(root.querySelector('[data-action="pick-document-files"]'));
  root.querySelector('[data-action="pick-photos"]').click();
  assert.equal(selected, "foto");
  assert.equal(root.querySelector('[data-attachment-source-dialog]'), null);
  view.destroy();
  dom.window.close();
});

test("toque rápido no clipe usa o botão tocado mesmo se o hit-test da soltura falhar", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState());

  const clip = root.querySelector('[data-action="pick-files"]');
  clip.getBoundingClientRect = () => ({ left: 20, right: 80, top: 100, bottom: 160, width: 60, height: 60 });
  let hitTarget = clip;
  dom.window.document.elementFromPoint = () => hitTarget;
  const pointer = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 40,
      clientY: 120,
      pointerId: 14,
      pointerType: "touch",
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  clip.dispatchEvent(pointer("pointerdown"));
  hitTarget = root;
  clip.dispatchEvent(pointer("pointerup"));

  assert.ok(root.querySelector('[data-attachment-source-dialog]'),
    "um toque sem arraste deve abrir a bandeja mesmo quando a coordenada de soltura estiver defasada");
  view.destroy();
  dom.window.close();
});

test("arrastar arquivos abre a bandeja e soltar entrega todos ao fluxo de anexos", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const dropped = [];
  view.on("files-dropped", command => dropped.push(...command.files));
  view.render(signedInState());
  const files = [
    new dom.window.File(["pdf"], "comprovante.pdf", { type: "application/pdf" }),
    new dom.window.File(["foto"], "foto.jpg", { type: "image/jpeg" }),
  ];
  const transfer = { types: ["Files"], files, dropEffect: "none" };
  const dispatch = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    root.dispatchEvent(event);
    return event;
  };

  dispatch("dragenter");
  dispatch("dragenter");
  assert.match(root.textContent, /Solte os arquivos aqui para anexar/);
  assert.ok(root.querySelector('[data-file-drop-zone]'));
  dispatch("dragleave");
  assert.ok(root.querySelector('[data-file-drop-zone]'), "entrar em um elemento filho não pode fechar a bandeja");
  const over = dispatch("dragover");
  assert.equal(over.defaultPrevented, true);
  assert.equal(transfer.dropEffect, "copy");
  const drop = dispatch("drop");

  assert.equal(drop.defaultPrevented, true);
  assert.equal(root.querySelector('[data-file-drop-zone]'), null);
  assert.deepEqual(dropped.map(file => file.name), ["comprovante.pdf", "foto.jpg"]);
  view.destroy();
  dom.window.close();
});

test("arrastar texto não abre a bandeja nem cria anexo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let drops = 0;
  view.on("files-dropped", () => { drops++; });
  view.render(signedInState());
  const transfer = { types: ["text/plain"], files: [], dropEffect: "none" };
  const dispatch = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    root.dispatchEvent(event);
    return event;
  };

  assert.equal(dispatch("dragenter").defaultPrevented, false);
  assert.equal(dispatch("dragover").defaultPrevented, false);
  assert.equal(dispatch("drop").defaultPrevented, false);
  assert.equal(root.querySelector('[data-file-drop-zone]'), null);
  assert.equal(drops, 0);
  view.destroy();
  dom.window.close();
});

test("soltar uma pasta fecha a bandeja sem criar anexo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let drops = 0;
  view.on("files-dropped", () => { drops++; });
  view.render(signedInState());
  const transfer = {
    types: ["Files"],
    files: [],
    items: [{
      kind: "file",
      webkitGetAsEntry: () => ({ isDirectory: true }),
      getAsFile: () => null,
    }],
    dropEffect: "none",
  };
  const dispatch = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    root.dispatchEvent(event);
    return event;
  };

  dispatch("dragenter");
  assert.ok(root.querySelector('[data-file-drop-zone]'));
  assert.equal(dispatch("drop").defaultPrevented, true);
  assert.equal(root.querySelector('[data-file-drop-zone]'), null);
  assert.equal(drops, 0);
  view.destroy();
  dom.window.close();
});

test("botão Enviar anexo da pergunta abre a mesma escolha do clipe", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    messages: [{
      id: "upload-question",
      role: "assistant",
      type: "poll",
      question: "ENVIE O DOCUMENTO PDF.",
      options: [{ id: "attachment_upload_continue", reply: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
    }],
  }));

  root.querySelector('[data-reply-id="attachment_upload_continue"]').click();

  assert.match(root.textContent, /Escolha se deseja selecionar uma foto ou um arquivo/);
  assert.ok(root.querySelector('[data-action="pick-photos"]'));
  assert.ok(root.querySelector('[data-action="pick-document-files"]'));
  view.destroy();
  dom.window.close();
});

test("oferece prosseguir sem anexo quando o temporário expirou", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO" },
    messages: [{
      id: "expired-upload",
      role: "assistant",
      type: "poll",
      question: "⚠️ UM ANEXO TEMPORÁRIO NÃO ESTÁ MAIS DISPONÍVEL. OS DADOS DO FORMULÁRIO FORAM PRESERVADOS. REENVIE O ARQUIVO: Comprovante_20260920_014255.pdf",
      options: [{ id: "attachment_upload_continue", reply: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
    }],
  }));

  assert.match(markup, /data-reply-id="attachment_upload_continue"/);
  assert.match(markup, /data-reply-id="attachment_upload_skip"/);
  assert.match(markup, /PROSSEGUIR SEM ANEXO/);
});

test("mostra o calendário em pergunta de data mesmo sem metadado da VM", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "launch-payment-date",
      role: "assistant",
      type: "poll",
      question: "📅 QUAL É A DATA DE PAGAMENTO PREVISTO?\nSelecione uma opção. Caso prefira outra data, envie-a no formato dd/mm/yyyy.",
      options: [
        { id: "blank", label: "EM BRANCO" },
        { id: "yesterday", label: "🔴 📆 ONTEM" },
        { id: "today", label: "📅 HOJE" },
        { id: "tomorrow", label: "AMANHÃ" },
        { id: "other", label: "OUTRA DATA" },
      ],
    }],
  }));

  assert.match(markup, /data-action="open-date-picker"/);
  assert.match(markup, /aria-label="Selecionar data pelo calendário"/);
});

test("formata automaticamente a data digitada na pergunta atual", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const drafts = [];
  view.on("draft-changed", command => drafts.push(command.value));
  view.render(signedInState({
    messages: [{
      id: "payment-date",
      role: "assistant",
      type: "poll",
      question: "Qual é a data do pagamento? Digite no formato DD/MM/AAAA.",
      options: [{ id: "today", label: "HOJE" }],
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  assert.equal(draft.placeholder, "DD/MM/AAAA");
  assert.equal(draft.inputMode, "numeric");
  assert.equal(draft.dataset.dateInput, "true");

  for (const [raw, expected] of [
    ["21", "21/"],
    ["21/09", "21/09/"],
    ["21/09/2026", "21/09/2026"],
  ]) {
    draft.value = raw;
    draft.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: raw.at(-1),
      inputType: "insertText",
    }));
    assert.equal(draft.value, expected);
  }
  assert.deepEqual(drafts, ["21/", "21/09/", "21/09/2026"]);

  view.destroy();
  dom.window.close();
});

test("formata data colada e permite apagar a barra automática", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    messages: [{
      id: "due-date",
      role: "assistant",
      type: "text",
      text: "Informe a data de vencimento.",
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "21092026";
  draft.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    data: "21092026",
    inputType: "insertFromPaste",
  }));
  assert.equal(draft.value, "21/09/2026");

  draft.value = "21";
  draft.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    inputType: "deleteContentBackward",
  }));
  assert.equal(draft.value, "21");

  view.destroy();
  dom.window.close();
});

test("desativa a máscara de data enquanto a resposta está sendo enviada", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeText: "21/09/2026",
    messages: [{
      id: "payment-date",
      role: "assistant",
      type: "text",
      text: "Qual é a data do pagamento?",
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  assert.equal(draft.dataset.dateInput, undefined);
  assert.equal(draft.placeholder, "Digite uma mensagem");
  draft.value = "observação";
  draft.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    data: "o",
    inputType: "insertText",
  }));
  assert.equal(draft.value, "observação");

  view.destroy();
  dom.window.close();
});

test("permite apagar qualquer separador de uma data completa", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    messages: [{
      id: "due-date",
      role: "assistant",
      type: "text",
      text: "Informe a data de vencimento.",
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  for (const { caret, raw, expected } of [
    { caret: 3, raw: "2109/2026", expected: "2109/2026" },
    { caret: 6, raw: "21/092026", expected: "21/092026" },
  ]) {
    draft.value = "21/09/2026";
    draft.setSelectionRange(caret, caret);
    draft.dispatchEvent(new dom.window.InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    }));
    draft.value = raw;
    draft.setSelectionRange(caret - 1, caret - 1);
    draft.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward",
    }));
    assert.equal(draft.value, expected);
  }

  view.destroy();
  dom.window.close();
});

test("não aplica máscara de data em perguntas comuns", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    messages: [{
      id: "notes",
      role: "assistant",
      type: "text",
      text: "Digite as observações.",
    }],
  }));

  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "2109";
  draft.dispatchEvent(new dom.window.InputEvent("input", {
    bubbles: true,
    data: "9",
    inputType: "insertText",
  }));

  assert.equal(draft.value, "2109");
  assert.equal(draft.dataset.dateInput, undefined);
  assert.equal(draft.placeholder, "Digite uma mensagem");

  view.destroy();
  dom.window.close();
});

test("não confunde data exibida no texto de uma seleção com pergunta de data", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "provision-selection",
      role: "assistant",
      type: "poll",
      question: "A QUAL PROVISÃO DE PAGAMENTO DESEJA ADICIONAR OS ANEXOS? As opções incluem a DATA PREVISTO PGTO.",
      options: [{ id: "42", label: "42 - FORNECEDOR (10/09/2026)" }],
    }],
  }));

  assert.doesNotMatch(markup, /data-action="open-date-picker"/);
});

test("não mostra calendário no resumo de confirmação do EPI", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "epi-confirmation-summary",
      role: "assistant",
      type: "poll",
      question: [
        "📋 RESUMO DO QUE SERÁ POSTADO EM DOCUMENTOS",
        "DATA: 2026-09-18",
        "DATA DE VALIDADE: EM BRANCO",
        "DATA SUBMETIDO: 2026-09-18",
        "PESSOA RELACIONADA: EDGAR NELSON DA SILVA",
        "TIPO DE DOCUMENTO: COMPROVANTE ENTREGA EPI",
        "ANEXO: COMPROVANTE-ENTREGA-EPI-2026-09-18-ASSINADO.pdf",
      ].join("\n"),
      options: [],
    }],
  }));

  assert.match(markup, /RESUMO DO QUE SERÁ POSTADO EM DOCUMENTOS/);
  assert.doesNotMatch(markup, /data-action="open-date-picker"/);
});

test("mantém o X e o título do calendário em áreas separadas", () => {
  const markup = renderChatMarkup(signedInState(), {
    datePicker: true,
    datePickerValue: "2026-09-30",
  });

  assert.match(markup, /class="chat-date-picker__header"[\s\S]*data-action="cancel-date-picker"[\s\S]*id="date-picker-title"/);
  assert.match(markup, /class="chat-date-picker__close"/);
  assert.match(markup, /Selecionar data/);
});

test("não mostra o LOG de ações no menu principal", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu",
      role: "assistant",
      type: "poll",
      question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [
        { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
        { id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" },
      ],
    }],
  }));

  assert.doesNotMatch(markup, /data-reply-id="audit_log"/);
  assert.doesNotMatch(markup, /LOG DE AÇÕES/);
  assert.match(markup, /SUPRIMENTOS/);
});

test("mantém o LOG de ações dentro de Auditoria e Documentos", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "audit-menu",
      role: "assistant",
      type: "poll",
      question: "🔎 AUDITORIA E DOCUMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
        { id: "action_document", label: "📄 ADICIONAR UM NOVO DOCUMENTO", reply: "action_document" },
      ],
    }],
  }));

  assert.equal((markup.match(/data-reply-id="audit_log"/g) || []).length, 1);
  assert.match(markup, /LOG DE AÇÕES/);
});

test("move a navegação do formulário para a faixa superior do fluxo", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "task", title: "ADICIONAR UMA TAREFA COM UM NOME MUITO LONGO PARA TESTAR A QUEBRA" },
    messages: [{
      id: "question-with-navigation",
      role: "assistant",
      type: "poll",
      question: "Qual opção?",
      options: [
        { id: "answer", label: "RESPOSTA", reply: "answer" },
        { id: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR", reply: "navigation_back", navigation_back: true },
        { id: "navigation_main_menu", label: "🏠 RETORNAR AO MENU INICIAL", reply: "navigation_main_menu", navigation_main_menu: true },
      ],
    }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
  assert.match(markup, /class="chat-flow-title"/);
  assert.match(markup, /Ver resumo/);
  const formChoices = markup.match(/<div class="chat-choice-list">[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(formChoices, /RETORNAR/);
  assert.match(markup, /data-reply-id="answer"/);
});

test("mostra a navegação em menus intermediários mesmo sem activeFlow", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "intermediate-menu-with-navigation",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" },
        { id: "navigation_back", label: "↩️ RETORNAR À PERGUNTA ANTERIOR", reply: "navigation_back", navigation_back: true },
        { id: "navigation_main_menu", label: "🏠 RETORNAR AO MENU INICIAL", reply: "navigation_main_menu", navigation_main_menu: true },
      ],
    }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
  assert.match(markup, /class="chat-flow-title"[^>]*title="📦 SUPRIMENTOS">📦 SUPRIMENTOS<\/strong>/);
  assert.match(markup, /data-reply-id="new_document"/);
});

test("mantém a faixa de navegação em telas internas sem enquete", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "attachments", title: "ADICIONAR ANEXOS" },
    messages: [{ id: "status", role: "assistant", type: "text", text: "Anexo recebido." }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
});

test("mostra finalizar anexos somente quando a VM pede o comando", () => {
  const finishMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "payment_provision", title: "CRIAR UMA PROVISÃO DE PAGAMENTO" },
    messages: [{
      id: "attachment-prompt",
      role: "assistant",
      type: "text",
      text: "ENVIE O PRIMEIRO ANEXO. Quando terminar, responda FINALIZAR.",
    }],
  }));

  assert.match(finishMarkup, /class="chat-flow-finish"/);
  assert.match(finishMarkup, /data-action="finish-flow"/);
  assert.match(finishMarkup, />FINALIZAR</);

  const regularMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "task", title: "ADICIONAR TAREFA" },
    messages: [{ id: "regular-prompt", role: "assistant", type: "text", text: "Informe a filial." }],
  }));
  assert.doesNotMatch(regularMarkup, /data-action="finish-flow"/);
});

test("permite finalizar quando já há anexo e a VM oferece adicionar mais ou finalizar", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO" },
    attachments: [{
      id: "uploaded-document",
      fileName: "comprovante.pdf",
      mimeType: "application/pdf",
      size: 1024,
      mediaUrl: "/api/portal-media/uploaded-document",
    }],
    messages: [{
      id: "attachment-loop",
      role: "assistant",
      type: "poll",
      question: "📎 ENVIE O PRIMEIRO ANEXO DO DOCUMENTO. DEPOIS DE CADA ENVIO, VOCÊ PODERÁ ADICIONAR MAIS ANEXOS OU FINALIZAR.",
      options: [{ id: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
    }],
  }));

  assert.match(markup, /data-action="finish-flow"/);
  assert.match(markup, />FINALIZAR</);
});

test("mantém finalizar disponível na etapa de anexos mesmo sem anexo", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO" },
    messages: [{
      id: "attachment-first-upload",
      role: "assistant",
      type: "poll",
      question: "📎 ENVIE O PRIMEIRO ANEXO DO DOCUMENTO. DEPOIS DE CADA ENVIO, VOCÊ PODERÁ ADICIONAR MAIS ANEXOS OU FINALIZAR.",
      options: [{ id: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
    }],
  }));

  assert.match(markup, /data-reply-id="attachment_upload_continue"/);
  assert.match(markup, /data-action="finish-flow"/);
});

test("marca opção única para ocupar uma área maior em tablets", () => {
  const singleMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "single-choice",
      role: "assistant",
      type: "poll",
      question: "Envie o anexo.",
      options: [{ id: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
    }],
  }));
  assert.match(singleMarkup, /class="chat-choice-list chat-choice-list--single"/);

  const multipleMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "task", title: "ADICIONAR TAREFA" },
    messages: [{
      id: "multiple-choice",
      role: "assistant",
      type: "poll",
      question: "Escolha.",
      options: [
        { id: "one", label: "Uma" },
        { id: "two", label: "Duas" },
      ],
    }],
  }));
  assert.doesNotMatch(multipleMarkup, /chat-choice-list--single/);
});

test("prioriza duas casas no total das linhas de lançamento", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      launches: {
        id: "batch-1",
        totalDisplay: "R$ 62,00",
        lines: [{ index: 1, product: "FORMA", unitPriceDisplay: "R$ 5,00", quantity: "4", freightDisplay: "R$ 0,00", totalDisplay: "R$ 20,00" }],
      },
    },
  }));

  assert.match(markup, /R\$ 5,0/);
  assert.match(markup, /4,0/);
  assert.match(markup, /R\$ 0,0/);
  assert.match(markup, /R\$ 20,00/);
  assert.match(markup, /class="chat-launch-total"/);
});

test("compacta linhas de contrato com cabeçalhos abreviados, números centralizados e qtd vazia como hífen", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      measurementLines: {
        id: "measurement-batch-1",
        totalDisplay: "R$ 21,5",
        lines: [{
          index: 1,
          activity: "Execução de forma",
          quantity: "",
          height: "2",
          width: "1,5",
          unitPriceDisplay: "R$ 7",
          totalDisplay: "R$ 21,5",
          details: { contract: "C-1", branch: "Matriz", description: "Forma", unit: "m²", lineType: "Área" },
        }],
      },
    },
  }));

  const dom = new JSDOM(`<main>${markup}</main>`);
  const panel = dom.window.document.querySelector(".chat-measurements");
  assert.deepEqual([...panel.querySelectorAll(".chat-measurement-row--header span")].map(node => node.textContent),
    ["Atividade", "Qtd.", "H", "L", "VLOR UN.", "Total", "Ações"]);
  assert.deepEqual([...panel.querySelectorAll(".chat-measurement-number")].map(node => node.textContent), ["-", "2,00", "1,50", "7,00", "21,50"]);
  assert.equal(panel.querySelectorAll(".chat-measurement-number")[0].className, "chat-measurement-number");
});

test("mostra a lixeira para excluir cada rascunho sem confundir com retomar", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "draft-menu",
      role: "assistant",
      type: "poll",
      question: "1 RASCUNHO AGUARDANDO. ESCOLHA QUAL DESEJA CONTINUAR.",
      options: [
        { id: "draft_resume:abc", label: "▶️ RETOMAR • EFETUAR LANÇAMENTO" },
        { id: "draft_resume:abc", label: "EFETUAR LANÇAMENTO" },
      ],
    }],
  }));

  assert.match(markup, /data-reply-id="draft_resume:abc"/);
  assert.match(markup, /data-reply-id="draft_delete:abc"/);
  assert.match(markup, /class="chat-draft-option"/);
  assert.match(markup, /class="chat-draft-delete"/);
  assert.match(markup, /aria-label="Excluir rascunho: EFETUAR LANÇAMENTO"/);
  assert.doesNotMatch(markup, /🗑️ EXCLUIR • EFETUAR LANÇAMENTO/);
  assert.equal((markup.match(/data-reply-id="draft_resume:abc"/g) || []).length, 1);
});

test("não mostra salvar rascunho dentro das perguntas do fluxo", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "flow-question",
      role: "assistant",
      type: "poll",
      question: "ESCOLHA UMA OPÇÃO",
      options: [
        { id: "one", label: "UMA OPÇÃO" },
        { id: "save_draft_main_menu", label: "💾 SALVAR RASCUNHO E RETORNAR AO MENU PRINCIPAL" },
      ],
    }],
  }));

  assert.match(markup, /UMA OPÇÃO/);
  assert.doesNotMatch(markup, /SALVAR RASCUNHO E RETORNAR/);
});

test("mídia recebida mostra cartão de prévia clicável", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{ id: "photo-1", type: "image", fileName: "foto.jpg", previewUrl: "blob:http://local/preview" }],
  }));
  assert.match(markup, /class="chat-media-preview chat-media-preview--image"/);
  assert.match(markup, /alt="Prévia de foto\.jpg"/);
  assert.match(markup, /Toque para abrir o arquivo completo/);
});

test("não lista anexo que falhou e mantém somente o envio em andamento", () => {
  const markup = renderChatMarkup(signedInState({
    error: "O anexo ata.pdf não foi enviado e foi removido da lista.",
    pendingFiles: [
      { id: "f1", file: { name: "foto.jpg", size: 1500 }, status: "sending", error: null },
      { id: "f2", file: { name: "ata.pdf", size: 2200 }, status: "failed", error: "timeout" },
    ],
  }));

  assert.match(markup, /foto\.jpg/);
  assert.match(markup, /Enviando/);
  assert.match(markup, /O anexo ata\.pdf não foi enviado e foi removido da lista/);
  assert.doesNotMatch(markup, /data-file-id="f2"/);
  assert.doesNotMatch(markup, /timeout/);
});

test("traduz alvos DOM em comandos sem acoplar a rede", () => {
  const target = {
    closest(selector) {
      if (selector === "[data-action]") {
        return { dataset: { action: "select-reply", replyId: "yes", label: "Sim" } };
      }
      return null;
    },
  };

  assert.deepEqual(commandFromTarget(target), {
    type: "select-reply",
    replyId: "yes",
    label: "Sim",
  });
  assert.equal(commandFromTarget({ closest: () => null }), null);
});

test("anexos do fluxo ficam em lista compacta com ação de visualizar e nomes escapados", () => {
  const markup = renderChatMarkup(signedInState({ attachments: [
    { id: "vm-1", fileName: 'foto <teste>.jpg', size: 1500, mediaUrl: "/api/portal-media/id" },
  ] }));
  assert.match(markup, /<details[^>]*class="chat-attachments"/);
  assert.match(markup, /Anexos \(1\)/);
  assert.match(markup, /data-action="open-file" data-file-id="vm-1"/);
  assert.match(markup, /data-action="remove-attachment" data-file-id="vm-1"/);
  assert.match(markup, /data-action="open-signature-pad"[^>]*aria-label="Assinar documento: foto &lt;teste&gt;\.jpg"/);
  assert.match(markup, /data-action="compress-attachment" data-file-id="vm-1"/);
  assert.ok(markup.indexOf('data-action="open-signature-pad"') < markup.indexOf('data-action="compress-attachment"'));
  assert.ok(markup.indexOf('data-action="compress-attachment"') < markup.indexOf('data-action="remove-attachment"'));
  assert.match(markup, /aria-label="Excluir anexo: foto &lt;teste&gt;\.jpg"/);
  assert.match(markup, /class="chat-attachment-cluster"/);
  assert.match(markup, /foto &lt;teste&gt;\.jpg/);
  assert.doesNotMatch(markup, /src="\/api\/portal-media/);
});

test("botão de assinatura da bandeja abre o campo em qualquer fluxo", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "expenses", title: "GASTOS PESSOAIS" },
    attachments: [{ id: "receipt", fileName: "recibo.pdf", mimeType: "application/pdf", size: 2300 }],
  }));

  root.querySelector('[data-action="open-signature-pad"]').click();
  assert.ok(root.querySelector('[data-role="signature-pad"]'));
  dom.window.close();
});

test("botão ASSINAR NA TELA responde ao toque sem arraste no celular", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{
      id: "signature-first-touch",
      role: "assistant",
      type: "text",
      text: "DOCUMENTO RECEBIDO. AGORA ENVIE UMA FOTO OU IMAGEM DA ASSINATURA.",
    }],
  }));

  const button = root.querySelector('[data-action="open-signature-pad"]');
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
  })) Object.defineProperty(pointerDown, key, { value, configurable: true });
  button.dispatchEvent(pointerDown);

  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerType: "touch", isPrimary: true, button: 0, buttons: 0 })) {
    Object.defineProperty(pointerUp, key, { value, configurable: true });
  }
  button.dispatchEvent(pointerUp);

  assert.ok(root.querySelector('[data-role="signature-pad"]'));
  view.destroy();
  dom.window.close();
});

test("assinatura desenhada preserva o PDF escolhido na bandeja", () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const pixels = new Uint8ClampedArray(900 * 360 * 4);
  pixels[3] = 255;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
    getImageData: () => ({ data: pixels }), putImageData() {}, drawImage() {},
  });
  dom.window.HTMLCanvasElement.prototype.toBlob = callback => callback(new Blob(["png"], { type: "image/png" }));
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const captured = [];
  view.on("signature-captured", command => captured.push(command));
  view.render(signedInState({
    activeFlow: { id: "task", title: "ADICIONAR UMA NOVA TAREFA" },
    attachments: [{ id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 2300 }],
  }));

  root.querySelector('[data-action="open-signature-pad"]').click();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 120 });
  const down = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ clientX: 20, clientY: 20, pointerId: 1, pointerType: "touch", button: 0, buttons: 1, isPrimary: true })) {
    Object.defineProperty(down, key, { value, configurable: true });
  }
  canvas.dispatchEvent(down);
  root.querySelector('[data-action="confirm-signature-pad"]').click();

  assert.equal(captured.length, 1);
  assert.equal(captured[0].fileId, "report");
  assert.equal(captured[0].file.name, "assinatura-desenhada.png");
  view.destroy();
  dom.window.close();
});

test("exporta a assinatura redesenhando o traço em alta resolução e preto opaco", () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  dom.window.PointerEvent = dom.window.Event;
  const outputContexts = [];

  dom.window.HTMLCanvasElement.prototype.getContext = function getContext() {
    if (this.getAttribute?.("data-role") === "signature-pad") {
      return {
        clearRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {},
        getImageData: () => {
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          for (let y = 30; y <= 90; y += 1) {
            for (let x = 60; x <= 240; x += 1) {
              const offset = (y * this.width + x) * 4;
              data[offset] = 16;
              data[offset + 1] = 47;
              data[offset + 2] = 59;
              data[offset + 3] = 255;
            }
          }
          return { data };
        },
        putImageData() {},
      };
    }

    const outputCalls = [];
    const outputContext = {
      calls: outputCalls,
      clearRect() {},
      beginPath: () => outputCalls.push(["beginPath"]),
      arc: (...args) => outputCalls.push(["arc", ...args]),
      fill: () => outputCalls.push(["fill"]),
      moveTo: (...args) => outputCalls.push(["moveTo", ...args]),
      lineTo: (...args) => outputCalls.push(["lineTo", ...args]),
      stroke: () => outputCalls.push(["stroke"]),
      drawImage: (...args) => outputCalls.push(["drawImage", ...args]),
    };
    outputContexts.push(outputContext);
    return outputContext;
  };
  dom.window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
    callback(new Blob(["png"], { type: "image/png" }));
  };

  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "document_signing", title: "✍️ ASSINAR DOCUMENTOS" },
    messages: [{ id: "signature-quality", role: "assistant", type: "text", text: "Envie a assinatura." }],
  }));
  view.openSignaturePad();
  const canvas = root.querySelector('[data-role="signature-pad"]');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 120 });
  const pointer = (type, clientX, clientY, buttons = 1) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX, clientY, pointerId: 1, pointerType: "touch", button: 0, buttons, isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  canvas.dispatchEvent(pointer("pointerdown", 60, 30));
  dom.window.document.dispatchEvent(pointer("pointermove", 240, 90));
  dom.window.document.dispatchEvent(pointer("pointerup", 240, 90, 0));
  assert.equal(canvas.dataset.ink, "true", "o gesto de teste deve registrar tinta antes da exportação");
  root.querySelector('[data-action="confirm-signature-pad"]').click();

  assert.ok(outputContexts.length, "a confirmação deve consultar um canvas de exportação");
  const outputContext = outputContexts.find(context => context.calls.some(call => ["stroke", "fill", "drawImage"].includes(call[0])));
  assert.ok(outputContext, "a exportação deve criar um canvas próprio");
  assert.equal(outputContext.strokeStyle, "#000000");
  assert.ok(outputContext.lineWidth >= 25, "o traço deve ser redesenhado na escala final, não ampliado como bitmap");
  assert.ok(outputContext.calls.some(call => ["stroke", "fill"].includes(call[0])));
  assert.equal(outputContext.calls.some(call => call[0] === "drawImage"), false, "o bitmap da tela não deve ser interpolado");
  view.destroy();
  dom.window.close();
});

test("anexos novos e existentes ficam visualmente identificados na bandeja", () => {
  const markup = renderChatMarkup(signedInState({ attachments: [
    { id: "old", fileName: "nota-existente.pdf", size: 1200, mediaUrl: "/api/portal-media/old", existing: true, readOnly: true },
    { id: "new", fileName: "comprovante-novo.pdf", size: 2400, mediaUrl: "/api/portal-media/new" },
  ] }));
  assert.match(markup, /data-attachment-origin="existing"/);
  assert.match(markup, /data-attachment-origin="new"/);
  assert.match(markup, /chat-attachment-badge--existing">JÁ EXISTIA/);
  assert.match(markup, /chat-attachment-badge--new">NOVO/);
  assert.doesNotMatch(markup, /data-file-id="old"[^>]*aria-label="Comprimir/);
  assert.doesNotMatch(markup, /data-file-id="old"[^>]*aria-label="Excluir/);
  assert.match(markup, /data-action="compress-attachment" data-file-id="new"/);
  assert.match(markup, /data-action="remove-attachment" data-file-id="new"/);
});

test("cada anexo da bandeja encaminha somente o arquivo tocado", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const shared = [];
  const opened = [];
  view.on("share-attachment", command => shared.push(command.fileId));
  view.on("open-file", command => opened.push(command.fileId));
  view.render(signedInState({ attachments: [
    { id: "old", fileName: "foto antiga.jpg", size: 20, existing: true, readOnly: true },
    { id: "new", fileName: "foto nova.jpg", size: 30 },
  ] }));

  const shareButtons = [...root.querySelectorAll('[data-action="share-attachment"]')];
  assert.equal(shareButtons.length, 2);
  assert.equal(shareButtons[0].getAttribute("aria-label"), "Encaminhar foto antiga.jpg");
  assert.equal(shareButtons[1].getAttribute("aria-label"), "Encaminhar foto nova.jpg");
  shareButtons[1].click();
  assert.deepEqual(shared, ["new"]);
  assert.deepEqual(opened, []);
  view.destroy();
  dom.window.close();
});

test("bandeja de anexos mostra transferir somente durante um fluxo ativo", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { title: "EFETUAR LANÇAMENTO" },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.match(markup, /data-action="transfer-attachments"/);
  assert.match(markup, />TRANSFERIR</);
  const menuMarkup = renderChatMarkup(signedInState({
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.doesNotMatch(menuMarkup, /data-action="transfer-attachments"/);
});

test("bandeja de anexos oferece eliminar todos para anexos novos e preserva os existentes", () => {
  const creationMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "NOVO LANÇAMENTO", allowBulkAttachmentDelete: true },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20 }],
  }));
  assert.match(creationMarkup, /data-action="delete-all-attachments"/);
  assert.match(creationMarkup, />ELIMINAR</);
  assert.match(creationMarkup, /class="chat-attachments-danger-cluster"><button class="chat-attachments-delete-all"/);
  assert.ok(creationMarkup.indexOf('data-action="delete-all-attachments"')
    < creationMarkup.indexOf('data-action="transfer-attachments"'));

  const editMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "EDITAR DIÁRIO", allowBulkAttachmentDelete: true },
    attachments: [{ id: "vm-1", fileName: "foto.jpg", size: 20, existing: true, readOnly: true }],
  }));
  assert.doesNotMatch(editMarkup, /data-action="delete-all-attachments"/);
  assert.doesNotMatch(editMarkup, />ELIMINAR</);
  assert.doesNotMatch(editMarkup, /chat-attachments-danger-cluster/);

  const editWithNewMarkup = renderChatMarkup(signedInState({
    activeFlow: { title: "EDITAR DIÁRIO", allowBulkAttachmentDelete: true },
    attachments: [
      { id: "old", fileName: "foto-existente.jpg", size: 20, existing: true, readOnly: true },
      { id: "new", fileName: "foto-nova.jpg", size: 20 },
    ],
  }));
  assert.match(editWithNewMarkup, /data-action="delete-all-attachments"/);
});

test("toque no título da bandeja não usa um botão atingido por coordenada defasada", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("remove-attachment", command => commands.push(command));
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));

  root.querySelector(".chat-attachments").open = true;
  const summary = root.querySelector(".chat-attachments > summary");
  const deleteButton = root.querySelector('[data-action="remove-attachment"]');
  assert.ok(summary);
  assert.ok(deleteButton);
  // Reproduz a coordenada stale do WebView: o alvo real é o summary, mas
  // elementFromPoint informa um botão que está dentro da bandeja.
  root.ownerDocument.elementFromPoint = () => deleteButton;
  const pointer = (type, buttons) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      clientX: 20,
      clientY: 20,
      pointerId: 7,
      pointerType: "touch",
      buttons,
      isPrimary: true,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  summary.dispatchEvent(pointer("pointerdown", 1));
  const pointerUp = pointer("pointerup", 0);
  summary.dispatchEvent(pointerUp);

  assert.equal(pointerUp.defaultPrevented, false);
  assert.deepEqual(commands, []);
  summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  assert.equal(root.querySelector(".chat-attachments").open, false);
  assert.deepEqual(commands, []);
  view.destroy();
  dom.window.close();
});

test("título da bandeja fecha e reabre anexos mesmo sem alternância nativa do WebView", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  const commands = [];
  view.on("remove-attachment", command => commands.push(command));
  view.render(state);
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  // Um WebView pode suprimir o comportamento padrão do <summary> depois do
  // toque. A ação do título precisa funcionar independentemente dele.
  root.addEventListener("click", event => {
    if (event.target.closest(".chat-attachments > summary")) event.preventDefault();
  }, { capture: true });

  details.querySelector("summary > span").click();
  assert.equal(details.open, false);
  view.render(state);
  assert.equal(root.querySelector(".chat-attachments").open, false);
  root.querySelector(".chat-attachments > summary > span").click();
  assert.equal(root.querySelector(".chat-attachments").open, true);
  assert.deepEqual(commands, []);
  view.destroy();
  dom.window.close();
});

test("fechar a bandeja persiste se a conversa renderizar entre o toque e o clique", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  view.render(state);
  const oldDetails = root.querySelector(".chat-attachments");
  const oldSummary = oldDetails.querySelector("summary");
  oldDetails.open = true;

  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 17,
      pointerType: "touch",
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    })) Object.defineProperty(event, key, { value, configurable: true });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", oldSummary);
  view.render({ ...state, messages: [{ id: "refresh", role: "assistant", type: "text", text: "Atualizado" }] });
  const currentDetails = root.querySelector(".chat-attachments");
  assert.equal(currentDetails.open, false, "a intenção de fechar deve sobreviver à recriação do DOM");

  pointer("pointerup", root);
  oldSummary.click();
  assert.equal(root.querySelector(".chat-attachments").open, false);

  const closedSummary = root.querySelector(".chat-attachments > summary");
  pointer("pointerdown", closedSummary);
  view.render({ ...state, messages: [{ id: "refresh-2", role: "assistant", type: "text", text: "Atualizado novamente" }] });
  const reopenedDetails = root.querySelector(".chat-attachments");
  assert.equal(reopenedDetails.open, true, "a intenção de abrir também deve sobreviver à recriação do DOM");
  pointer("pointerup", root);
  closedSummary.click();
  assert.equal(root.querySelector(".chat-attachments").open, true);

  const summaryBeforeDelayedRender = root.querySelector(".chat-attachments > summary");
  pointer("pointerdown", summaryBeforeDelayedRender);
  pointer("pointerup", root);
  view.render({ ...state, messages: [{ id: "refresh-3", role: "assistant", type: "text", text: "Atualização após soltar" }] });
  assert.equal(root.querySelector(".chat-attachments").open, false, "um render após o toque não pode restaurar o estado anterior");
  summaryBeforeDelayedRender.click();
  assert.equal(root.querySelector(".chat-attachments").open, false);

  view.destroy();
  dom.window.close();
});

test("arrastar o título da bandeja para rolar não altera o estado aberto", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  view.render(state);
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointer = (type, target, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 23,
      pointerType: "touch",
      isPrimary: true,
      clientX: 20,
      clientY,
    })) Object.defineProperty(event, key, { value, configurable: true });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", summary, 20);
  pointer("pointermove", root, 50);
  view.render({ ...state, messages: [{ id: "refresh", role: "assistant", type: "text", text: "Atualizado" }] });
  assert.equal(root.querySelector(".chat-attachments").open, true);
  pointer("pointerup", root, 50);
  root.querySelector(".chat-attachments > summary").click();
  assert.equal(root.querySelector(".chat-attachments").open, true);

  view.destroy();
  dom.window.close();
});

test("clique sintético redirecionado após fechar a bandeja não aciona um botão", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const removed = [];
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  view.on("remove-attachment", command => removed.push(command.fileId));
  view.render(state);
  root.querySelector(".chat-attachments").open = true;
  const oldSummary = root.querySelector(".chat-attachments > summary");
  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 29,
      pointerType: "touch",
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    })) Object.defineProperty(event, key, { value, configurable: true });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", oldSummary);
  pointer("pointerup", root);
  view.render({ ...state, messages: [{ id: "refresh", role: "assistant", type: "text", text: "Atualizado" }] });
  const retargetedButton = root.querySelector('[data-action="remove-attachment"]');
  retargetedButton.click();

  assert.deepEqual(removed, [], "o clique atrasado não pode executar o botão encontrado na DOM nova");
  assert.equal(root.querySelector(".chat-attachments").open, false);

  root.querySelector(".chat-attachments").open = true;
  const nextSummary = root.querySelector(".chat-attachments > summary");
  pointer("pointerdown", nextSummary);
  pointer("pointerup", root);
  view.render({ ...state, messages: [{ id: "refresh-2", role: "assistant", type: "text", text: "Atualizado novamente" }] });
  root.querySelector('[data-action="remove-attachment"]').dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: 1,
    clientX: 20,
    clientY: 20,
  }));
  assert.deepEqual(removed, [], "o clique físico redirecionado também deve ser consumido");

  view.destroy();
  dom.window.close();
});

test("touchend do segundo dedo não encerra o gesto de rolagem da bandeja", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  view.render(state);
  root.querySelector(".chat-attachments").open = true;
  const summary = root.querySelector(".chat-attachments > summary");
  const firstFinger = { identifier: 41, clientX: 20, clientY: 20 };
  const secondFinger = { identifier: 42, clientX: 30, clientY: 20 };
  const touch = (type, target, touches, changedTouches) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: touches },
      changedTouches: { value: changedTouches },
    });
    target.dispatchEvent(event);
  };

  touch("touchstart", summary, [firstFinger], [firstFinger]);
  touch("touchstart", summary, [firstFinger, secondFinger], [secondFinger]);
  touch("touchend", root, [firstFinger], [secondFinger]);
  assert.equal(root.querySelector(".chat-attachments").open, true, "soltar o dedo secundário não deve fechar a bandeja");

  const movedFirstFinger = { ...firstFinger, clientY: 50 };
  touch("touchmove", root, [movedFirstFinger], [movedFirstFinger]);
  view.render({ ...state, messages: [{ id: "refresh", role: "assistant", type: "text", text: "Atualizado" }] });
  touch("touchend", root, [], [movedFirstFinger]);
  assert.equal(root.querySelector(".chat-attachments").open, true, "a rolagem do primeiro dedo deve preservar a bandeja aberta");

  view.destroy();
  dom.window.close();
});

test("remover a bandeja durante o toque ainda consome o clique redirecionado", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  });
  const captured = [];
  view.on("capture-photo", command => captured.push(command));
  view.render(state);
  const summary = root.querySelector(".chat-attachments > summary");
  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 47,
      pointerType: "touch",
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    })) Object.defineProperty(event, key, { value, configurable: true });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", summary);
  view.render({ ...state, attachments: [], messages: [{ id: "refresh", role: "assistant", type: "text", text: "Atualizado" }] });
  assert.equal(root.querySelector(".chat-attachments"), null);
  pointer("pointerup", root);
  root.querySelector('[data-action="capture-photo"]').click();

  assert.deepEqual(captured, [], "o clique atrasado não pode cair no botão de câmera da nova tela");
  view.destroy();
  dom.window.close();
});

test("clique direito ou do meio não alterna a bandeja de anexos", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointer = (type, target, button) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 59,
      pointerType: "mouse",
      isPrimary: true,
      button,
      clientX: 20,
      clientY: 20,
    })) Object.defineProperty(event, key, { value, configurable: true });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", summary, 2);
  pointer("pointerup", root, 2);
  assert.equal(root.querySelector(".chat-attachments").open, true, "o botão secundário não deve iniciar alternância");
  for (const button of [1, 2]) {
    summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button, detail: 1 }));
    assert.equal(root.querySelector(".chat-attachments").open, true, `o clique do botão ${button} não deve alternar a bandeja`);
  }

  view.destroy();
  dom.window.close();
});

test("arquivo pendente também pode ser visualizado sem reenviar", () => {
  const markup = renderChatMarkup(signedInState({ pendingFiles: [
    { id: "pending-1", file: { name: "planta.pdf", size: 40 }, status: "pending" },
  ] }));
  assert.match(markup, /data-action="open-file" data-file-id="pending-1"/);
});

test("arquivo recém-selecionado também oferece encaminhamento individual", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const shared = [];
  view.on("share-attachment", command => shared.push(command.fileId));
  view.render(signedInState({ pendingFiles: [
    { id: "pending-1", file: { name: "projeto.jpg", size: 42 }, status: "pending" },
  ] }));

  const button = root.querySelector('.pending-file [data-action="share-attachment"]');
  assert.equal(button?.getAttribute("aria-label"), "Encaminhar projeto.jpg");
  button.click();
  assert.deepEqual(shared, ["pending-1"]);
  view.destroy();
  dom.window.close();
});
