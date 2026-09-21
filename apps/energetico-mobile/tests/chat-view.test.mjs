import test from "node:test";
import assert from "node:assert/strict";

import { commandFromTarget, createChatView, renderChatMarkup, signaturePointFromEvent } from "../src/ui/chat-view.js";
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
  assert.match(pad, /data-action="confirm-signature-pad"/);
  assert.match(pad, /fundo branco será removido/);
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
  assert.match(markup, /Toque no PDF|arraste a assinatura/i);
  assert.match(markup, /todas as páginas/i);
  assert.doesNotMatch(markup, /signature-placement-page-button/);
  assert.match(markup, /data-action="signature-placement-edit"[^>]*>✍️ Editar assinatura</);
  assert.match(markup, /data-action="signature-placement-shrink"/);
  assert.match(markup, /data-action="signature-placement-grow"/);
  assert.match(markup, /data-action="signature-placement-confirm"[^>]*>✅ Continuar</);
  assert.doesNotMatch(markup, /signature-placement-scope/);
  assert.doesNotMatch(markup, /TODAS AS PÁGINAS/);
  assert.match(markup, /data-role="signature-placement-scale">50%<\/strong>/);
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

test("remonta a prévia quando uma atualização do chat substitui o contêiner do mesmo PDF", () => {
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
  assert.ok(root.querySelector(".signature-placement-pdf"));
  view.render({ ...state, error: "Atualização transitória" });
  assert.ok(root.querySelector(".signature-placement-pdf"), "o novo contêiner deve receber novamente o visualizador");
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

test("mantém a faixa de navegação em telas internas sem enquete", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "attachments", title: "ADICIONAR ANEXOS" },
    messages: [{ id: "status", role: "assistant", type: "text", text: "Anexo recebido." }],
  }));

  assert.match(markup, /class="chat-flow-navigation"/);
  assert.match(markup, /data-reply-id="navigation_back"[^>]*>↩️</);
  assert.match(markup, /data-reply-id="navigation_main_menu"[^>]*>🏠</);
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
  assert.match(markup, /data-action="compress-attachment" data-file-id="vm-1"/);
  assert.ok(markup.indexOf('data-action="compress-attachment"') < markup.indexOf('data-action="remove-attachment"'));
  assert.match(markup, /aria-label="Excluir anexo: foto &lt;teste&gt;\.jpg"/);
  assert.match(markup, /class="chat-attachment-cluster"/);
  assert.match(markup, /foto &lt;teste&gt;\.jpg/);
  assert.doesNotMatch(markup, /src="\/api\/portal-media/);
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

test("arquivo pendente também pode ser visualizado sem reenviar", () => {
  const markup = renderChatMarkup(signedInState({ pendingFiles: [
    { id: "pending-1", file: { name: "planta.pdf", size: 40 }, status: "pending" },
  ] }));
  assert.match(markup, /data-action="open-file" data-file-id="pending-1"/);
});
