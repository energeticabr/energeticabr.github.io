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
import { createPowerBiDashboardView, POWERBI_REPORT_ID } from "../src/ui/powerbi-dashboard-view.js";
import { buildRhidAttendanceTable } from "../src/chat/rhid-attendance-table.js";
import { createConversationStore } from "../src/chat/conversation-store.js";
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

test("mascotes comerciais ficam em uma faixa externa antes do cartão e preservam suas ações", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const menu = { id: 'commercial-top-home', role: 'assistant', type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', label: 'PENDÊNCIAS' },
    { id: 'group_supplies', label: 'SUPRIMENTOS' },
  ] };
  const actions = ['open-commercial-receipts', 'open-commercial-milestones', 'open-commercial-documents', 'open-sac-pathologies'];
  const opened = [], selected = [];
  actions.forEach(action => view.on(action, () => opened.push(action)));
  view.on('select-reply', event => selected.push(event));
  view.render(signedInState({ messages: [menu] }));
  const row = root.querySelector('nav[aria-label="Relatórios comerciais"]');
  assert.ok(row, 'os quatro mascotes laranja precisam de uma faixa própria');
  const bubble = root.querySelector('[data-reply-id="group_pending"]').closest('.chat-bubble');
  assert.equal(bubble.contains(row), false);
  assert.equal(row.parentElement, bubble.parentElement);
  assert.ok(row.compareDocumentPosition(bubble) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual([...row.querySelectorAll('button')].map(button => button.dataset.action), actions);
  for (const action of actions) {
    assert.equal(root.querySelectorAll(`[data-action="${action}"]`).length, 1);
    row.querySelector(`[data-action="${action}"] img`).click();
  }
  assert.deepEqual(opened, actions);
  assert.deepEqual(selected, []);
  view.render(signedInState({ messages: [menu], activeText: { id: 'sending' } }));
  for (const button of root.querySelectorAll('nav[aria-label="Relatórios comerciais"] button')) {
    assert.equal(button.disabled, true);
    button.click();
  }
  assert.deepEqual(opened, actions, 'cliques durante processamento não abrem relatórios');
  view.render(signedInState({ messages: [menu, { id: 'next', role: 'assistant', type: 'poll', question: 'ESCOLHA', options: [{ id: 'next', label: 'Próximo' }] }] }));
  assert.equal(root.querySelector('nav[aria-label="Relatórios comerciais"]'), null);
  view.render(signedInState({ messages: [menu], activeFlow: { id: 'new-flow' } }));
  assert.equal(root.querySelector('nav[aria-label="Relatórios comerciais"]'), null);
});

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

test("atalho do mascote fica fora do cartão e abre provisões sem selecionar Pendências", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const opened = [], selected = [];
  view.on('open-pending-provisions', event => opened.push(event));
  view.on('select-reply', event => selected.push(event));
  const menu = { id: 'home-shortcut', role: 'assistant', type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', reply: 'group_pending', label: '⏳ PENDÊNCIAS (47)', tone: 'danger' },
    { id: 'group_supplies', reply: 'group_supplies', label: '📦 SUPRIMENTOS' },
  ] };
  view.render(signedInState({ messages: [menu] }));
  const cargos = root.querySelector('[data-action="open-cargos-table"]');
  assert.ok(cargos);let cargosOpened=0;view.on('open-cargos-table',()=>cargosOpened++);cargos.click();assert.equal(cargosOpened,1);assert.equal(cargos.closest('.chat-bubble'),null);
  const shortcut = root.querySelector('[data-action="open-pending-provisions"]');
  assert.ok(shortcut, 'o menu inicial precisa oferecer o atalho');
  assert.match(shortcut.getAttribute('aria-label'), /provisões.*pagamento.*pendentes/i);
  assert.ok(shortcut.querySelector('img[alt="Mascote Energético"]'));
  const pending = root.querySelector('[data-reply-id="group_pending"]');
  const bubble = pending.closest('.chat-bubble');
  assert.equal(bubble.contains(shortcut), false, 'o mascote não ocupa a coluna dos botões');
  const paymentShortcut = root.querySelector('[data-action="open-payment-ledger"]');
  const provisionReport = root.querySelector('[data-action="open-provision-report"]');
  assert.ok(provisionReport, 'o segundo mascote abre o relatório de provisões');
  assert.equal(shortcut.nextElementSibling, provisionReport);
  assert.equal(provisionReport.nextElementSibling, paymentShortcut);
  assert.equal(bubble.contains(provisionReport), false);
  assert.notEqual(provisionReport.querySelector('img').src, shortcut.querySelector('img').src);
  let provisionReportOpened=0; view.on('open-provision-report',()=>provisionReportOpened++);
  provisionReport.querySelector('img').click();
  assert.equal(provisionReportOpened,1);
  const managementShortcut = root.querySelector('[data-action="open-management-report"]');
  assert.ok(managementShortcut, 'resumo gerencial deve ter seu próprio mascote');
  assert.equal(paymentShortcut.nextElementSibling, managementShortcut);
  const validationShortcut=root.querySelector('[data-action="open-order-validation-report"]');
  assert.ok(validationShortcut,'validação de notas deve ser o quinto mascote');
  assert.equal(managementShortcut.nextElementSibling, validationShortcut);
  const quotationShortcut=root.querySelector('[data-action="open-quotation-report"]');
  assert.equal(validationShortcut.nextElementSibling, quotationShortcut);
  const depreciationShortcut=root.querySelector('[data-action="open-depreciation-report"]');
  assert.equal(quotationShortcut.nextElementSibling, depreciationShortcut);
  const documentControlShortcut=root.querySelector('[data-action="open-document-control-report"]');
  assert.equal(depreciationShortcut.nextElementSibling, documentControlShortcut);
  const taskAssociationShortcut=root.querySelector('[data-action="open-task-association-report"]');
  assert.equal(documentControlShortcut.nextElementSibling,taskAssociationShortcut);
  const delegatedDeadlineShortcut=root.querySelector('[data-action="open-delegated-deadline-report"]');
  assert.equal(taskAssociationShortcut.nextElementSibling,delegatedDeadlineShortcut);
  assert.equal(delegatedDeadlineShortcut.nextElementSibling,bubble);
  assert.equal(bubble.contains(delegatedDeadlineShortcut),false);
  assert.equal(bubble.contains(validationShortcut),false);
  assert.notEqual(validationShortcut.querySelector('img').src,paymentShortcut.querySelector('img').src);
  let validationOpened=0;view.on('open-order-validation-report',()=>validationOpened++);
  validationShortcut.querySelector('img').click();assert.equal(validationOpened,1);
  assert.equal(bubble.contains(managementShortcut), false);
  let managementOpened=0; view.on('open-management-report',()=>managementOpened++);
  managementShortcut.querySelector('img').click();
  assert.equal(managementOpened,1);
  assert.equal(bubble.contains(paymentShortcut), false);
  assert.equal(shortcut.parentElement, bubble.parentElement);
  assert.match(pending.textContent, /PENDÊNCIAS \(47\)/);
  assert.ok(pending.classList.contains('chat-choice-button--danger'));
  shortcut.querySelector('img').click();
  assert.equal(opened.length, 1);
  assert.equal(selected.length, 0);
  pending.click();
  assert.equal(selected[0].replyId, 'group_pending');
});

test("atalho das provisões não aparece em submenus nem em menus antigos e desativa durante leitura", () => {
  const menu = { id: 'home-shortcut', role: 'assistant', type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', label: 'PENDÊNCIAS' },
  ] };
  for (const state of [
    { messages: [{ ...menu, question: 'PENDÊNCIAS — ESCOLHA O TIPO' }] },
    { messages: [menu, { id: 'later', role: 'assistant', type: 'poll', question: 'ESCOLHA', options: [{ id: 'next', label: 'Próximo' }] }] },
  ]) {
    const dom = new JSDOM(renderChatMarkup(signedInState(state)));
    assert.equal(dom.window.document.querySelector('[data-action="open-pending-provisions"]'), null);
    dom.window.close();
  }
  for (const busy of [{ pendingProvisionOpening: true }, { activeText: { id: 'sending' } }]) {
    const dom = new JSDOM(renderChatMarkup(signedInState({ messages: [menu], ...busy })));
    const shortcut = dom.window.document.querySelector('[data-action="open-pending-provisions"]');
    assert.ok(shortcut);
    assert.equal(shortcut.disabled, true);
    dom.window.close();
  }
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

test("bloqueia o compositor enquanto a conversa precisa ser sincronizada com a VM", () => {
  const markup = renderChatMarkup(signedInState({ recoveryUncertain: true, draft: "EM BRANCO" }));

  assert.match(markup, /<textarea[^>]*disabled/);
  assert.match(markup, /data-action="send-text"[^>]*disabled/);
  assert.match(markup, /Aguardando sincronização com a VM/);
});

test("desativa e reativa os campos do compositor conforme a sincronização", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);

  view.render(signedInState({ recoveryUncertain: true, draft: "EM BRANCO" }));
  assert.equal(root.querySelector('[data-role="draft"]').disabled, true);
  assert.equal(root.querySelector('[data-action="send-text"]').disabled, true);
  view.render(signedInState());
  assert.equal(root.querySelector('[data-role="draft"]').disabled, false);
  assert.equal(root.querySelector('[data-action="send-text"]').disabled, true);

  view.destroy();
  dom.window.close();
});

test("microfone aparece acima de Enviar somente ao preencher diário de obras", () => {
  const activeMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));
  const activeVoice = activeMarkup.indexOf('data-role="voice-input"');
  const activeSend = activeMarkup.indexOf('data-action="send-text"');

  assert.ok(activeVoice >= 0, "o fluxo de preenchimento deve oferecer transcrição");
  assert.ok(activeVoice < activeSend, "o microfone deve ficar antes/acima do envio");
  assert.match(activeMarkup, /Segurar para transcrever áudio/);

  const createMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "construction_diary_create", title: "COMEÇAR DIÁRIO DE OBRAS" },
  }));
  assert.match(createMarkup, /data-role="voice-input"/);
  assert.doesNotMatch(createMarkup, /data-role="voice-input"[^>]*hidden/);
  assert.ok(createMarkup.indexOf('data-role="voice-input"') < createMarkup.indexOf('data-action="send-text"'));

  const inactiveMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "construction_diary_other", title: "OUTRA ETAPA" },
  }));
  assert.match(inactiveMarkup, /data-role="voice-input"[^>]*hidden/);
});

test("microfone aparece em perguntas de texto livre e fica oculto em campos estruturados", () => {
  const textMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "construction_task", title: "TAREFAS" },
    messages: [{ role: "assistant", type: "poll", question: "INFORME AS OBSERVAÇÕES DA EXECUÇÃO", options: [] }],
  }));
  assert.match(textMarkup, /data-role="voice-input"(?![^>]*hidden)/);

  const dateMarkup = renderChatMarkup(signedInState({
    activeFlow: { id: "construction_task", title: "TAREFAS" },
    messages: [{ role: "assistant", type: "poll", question: "INFORME A DATA DA EXECUÇÃO", options: [] }],
  }));
  assert.match(dateMarkup, /data-role="voice-input"[^>]*hidden/);
});

test("microfone continua clicável no diário quando a única opção é abandonar o fluxo", () => {
  class Recognition {
    static instances = [];
    constructor() { this.started = 0; Recognition.instances.push(this); }
    start() { this.started += 1; this.onstart?.(); }
    stop() { this.onend?.(); }
  }

  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
    messages: [{
      role: "assistant",
      type: "poll",
      question: "DIGITE AS ATIVIDADES EXECUTADAS",
      options: [{ reply: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" }],
    }],
  }));

  const voice = root.querySelector('[data-role="voice-input"]');
  assert.equal(voice.hidden, false, "ação para abandonar não transforma a pergunta em campo estruturado");
  assert.equal(voice.disabled, false, "microfone deve estar habilitado durante a pergunta de texto");
  voice.click();
  assert.equal(Recognition.instances.length, 1, "o clique deve iniciar a transcrição");
  assert.equal(Recognition.instances[0].started, 1, "o clique deve chamar start no reconhecimento de voz");

  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
    messages: [{
      role: "assistant",
      type: "poll",
      question: "QUAL ATIVIDADE FOI EXECUTADA?",
      options: [
        { reply: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" },
        { reply: "activity_fundacao", label: "FUNDAÇÃO" },
      ],
    }],
  }));
  assert.equal(root.querySelector('[data-role="voice-input"]').hidden, true,
    "a presença de uma resposta real junto à ação auxiliar mantém o microfone oculto");

  view.destroy();
  dom.window.close();
});

test("toque simples no microfone inicia e encerra a transcrição quando o WebView não entrega gesto de pressão", () => {
  class Recognition {
    static instances = [];

    constructor() {
      this.stopped = 0;
      Recognition.instances.push(this);
    }

    start() { this.onstart?.(); }
    stop() { this.stopped += 1; this.onend?.(); }
  }

  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.click();
  assert.equal(Recognition.instances.length, 1);
  assert.equal(voice.classList.contains("voice-input-button--active"), true);
  assert.match(root.querySelector('[data-role="voice-input-status"]').textContent, /toque novamente para parar/i);

  voice.click();
  assert.equal(Recognition.instances[0].stopped, 1);
  assert.equal(voice.classList.contains("voice-input-button--active"), false);
  view.destroy();
  dom.window.close();
});

test("soltar durante a permissão não cancela o microfone no iPhone", async () => {
  class Recognition {
    static instance = null;
    constructor() { Recognition.instance = this; this.stopped = 0; }
    start() { this.onstart?.(); }
    stop() { this.stopped += 1; this.onend?.(); }
  }
  let grantPermission;
  const permission = new Promise(resolve => { grantPermission = resolve; });
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { ensureMicrophonePermission: () => permission });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  grantPermission(true);
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(Recognition.instance, "a captação deve iniciar após a permissão ser concedida");
  assert.equal(voice.classList.contains("voice-input-button--active"), true);
  assert.match(root.querySelector('[data-role="voice-input-status"]').textContent, /toque novamente para parar/i);
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  assert.equal(Recognition.instance.stopped, 1, "outro toque deve encerrar a captação");
  view.destroy();
  dom.window.close();
});

test("microfone permanece selecionável enquanto espera permissão e outro toque cancela", async () => {
  class Recognition {
    static instances = [];
    constructor() { Recognition.instances.push(this); }
    start() { this.onstart?.(); }
  }
  const grants = [];
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, {
    ensureMicrophonePermission: () => new Promise(resolve => { grants.push(resolve); }),
  });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  assert.equal(voice.disabled, false);
  assert.match(voice.getAttribute("aria-label"), /cancelar/i);

  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  grants[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(Recognition.instances.length, 0);
  assert.equal(voice.disabled, false);
  view.destroy();
  dom.window.close();
});

test("eventos pointer e touch do mesmo toque não reiniciam microfone cancelado", async () => {
  class Recognition {
    static instances = [];
    constructor() { Recognition.instances.push(this); }
    start() { this.onstart?.(); }
  }
  const grants = [];
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, {
    ensureMicrophonePermission: () => new Promise(resolve => { grants.push(resolve); }),
  });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));
  const voice = root.querySelector('[data-role="voice-input"]');
  for (let index = 0; index < 2; index += 1) {
    for (const type of ["pointerdown", "touchstart", "pointerup", "touchend"]) {
      voice.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true }));
    }
  }
  assert.equal(grants.length, 1, "o segundo toque deve cancelar, não pedir nova permissão");
  assert.equal(voice.disabled, false);
  grants[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(Recognition.instances.length, 0);
  view.destroy();
  dom.window.close();
});

test("modo de clique permite nova tentativa imediatamente após cancelar", async () => {
  class Recognition { start() {} }
  const grants = [];
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, {
    ensureMicrophonePermission: () => new Promise(resolve => { grants.push(resolve); }),
  });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));
  const voice = root.querySelector('[data-role="voice-input"]');
  voice.click();
  voice.click();
  voice.click();
  assert.equal(grants.length, 2);
  assert.equal(voice.disabled, false);
  view.destroy();
  dom.window.close();
});

test("iPhone com microfone negado orienta ativar em Ajustes e permite tentar novamente", async () => {
  class Recognition { start() {} }
  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperty(dom.window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  let attempts = 0;
  const view = createChatView(root, {
    ensureMicrophonePermission: () => {
      attempts += 1;
      return Promise.reject(new Error("Permissão negada pelo iPhone."));
    },
  });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.click();
  await Promise.resolve();
  await Promise.resolve();

  assert.match(root.querySelector('[data-role="voice-input-status"]').textContent, /Ajustes.*Energético.*Microfone/i);
  assert.equal(voice.disabled, false);
  voice.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 2);
  view.destroy();
  dom.window.close();
});

test("cancelar gesto durante a permissão não inicia a captação depois", async () => {
  class Recognition {
    static instances = [];
    constructor() { Recognition.instances.push(this); }
    start() { this.onstart?.(); }
  }
  let grantPermission;
  const permission = new Promise(resolve => { grantPermission = resolve; });
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { ensureMicrophonePermission: () => permission });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointercancel", { bubbles: true, cancelable: true }));
  grantPermission(true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(Recognition.instances.length, 0);
  assert.equal(voice.classList.contains("voice-input-button--active"), false);
  view.destroy();
  dom.window.close();
});

test("toque no iPhone aguarda o gravador e mostra como parar depois", async () => {
  class Recorder {
    static instance = null;
    constructor(stream) { this.stream = stream; this.stopped = 0; Recorder.instance = this; }
    start() { this.onstart?.(); }
    stop() {
      this.stopped += 1;
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  let grantStream;
  const pendingStream = new Promise(resolve => { grantStream = resolve; });
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => pendingStream },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { transcribeAudio: async () => "Concretagem concluída" });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("touchend", { bubbles: true, cancelable: true }));
  grantStream({ getTracks: () => [{ stop() {} }] });
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(Recorder.instance);
  assert.equal(voice.classList.contains("voice-input-button--active"), true);
  assert.match(root.querySelector('[data-role="voice-input-status"]').textContent, /toque novamente para parar/i);
  voice.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("touchend", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(Recorder.instance.stopped, 1);
  view.destroy();
  dom.window.close();
});

test("captura pendente pode ser cancelada pelo botão sem iniciar gravação", async () => {
  class Recorder {
    static instances = [];
    constructor() { Recorder.instances.push(this); }
    start() {}
  }
  let grantStream;
  let stoppedTracks = 0;
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => new Promise(resolve => { grantStream = resolve; }) },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("touchend", { bubbles: true, cancelable: true }));
  assert.equal(voice.disabled, false);
  voice.dispatchEvent(new dom.window.Event("touchstart", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("touchend", { bubbles: true, cancelable: true }));
  grantStream({ getTracks: () => [{ stop: () => { stoppedTracks += 1; } }] });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(Recorder.instances.length, 0);
  assert.equal(stoppedTracks, 1);
  assert.equal(voice.disabled, false);
  view.destroy();
  dom.window.close();
});

test("segurar e soltar o microfone controla a transcrição no diário de obras", () => {
  class Recognition {
    static instance = null;

    constructor() {
      Recognition.instance = this;
      this.stopped = 0;
    }

    start() { this.onstart?.(); }
    stop() { this.stopped += 1; this.onend?.(); }
    emit(text) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    }
  }

  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const changes = [];
  view.on("draft-changed", event => changes.push(event.value));
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  const voice = root.querySelector('[data-role="voice-input"]');
  const draft = root.querySelector('[data-role="draft"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  Recognition.instance.emit("Concretagem da laje");
  assert.equal(draft.value, "Concretagem da laje");
  assert.equal(voice.classList.contains("voice-input-button--active"), true);

  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  assert.equal(Recognition.instance.stopped, 1);
  assert.equal(voice.classList.contains("voice-input-button--active"), false);
  assert.ok(changes.includes("Concretagem da laje"));
  view.destroy();
  dom.window.close();
});

test("ao soltar o microfone, transforma a transcrição em registro técnico", () => {
  class Recognition {
    static instance = null;

    constructor() {
      Recognition.instance = this;
    }

    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
    emit(text) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    }
  }

  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  const voice = root.querySelector('[data-role="voice-input"]');
  const draft = root.querySelector('[data-role="draft"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  Recognition.instance.emit("Eu fiz a concretagem da laje. Nós usamos 10 sacos de cimento, né.");
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));

  assert.equal(
    draft.value,
    "Execução de concretagem da laje. Utilização de 10 sacos de cimento."
  );
  assert.doesNotMatch(draft.value, /\b(eu|nós|meu|minha|nosso|nossa)\b/i);
  view.destroy();
  dom.window.close();
});

test("última frase entregue após soltar também vira registro técnico", () => {
  class Recognition {
    static instance = null;
    constructor() { Recognition.instance = this; }
    start() { this.onstart?.(); }
    stop() {}
    emit(text) {
      this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    }
  }
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.SpeechRecognition = Recognition;
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  Recognition.instance.emit("Eu fiz a concretagem da laje");
  Recognition.instance.onend?.();

  assert.equal(root.querySelector('[data-role="draft"]').value, "Execução de concretagem da laje.");
  view.destroy();
  dom.window.close();
});

test("WebView nativo grava no microfone somente após o toque e transcreve ao soltar", async () => {
  class Recorder {
    static instance = null;

    constructor(stream) {
      Recorder.instance = this;
      this.stream = stream;
      this.state = "inactive";
    }

    start() {
      this.state = "recording";
      this.onstart?.();
    }

    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }

  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  let streamCalls = 0;
  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => { streamCalls += 1; return stream; } },
  });
  dom.window.MediaRecorder = Recorder;
  const view = createChatView(root, {
    ensureMicrophonePermission: async () => { throw new Error("não deve pedir fora do toque"); },
    transcribeAudio: async file => {
      assert.equal(file.name, "energetico-voice-input.webm");
      return "Execução de concretagem concluída";
    },
  });
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  assert.equal(streamCalls, 0, "a permissão não deve ser solicitada durante a renderização");
  const voice = root.querySelector('[data-role="voice-input"]');
  const draft = root.querySelector('[data-role="draft"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(streamCalls, 1, "o acesso deve acontecer ao pressionar o microfone");
  assert.equal(Recorder.instance.state, "recording");
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(draft.value, "Execução de concretagem concluída.");
  view.destroy();
  dom.window.close();
});

test("Android usa captura pausável e medidor de áudio quando a transcrição está disponível", async () => {
  class Recognition {
    static starts = 0;
    start() { Recognition.starts += 1; }
  }
  class Recorder {
    static instance = null;
    constructor() { Recorder.instance = this; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio"]) }); this.onstop?.(); }
  }
  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperty(dom.window.navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 15)" });
  dom.window.SpeechRecognition = Recognition;
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { transcribeAudio: async () => "Equipe executou a atividade." });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(Recognition.starts, 0, "deve capturar o áudio para exibir waveform e permitir pausa no Android");
  assert.equal(Recorder.instance.state, "recording");
  assert.equal(root.querySelector('[data-role="voice-recording-panel"]').hidden, false);
  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(root.querySelector('[data-role="draft"]').value, "Equipe executou a atividade.");

  view.destroy();
  dom.window.close();
});

test("gesto touch no iPhone trava a gravação mesmo sem eventos Pointer", async () => {
  class Recorder {
    static instance = null;
    constructor() { Recorder.instance = this; this.state = "inactive"; this.stopped = 0; }
    start() { this.state = "recording"; }
    stop() { this.stopped += 1; this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio"]) }); this.onstop?.(); }
  }
  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperty(dom.window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { transcribeAudio: async () => "Execução registrada." });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));
  const voice = root.querySelector('[data-role="voice-input"]');
  const touch = (type, y) => {
    const point = { identifier: 5, clientX: 80, clientY: y };
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === "touchend" ? [] : [point] },
      changedTouches: { value: [point] },
    });
    voice.dispatchEvent(event);
  };

  touch("touchstart", 220);
  await Promise.resolve();
  await Promise.resolve();
  touch("touchmove", 140);
  touch("touchend", 140);
  assert.equal(Recorder.instance.stopped, 0);
  assert.match(root.querySelector('[data-role="voice-recording-status"]').textContent, /travada|mãos livres/i);
  root.querySelector('[data-action="voice-finish"]').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(root.querySelector('[data-role="draft"]').value, "Execução registrada.");

  view.destroy();
  dom.window.close();
});

test("deslizar para cima trava a gravação e os controles pausam, retomam, descartam e transcrevem", async () => {
  class Recorder {
    static instance = null;
    constructor() { Recorder.instance = this; this.state = "inactive"; this.stopped = 0; }
    start() { this.state = "recording"; this.onstart?.(); }
    pause() { this.state = "paused"; this.onpause?.(); }
    resume() { this.state = "recording"; this.onresume?.(); }
    requestData() { this.ondataavailable?.({ data: new Blob(["amostra"], { type: "audio/webm" }) }); }
    stop() {
      this.stopped += 1;
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["fala"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  const root = dom.window.document.querySelector("#app");
  let transcriptions = 0;
  const view = createChatView(root, {
    transcribeAudio: async () => { transcriptions += 1; return "Execução de concretagem concluída"; },
  });
  view.render(signedInState({ activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" } }));

  const voice = root.querySelector('[data-role="voice-input"]');
  const recordingPanel = root.querySelector('[data-role="voice-recording-panel"]');
  assert.equal(recordingPanel.parentElement, root.querySelector('[data-chat-form]'), "o painel deve ocupar a grade toda do compositor, não a coluna estreita do botão Enviar");
  const pointer = (type, y) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 17 },
      pointerType: { value: "touch" },
      clientY: { value: y },
    });
    return event;
  };
  voice.dispatchEvent(pointer("pointerdown", 220));
  await Promise.resolve();
  await Promise.resolve();
  voice.dispatchEvent(pointer("pointermove", 140));
  assert.match(root.querySelector('[data-role="voice-recording-status"]').textContent, /travada|mãos livres/i);

  voice.dispatchEvent(pointer("pointerup", 140));
  assert.equal(Recorder.instance.stopped, 0, "soltar após deslizar para cima deve manter a gravação ativa");
  assert.equal(root.querySelector('[data-role="voice-recording-panel"]').hidden, false);

  root.querySelector('[data-action="voice-pause"]').click();
  assert.equal(Recorder.instance.state, "paused");
  assert.equal(root.querySelector('[data-action="voice-resume"]').hidden, false);
  root.querySelector('[data-action="voice-resume"]').click();
  assert.equal(Recorder.instance.state, "recording");
  root.querySelector('[data-action="voice-finish"]').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(Recorder.instance.stopped, 1);
  assert.equal(transcriptions, 1);
  assert.equal(root.querySelector('[data-role="draft"]').value, "Execução de concretagem concluída.");

  voice.dispatchEvent(pointer("pointerdown", 220));
  await Promise.resolve();
  await Promise.resolve();
  voice.dispatchEvent(pointer("pointermove", 140));
  voice.dispatchEvent(pointer("pointerup", 140));
  root.querySelector('[data-action="voice-discard"]').click();
  assert.equal(transcriptions, 1, "descartar não deve enviar o áudio para transcrição");
  assert.equal(root.querySelector('[data-role="voice-recording-panel"]').hidden, true);

  view.destroy();
  dom.window.close();
});

test("iPhone usa captura de áudio e não confunde falha do ditado com permissão desativada", async () => {
  class Recognition {
    static starts = 0;
    start() { Recognition.starts += 1; this.onstart?.(); }
  }
  class Recorder {
    static instance = null;
    constructor(stream) { Recorder.instance = this; this.stream = stream; }
    start() { this.onstart?.(); }
    stop() {
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }

  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperty(dom.window.navigator, "userAgent", {
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
  dom.window.SpeechRecognition = Recognition;
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, {
    transcribeAudio: async () => "Execução de concretagem concluída",
  });
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  const voice = root.querySelector('[data-role="voice-input"]');
  const draft = root.querySelector('[data-role="draft"]');
  voice.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(Recorder.instance, "o toque deve iniciar captura de áudio no iPhone");
  assert.equal(Recognition.starts, 0, "o ditado do WebView não deve ser usado no iPhone");

  voice.dispatchEvent(new dom.window.Event("pointerup", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(draft.value, "Execução de concretagem concluída.");
  assert.doesNotMatch(root.querySelector('[data-role="voice-input-status"]').textContent, /Microfone desativado/i);
  view.destroy();
  dom.window.close();
});

test("iPadOS com user agent de desktop recebe orientação quando a captura é negada", async () => {
  class Recognition { start() { this.onstart?.(); } }
  class Recorder {
    start() { this.onstart?.(); }
    stop() { this.onstop?.(); }
  }

  const dom = new JSDOM('<main id="app"></main>');
  Object.defineProperty(dom.window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15",
  });
  Object.defineProperty(dom.window.navigator, "platform", { value: "MacIntel" });
  Object.defineProperty(dom.window.navigator, "maxTouchPoints", { value: 5 });
  dom.window.SpeechRecognition = Recognition;
  dom.window.MediaRecorder = Recorder;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => { throw new Error("Permission denied"); } },
  });
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root, { transcribeAudio: async () => "" });
  view.render(signedInState({
    activeFlow: { id: "construction_diary_fill", title: "PREENCHER DIÁRIO DE OBRAS" },
  }));

  root.querySelector('[data-role="voice-input"]').dispatchEvent(
    new dom.window.Event("pointerdown", { bubbles: true, cancelable: true }),
  );
  await Promise.resolve();
  await Promise.resolve();

  assert.match(root.querySelector('[data-role="voice-input-status"]').textContent, /Ajustes.*Energético.*Microfone/i);
  view.destroy();
  dom.window.close();
});

test("inclui o relatório RHID depois de Contrato somente no menu de Recursos Humanos", () => {
  const menu = {
    id: "hr-menu",
    role: "assistant",
    type: "poll",
    question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [
      { id: "hr-attendance", reply: "action_create_supplier_attendance", label: "➕ CRIAR PRESENÇA DE FORNECEDOR" },
      { id: "hr-contract", reply: "action_contract", label: "📑 CONTRATO" },
    ],
  };
  const markup = renderChatMarkup(signedInState({ messages: [menu] }));
  const contract = markup.indexOf('data-reply-id="action_contract"');
  const report = markup.indexOf('data-reply-id="action_rhid_attendance_report"');

  assert.ok(contract >= 0);
  assert.ok(report > contract, "o novo botão deve vir logo após Contrato");
  assert.match(markup, /RELATÓRIO DE PRESENÇAS RHID/);

  const unrelated = renderChatMarkup(signedInState({ messages: [{
    ...menu,
    question: "📦 SUPRIMENTOS\nQUAL FLUXO?",
    options: [{ id: "launch", reply: "action_launch", label: "LANÇAMENTOS" }],
  }] }));
  assert.doesNotMatch(unrelated, /action_rhid_attendance_report/);
});

test("menu RH mostra galerias IDFOLHA e FOLHA PGTO sem depender de opções do backend", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "hr-menu",
      role: "assistant",
      type: "poll",
      question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "action_create_supplier_attendance", reply: "action_create_supplier_attendance", label: "➕ CRIAR PRESENÇA DE FORNECEDOR" },
        { id: "action_contract", reply: "action_contract", label: "📑 CONTRATO" },
      ],
    }],
  }));
  const article = markup.match(/<article class="chat-message chat-message--assistant[^]*?<\/article>/)?.[0] || "";

  assert.match(article, /chat-choice-columns--hr-galleries/);
  assert.match(article, /data-reply-id="action_hr_gallery_idfolha"[^>]*>[^]*?GALERIA IDFOLHA/);
  assert.match(article, /data-reply-id="action_hr_gallery_folhapgto"[^>]*>[^]*?GALERIA FOLHA PGTO/);
  assert.ok(article.indexOf("CONTRATO") < article.indexOf("GALERIA IDFOLHA"));
  assert.ok(article.indexOf("GALERIA IDFOLHA") < article.indexOf("GALERIA FOLHA PGTO"));
});

test("atalho RHID substitui Ver resumo somente no menu de Recursos Humanos e usa a data de hoje", () => {
  const menu = {
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [
      { id: "hr", reply: "action_create_supplier_attendance", label: "CRIAR PRESENÇA" },
      { id: "contract", reply: "action_contract", label: "CONTRATO" },
    ],
  };
  const state = signedInState({ activeFlow: { title: "👥 RECURSOS HUMANOS" }, messages: [menu] });
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const dates = [];
  let refreshes = 0;
  view.on("rhid-attendance-report-today", event => dates.push(event.value));
  view.on("rhid-refresh", () => { refreshes += 1; });
  view.render(state);

  const shortcut = root.querySelector('.chat-flow-status [data-action="rhid-attendance-report-today"]');
  const refresh = root.querySelector('.chat-flow-status [data-action="rhid-refresh"]');
  assert.ok(refresh, "a atualização deve estar no cabeçalho RH");
  assert.ok(refresh.compareDocumentPosition(shortcut) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "ícone antes de RHID");
  assert.match(refresh.getAttribute("aria-label"), /atualizar.*rhid.*sharepoint/i);
  refresh.click();
  assert.equal(refreshes, 1);
  assert.ok(shortcut, "o atalho deve ocupar o lugar de Ver resumo no cabeçalho");
  assert.match(shortcut.textContent, /📊\s*RHID/);
  assert.equal(root.querySelector('.chat-flow-status [data-action="show-summary"]'), null);
  shortcut.click();
  assert.match(dates[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'), null, "o atalho não abre seleção de data");

  view.render(signedInState({ activeFlow: { title: "CONTRATO" }, messages: [{ ...menu, question: "📑 CONTRATO" }] }));
  assert.equal(root.querySelector('.chat-flow-status [data-action="rhid-attendance-report-today"]'), null);
  assert.ok(root.querySelector('.chat-flow-status [data-action="show-summary"]'));
  view.destroy();
  dom.window.close();
});

test("atalho RHID não permanece no cabeçalho após relatório vazio", () => {
  const menu = {
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [{ id: "hr", reply: "action_create_supplier_attendance", label: "CRIAR PRESENÇA" }],
  };
  const emptyReport = {
    id: "rhid-empty", role: "assistant", type: "text",
    text: "📊 RELATÓRIO DE PRESENÇAS RHID — 27/09/2026\nNenhuma presença foi encontrada para esta data.",
  };
  const markup = renderChatMarkup(signedInState({
    activeFlow: { title: "👥 RECURSOS HUMANOS" }, messages: [menu, emptyReport],
  }));
  assert.doesNotMatch(markup, /data-action="rhid-attendance-report-today"/);
  assert.match(markup, /Nenhuma presença foi encontrada/);
});

test("tela do calendário RHID cancela sem enviar e gera com a data escolhida", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const requests = [];
  view.on("rhid-attendance-report-generate", event => requests.push(event.value));
  view.render(signedInState({ messages: [{
    id: "hr-menu",
    role: "assistant",
    type: "poll",
    question: "👥 RECURSOS HUMANOS",
    options: [{ id: "hr", reply: "action_create_supplier_attendance", label: "PRESENÇA" }, { id: "contract", reply: "contract", label: "CONTRATO" }],
  }] }));

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null, "o calendário RHID usa a própria tela, sem camada escura");
  assert.equal(root.querySelector('.chat-transcript .chat-choice-button'), null, "o menu fica oculto enquanto o calendário RHID está aberto");
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog] input[type="date"]'), null, "o calendário RHID não deve abrir seletor nativo");
  assert.ok(root.querySelector('[data-role="rhid-calendar-day"][aria-pressed="true"]'), "a data de hoje deve vir selecionada");
  root.querySelector('[data-action="cancel-rhid-attendance-report"]').click();
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'), null);
  assert.deepEqual(requests, [], "cancelar deve apenas fechar a janela");

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  const selectedDay = root.querySelector('[data-role="rhid-calendar-day"][aria-pressed="true"]');
  const selectedMonth = selectedDay.dataset.value.slice(0, 7);
  root.querySelector(`[data-role="rhid-calendar-day"][data-value="${selectedMonth}-15"]`).click();
  assert.equal(root.querySelector('[data-action="generate-rhid-attendance-report"]')?.dataset.value, `${selectedMonth}-15`, "a confirmação usa a data do calendário visível");
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();
  assert.deepEqual(requests, [`${selectedMonth}-15`]);
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'), null, "o calendário sai da tela durante a consulta");
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null, "nenhuma camada escura permanece sem conteúdo");
  assert.match(root.querySelector('.chat-transcript')?.textContent || "", /Consultando relatório RHID/);
  assert.equal(root.querySelector('.chat-transcript .chat-choice-button'), null, "o menu não substitui a tela de carregamento");
  assert.match(root.querySelector('.chat-progress')?.textContent || "", /Consultando relatório RHID/);
  view.destroy();
  dom.window.close();
});

test("calendário antigo de perguntas não cobre a seleção de data RHID", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ messages: [{ id: "date", role: "assistant", type: "poll",
    question: "Qual é a data de pagamento?", options: [{ id: "today", label: "HOJE" }] }] }));
  root.querySelector('[data-action="open-date-picker"]').click();
  assert.ok(root.querySelector('[data-date-picker-dialog]'));

  view.render(signedInState({ messages: [{ id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS", options: [
      { id: "attendance", reply: "action_validate_attendance", label: "VALIDAR PRESENÇAS" },
      { id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" },
    ] }] }));
  root.querySelector('[data-action="open-rhid-attendance-report"]').click();

  assert.equal(root.querySelector('[data-date-picker-dialog]'), null);
  assert.ok(root.querySelector('[data-rhid-attendance-report-dialog]'));
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null);
  view.destroy();
  dom.window.close();
});

test("toque de iPhone em Gerar relatório envia uma vez a data do calendário RHID visível", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const requested = [];
  view.on("rhid-attendance-report-generate", command => requested.push(command.value));
  view.render(signedInState({ messages: [{ id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS", options: [
      { id: "attendance", reply: "action_validate_attendance", label: "VALIDAR PRESENÇAS" },
      { id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" },
    ] }] }));
  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  const month = root.querySelector('[data-role="rhid-calendar-day"]').dataset.value.slice(0, 7);
  root.querySelector(`[data-role="rhid-calendar-day"][data-value="${month}-18"]`).click();
  const confirm = root.querySelector('[data-action="generate-rhid-attendance-report"]');
  confirm.getBoundingClientRect = () => ({ left: 20, right: 220, top: 500, bottom: 560, width: 200, height: 60 });
  dom.window.document.elementFromPoint = () => confirm;
  const pointer = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ clientX: 100, clientY: 530, pointerId: 21, pointerType: "touch", isPrimary: true }))
      Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };
  confirm.dispatchEvent(pointer("pointerdown"));
  confirm.dispatchEvent(pointer("pointerup"));
  confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.deepEqual(requested, [`${month}-18`]);
  assert.ok(root.querySelector('.chat-rhid-report-loading'));
  assert.equal(root.querySelector('.chat-confirmation-backdrop'), null);
  view.destroy();
  dom.window.close();
});

test("relatório RHID oferece retorno e acesso ao menu principal", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", event => replies.push(event.replyId));
  view.render(signedInState({ messages: [{
    id: "rhid-report",
    role: "assistant",
    type: "poll",
    question: "📊 RELATÓRIO DE PRESENÇAS RHID — 27/09/2026",
    options: [],
    detail_table: { kind: "presence", title: "📋 PRESENÇAS • 27/09/2026", rows: [] },
  }] }));

  const back = root.querySelector('[aria-label="Retornar à pergunta anterior"]');
  const home = root.querySelector('[aria-label="Retornar ao menu inicial"]');
  assert.ok(back, "a página do relatório deve oferecer retorno");
  assert.ok(home, "a página do relatório deve oferecer acesso ao menu principal");
  back.click();
  home.click();

  assert.deepEqual(replies, ["navigation_back", "navigation_main_menu"]);
  view.destroy();
  dom.window.close();
});

test("relatório RHID mostra o horário real de coleta junto da tabela", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-updated", role: "assistant", type: "poll",
    question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", title: "PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
      updateLabel: "ÚLTIMA COLETA DO RHID ÀS 17:12",
    },
  }] }));
  assert.match(markup, /ÚLTIMA COLETA DO RHID ÀS 17:12/);
});

test("relatório RHID oferece compartilhar PDF da própria mensagem", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-share-25",
    role: "assistant",
    type: "poll",
    question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026",
    options: [],
    detail_table: {
      kind: "rhid_attendance",
      reportDate: "2026-09-25",
      title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const button = dom.window.document.querySelector('[data-action="share-rhid-attendance-report"]');

  assert.ok(button, "a tabela deve expor a ação de compartilhar o PDF");
  assert.equal(button.dataset.messageId, "rhid-share-25", "a ação deve identificar exatamente o relatório clicado");
  assert.match(button.getAttribute("aria-label"), /PDF/i);
  dom.window.close();
});

test("fim do dia oferece preencher célula vazia e distingue inclusões e correções pelas cores", () => {
  const table = buildRhidAttendanceTable([
    { Id: 81, ID_PESSOA_RHID: "23", NOME_COLABORADOR: "EDGAR", BATIDAS_RHID: "07:01; 11:59; 13:00; 17:03",
      ADMIN_AJUSTES: { exit2: { time: "17:00", reason: "Relógio conferido", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" } } },
    { Id: 82, ID_PESSOA_RHID: "24", NOME_COLABORADOR: "CLEITON", BATIDAS_RHID: "06:57; 11:57",
      ADMIN_AJUSTES: {
        exit1: { time: "12:00", reason: "Ajuste manual", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" },
        entry2: { time: "13:01", reason: "Esquecimento", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" },
      } },
  ]);
  const markup = renderChatMarkup(signedInState({ messages: [{ id: "rhid-edit", role: "assistant", type: "poll",
    question: "RELATÓRIO RHID", options: [], detail_table: { ...table, reportDate: "2026-09-25" } }] }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll('[data-action="rhid-attendance-adjust-open"]')];
  assert.ok(buttons.some(button => button.dataset.personKey === "rhid:24" && button.dataset.slot === "exit2"), "a saída não batida deve ser selecionável");
  assert.match(buttons.find(button => button.dataset.personKey === "rhid:23" && button.dataset.slot === "exit2")?.className || "", /--corrected/);
  assert.match(buttons.find(button => button.dataset.personKey === "rhid:24" && button.dataset.slot === "exit1")?.className || "", /--corrected/);
  assert.match(buttons.find(button => button.dataset.personKey === "rhid:24" && button.dataset.slot === "entry2")?.className || "", /--added/);
  assert.ok(dom.window.document.querySelector(".chat-rhid-attendance-card--discrepant"));
  dom.window.close();
});

test("dia RHID completo sem incongruência não oferece edição", () => {
  const table = buildRhidAttendanceTable([{ Id: 81, ID_PESSOA_RHID: "23", NOME_COLABORADOR: "EDGAR",
    BATIDAS_RHID: "07:01; 11:59; 13:00; 17:03" }]);
  const markup = renderChatMarkup(signedInState({ messages: [{ id: "rhid-sound", role: "assistant", type: "poll",
    question: "RELATÓRIO RHID", options: [], detail_table: { ...table, reportDate: "2026-09-25" } }] }));
  assert.doesNotMatch(markup, /data-action="rhid-attendance-adjust-open"/);
});

test("tocar em horário corrigido mostra RHID e ajuste e exige motivo para salvar novamente", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const submitted = [];
  view.on("rhid-attendance-adjust-save", event => submitted.push(event));
  const table = buildRhidAttendanceTable([{ Id: 81, ID_PESSOA_RHID: "23", NOME_COLABORADOR: "EDGAR",
    BATIDAS_RHID: "07:01; 11:59; 13:00; 17:03", ADMIN_AJUSTES: {
      exit2: { time: "17:00", reason: "Relógio conferido", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" },
    } }]);
  view.render(signedInState({ messages: [{ id: "rhid-edit", role: "assistant", type: "poll", question: "RELATÓRIO RHID",
    options: [], detail_table: { ...table, reportDate: "2026-09-25" } }] }));
  root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit2"]').click();
  const dialog = root.querySelector("[data-rhid-adjustment-dialog]");
  assert.ok(dialog);
  assert.match(dialog.textContent, /RHID.*17:03/s);
  assert.match(dialog.textContent, /Ajustado.*17:00/s);
  assert.match(dialog.textContent, /Relógio conferido/);
  assert.equal(root.querySelector('[data-role="rhid-adjustment-reason"]').value, "");
  root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.equal(submitted.length, 0);
  assert.match(root.querySelector('[data-rhid-adjustment-dialog] [role="alert"]')?.textContent || "", /justificativa/i);
  root.querySelector('[data-role="rhid-adjustment-reason"]').value = "Correção revisada";
  root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.deepEqual(submitted, [{ type: "rhid-attendance-adjust-save", messageId: "rhid-edit", personKey: "rhid:23", slot: "exit2",
    time: "17:00", reason: "Correção revisada" }]);
  view.destroy();
  dom.window.close();
});

test("correção RHID preserva horário e motivo durante envio e após falha para nova tentativa", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const submitted = [];
  view.on("rhid-attendance-adjust-save", event => submitted.push(event));
  const table = buildRhidAttendanceTable([{ Id: 1, NOME_COLABORADOR: "ANA", BATIDAS_RHID: "08:35;12:03;13:00;17:00" }]);
  view.render(signedInState({ messages: [{ id: "rhid-retry", role: "assistant", type: "poll", question: "RELATÓRIO RHID",
    options: [], detail_table: { ...table, reportDate: "2026-09-25" } }] }));
  root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="entry1"]').click();
  root.querySelector('[data-role="rhid-adjustment-time"]').value = "07:00";
  root.querySelector('[data-role="rhid-adjustment-reason"]').value = "Horário conferido";
  root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, "07:00");
  assert.equal(root.querySelector('[data-role="rhid-adjustment-reason"]').value, "Horário conferido");
  view.setRhidAttendanceAdjustmentStatus({ busy: false, error: "Falha temporária" });
  assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, "07:00");
  assert.equal(root.querySelector('[data-role="rhid-adjustment-reason"]').value, "Horário conferido");
  root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.equal(submitted.length, 2);
  assert.ok(submitted.every(event => event.time === "07:00" && event.reason === "Horário conferido"));
});

test("relatório RHID exibe a ressincronização no próprio cabeçalho", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-inline-refresh",
    role: "assistant",
    type: "poll",
    question: "RELATÓRIO RHID",
    options: [],
    detail_table: {
      kind: "rhid_attendance",
      reportDate: "2026-09-25",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
    },
  }] }), { rhidRefresh: { busy: false, message: "", error: false } });
  const dom = new JSDOM(markup);
  const refresh = dom.window.document.querySelector('.chat-rhid-attendance-report [data-action="rhid-refresh"]');

  assert.ok(refresh, "o relatório deve exibir o botão de ressincronização");
  assert.match(refresh.getAttribute("aria-label"), /atualizar.*rhid.*sharepoint/i);
  assert.match(refresh.className, /chat-rhid-attendance-table__refresh/);
  dom.window.close();
});

test("relatório RHID posiciona ressincronização e PDF no topo, alinhados ao relatório diário", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-top-actions",
    role: "assistant",
    type: "poll",
    question: "RELATÓRIO RHID",
    options: [],
    detail_table: {
      kind: "rhid_attendance",
      reportDate: "2026-09-25",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const report = dom.window.document.querySelector(".chat-rhid-attendance-report");
  const header = report.querySelector(".chat-rhid-attendance-report__header");
  const actions = header.querySelector(".chat-rhid-attendance-report__header-actions");

  assert.ok(actions, "as ações devem ficar no cabeçalho do relatório");
  assert.ok(actions.querySelector('[data-action="rhid-refresh"]'));
  assert.ok(actions.querySelector('[data-action="share-rhid-attendance-report"]'));
  assert.equal(report.querySelector(".chat-rhid-attendance-report__toolbar-actions"), null);
  assert.ok(header.textContent.indexOf("RELATÓRIO DIÁRIO") < header.textContent.indexOf("Compartilhar PDF"));
  dom.window.close();
});

test("não oferece compartilhar RHID quando a data é impossível", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-invalid-date",
    role: "assistant",
    type: "poll",
    question: "📊 RELATÓRIO DE PRESENÇAS RHID — 31/02/2026",
    options: [],
    detail_table: {
      kind: "rhid_attendance",
      reportDate: "2026-02-31",
      title: "📋 PRESENÇAS • 31/02/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
    },
  }] }));
  assert.doesNotMatch(markup, /data-action="share-rhid-attendance-report"/);
});

test("relatório RHID exibe cartões diários com colunas de batidas e total", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-table", role: "assistant", type: "poll", question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [["CLEITON CESAR NONATO", "06:58", "12:01", "12:59", "15:50", "07:54"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const report = dom.window.document.querySelector(".chat-rhid-attendance-report");
  assert.ok(report, "o relatório deve usar o layout diário");
  assert.equal(report.querySelectorAll(".chat-rhid-attendance-card").length, 1);
  assert.deepEqual([...report.querySelectorAll(".chat-rhid-attendance-card__entry, .chat-rhid-attendance-card__exit")].map(cell => cell.textContent),
    ["06:58", "12:01", "12:59", "15:50"]);
  assert.match(report.querySelector(".chat-rhid-attendance-card__total")?.textContent || "", /07:54/);
  assert.equal(report.querySelector("table"), null);
  dom.window.close();
});

test("lacuna RHID abre com horário sugerido para confirmação, inclusive sexta-feira", () => {
  for (const [reportDate, expected] of [["2026-09-28", "17:00"], ["2026-09-25", "16:00"]]) {
    const dom = new JSDOM('<main id="app"></main>');
    const root = dom.window.document.querySelector("#app");
    const view = createChatView(root);
    const submitted = [];
    view.on("rhid-attendance-adjust-save", event => submitted.push(event));
    const table = buildRhidAttendanceTable([{ Id: 90, ID_PESSOA_RHID: "90", NOME_COLABORADOR: "ANA",
      BATIDAS_RHID: "07:00; 12:00; 13:00" }]);
    view.render(signedInState({ messages: [{ id: "rhid-blank", role: "assistant", type: "poll", question: "RELATÓRIO RHID",
      options: [], detail_table: { ...table, reportDate } }] }));
    root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit2"]').click();
    assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, expected);
    assert.equal(root.querySelector('[data-role="rhid-adjustment-reason"]').value, "NÃO APONTADO");
    assert.match(root.querySelector('[data-rhid-adjustment-dialog]').textContent, /Ajustado:\s*não informado/);
    root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    assert.deepEqual(submitted, [{ type: "rhid-attendance-adjust-save", messageId: "rhid-blank",
      personKey: "rhid:90", slot: "exit2", time: expected, reason: "NÃO APONTADO" }]);
    view.destroy();
    dom.window.close();
  }
});

test("justificativa sugerida para lacuna RHID pode ser editada antes de salvar", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const submitted = [];
  view.on("rhid-attendance-adjust-save", event => submitted.push(event));
  const table = buildRhidAttendanceTable([{ Id: 90, ID_PESSOA_RHID: "90", NOME_COLABORADOR: "ANA",
    BATIDAS_RHID: "07:00; 12:00; 13:00", ADMIN_AJUSTES: {
      exit2: { time: "17:00", reason: "Registro anterior", actorName: "Bernardo", adjustedAt: "2026-10-01T03:00:00Z" },
    } }]);
  view.render(signedInState({ messages: [{ id: "rhid-blank-adjusted", role: "assistant", type: "poll",
    question: "RELATÓRIO RHID", options: [], detail_table: { ...table, reportDate: "2026-09-28" } }] }));
  root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit2"]').click();
  const reason = root.querySelector('[data-role="rhid-adjustment-reason"]');
  assert.equal(reason.value, "NÃO APONTADO");
  reason.value = "Ajuste conferido com o colaborador";
  root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.deepEqual(submitted, [{ type: "rhid-attendance-adjust-save", messageId: "rhid-blank-adjusted",
    personKey: "rhid:90", slot: "exit2", time: "17:00", reason: "Ajuste conferido com o colaborador" }]);
  view.destroy();
  dom.window.close();
});

test("gerar relatório RHID libera o modal durante a consulta e restaura o foco após erro", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ messages: [{
    id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS",
    options: [{ id: "hr", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" }],
  }] }));

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  assert.ok(dom.window.document.activeElement.matches('[data-role="rhid-calendar-day"]'));
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();

  assert.equal(
    dom.window.document.activeElement.matches('[data-role="rhid-calendar-day"]'),
    false,
    "a atualização não deve focar novamente um dia pequeno e deslocar a janela no celular",
  );
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'), null, "a janela sai durante a consulta");
  assert.match(root.querySelector('.chat-progress')?.textContent || "", /Consultando relatório RHID/);

  view.setRhidAttendanceReportStatus({ busy: false, error: "Não foi possível consultar o relatório." });
  assert.ok(dom.window.document.activeElement.closest('[data-rhid-attendance-report-dialog]'), "o foco permanece na janela após erro");
  assert.equal(dom.window.document.activeElement.matches('[data-role="rhid-calendar-day"]'), false);
  const selectedMonth = root.querySelector('[data-role="rhid-calendar-day"][aria-pressed="true"]').dataset.value.slice(0, 7);
  view.setRhidAttendanceMonthStatus({ month: selectedMonth, presentDates: [`${selectedMonth}-01`] });
  assert.match(root.querySelector('[data-rhid-attendance-report-dialog] [role="alert"]').textContent, /Não foi possível consultar/);
  assert.ok(dom.window.document.activeElement.closest('[data-rhid-attendance-report-dialog]'), "a resposta mensal tardia não tira o foco da janela");
  assert.equal(dom.window.document.activeElement.matches('[data-role="rhid-calendar-day"]'), false);
  view.destroy();
  dom.window.close();
});

test("consulta RHID em andamento não deixa uma camada escura sem conteúdo no iPhone", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ messages: [{ id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS", options: [
      { id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" },
    ] }], pendingProvisions: { due: true, rows: [
    { id: "306", supplier: "LOCAMÁQUINAS", dueDate: "2026-10-02", total: 140 },
  ] } }));

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();

  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog]'), null,
    "a camada escura do calendário sai enquanto a consulta aguarda a VM");
  assert.equal(root.querySelector('[data-pending-provisions-dialog]'), null);
  assert.match(root.querySelector('.chat-progress')?.textContent || "", /Consultando relatório RHID/i);

  view.setRhidAttendanceReportStatus({ busy: false, error: "A consulta demorou demais. Tente novamente." });
  assert.match(root.querySelector('[data-rhid-attendance-report-dialog] [role="alert"]')?.textContent || "", /demorou demais/);
  view.destroy();
  dom.window.close();
});

test("consulta RHID impede envio de outra resposta enquanto o resultado carrega", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let sent = 0;
  view.on("send-text", () => { sent += 1; });
  view.render(signedInState({ draft: "outra resposta", messages: [{ id: "hr-menu", role: "assistant", type: "poll",
    question: "👥 RECURSOS HUMANOS", options: [
      { id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" },
    ] }] }));

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();

  assert.equal(root.querySelector('[data-action="send-text"]').disabled, true);
  assert.equal(root.querySelector('[data-action="pick-files"]').disabled, true);
  root.querySelector('[data-chat-form]').dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(sent, 0, "o envio pelo teclado também espera o relatório");
  view.destroy();
  dom.window.close();
});

test("gerar relatório RHID não revela aviso de provisões nem deixa o menu anterior no lugar do relatório", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const menu = { id: "hr-menu", role: "assistant", type: "poll", question: "👥 RECURSOS HUMANOS",
    options: [{ id: "rhid", reply: "action_rhid_attendance_report", label: "RELATÓRIO DE PRESENÇAS RHID" }] };
  const pendingProvisions = { due: true, today: "2026-10-01", rows: [{
    id: "306", supplier: "LOCAMÁQUINAS", dueDate: "2026-10-02", total: 140,
  }] };
  const state = signedInState({ messages: [menu], pendingProvisions });
  view.render(state);
  assert.ok(root.querySelector("[data-pending-provisions-dialog]"), "o lembrete permanece disponível na tela anterior");

  root.querySelector('[data-action="open-rhid-attendance-report"]').click();
  assert.ok(root.querySelector("[data-rhid-attendance-report-dialog]"));
  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null,
    "o lembrete não pode disputar a tela com o calendário RHID");

  const table = buildRhidAttendanceTable([{ ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA",
    BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00" }]);
  const report = { id: "rhid-report", role: "assistant", type: "poll", question: "📊 RELATÓRIO DE PRESENÇAS RHID — 01/10/2026",
    options: [], detail_table: { ...table, reportDate: "2026-10-01" } };
  view.render({ ...state, messages: [menu, report] });
  view.closeRhidAttendanceReport();

  assert.ok(root.querySelector(".chat-transcript .chat-rhid-attendance-report"), "o relatório fica visível ao concluir a consulta");
  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null,
    "o lembrete não deve cobrir o relatório gerado");
  assert.equal(root.querySelector('.chat-transcript [data-reply-id="action_rhid_attendance_report"]'), null,
    "o menu anterior não deve ocupar a área do relatório");

  view.render(state);
  assert.ok(root.querySelector("[data-pending-provisions-dialog]"),
    "o lembrete volta a ficar disponível ao sair do relatório sem perder o pagamento");
  view.destroy();
  dom.window.close();
});

test("relatório RHID estruturado continua visível com título alternativo e mensagem posterior", () => {
  const menu = { id: "hr-menu", role: "assistant", type: "poll", question: "👥 RECURSOS HUMANOS", options: [] };
  const report = { id: "rhid-short-title", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: { ...buildRhidAttendanceTable([{ ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA",
      BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00" }]), reportDate: "2026-10-01" } };
  const reply = { id: "reply-after-report", role: "user", type: "text", text: "Conferido" };
  const dom = new JSDOM(renderChatMarkup(signedInState({
    messages: [menu, report, reply],
    pendingProvisions: { due: true, rows: [{ id: "306", dueDate: "2026-10-02" }] },
  })));
  const transcript = dom.window.document.querySelector(".chat-transcript");
  assert.ok(transcript.querySelector(".chat-rhid-attendance-report"));
  assert.match(transcript.textContent, /Conferido/, "a resposta posterior ao relatório continua visível");
  assert.doesNotMatch(transcript.textContent, /RECURSOS HUMANOS/, "o menu anterior não toma o lugar do relatório");
  assert.equal(dom.window.document.querySelector("[data-pending-provisions-dialog]"), null);
  dom.window.close();
});

test("menção textual ao relatório RHID não transforma outra tela em relatório", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    messages: [{ id: "note", role: "assistant", type: "text", text: "Você pode abrir o relatório de presenças RHID pelo menu." }],
    pendingProvisions: { due: true, rows: [{ id: "306", dueDate: "2026-10-02" }] },
  })));
  assert.ok(dom.window.document.querySelector("[data-pending-provisions-dialog]"));
  assert.equal(dom.window.document.querySelector(".chat-rhid-attendance-report"), null);
  dom.window.close();
});

test("batidas RHID duplicadas não recebem justificativa de ponto não apontado", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const table = buildRhidAttendanceTable([{ Id: 91, ID_PESSOA_RHID: "91", NOME_COLABORADOR: "BIA",
    BATIDAS_RHID: "07:00; 12:00; 13:00; 16:00; 16:10" }]);
  view.render(signedInState({ messages: [{ id: "rhid-duplicates", role: "assistant", type: "poll",
    question: "RELATÓRIO RHID", options: [], detail_table: { ...table, reportDate: "2026-09-28" } }] }));
  root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit2"]').click();
  assert.equal(root.querySelector('[data-role="rhid-adjustment-reason"]').value, "");
  view.destroy();
  dom.window.close();
});

test("somente colaborador com presença pendente recebe botão de validação ao lado do nome", () => {
  const detail = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "9", NOME_COLABORADOR: "ANA", BATIDAS_RHID: "07:00", pendingPresenceIds: ["21"] },
    { ID_PESSOA_RHID: "10", NOME_COLABORADOR: "BIA", BATIDAS_RHID: "", pendingPresenceIds: [] },
  ]);
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "report-pending", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: { ...detail, reportDate: "2026-09-25" },
  }] }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll('[data-action="rhid-presence-validate-open"]')];
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].closest(".chat-rhid-attendance-card__person")?.querySelector("h3")?.textContent, "ANA");
  assert.equal(buttons[0].textContent.trim(), "VALIDAR PRESENÇA");
  assert.equal(commandFromTarget(buttons[0]).personKey, "rhid:9");
  dom.window.close();
});

test("relatório RHID segue o layout diário com indicadores e cartões individuais", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-daily-layout", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-28", updateLabel: "ÚLTIMA COLETA DO RHID ÀS 13:58",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [
        ["CLEITON CESAR NONATO", "07:00", "11:59", "13:02", "—", "04:59 (parcial)"],
        ["EDGAR NELSON DA SILVA", "06:57", "12:54", "—", "—", "05:57"],
        ["BERNARDO NOTINI MOREIRA BAHIA", "—", "—", "—", "—", "— (parcial)"],
      ],
    },
  }] }));
  const dom = new JSDOM(markup);
  const report = dom.window.document.querySelector(".chat-rhid-attendance-report");

  assert.ok(report, "o relatório deve usar o cartão de relatório diário");
  assert.equal(report.querySelector(".chat-rhid-attendance-report__kicker")?.textContent, "RELATÓRIO DIÁRIO");
  assert.equal(report.querySelector("h2")?.textContent, "Presenças RHID");
  assert.match(report.querySelector(".chat-rhid-attendance-report__updated")?.textContent || "", /13:58/);
  assert.deepEqual(
    [...report.querySelectorAll(".chat-rhid-attendance-report__summary-value")].map(node => node.textContent),
    ["03", "02", "01"],
  );
  assert.equal(report.querySelectorAll(".chat-rhid-attendance-card").length, 3);
  assert.equal(report.querySelectorAll(".chat-rhid-attendance-card__entry").length, 3);
  assert.equal(report.querySelectorAll(".chat-rhid-attendance-card__exit").length, 2);
  assert.match(report.querySelector(".chat-rhid-attendance-card__total")?.textContent || "", /04:59/);
  const firstCard = report.querySelector(".chat-rhid-attendance-card");
  const person = firstCard?.querySelector(".chat-rhid-attendance-card__person");
  const details = firstCard?.querySelector(".chat-rhid-attendance-card__details");
  assert.equal(person?.nextElementSibling, details, "o nome deve ocupar uma faixa própria acima dos horários");
  assert.equal(firstCard?.querySelector(".chat-rhid-attendance-card__total strong")?.textContent, "04:59");
  assert.equal(firstCard?.querySelector(".chat-rhid-attendance-card__total small")?.textContent, "PARCIAL");
  assert.doesNotMatch(firstCard?.querySelector(".chat-rhid-attendance-card__total strong")?.textContent || "", /parcial/i);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.chat-rhid-attendance-card__person h3\s*\{[^}]*white-space:\s*nowrap/s);
  assert.ok(report.querySelector(".chat-rhid-attendance-card--no-punches"));
  assert.match(report.querySelector(".chat-rhid-attendance-card--no-punches")?.textContent || "", /SEM MARCAÇÃO/);
  assert.equal(report.querySelector("table"), null, "a apresentação não deve voltar à tabela horizontal");
  dom.window.close();
});

test("relatório RHID mostra horário fora da faixa no cluster com asterisco e total efetivo", () => {
  for (const adjusted of [false, true]) {
    const table = buildRhidAttendanceTable([{ ID_PESSOA_RHID: "9", NOME_COLABORADOR: "MAURICIO",
      BATIDAS_RHID: "08:35; 12:03; 13:00; 17:00",
      ...(adjusted ? { ADMIN_AJUSTES: { entry1: { time: "07:00", reason: "Conferido" } } } : {}) }]);
    const dom = new JSDOM(renderChatMarkup(signedInState({ messages: [{ id: "rhid-outside", role: "assistant", type: "poll",
      question: "RHID", options: [], detail_table: { ...table, reportDate: "2026-10-02" } }] })));
    const card = dom.window.document.querySelector(".chat-rhid-attendance-card");
    const entry = card.querySelector('[data-slot="entry1"]');
    assert.equal(entry.querySelector("strong").textContent, adjusted ? "07:00" : "08:35*");
    assert.ok(entry.classList.contains(`chat-rhid-attendance-card__cluster--${adjusted ? "corrected" : "entry"}`));
    assert.equal(entry.querySelector("sup")?.textContent || "", adjusted ? "" : "*");
    if (!adjusted) assert.match(entry.getAttribute("aria-label"), /fora das faixas/i);
    assert.equal(card.querySelector(".chat-rhid-attendance-card__total strong").textContent, adjusted ? "09:03" : "07:28");
    assert.equal(card.querySelector(".chat-rhid-attendance-card__total small"), null);
    assert.match(card.querySelector(".chat-rhid-attendance-card__issues").textContent, /08:35/);
    dom.window.close();
  }
});

test("relatório RHID distingue entradas e saídas preenchidas sem destacar horários ausentes", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-punch-colors", role: "assistant", type: "poll", question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [["CLEITON CESAR NONATO", "06:58", "12:01", "12:59", "—", "05:03 (parcial)"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const cells = [...dom.window.document.querySelectorAll(".chat-rhid-attendance-card__slot strong")];
  const total = dom.window.document.querySelector(".chat-rhid-attendance-card__total");

  assert.ok(cells[0].classList.contains("chat-rhid-attendance-card__entry"));
  assert.ok(cells[1].classList.contains("chat-rhid-attendance-card__exit"));
  assert.ok(cells[2].classList.contains("chat-rhid-attendance-card__entry"));
  assert.equal(cells[3].textContent, "—", "sem batida, o traço permanece neutro");
  assert.ok(total, "o total deve continuar visível");
  dom.window.close();
});

test("relatório RHID agrupa cada entrada e saída em clusters legíveis", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-clusters", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-28",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [["CLEITON CESAR NONATO", "07:00", "11:59", "13:02", "—", "04:59 (parcial)"]],
    },
  }] }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<style>${styles}</style>${markup}`);
  const clusters = [...dom.window.document.querySelectorAll(".chat-rhid-attendance-card__cluster")];

  assert.equal(clusters.length, 4);
  assert.ok(clusters[0].classList.contains("chat-rhid-attendance-card__cluster--entry"));
  assert.ok(clusters[1].classList.contains("chat-rhid-attendance-card__cluster--exit"));
  assert.equal(clusters[0].querySelector("span")?.textContent, "Entrada 1");
  assert.equal(clusters[0].querySelector("strong")?.textContent, "07:00");
  assert.equal(clusters[1].querySelector("span")?.textContent, "Saída 1");
  assert.equal(clusters[1].querySelector("strong")?.textContent, "11:59");
  assert.ok(clusters[3].classList.contains("chat-rhid-attendance-card__cluster--empty"));
  assert.match(styles, /\.chat-rhid-attendance-card__cluster\s*\{[^}]*font-size:\s*9px/s);
  assert.match(styles, /\.chat-rhid-attendance-card__cluster--entry\s*\{[^}]*color:\s*#fff[^}]*background:/s);
  assert.match(styles, /\.chat-rhid-attendance-card__cluster--exit\s*\{[^}]*color:\s*#fff[^}]*background:/s);
  assert.match(styles, /\.chat-rhid-attendance-card__details\s*\{[^}]*gap:\s*14px/s);
  dom.window.close();
});

test("relatório RHID preenche de vermelho claro só a linha discrepante após o fechamento", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-discrepancies", role: "assistant", type: "poll", question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-25", title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [
        ["ABAIXO DO MÍNIMO", "07:00", "12:00", "13:00", "15:42", "07:44"],
        ["NO MÍNIMO", "07:00", "12:00", "13:00", "15:45", "07:45"],
      ],
    },
  }] }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<style>${styles}</style>${markup}`);
  const rows = [...dom.window.document.querySelectorAll(".chat-rhid-attendance-card")];

  assert.ok(rows[0].classList.contains("chat-rhid-attendance-card--discrepant"));
  assert.ok(!rows[1].classList.contains("chat-rhid-attendance-card--discrepant"));
  assert.equal(dom.window.getComputedStyle(rows[0]).backgroundColor, "rgb(253, 232, 230)");
  assert.notEqual(dom.window.getComputedStyle(rows[1]).backgroundColor, "rgb(253, 232, 230)");
  dom.window.close();
});

test("relatório RHID destaca em laranja o cadastro sem batidas", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-without-punches", role: "assistant", type: "poll", question: "Relatório RHID", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-25", title: "PRESENÇAS",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
      rows: [["ANA PRESENTE", "07:00", "12:00", "13:00", "15:45", "07:45"],
        ["BIA SEM BATIDA", "—", "—", "—", "—", "— (parcial)"]],
    },
  }] }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(`<style>${styles}</style>${markup}`);
  const rows = [...dom.window.document.querySelectorAll(".chat-rhid-attendance-card")];
  assert.ok(rows[1].classList.contains("chat-rhid-attendance-card--no-punches"));
  assert.equal(dom.window.getComputedStyle(rows[1]).backgroundColor, "rgb(255, 235, 204)");
  dom.window.close();
});

test("relatório RHID usa a largura do chat e identifica cada horário sem rolagem lateral", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-compact", role: "assistant", type: "poll", question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Entrada 3", "Saída 3", "Total de horas/dia"],
      rows: [["CLEITON CESAR NONATO", "06:58", "12:01", "12:59", "15:50", "16:20", "17:00", "08:34"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const document = dom.window.document;
  const message = document.querySelector(".chat-message--rhid-report");

  assert.ok(message, "o relatório deve ter layout próprio");
  assert.equal(message.querySelector(".chat-avatar"), null, "o mascote lateral não ocupa a largura do relatório");
  assert.equal(message.querySelectorAll(".chat-rhid-attendance-card").length, 1);
  assert.deepEqual([...message.querySelectorAll(".chat-rhid-attendance-card__entry, .chat-rhid-attendance-card__exit")].map(cell => cell.textContent),
    ["06:58", "12:01", "12:59", "15:50", "16:20", "17:00"]);
  assert.equal(message.querySelector(".chat-rhid-attendance-table__horizontal-hint"), null);
  dom.window.close();
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

test("resume o vínculo de pagamento na confirmação final do lançamento", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      id: "launch",
      title: "EFETUAR LANÇAMENTO",
      launches: {
        id: "batch-1",
        currency: "BRL",
        count: 2,
        total: "1005.00",
        totalDisplay: "R$ 1.005,00",
        lines: [
          { index: 1, product: "SERVIÇO A", unit: "DIÁRIA", quantity: "1", unitPrice: "905", unitPriceDisplay: "R$ 905,00", freight: "0", freightDisplay: "R$ 0,00", total: "905", totalDisplay: "R$ 905,00", details: { supplier: "EDGAR" } },
          { index: 2, product: "SERVIÇO B", unit: "DIÁRIA", quantity: "1", unitPrice: "100", unitPriceDisplay: "R$ 100,00", freight: "0", freightDisplay: "R$ 0,00", total: "100", totalDisplay: "R$ 100,00", details: { supplier: "EDGAR" } },
        ],
      },
    },
    messages: [{
      id: "launch-payment-link",
      role: "assistant",
      type: "poll",
      question: "🏢 FORAM ENCONTRADOS DESCRITIVOS DE PRESENÇA COM STATUS PENDENTE PGTO PARA O FORNECEDOR. IDS: 2128, 2118, 2108, 2098, 2088. SOMA VLORDIARIO: R$ 905,00. DESEJA SUBMETER O ID DO LANÇAMENTO 3450 COMO IDPGTO E ATUALIZAR O STATUS PARA PAGO?",
      options: [
        { id: "yes", label: "✅ SIM", reply: "yes" },
        { id: "no", label: "❌ NÃO", reply: "no" },
      ],
    }],
  }));

  const dom = new JSDOM(markup);
  const card = dom.window.document.querySelector(".chat-launch-payment-confirmation");
  assert.ok(card);
  assert.ok(dom.window.document.querySelector(".chat-message--launch-payment"));
  assert.match(card.textContent, /DESCRITIVO DE PRESENÇA PENDENTE/);
  assert.equal(card.querySelector(".chat-launch-payment-confirmation__supplier strong").textContent, "EDGAR");
  assert.deepEqual([...card.querySelectorAll(".chat-launch-payment-confirmation__ids span")].map(node => node.textContent), ["2128", "2118", "2108", "2098", "2088"]);
  assert.match(markup, /R\$ 1\.005,00/);
  assert.match(markup, /R\$ 905,00/);
  assert.match(markup, /R\$ 100,00/);
  assert.match(markup, /3450/);
  assert.match(card.querySelector(".chat-launch-payment-confirmation__status").textContent, /Os valores não conferem/);
  assert.match(markup, /data-reply-id="yes"/);
  assert.match(markup, /data-reply-id="no"/);
  assert.ok(markup.indexOf("chat-launch-payment-confirmation") < markup.indexOf('data-reply-id="yes"'));
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list--launch-payment button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), ["no", "yes"]);
  assert.deepEqual(buttons.map(button => commandFromTarget(button).replyId), ["no", "yes"]);
  assert.doesNotMatch(markup, /SOMA VLORDIARIO: R\$ 905,00/);
  dom.window.close();
});

test("confirmação de vínculo destaca valores iguais sem inverter as respostas", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: {
      id: "launch", title: "EFETUAR LANÇAMENTO",
      launches: { totalDisplay: "R$ 905,00", lines: [{ details: { supplier: "EDGAR" }, total: "905" }] },
    },
    messages: [{
      role: "assistant", type: "poll",
      question: "FORAM ENCONTRADOS DESCRITIVOS DE PRESENÇA COM STATUS PENDENTE PGTO PARA O FORNECEDOR. IDS: 2125, 2115. SOMA VLORDIARIO: R$ 905,00. DESEJA SUBMETER O ID DO LANÇAMENTO 3451 COMO IDPGTO E ATUALIZAR O STATUS PARA PAGO?",
      options: [{ id: "yes", label: "✅ SIM", reply: "yes" }, { id: "no", label: "❌ NÃO", reply: "no" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const card = dom.window.document.querySelector(".chat-launch-payment-confirmation");
  assert.match(card.querySelector(".chat-launch-payment-confirmation__status").textContent, /Os valores conferem/);
  assert.match(card.textContent, /3451 como IDPGTO/);
  assert.deepEqual([...dom.window.document.querySelectorAll(".chat-choice-list--launch-payment button")].map(button => button.dataset.replyId), ["no", "yes"]);
  dom.window.close();
});

test("ordena as respostas da confirmação pelo identificador mesmo com rótulos alternativos", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", launches: { totalDisplay: "R$ 10,00", lines: [{ total: "10", details: { supplier: "EDGAR" } }] } },
    messages: [{ role: "assistant", type: "poll",
      question: "FORAM ENCONTRADOS DESCRITIVOS DE PRESENÇA COM STATUS PENDENTE PGTO PARA O FORNECEDOR. IDS: 12. SOMA VLORDIARIO: R$ 10,00. DESEJA SUBMETER O ID DO LANÇAMENTO 34 COMO IDPGTO E ATUALIZAR O STATUS PARA PAGO?",
      options: [{ id: "yes", label: "Confirmar", reply: "yes" }, { id: "no", label: "Cancelar", reply: "no" }],
    }],
  }));
  const dom = new JSDOM(markup);
  assert.deepEqual([...dom.window.document.querySelectorAll(".chat-choice-list--launch-payment button")].map(button => button.dataset.replyId), ["no", "yes"]);
  dom.window.close();
});

test("alerta quando os lançamentos incluem fornecedores diferentes", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", launches: { totalDisplay: "R$ 20,00", lines: [
      { total: "10", details: { supplier: "EDGAR" } },
      { total: "10", details: { supplier: "MARIA" } },
    ] } },
    messages: [{ role: "assistant", type: "poll",
      question: "FORAM ENCONTRADOS DESCRITIVOS DE PRESENÇA COM STATUS PENDENTE PGTO PARA O FORNECEDOR. IDS: 12. SOMA VLORDIARIO: R$ 20,00. DESEJA SUBMETER O ID DO LANÇAMENTO 34 COMO IDPGTO E ATUALIZAR O STATUS PARA PAGO?",
      options: [{ id: "yes", label: "✅ SIM", reply: "yes" }, { id: "no", label: "❌ NÃO", reply: "no" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const card = dom.window.document.querySelector(".chat-launch-payment-confirmation");
  assert.match(card.querySelector(".chat-launch-payment-confirmation__supplier").textContent, /FORNECEDORES DO LANÇAMENTO/);
  assert.match(card.querySelector(".chat-launch-payment-confirmation__supplier").textContent, /EDGAR, MARIA/);
  assert.match(card.querySelector(".chat-launch-payment-confirmation__status").textContent, /mais de um fornecedor/);
  assert.ok(card.querySelector(".chat-launch-payment-confirmation__status.is-different"));
  dom.window.close();
});

test("não altera perguntas de vínculo que não pertencem ao fluxo de lançamento", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "not-a-launch-payment-link",
      role: "assistant",
      type: "poll",
      question: "FORAM ENCONTRADOS DESCRITIVOS DE PRESENÇA COM STATUS PENDENTE PGTO. IDS: 12. SOMA VLORDIARIO: R$ 10,00. DESEJA SUBMETER O ID DO LANÇAMENTO 34 COMO IDPGTO?",
      options: [{ id: "yes", label: "SIM", reply: "yes" }],
    }],
  }));

  assert.doesNotMatch(markup, /chat-launch-payment-summary/);
  assert.match(markup, /FORAM ENCONTRADOS DESCRITIVOS DE/);
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

test("menu de RH reserva a coluna direita para galerias e remove apenas o avatar lateral", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "hr-menu",
      role: "assistant",
      type: "poll",
      question: "👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "action_hr_registration", label: "🗂️ EFETUAR CADASTROS", reply: "action_hr_registration" },
        { id: "action_hr_report", label: "📊 OBTER DADOS", reply: "action_hr_report" },
        { id: "action_hr_gallery_idfolha", label: "📚 GALERIA IDFOLHA", reply: "action_hr_gallery_idfolha" },
        { id: "action_hr_gallery_folhapgto", label: "💵 GALERIA FOLHA PGTO", reply: "action_hr_gallery_folhapgto" },
      ],
    }],
  }));
  const article = markup.match(/<article class="chat-message chat-message--assistant[^]*?<\/article>/)?.[0] || "";
  assert.match(article, /chat-choice-card--hr-galleries/);
  assert.match(article, /chat-choice-columns--hr-galleries/);
  assert.match(article, /chat-choice-columns__flow/);
  assert.match(article, /chat-choice-columns__galleries/);
  assert.doesNotMatch(article, /alt="Mascote Energético"/);
  assert.ok(article.indexOf("EFETUAR CADASTROS") < article.indexOf("GALERIA IDFOLHA"));
});

test("popup de vencimentos apresenta data e valor destacados e os dados em linhas separadas", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T15:00:00Z") });
  const dom = new JSDOM(renderChatMarkup(signedInState({ pendingProvisions: {
    due: true, today: "2026-09-30", rows: [{ id: "306", supplier: "TRANSPIO TRANSPORTES SERVICOS E LOCACOES LTDA",
      dueDate: "2026-09-30T03:00:00Z", total: 150, product: "MOVIMENTAÇÃO DE TERRA",
      branch: "004 - EDIFÍCIO XAVANTE", property: "TODOS" }],
  } })));
  const doc = dom.window.document;
  const payment = doc.querySelector('[data-payment-id="306"][role="listitem"]');
  assert.equal(payment.querySelector('[data-field="dueDate"] strong')?.textContent, "30/09/2026");
  assert.equal(payment.querySelector('[data-field="total"] strong')?.textContent.replace(/\s/g, " "), "R$ 150,00");
  assert.equal(payment.querySelector('.chat-pending-provision__timing')?.textContent, "VENCE HOJE");
  for (const [field, value] of [["supplier", "TRANSPIO"], ["product", "MOVIMENTAÇÃO DE TERRA"], ["branch", "XAVANTE"], ["property", "TODOS"]]) {
    assert.ok(payment.querySelector(`[data-field="${field}"]`)?.textContent.includes(value));
  }
  assert.equal(payment.querySelector('[data-field="supplier"] [data-action="edit-pending-provision-due-date"]')?.dataset.paymentId, "306");
  assert.equal(payment.querySelector('[data-field="supplier"] [data-action="settle-pending-provision"]')?.dataset.paymentId, "306");
  dom.window.close();
});

test("vencimentos usam vermelho até hoje e laranja apenas nos próximos dois dias do calendário brasileiro", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T15:00:00Z") });
  const dom = new JSDOM(renderChatMarkup(signedInState({ pendingProvisions: {
    due: true, today: "2026-09-30", rows: [
      { id: "1", dueDate: "2026-09-29T03:00:00Z", total: 0 },
      { id: "2", dueDate: "30/09/2026" },
      { id: "3", dueDate: "2026-10-01T03:00:00Z" },
      { id: "4", dueDate: "2026-10-02" },
      { id: "5", dueDate: "2026-10-03" },
      { id: "6", dueDate: "31/09/2026" },
      { id: "7", dueDate: "2026-10-01T01:00:00Z" },
    ],
  } })));
  const payments = [...dom.window.document.querySelectorAll('[role="listitem"][data-payment-id]')];
  assert.deepEqual(payments.filter(row => row.classList.contains("chat-pending-provision--urgent")).map(row => row.dataset.paymentId), ["1", "2", "7"]);
  assert.deepEqual(payments.filter(row => row.classList.contains("chat-pending-provision--upcoming")).map(row => row.dataset.paymentId), ["3", "4"]);
  assert.match(payments[2].textContent, /VENCE AMANHÃ/);
  assert.match(payments[3].textContent, /VENCE EM 2 DIAS/);
  assert.equal(payments[0].querySelector('[data-field="total"] strong')?.textContent.replace(/\s/g, " "), "R$ 0,00");
  dom.window.close();
});

test("vencimento laranja passa a vermelho ao renderizar depois da meia-noite brasileira", t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T02:59:00Z") });
  const state = signedInState({ pendingProvisions: { due: true, today: "2026-09-30", rows: [{ id: "306", dueDate: "2026-10-01" }] } });
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(state);
  assert.ok(root.querySelector('.chat-pending-provision--upcoming'));
  t.mock.timers.setTime(new Date("2026-10-01T03:01:00Z").getTime());
  view.render(state);
  assert.ok(root.querySelector('.chat-pending-provision--urgent'));
  assert.match(root.querySelector('.chat-pending-provision__timing').textContent, /VENCE HOJE/);
  view.destroy();
  dom.window.close();
});

test("avisa quando valores e vencimentos não puderam ser conferidos sem esconder os vencidos", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({ pendingProvisions: {
    due: true, upcomingUnavailable: true, rows: [{ id: "306", supplier: "COFER", dueDate: "30/09/2026" }],
  } })));
  assert.match(dom.window.document.querySelector('[data-pending-provisions-dialog] [role="status"]')?.textContent || "", /Não foi possível conferir todos os valores e vencimentos/);
  assert.match(dom.window.document.querySelector('[data-field="total"] strong')?.textContent || "", /—/);
  assert.ok(dom.window.document.querySelector('[role="listitem"][data-payment-id="306"]'));
  dom.window.close();
});

test("edição preenche o mesmo dia brasileiro exibido no cartão para timestamps antes das 03h UTC", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({ pendingProvisions: {
    due: true, rows: [{ id: "306", dueDate: "2026-10-02T01:00:00Z" }],
  }, pendingProvisionDateEditPaymentId: "306" })));
  assert.equal(dom.window.document.querySelector('[data-role="pending-provision-due-date"]').value, "2026-10-01");
  dom.window.close();
});

test("abre a lista de provisões vencidas com X e opções de lembrete", () => {
  const markup = renderChatMarkup(signedInState({
    pendingProvisions: {
      due: true,
      rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026", product: "Material", total: "R$ 120,00" }],
    },
  }));
  assert.match(markup, /data-action="dismiss-pending-provisions"/);
  assert.match(markup, /data-action="close-pending-provisions"[^>]*aria-label="Configurar lembrete das provisões"/);
  assert.match(markup, /data-popup-close-action="dismiss-pending-provisions"/);
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

test("falha no lançamento aparece dentro do popup e mantém o lápis disponível para retry", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    pendingNotes: { rows: [{ id: "13", label: "13 - Terceiro" }] },
    pendingNoteLaunchFailed: true,
    error: "Falha real da VM em action_launch",
  })));
  const dialog = dom.window.document.querySelector("[data-pending-notes-dialog]");
  assert.match(dialog.textContent, /Falha real da VM em action_launch/);
  assert.equal(dialog.querySelector('[data-action="launch-pending-note"]').disabled, false);
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

test("clique sintético tardio do X não aciona o menu que ficou sob o popup", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  const state = signedInState({
    pendingNotes: { rows: [{ id: "13", label: "13 - Terceiro" }] },
    messages: [{ id: "menu", role: "assistant", type: "poll", question: "ESCOLHA", options: [
      { id: "group_supplies", reply: "group_supplies", label: "SUPRIMENTOS" },
    ] }],
  });
  view.on("dismiss-pending-notes", () => {
    commands.push("dismiss");
    view.render({ ...state, pendingNotes: null });
  });
  view.on("select-reply", command => commands.push(command.replyId));
  view.render(state);
  const pointer = type => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { isPrimary: { value: true }, pointerType: { value: "touch" }, pointerId: { value: 7 } });
    return event;
  };
  const close = root.querySelector('[data-action="dismiss-pending-notes"]');
  close.dispatchEvent(pointer("pointerdown"));
  close.dispatchEvent(pointer("pointerup"));
  assert.deepEqual(commands, ["dismiss"]);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 1_000;
    root.querySelector('[data-reply-id="group_supplies"]').dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(commands, ["dismiss"]);
  const next = root.querySelector('[data-reply-id="group_supplies"]');
  next.dispatchEvent(pointer("pointerdown"));
  next.dispatchEvent(pointer("pointerup"));
  assert.deepEqual(commands, ["dismiss", "group_supplies"]);
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
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const editRule = css.match(/\.chat-pending-provision__edit--due-date\s*\{([^}]*)\}/)?.[1] || "";
  const editFontSize = Number(editRule.match(/font-size:\s*([\d.]+)rem/)?.[1]);

  assert.ok(edit);
  assert.ok(edit.classList.contains("chat-pending-provision__edit--due-date"));
  assert.equal(edit.dataset.paymentId, "306");
  assert.equal(edit.textContent, "✏️");
  assert.ok(editFontSize > 1.25, "o lápis deve ficar maior que o ícone anterior");
  assert.match(edit.getAttribute("aria-label"), /DIBRITA/);
  assert.ok(edit.compareDocumentPosition(check) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("tela de vencimento preenche calendário e envia DD/MM/AAAA para o pagamento correto", () => {
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
  assert.equal(input.type, "date");
  assert.equal(input.value, "2026-09-23");
  input.value = "2026-10-24";
  input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
  assert.equal(input.value, "2026-10-24");
  const save = root.querySelector('[data-action="save-pending-provision-due-date"]');
  save.click();
  assert.deepEqual(commands.map(({ paymentId, value }) => ({ paymentId, value })), [
    { paymentId: "306", value: "24/10/2026" },
  ]);
  view.destroy();
  dom.window.close();
});

test("popup consulta e encaminha anexos existentes sem oferecer bandeja de novos arquivos", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const commands = [];
  view.on("open-pending-provision-attachment", command => commands.push(command));
  view.on("share-pending-provision-attachment", command => commands.push(command));
  view.render(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA" }] },
    pendingProvisionAttachments: { 306: { status: "available", items: [{ fileName: "existente.pdf", mimeType: "application/pdf", size: 2048 }] } },
    pendingProvisionExpandedPaymentId: "306",
    pendingProvisionUploads: { 306: { items: [{ fileName: "novo.pdf", size: 8, status: "ready" }], busy: false } },
  }));

  assert.equal(root.querySelectorAll(".chat-pending-provision__attachments > li").length, 1);
  assert.equal(root.querySelector('[data-action="pick-pending-provision-attachments"]'), null);
  assert.equal(root.querySelector('[data-action="send-pending-provision-attachments"]'), null);
  assert.equal(root.querySelector(".chat-pending-provision__upload-queue"), null);
  assert.doesNotMatch(root.textContent, /novo\.pdf|Adicionar mais anexos/);
  root.querySelector('[data-action="open-pending-provision-attachment"]').click();
  root.querySelector('[data-action="share-pending-provision-attachment"]').click();
  assert.deepEqual(commands.map(command => command.type), [
    "open-pending-provision-attachment", "share-pending-provision-attachment",
  ]);
  assert.ok(commands.every(command => command.paymentId === "306" && command.fileName === "existente.pdf"));
  view.destroy();
  dom.window.close();
});

test("estado de uma fila antiga não reaparece no popup de provisões", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    pendingProvisions: { due: true, rows: [{ id: "306", supplier: "DIBRITA" }] },
    pendingProvisionAttachments: { 306: { status: "available", items: [{ fileName: "existente.pdf", size: 10 }] } },
    pendingProvisionExpandedPaymentId: "306",
    pendingProvisionUploads: { 306: {
      items: [{ fileName: "existente.pdf", size: 10, status: "conflict" }],
      busy: false, error: "Um arquivo com esse nome já existe.",
    } },
  }));
  assert.equal(root.querySelector('[data-action="send-pending-provision-attachments"]'), null);
  assert.doesNotMatch(root.textContent, /Nome repetido|já existe/i);
  assert.ok(root.querySelector('[data-action="open-pending-provision-attachment"]'));
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

test("X dispensa provisões e engrenagem abre lembrete no início do toque do iPhone", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let dismissRequests = 0;
  let reminderRequests = 0;
  const reminderState = signedInState({
    pendingProvisions: { due: true, rows: [{ supplier: "Fornecedor A" }] },
    pendingProvisionReminderOpen: true,
  });
  view.on("dismiss-pending-provisions", () => {
    dismissRequests += 1;
    view.render(signedInState());
  });
  view.on("close-pending-provisions", () => {
    reminderRequests += 1;
    view.render(reminderState);
  });
  view.render(signedInState({
    pendingProvisions: {
      due: true,
      rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
    },
  }));

  const tap = element => {
    const touchStart = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperties(touchStart, {
      isPrimary: { value: true },
      pointerType: { value: "touch" },
    });
    element.dispatchEvent(touchStart);

    const touchEnd = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(touchEnd, {
      isPrimary: { value: true },
      pointerType: { value: "touch" },
    });
    element.dispatchEvent(touchEnd);
  };

  const close = root.querySelector('[data-action="dismiss-pending-provisions"]');
  assert.ok(close);
  tap(close);
  assert.equal(dismissRequests, 1);
  assert.equal(reminderRequests, 0);
  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null);

  view.render(signedInState({ pendingProvisions: { due: true, rows: [{ supplier: "Fornecedor A" }] } }));
  const settings = root.querySelector('[data-action="close-pending-provisions"]');
  assert.ok(settings);
  tap(settings);

  assert.equal(reminderRequests, 1);
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
  assert.equal((markup.match(/type="checkbox"/g) || []).length, 3);
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
  assert.equal(root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked').length, 2);
  root.querySelector('[data-reply-id="2109"]').click();
  assert.equal(root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked').length, 1);
  root.querySelector('[data-action="attendance-select-proceed"]').click();
  assert.deepEqual(replies, ["attendance_batch:2108"]);
  view.destroy();
  dom.window.close();
});

test("selecionar todos marca e desmarca as presenças visíveis sem abrir o fluxo individual", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "attendance-options", role: "assistant", type: "poll",
    presentation: "attendance_multi_select", question: "QUAL PRESENÇA DESEJA VALIDAR?",
    options: [
      { id: "choice:registro_presenca_pendente:2101", reply: "choice:registro_presenca_pendente:2101", label: "2101 - ISRAEL" },
      { id: "choice:registro_presenca_pendente:2100", reply: "choice:registro_presenca_pendente:2100", label: "2100 - RAFAEL" },
    ],
  }] }));
  const selectAll = root.querySelector('[data-action="attendance-select-all"]');
  assert.equal(selectAll.checked, false);
  assert.ok(root.querySelector('[data-reply-id="2100"]').compareDocumentPosition(selectAll) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  selectAll.click();
  assert.deepEqual([...root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked')].map(input => input.dataset.replyId), ["2101", "2100"]);
  assert.equal(root.querySelector('[data-action="attendance-select-all"]').checked, true);
  assert.equal(root.querySelector('[data-action="attendance-select-proceed"]').disabled, false);
  root.querySelector('[data-action="attendance-select-all"]').click();
  assert.equal(root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked').length, 0);
  assert.equal(root.querySelector('[data-action="attendance-select-proceed"]').disabled, true);
  assert.deepEqual(replies, []);
  view.destroy();
  dom.window.close();
});

test("botão da presença abre o fluxo individual sem marcar o checkbox", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "attendance-options", role: "assistant", type: "poll",
    presentation: "attendance_multi_select", question: "QUAL PRESENÇA DESEJA VALIDAR?",
    options: [{ id: "choice:registro_presenca_pendente:2100", reply: "choice:registro_presenca_pendente:2100", label: "2100 - RAFAEL" }],
  }] }));
  root.querySelector('.chat-attendance-select__row button').click();
  assert.deepEqual(replies, ["choice:registro_presenca_pendente:2100"]);
  assert.equal(root.querySelector('input[data-action="attendance-select-toggle"]').checked, false);
  view.destroy();
  dom.window.close();
});

test("seleção em lote bloqueia botão individual e orienta a desmarcar as caixas", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "attendance-options", role: "assistant", type: "poll",
    presentation: "attendance_multi_select", question: "QUAL PRESENÇA DESEJA VALIDAR?",
    options: [
      { id: "choice:registro_presenca_pendente:2101", reply: "choice:registro_presenca_pendente:2101", label: "2101 - ISRAEL" },
      { id: "choice:registro_presenca_pendente:2100", reply: "choice:registro_presenca_pendente:2100", label: "2100 - RAFAEL" },
    ],
  }] }));
  root.querySelector('input[data-reply-id="2101"]').click();
  root.querySelector('.chat-attendance-select__row button').click();
  assert.deepEqual(replies, []);
  assert.equal(root.querySelectorAll('input[data-action="attendance-select-toggle"]:checked').length, 1);
  const warning = root.querySelector('.chat-attendance-select__warning');
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /todos os checkbox devem estar desmarcados/i);
  view.destroy();
  dom.window.close();
});

test("tocar no nome do último fornecedor abre Rafael individualmente", () => {
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
  const button = rafael.nextElementSibling;
  dom.window.document.elementFromPoint = () => button;
  button.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true, cancelable: true, detail: 1, clientX: 200, clientY: 950,
  }));

  assert.equal(root.querySelector('[data-reply-id="2100"]').checked, false);
  assert.deepEqual(replies, ["choice:registro_presenca_pendente:2100"]);
  view.destroy();
  dom.window.close();
});

test("seleção de lançamentos para folha começa desmarcada e envia apenas os IDs marcados", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "launch-payroll-options",
    role: "assistant",
    type: "poll",
    presentation: "launch_payroll_multi_select",
    question: "SELECIONE OS LANÇAMENTOS QUE DESEJA INCLUIR NA FOLHA.",
    options: [
      { id: "choice:launch_payroll_entries:700", reply: "choice:launch_payroll_entries:700", label: "ID 700 — FORNECEDOR A — R$ 20,00" },
      { id: "choice:launch_payroll_entries:701", reply: "choice:launch_payroll_entries:701", label: "ID 701 — FORNECEDOR A — R$ 60,00" },
      { id: "choice:launch_payroll_entries:702", reply: "choice:launch_payroll_entries:702", label: "ID 702 — FORNECEDOR B — R$ 20,00" },
    ],
  }] }));

  const rows = root.querySelectorAll('.chat-launch-payroll-select input[data-action="launch-payroll-select-toggle"]');
  assert.equal(rows.length, 3);
  assert.equal(root.querySelectorAll('.chat-launch-payroll-select input:checked').length, 0);
  assert.equal(root.querySelector('[data-action="launch-payroll-select-proceed"]').disabled, false);
  assert.ok(rows[0].compareDocumentPosition(rows[0].nextElementSibling) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);

  root.querySelector('.chat-launch-payroll-select__row span').click();
  root.querySelector('input[data-reply-id="702"]').click();
  root.querySelector('[data-action="launch-payroll-select-proceed"]').click();

  assert.deepEqual(replies, ["launch_payroll_selected:700,702"]);
  view.destroy();
  dom.window.close();
});

test("permite prosseguir sem incluir lançamentos quando nenhum checkbox da folha for marcado", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "launch-payroll-options",
    role: "assistant",
    type: "poll",
    presentation: "launch_payroll_multi_select",
    question: "SELECIONE OS LANÇAMENTOS QUE DESEJA INCLUIR NA FOLHA.",
    options: [{ id: "choice:launch_payroll_entries:700", reply: "choice:launch_payroll_entries:700", label: "ID 700 — FORNECEDOR A — R$ 20,00" }],
  }] }));

  const proceed = root.querySelector('[data-action="launch-payroll-select-proceed"]');
  assert.equal(proceed.disabled, false);
  assert.match(proceed.textContent, /SEM FOLHA/i);
  proceed.click();

  assert.deepEqual(replies, ["launch_payroll_selected:"]);
  view.destroy();
  dom.window.close();
});

test("limpa os IDs selecionados quando chega outro lote de seleção da folha", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  const buildPoll = (id, options) => ({
    id,
    role: "assistant",
    type: "poll",
    presentation: "launch_payroll_multi_select",
    question: "SELECIONE OS LANÇAMENTOS QUE DESEJA INCLUIR NA FOLHA.",
    options,
  });
  const launch700 = { id: "choice:launch_payroll_entries:700", reply: "choice:launch_payroll_entries:700", label: "ID 700 — FORNECEDOR A — R$ 20,00" };

  view.render(signedInState({ messages: [buildPoll("launch-payroll-options-one", [launch700])] }));
  root.querySelector('input[data-reply-id="700"]').click();
  assert.equal(root.querySelector('input[data-reply-id="700"]').checked, true);
  root.querySelector('[data-action="launch-payroll-select-proceed"]').click();

  view.render(signedInState({ messages: [buildPoll("launch-payroll-options-two", [
    launch700,
    { id: "choice:launch_payroll_entries:701", reply: "choice:launch_payroll_entries:701", label: "ID 701 — FORNECEDOR A — R$ 60,00" },
  ])] }));
  assert.equal(root.querySelectorAll('.chat-launch-payroll-select input:checked').length, 0);
  root.querySelector('[data-action="launch-payroll-select-proceed"]').click();

  assert.deepEqual(replies, ["launch_payroll_selected:700", "launch_payroll_selected:"]);
  view.destroy();
  dom.window.close();
});

test("opções sem ID numérico na seleção de folha ficam indisponíveis, não viram botões", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "launch-payroll-options-malformed",
    role: "assistant",
    type: "poll",
    presentation: "launch_payroll_multi_select",
    question: "SELECIONE OS LANÇAMENTOS QUE DESEJA INCLUIR NA FOLHA.",
    options: [{ id: "launch-unknown", reply: "launch-unknown", label: "Lançamento sem ID válido" }],
  }] }));
  const dom = new JSDOM(markup);
  const card = dom.window.document.querySelector(".chat-launch-payroll-select");

  assert.ok(card.querySelector('input[type="checkbox"][disabled]'));
  assert.equal(card.querySelectorAll('[data-action="select-reply"]').length, 0);
  assert.ok(card.querySelector('[role="alert"]'));
  dom.window.close();
});

test("lançamentos de não empreiteiro aparecem desabilitados e não entram no envio da folha", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command.replyId));
  view.render(signedInState({ messages: [{
    id: "launch-payroll-mixed-contractors",
    role: "assistant",
    type: "poll",
    presentation: "launch_payroll_multi_select",
    question: "SELECIONE OS LANÇAMENTOS QUE DESEJA INCLUIR NA FOLHA.",
    options: [
      { id: "choice:launch_payroll_entries:700", reply: "choice:launch_payroll_entries:700", label: "ID 700 — EMPREITEIRO" },
      { id: "choice:launch_payroll_entries:701", reply: "choice:launch_payroll_entries:701", label: "ID 701 — FORNECEDOR COMUM — FORNECEDOR NÃO É EMPREITEIRO", disabled: true },
    ],
  }] }));

  const eligible = root.querySelector('input[data-reply-id="700"]');
  const ineligible = root.querySelector('input[data-reply-id="701"]');
  assert.equal(ineligible.disabled, true);
  assert.equal(
    ineligible.closest("label").textContent.match(/FORNECEDOR NÃO É EMPREITEIRO/g)?.length,
    1,
  );
  ineligible.click();
  eligible.click();
  root.querySelector('[data-action="launch-payroll-select-proceed"]').click();

  assert.equal(ineligible.checked, false);
  assert.deepEqual(replies, ["launch_payroll_selected:700"]);
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

test("menu inicial remove cabeçalho redundante e preserva as opções", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "main-menu-compact",
      role: "assistant",
      type: "poll",
      question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
      options: [{ id: "group_supplies", label: "📦 SUPRIMENTOS", reply: "group_supplies" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const message = dom.window.document.querySelector(".chat-message--assistant");

  assert.ok(message);
  assert.ok(message.classList.contains("chat-message--initial-area-menu"), "o menu inicial tem uma classe de layout própria");
  assert.equal(message.querySelector(":scope > .chat-avatar"), null, "o avatar redundante não pode cobrir o sétimo mascote");
  const ordinary = new JSDOM(renderChatMarkup(signedInState({ messages: [{ id: "ordinary", role: "assistant", type: "text", text: "Mensagem comum" }] })));
  assert.ok(ordinary.window.document.querySelector(".chat-message--assistant > .chat-avatar"), "mensagens comuns preservam o avatar");
  ordinary.window.close();
  assert.equal(message.querySelector(".chat-bubble > strong"), null);
  assert.equal(message.querySelector(".chat-choice-card > p"), null);
  assert.match(message.textContent, /SUPRIMENTOS/);

  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.chat-message--initial-area-menu\s*\{[^}]*position:\s*relative[^}]*justify-content:\s*center/);
  assert.match(css, /\.chat-message\.chat-message--initial-area-menu \.chat-avatar\s*\{[^}]*position:\s*absolute[^}]*left:\s*0[^}]*bottom:\s*0/);
  assert.match(css, /\.chat-message--initial-area-menu \.chat-bubble\s*\{[^}]*width:\s*min\(82%,\s*640px\)/);
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

test("menu inicial não oferece o hub antigo, inclusive em respostas legadas", t => {
  const dom = new JSDOM('<main id="app"></main>');
  const view = createChatView(dom.window.document.querySelector('#app'));
  t.after(() => { view.destroy(); dom.window.close(); });
  for (const question of ['QUAL ÁREA VOCÊ DESEJA ACESSAR?', 'DESEJA UTILIZAR ELES EM QUAL FLUXO?']) {
    const opened = [];
    const actions = ['open-contractor-control-report', 'open-supplier-workforce-report',
      'open-pending-supplier-payments-report', 'open-pending-work-diaries-report'];
    for (const action of actions) view.on(action, () => opened.push(action));
    view.render(signedInState({ messages: [{
      id: 'retired-reports-menu', role: 'assistant', type: 'poll', question,
      options: [
        { id: 'group_pending', reply: 'group_pending', label: 'PENDÊNCIAS' },
        { id: 'group_supplies', reply: 'group_supplies', label: 'SUPRIMENTOS' },
        { id: 'action_contractor_reports', reply: 'action_contractor_reports', label: 'RELATÓRIOS' },
      ],
    }] }));
    assert.equal(dom.window.document.querySelector('[data-reply-id="action_contractor_reports"]'), null);
    for (const action of question.startsWith('QUAL ÁREA') ? actions : []) {
      const mascot = dom.window.document.querySelector('[data-action="' + action + '"]');
      assert.ok(mascot, action);
      mascot.click();
      assert.ok(opened.includes(action), action + ' continua acionável');
    }
  }
});

test("menu inicial posiciona Power BI logo depois de Gastos Pessoais", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "main-menu-powerbi",
    role: "assistant",
    type: "poll",
    question: "👉 QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      { id: "group_personal_expenses", reply: "group_personal_expenses", label: "💰 GASTOS PESSOAIS" },
      { id: "group_supplies", reply: "group_supplies", label: "📦 SUPRIMENTOS" },
      { id: "start_pending_construction_diary", reply: "start_pending_construction_diary", label: "📔 COMEÇAR DIÁRIO DE OBRAS (24/09/2026)" },
    ],
  }] }));
  const dom = new JSDOM(markup);
  const buttons = [...dom.window.document.querySelectorAll(".chat-choice-list > .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), [
    "group_personal_expenses",
    "action_powerbi_dashboard",
    "group_supplies",
    "start_pending_construction_diary",
  ]);
  assert.equal(buttons[1].dataset.label, "📊 POWER BI");
  dom.window.close();
});

test("painel Power BI usa token Microsoft no SDK e renova o token sem autenticação automática no iframe", async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const embeds = [];
  const eventHandlers = new Map();
  const powerBiClient = {
    models: { TokenType: { Aad: 0 } },
    embed(element, config) {
      embeds.push({ element, config });
      return { on(event, handler) { eventHandlers.set(event, handler); }, off() {} };
    },
    reset() {},
  };
  const getAccessToken = async () => "token-renovado";
  const view = createPowerBiDashboardView({ documentRef: dom.window.document, host: root, powerBiClient });

  assert.equal(await view.open({ accessToken: "token-inicial", getAccessToken }), true);
  const dialog = dom.window.document.querySelector('[role="dialog"][aria-label="Painel Power BI ENERGÉTICA"]');
  assert.ok(dialog);
  assert.equal(dialog.querySelector("iframe"), null, "o SDK deve criar o iframe depois de receber a configuração autenticada");
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].config.type, "report");
  assert.equal(embeds[0].config.id, POWERBI_REPORT_ID);
  assert.equal(embeds[0].config.accessToken, "token-inicial");
  assert.equal(embeds[0].config.tokenType, 0);
  assert.match(embeds[0].config.embedUrl, /^https:\/\/app\.powerbi\.com\/reportEmbed\?/);
  assert.match(embeds[0].config.embedUrl, new RegExp(`reportId=${POWERBI_REPORT_ID}`));
  assert.doesNotMatch(embeds[0].config.embedUrl, /autoAuth=true/);
  assert.equal(await embeds[0].config.eventHooks.accessTokenProvider(), "token-renovado");
  assert.equal(dialog.querySelector('a[href^="https://app.powerbi.com/groups/me/reports/"]')?.textContent, "Abrir no Power BI");
  dialog.querySelector('[data-powerbi-close]')?.click();
  assert.equal(dom.window.document.querySelector('[role="dialog"][aria-label="Painel Power BI ENERGÉTICA"]'), null);

  view.destroy();
  dom.window.close();
});

test("cabeçalho do Power BI oferece retorno ao menu principal sem subtítulo ou faixa de conexão", async () => {
  const dom = new JSDOM('<main id="app"></main>');
  let homeCalls = 0;
  const eventHandlers = new Map();
  const powerBiClient = {
    models: { TokenType: { Aad: 0 } },
    embed() { return { on(event, handler) { eventHandlers.set(event, handler); }, off() {} }; },
    reset() {},
  };
  const view = createPowerBiDashboardView({
    documentRef: dom.window.document,
    host: dom.window.document.querySelector("#app"),
    powerBiClient,
  });

  assert.equal(await view.open({
    accessToken: "token",
    getAccessToken: async () => "token",
    onHome: () => { homeCalls += 1; },
  }), true);

  const dialog = dom.window.document.querySelector('[role="dialog"][aria-label="Painel Power BI ENERGÉTICA"]');
  assert.ok(dialog.querySelector(".powerbi-dashboard__back"));
  assert.ok(dialog.querySelector('[data-powerbi-home][aria-label="Ir ao menu principal"]'));
  assert.deepEqual([...dialog.querySelector(".powerbi-dashboard__header").children].map(element => element.className), [
    "screen-navigation",
    "powerbi-dashboard__heading screen-navigation-title",
    "powerbi-dashboard__direct-link",
  ]);
  assert.deepEqual([...dialog.querySelector(".screen-navigation").children].map(button => button.dataset.navigationIcon), ["↩️", "🏠"]);
  assert.equal(dialog.querySelector(".powerbi-dashboard__heading p"), null);
  assert.equal(dialog.querySelector(".powerbi-dashboard__heading h1")?.textContent, "📊 POWER BI");
  assert.equal(dialog.querySelector(".powerbi-dashboard__direct-link")?.textContent, "Abrir no Power BI");

  eventHandlers.get("loaded")?.();
  assert.equal(dialog.querySelector(".powerbi-dashboard__hint")?.hidden, true);
  dialog.querySelector("[data-powerbi-home]").click();
  assert.equal(homeCalls, 1);
  assert.equal(dom.window.document.querySelector('[role="dialog"][aria-label="Painel Power BI ENERGÉTICA"]'), null);

  view.destroy();
  dom.window.close();
});

test("habilita pinça nativa somente enquanto o painel Power BI está aberto", async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const calls = [];
  const powerBiZoom = {
    setEnabled({ enabled }) {
      calls.push(enabled);
      return Promise.resolve();
    },
  };
  const powerBiClient = {
    models: { TokenType: { Aad: 0 } },
    embed() { return { on() {}, off() {} }; },
    reset() {},
  };
  const view = createPowerBiDashboardView({
    documentRef: dom.window.document,
    host: dom.window.document.querySelector("#app"),
    powerBiClient,
    powerBiZoom,
  });

  assert.equal(await view.open({ accessToken: "token", getAccessToken: async () => "token" }), true);
  assert.deepEqual(calls, [true]);
  view.close();
  assert.deepEqual(calls, [true, false]);

  dom.window.close();
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
  const suppliesDoc = suppliesDom.window.document;
  assert.equal(suppliesDoc.querySelector('[data-reply-id="action_construction_visit"]'), null);
  assert.equal(suppliesDoc.querySelector(".chat-supplies-heading"), null);
  assert.equal(suppliesDoc.querySelector(".chat-message--launch-menu .chat-bubble > strong"), null);
  assert.doesNotMatch(suppliesDoc.querySelector(".chat-message--launch-menu .chat-choice-card").textContent, /QUAL FLUXO VOCÊ DESEJA INICIAR/);
  const supplyPairs = [...suppliesDoc.querySelectorAll(".chat-supplies-pair")];
  assert.deepEqual(supplyPairs.map(pair => [...pair.querySelectorAll("[data-reply-id]")].map(button => button.dataset.replyId)), [
    ["new_document", "action_orders_gallery", "action_launch_gallery"],
    ["payment", "action_payment_programming_gallery", "action_provision_description_gallery", "action_recurring_expenses_gallery"],
  ]);
  assert.equal((suppliesMarkup.match(/data-gallery-button/g) || []).length, 5);
  assert.deepEqual([...suppliesDoc.querySelectorAll(".chat-supplies-extras__primary [data-reply-id]")].map(button => button.dataset.replyId), ["registrations"]);
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

test("botões principais de Suprimentos ocupam a altura das galerias correspondentes", () => {
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
  const pairs = [...dom.window.document.querySelectorAll(".chat-supplies-pair")];
  assert.deepEqual(pairs.map(pair => pair.querySelector(".chat-supplies-pair__primary [data-reply-id]")?.dataset.replyId), ["new_document", "payment"]);
  assert.deepEqual(pairs.map(pair => [...pair.querySelectorAll(".chat-gallery-actions button")].map(button => button.textContent)), [
    ["PEDIDOS", "LANÇAMENTOS"],
    ["PGTOS PREVISTOS", "DESCRITIVO PROVISÃO", "DESPESAS RECORRENTES"],
  ]);
  assert.match(styles, /\.chat-supplies-pair\s*\{[^}]*min-height:\s*calc\(2\s*\*\s*var\(--supplies-gallery-height\)\s*\+\s*var\(--supplies-gap\)\)/s);
  assert.match(styles, /\.chat-choice-columns--launch-menu \.chat-gallery-actions\s*\{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(var\(--supplies-gallery-height\),\s*1fr\)\)/s);
  assert.match(styles, /\.chat-supplies-pair, \.chat-supplies-extras\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
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
        { id: "data", label: "📊 OBTER DADOS", reply: "data" },
        { id: "quote", label: "📝 NOVA COTAÇÃO", reply: "quote" },
        { id: "assets", label: "🏷️ IMOBILIZADOS", reply: "assets" },
      ],
    }],
  }));
  const dom = new JSDOM(markup);
  const pairs = [...dom.window.document.querySelectorAll(".chat-supplies-pair")];
  assert.deepEqual([...pairs[1].querySelectorAll("[data-reply-id]")].map(button => [button.dataset.replyId, button.textContent]), [
    ["payment", "📅PGTO PROVISÃO E RECORRENTES"],
    ["action_payment_programming_gallery", "PGTOS PREVISTOS"],
    ["action_provision_description_gallery", "DESCRITIVO PROVISÃO"],
    ["action_recurring_expenses_gallery", "DESPESAS RECORRENTES"],
  ]);
  assert.equal(pairs[1].querySelector('[data-reply-id="payment"]').dataset.label, "💳 PROVISÃO DE PAGAMENTO E DESPESAS RECORRENTES");
  assert.deepEqual([...dom.window.document.querySelectorAll(".chat-supplies-extras__primary [data-reply-id]")].map(button => button.dataset.replyId), ["registrations", "quote", "assets"]);
  assert.equal(dom.window.document.querySelector('[data-reply-id="data"]'), null);
  assert.deepEqual([...dom.window.document.querySelectorAll(".chat-supplies-extra-pair")].map(pair => [...pair.querySelectorAll("[data-reply-id]")].map(button => button.dataset.replyId)), [
    ["registrations"], ["quote", "action_quote_gallery"], ["assets"],
  ]);
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
  const pairs = [...message.querySelectorAll(".chat-menu-gallery-pair")];
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.deepEqual(pairs.map(pair => [...pair.querySelectorAll('[data-reply-id]')].map(button => button.dataset.replyId)), [
    ['add_task', 'action_tasks_gallery'], ['finish_task'], ['delegate_task', 'action_delegated_tasks_gallery'], ['recurring_task', 'action_recurring_tasks_gallery'],
  ]);
  assert.equal(message.querySelectorAll("[data-gallery-button]").length, 3);
  assert.doesNotMatch(markup, /📱 APPS/);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.chat-choice-columns--task-menu\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\)/s);
  dom.window.close();
});

test("botões de todas as galerias têm cantos arredondados como os azuis e mantêm o cinza", () => {
  const messages = [
    {
      id: "gallery-style-launch",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" },
        { id: "payment", label: "💳 PROVISÃO DE PAGAMENTO", reply: "payment" },
      ],
    },
    {
      id: "gallery-style-registration",
      role: "assistant",
      type: "poll",
      question: "📦 SUPRIMENTOS\nEFETUAR CADASTROS\nQUAL CADASTRO VOCÊ DESEJA EFETUAR?",
      options: [
        { id: "register_group", label: "CADASTRAR GRUPO", reply: "register_group" },
        { id: "register_family", label: "CADASTRAR FAMÍLIA", reply: "register_family" },
      ],
    },
    {
      id: "gallery-style-demands",
      role: "assistant",
      type: "poll",
      question: "📋 DEMANDAS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "add_task", label: "ADICIONAR UMA NOVA TAREFA", reply: "add_task" },
        { id: "finish_task", label: "FINALIZAR UMA TAREFA", reply: "finish_task" },
      ],
    },
  ];
  const markup = renderChatMarkup(signedInState({ messages }));
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const dom = new JSDOM(markup);
  const styleElement = dom.window.document.createElement("style");
  styleElement.textContent = styles;
  dom.window.document.head.append(styleElement);

  const blueButton = dom.window.document.querySelector(".chat-choice-list button");
  const expectedRadius = dom.window.getComputedStyle(blueButton).borderRadius;
  const galleryButtons = [...dom.window.document.querySelectorAll(".chat-gallery-actions .chat-choice-button--gallery")];

  assert.equal(expectedRadius, "14px");
  assert.equal(galleryButtons.length, 10);
  for (const button of galleryButtons) {
    assert.equal(dom.window.getComputedStyle(button).borderRadius, expectedRadius, button.textContent);
    assert.equal(dom.window.getComputedStyle(button).backgroundColor, "rgb(69, 76, 83)", button.textContent);
  }

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

test("filtro preserva a ação de cadastro existente quando não corresponde ao texto digitado", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "Swi",
    messages: [{
      id: "supplier-filter",
      role: "assistant",
      type: "poll",
      question: "QUAL FORNECEDOR?",
      databaseFilter: true,
      databaseFilterKey: "supplier",
      options: [
        { id: "supplier:17", label: "17 - WILLIAM SILVA", reply: "17" },
        { id: "supplier:18", label: "18 - MARIA SOUZA", reply: "18" },
        { id: "register_supplier", label: "➕ CADASTRAR FORNECEDOR", reply: "register_supplier" },
      ],
    }],
  }));

  assert.match(markup, /CADASTRAR FORNECEDOR/);
  assert.doesNotMatch(markup, /MARIA SOUZA/);
  assert.doesNotMatch(markup, /WILLIAM SILVA/);
});

test("filtro mantém CADASTRAR NOVO com emoji mesmo quando nenhum registro corresponde", () => {
  const markup = renderChatMarkup(signedInState({
    draft: "Swi",
    messages: [{
      id: "supplier-filter-no-match",
      role: "assistant",
      type: "poll",
      question: "QUAL FORNECEDOR?",
      databaseFilter: true,
      databaseFilterKey: "supplier",
      options: [
        { id: "supplier:17", label: "17 - WILLIAM SILVA", reply: "17" },
        { id: "create_supplier", label: "➕ CADASTRAR NOVO FORNECEDOR", reply: "create_supplier" },
      ],
    }],
  }));

  assert.match(markup, /CADASTRAR NOVO FORNECEDOR/);
  assert.doesNotMatch(markup, /WILLIAM SILVA/);
});

test("filtra fornecedores do agrupamento de lançamento múltiplo enquanto digita sem metadados da VM", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    messages: [{
      id: "multiple-launch-supplier",
      role: "assistant",
      type: "poll",
      question: "🏢 👥 HÁ MAIS DE UM FORNECEDOR NAS LINHAS. QUAL FORNECEDOR DEVE SER USADO PARA AGRUPAR O NOVO PEDIDO? CASO DESEJE FILTRAR, DIGITE UM TEXTO.",
      options: [
        { id: "1", label: "1 - JOSÉ GERALDO DOS SANTOS", reply: "1" },
        { id: "2", label: "2 - FELICIANO ROGÉRIO DA SILVA", reply: "2" },
        { id: "3", label: "3 - HELISON ROSA LUIS", reply: "3" },
        { id: "4", label: "4 - SWILE", reply: "4" },
        { id: "5", label: "5 - COFERMETA", reply: "5" },
      ],
    }],
  });
  const filters = [];
  view.on("draft-changed", command => view.render({ ...state, draft: command.value }));
  view.on("database-filter-changed", command => filters.push(command));
  view.render(state);

  const draft = root.querySelector('[data-role="draft"]');
  assert.equal(draft.placeholder, "Digite para filtrar…");
  assert.equal(draft.dataset.databaseFilterKey, undefined);
  draft.value = "Swi";
  draft.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.equal(root.querySelectorAll(".chat-choice-button").length, 1);
  assert.match(root.textContent, /4 - SWILE/);
  assert.doesNotMatch(root.textContent, /JOSÉ GERALDO|FELICIANO|HELISON|COFERMETA/);
  assert.deepEqual(filters, [], "a busca local não deve ser enviada como resposta do fluxo");

  view.destroy();
  dom.window.close();
});

test("filtro do fornecedor em lançamento múltiplo aceita nomes com mais de duas palavras", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const state = signedInState({
    messages: [{
      id: "multiple-launch-supplier-long-name",
      role: "assistant",
      type: "poll",
      question: "HÁ MAIS DE UM FORNECEDOR NAS LINHAS. QUAL FORNECEDOR DEVE SER USADO PARA AGRUPAR O NOVO PEDIDO?",
      options: [
        { id: "1", label: "1 - JOSÉ GERALDO DOS SANTOS", reply: "1" },
        { id: "2", label: "2 - FELICIANO ROGÉRIO DA SILVA", reply: "2" },
      ],
    }],
  });
  view.on("draft-changed", command => view.render({ ...state, draft: command.value }));
  view.render(state);

  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "José Geraldo dos Santos";
  draft.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.equal(root.querySelectorAll(".chat-choice-button").length, 1);
  assert.match(root.textContent, /JOSÉ GERALDO DOS SANTOS/);
  assert.doesNotMatch(root.textContent, /FELICIANO/);

  view.destroy();
  dom.window.close();
});

test("mantém unidade de medida com estrela no topo e ordena as demais por ID crescente", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    messages: [{
      id: "product-unit-filter",
      role: "assistant",
      type: "poll",
      question: "📦 📏 QUAL É A UNIDADE DE MEDIDA DO PRODUTO? CASO DESEJE FILTRAR, DIGITE UM TEXTO.",
      databaseFilter: true,
      databaseFilterKey: "product-unit",
      options: [
        { id: "27", reply: "27", label: "27 - CAIXA" },
        { id: "13", reply: "13", label: "13 - m" },
        { id: "3", reply: "3", label: "3 - UN" },
        { id: "19", reply: "19", label: "19 - MÊS" },
        { id: "11", reply: "11", label: "11 - ⭐ DIÁRIA (PADRÃO DO PRODUTO)" },
      ],
    }],
  })));

  const buttons = Array.from(dom.window.document.querySelectorAll(".chat-choice-button[data-reply-id]"));
  const labels = buttons.map(button => button.textContent.trim());
  assert.deepEqual(labels, [
    "11 - ⭐ DIÁRIA (PADRÃO DO PRODUTO)",
    "3 - UN",
    "13 - m",
    "19 - MÊS",
    "27 - CAIXA",
  ]);
  assert.deepEqual(buttons.map(button => button.dataset.replyId), ["11", "3", "13", "19", "27"]);
  dom.window.close();
});

test("lista de produtos EPI combina checkbox desmarcado com o botão de quantidade personalizada", () => {
  const poll = {
    id: "epi-products",
    role: "assistant",
    type: "poll",
    question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    databaseFilter: true,
    databaseFilterKey: "document_signing_epi_product",
    options: [{
      id: "612",
      reply: "612",
      label: "612 - CAPACETE DE SEGURANÇA (UN)",
      source_values: { PRODUTO: "CAPACETE DE SEGURANÇA", UNIDADE: "UN" },
    }],
  };
  const baseState = signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [poll],
  });

  const uncheckedMarkup = renderChatMarkup(baseState);
  assert.match(uncheckedMarkup, /data-action="epi-product-select-toggle"/);
  assert.doesNotMatch(uncheckedMarkup, /data-action="epi-product-select-toggle"[^>]* checked/);
  assert.match(uncheckedMarkup, /data-action="select-reply" data-reply-id="612"/);
  assert.doesNotMatch(uncheckedMarkup, /data-reply-id="document_line_finalize"/);

  const selectedMarkup = renderChatMarkup({
    ...baseState,
    messages: [{ ...poll, epiSelectedProductIds: ["612"] }],
  });
  assert.match(selectedMarkup, /data-action="epi-product-select-toggle"[^>]* checked/);
  assert.match(selectedMarkup, /data-reply-id="document_line_finalize"[^>]*>✅ FINALIZAR</);
  const dom = new JSDOM(selectedMarkup);
  const row = dom.window.document.querySelector(".chat-epi-product-row");
  assert.equal(row.textContent.match(/612 - CAPACETE DE SEGURANÇA \(UN\)/g)?.length, 1);
  assert.ok(row.querySelector('input[aria-label="Selecionar 612 - CAPACETE DE SEGURANÇA (UN)"]'));
  assert.ok(row.querySelector(".chat-choice-button"));
  assert.ok(dom.window.document.querySelector(".chat-epi-product-select.chat-choice-list"));
  assert.equal(dom.window.document.querySelector('[data-reply-id="document_line_finalize"]').classList.contains("chat-choice-button--finish"), false);
  dom.window.close();
});

test("checkbox de produto EPI emite a opção selecionada", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const changes = [];
  const state = signedInState({
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
    messages: [{
      id: "epi-products",
      role: "assistant",
      type: "poll",
      question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
      databaseFilterKey: "document_signing_epi_product",
      options: [{ id: "612", reply: "612", label: "612 - CAPACETE DE SEGURANÇA (UN)" }],
    }],
  });
  view.on("epi-product-selection-changed", command => {
    changes.push(command);
    view.render({
      ...state,
      messages: [{ ...state.messages[0], epiSelectedProductIds: [command.productId] }],
    });
  });
  view.render(state);

  const checkbox = root.querySelector('[data-action="epi-product-select-toggle"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  assert.deepEqual(changes, [{ type: "epi-product-selection-changed", productId: "612", selected: true }]);
  assert.equal(root.ownerDocument.activeElement?.dataset?.productId, "612");
  view.destroy();
  dom.window.close();
});

test("selecionar todos os EPI emite uma seleção em lote e reflete o estado marcado", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const changes = [];
  const poll = {
    id: "epi-products", role: "assistant", type: "poll",
    question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    databaseFilterKey: "document_signing_epi_product",
    options: [
      { id: "612", reply: "612", label: "612 - CAPACETE" },
      { id: "613", reply: "613", label: "613 - LUVA" },
    ],
  };
  const state = signedInState({ activeFlow: { id: "document_signing" }, messages: [poll] });
  view.on("epi-product-select-all", command => {
    changes.push(command);
    view.render({ ...state, messages: [{ ...poll, epiSelectedProductIds: command.selected ? command.productIds : [] }] });
  });
  view.render(state);
  root.querySelector('[data-action="epi-product-select-all"]').click();
  assert.deepEqual(changes, [{ type: "epi-product-select-all", productIds: ["612", "613"], selected: true }]);
  assert.equal(root.querySelectorAll('input[data-action="epi-product-select-toggle"]:checked').length, 2);
  assert.equal(root.querySelector('[data-action="epi-product-select-all"]').checked, true);
  root.querySelector('[data-action="epi-product-select-all"]').click();
  assert.deepEqual(changes.at(-1), { type: "epi-product-select-all", productIds: ["612", "613"], selected: false });
  assert.equal(root.querySelectorAll('input[data-action="epi-product-select-toggle"]:checked').length, 0);
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

test("gera lixeira para opções reais de documentos pendentes sem metadados de exclusão", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "pending-documents",
      role: "assistant",
      type: "poll",
      question: "📄 QUAL DOCUMENTO PENDENTE DESEJA ATUALIZAR? CASO DESEJE FILTRAR, DIGITE UM TEXTO.",
      options: [
        { id: "document:262", reply: "document:262", label: "262 - RAYNER CORREIA DE CASTRO (CONTRATO)" },
        { id: "sign_document:282", reply: "sign_document:282", label: "✍️ ASSINAR — 282 - MAURO ANTONIO PEREIRA (COMPROVANTE PAGAMENTO)" },
        { id: "done", reply: "done", label: "CONCLUIR", terminal_option: true },
      ],
    }],
  }));

  assert.equal((markup.match(/class="chat-document-option"/g) || []).length, 2);
  assert.match(markup, /class="chat-document-option__delete"[^>]*data-reply-id="pending_document_delete:262"/);
  assert.match(markup, /class="chat-document-option__delete"[^>]*data-reply-id="pending_document_delete:282"/);
  assert.match(markup, /data-reply-id="done"/);
});

test("não cria lixeira para opções numéricas fora da pergunta de documentos pendentes", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "suppliers",
      role: "assistant",
      type: "poll",
      question: "QUAL FORNECEDOR DEVE SER USADO?",
      options: [{ id: "262", reply: "262", label: "262 - FORNECEDOR" }],
    }],
  }));

  assert.doesNotMatch(markup, /chat-document-option__delete/);
});

test("lixeira de documento pendente abre confirmação e só o Sim envia a exclusão", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const replies = [];
  view.on("select-reply", command => replies.push(command));
  view.render(signedInState({ messages: [{
    id: "pending-documents", role: "assistant", type: "poll",
    question: "QUAL DOCUMENTO PENDENTE DESEJA ATUALIZAR?",
    options: [{ id: "document:262", reply: "document:262", label: "262 - DOCUMENTO", delete_action: {
      id: "pending_document_delete:262", reply: "pending_document_delete:262", title: "🗑️ EXCLUIR",
    } }],
  }] }));

  const row = root.querySelector(".chat-document-option");
  assert.equal(row.firstElementChild.className, "chat-document-option__delete");
  row.firstElementChild.click();
  assert.match(root.querySelector("[data-pending-document-delete-dialog]").textContent, /TEM CERTEZA QUE DESEJA DELETAR O ITEM\?/);
  assert.equal(replies.length, 0);
  root.querySelector('[data-action="cancel-pending-document-delete"]').click();
  assert.equal(root.querySelector("[data-pending-document-delete-dialog]"), null);
  assert.equal(replies.length, 0);

  root.querySelector(".chat-document-option__delete").click();
  root.querySelector('[data-action="confirm-pending-document-delete"]').click();
  assert.equal(root.querySelector("[data-pending-document-delete-dialog]"), null);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].replyId, "pending_document_delete_confirmed:262");
  view.destroy();
  dom.window.close();
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
    ["[data-pending-provisions-dialog]", "dismiss-pending-provisions"],
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

test("data paga ordena hoje antes de ontem e exibe a estrela sem alterar o texto enviado", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let selected;
  view.on("select-reply", command => { selected = command; });
  view.render(signedInState({
    messages: [{
      id: "effective-payment-date",
      role: "assistant",
      type: "poll",
      question: "📅 QUAL É A DATA DE PAGAMENTO EFETUADO?",
      options: [
        { id: "blank", label: "⬜ EM BRANCO" },
        { id: "yesterday", label: "🔴 📆 ONTEM" },
        { id: "today", label: "📅 HOJE", recommendedDate: true },
        { id: "tomorrow", label: "🔵 AMANHÃ" },
        { id: "other", label: "👈 OUTRA DATA" },
      ],
    }],
  }));

  const buttons = [...root.querySelectorAll(".chat-message:last-of-type .chat-choice-button")];
  assert.deepEqual(buttons.map(button => button.dataset.replyId), ["blank", "today", "yesterday", "tomorrow", "other"]);
  assert.match(buttons[1].textContent, /⭐/);
  assert.equal(buttons[1].dataset.label, "📅 HOJE");
  buttons[1].click();
  assert.equal(selected.replyId, "today");
  assert.equal(selected.label, "📅 HOJE");

  view.destroy();
  dom.window.close();
});

test("data prevista personalizada fica em primeiro com estrela mas envia somente a data", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let selected;
  view.on("select-reply", command => { selected = command; });
  view.render(signedInState({
    messages: [{
      id: "effective-payment-date-custom",
      role: "assistant",
      type: "poll",
      question: "📅 QUAL É A DATA DE PAGAMENTO EFETUADO?",
      options: [
        { label: "31/12/2099", recommendedDate: true },
        { id: "blank", label: "⬜ EM BRANCO" },
        { id: "yesterday", label: "🔴 📆 ONTEM" },
        { id: "today", label: "📅 HOJE" },
      ],
    }],
  }));

  const buttons = [...root.querySelectorAll(".chat-message:last-of-type .chat-choice-button")];
  assert.equal(buttons[0].dataset.label, "31/12/2099");
  assert.match(buttons[0].textContent, /⭐/);
  assert.deepEqual(buttons.map(button => button.dataset.replyId), ["", "blank", "today", "yesterday"]);
  buttons[0].click();
  assert.equal(selected.replyId, undefined);
  assert.equal(selected.label, "31/12/2099");

  view.destroy();
  dom.window.close();
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

test("formata CPF e muda para CNPJ ao ultrapassar onze dígitos na assinatura de documentos", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const drafts = [];
  view.on("draft-changed", command => drafts.push(command.value));
  view.render(signedInState({
    messages: [{
      id: "supplier-document", role: "assistant", type: "text",
      text: "O FORNECEDOR SELECIONADO ESTÁ SEM CPF/CNPJ NO CADASTRO. DESEJA APONTAR O CPF/CNPJ PARA ESTE COMPROVANTE?",
    }],
  }));
  const draft = root.querySelector('[data-role="draft"]');
  assert.equal(draft.inputMode, "numeric");
  for (const [raw, expected] of [
    ["1234", "123.4"],
    ["12345678901", "123.456.789-01"],
    ["123456789012", "12.345.678/9012"],
    ["12345678901234", "12.345.678/9012-34"],
    ["1234567890123456", "12.345.678/9012-34"],
  ]) {
    draft.value = raw;
    draft.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    assert.equal(draft.value, expected);
  }
  assert.equal(drafts.at(-1), "12.345.678/9012-34");
  view.destroy();
  dom.window.close();
});

test("a máscara de CPF/CNPJ não interfere em outras perguntas ou na resposta em envio", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const question = { id: "supplier-document", role: "assistant", type: "text",
    text: "DESEJA APONTAR O CPF/CNPJ PARA ESTE COMPROVANTE?" };
  view.render(signedInState({ activeText: "12345678901", messages: [question] }));
  let draft = root.querySelector('[data-role="draft"]');
  assert.notEqual(draft.dataset.documentIdInput, "true");
  view.render(signedInState({ messages: [question, { id: "next", role: "assistant", type: "text", text: "Informe o nome." }] }));
  draft = root.querySelector('[data-role="draft"]');
  assert.notEqual(draft.dataset.documentIdInput, "true");
  draft.value = "12345678901";
  draft.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertText" }));
  assert.equal(draft.value, "12345678901");
  view.destroy();
  dom.window.close();
});

test("apagar a pontuação automática do CPF remove o dígito anterior", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({ messages: [{ id: "supplier-document", role: "assistant", type: "text",
    text: "DESEJA APONTAR O CPF/CNPJ PARA ESTE COMPROVANTE?" }] }));
  const draft = root.querySelector('[data-role="draft"]');
  draft.value = "123.4";
  draft.setSelectionRange(4, 4);
  draft.dispatchEvent(new dom.window.InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward" }));
  draft.value = "1234";
  draft.setSelectionRange(3, 3);
  draft.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  assert.equal(draft.value, "124");
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

test("Auditoria e Documentos usa duas colunas e põe Galeria Documentos primeiro à direita", () => {
  const markup = renderChatMarkup(signedInState({
    messages: [{
      id: "audit-menu",
      role: "assistant",
      type: "poll",
      question: "🔎 AUDITORIA E DOCUMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
      options: [
        { id: "audit_log", label: "🧾 LOG DE AÇÕES", reply: "audit_log" },
        { id: "action_document", label: "📄 ADICIONAR UM NOVO DOCUMENTO", reply: "action_document" },
        { id: "action_documents_gallery", label: "GALERIA DUPLICADA DO SERVIDOR", reply: "action_documents_gallery" },
      ],
    }],
  }));

  assert.match(markup, /chat-choice-columns--audit-menu/);
  assert.match(markup, /chat-message--audit-menu/);
  assert.match(markup, /data-reply-id="action_documents_gallery"[^>]*>📄 GALERIA DOCUMENTOS/);
  assert.equal((markup.match(/data-reply-id="action_documents_gallery"/g) || []).length, 1);
  const primaryStart = markup.indexOf('class="chat-choice-columns__primary"');
  const secondaryStart = markup.indexOf('class="chat-choice-columns__secondary"');
  assert.ok(primaryStart >= 0 && secondaryStart > primaryStart);
  assert.doesNotMatch(markup.slice(primaryStart, secondaryStart), /action_documents_gallery/);
  assert.match(markup.slice(secondaryStart), /data-reply-id="action_documents_gallery"/);
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

test("diário troca abandonar por finalizar na etapa de anexos e mantém o atalho superior", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    activeFlow: { id: "construction_diary_fill" },
    attachments: Array.from({ length: 4 }, (_, index) => ({
      id: `photo-${index}`, fileName: `foto-${index}.jpg`, mimeType: "image/jpeg",
      mediaUrl: `/api/portal-media/photo-${index}`,
    })),
    messages: [{ id: "diary-attachments", role: "assistant", type: "poll",
      question: "ENVIE UMA FOTO OU UM PDF. AS FOTOS SERÃO ORGANIZADAS NO PDF FINAL.",
      options: [
        { id: "attachment_upload_continue", label: "ENVIAR ANEXO" },
        { id: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" },
      ],
    }],
  })));
  assert.equal(dom.window.document.querySelectorAll('[data-action="finish-flow"]').length, 2);
  assert.equal(dom.window.document.querySelector('[data-reply-id="abandon_construction_diary"]'), null);
  assert.match(dom.window.document.querySelector('.chat-choice-list').textContent, /ENVIAR ANEXO.*FINALIZAR/s);
  assert.match(dom.window.document.body.textContent, /Anexos \(4\)/);
  dom.window.close();
});

test("diário preserva abandonar na pergunta de atividades e desativa os dois finalizar durante envio", () => {
  const state = signedInState({ activeFlow: { id: "construction_diary_fill" },
    messages: [{ role: "assistant", type: "poll", question: "DIGITE AS ATIVIDADES EXECUTADAS:",
      options: [{ id: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" }],
    }],
  });
  assert.match(renderChatMarkup(state), /data-reply-id="abandon_construction_diary"/);
  assert.doesNotMatch(renderChatMarkup(state), /data-action="finish-flow"/);
  state.messages[0].options.unshift({ id: "attachment_upload_continue", label: "ENVIAR ANEXO" });
  state.messages[0].question = "ENVIE UMA FOTO OU UM PDF.";
  state.activeText = { id: "sending" };
  const dom = new JSDOM(renderChatMarkup(state));
  const buttons = [...dom.window.document.querySelectorAll('[data-action="finish-flow"]')];
  assert.equal(buttons.length, 2);
  assert.equal(buttons.every(button => button.disabled), true);
  dom.window.close();
});

test("diário não duplica finalizar quando a VM já oferece essa opção", () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({
    activeFlow: { id: "construction_diary_create" },
    messages: [{ role: "assistant", type: "poll", question: "ENVIE UMA FOTO OU UM PDF.",
      options: [
        { id: "attachment_upload_continue", label: "ENVIAR ANEXO" },
        { id: "server-finish", reply: "server-finish", label: "✅ FINALIZAR" },
        { id: "abandon_construction_diary", label: "ABANDONAR DIÁRIO DE OBRAS" },
      ],
    }],
  })));
  assert.equal(dom.window.document.querySelectorAll('.chat-choice-list [data-action="finish-flow"]').length, 1);
  assert.equal(dom.window.document.querySelectorAll('.chat-choice-list button').length, 2);
  assert.equal(dom.window.document.querySelector('[data-reply-id="server-finish"]'), null);
  assert.equal(dom.window.document.querySelector('[data-reply-id="abandon_construction_diary"]'), null);
  dom.window.close();
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

test('documento reconhece a bandeja sem liberar anexos pendentes ou alterar etapas antigas', () => {
  const prompt = { id: 'first', role: 'assistant', type: 'poll',
    question: 'ENVIE O PRIMEIRO ANEXO DO DOCUMENTO. DEPOIS DE CADA ENVIO, VOCÊ PODERÁ ADICIONAR MAIS ANEXOS OU FINALIZAR.',
    options: [{ id: 'attachment_upload_continue', label: 'ENVIAR ANEXO' }] };
  const attachment = { id: 'ready', fileName: 'teste.pdf', mimeType: 'application/pdf', size: 3, mediaUrl: '/api/portal-media/ready' };
  const base = { activeFlow: { id: 'document' }, messages: [prompt] };
  for (const attachments of [[], [{ ...attachment, mediaUrl: '' }], [{ ...attachment, existing: true }], [{ ...attachment, readOnly: true }]]) {
    const dom = new JSDOM(renderChatMarkup(signedInState({ ...base, attachments,
      pendingFiles: [{ id: 'pending', file: { name: 'pendente.pdf' }, status: 'pending' }] })));
    assert.equal(dom.window.document.querySelector('.chat-choice-list [data-action="finish-flow"]'), null);
    dom.window.close();
  }
  const markup = renderChatMarkup(signedInState({ ...base, attachments: [attachment, { ...attachment, id: 'ready-2' }] }));
  const dom = new JSDOM(markup);
  assert.match(dom.window.document.querySelector('.chat-bubble').textContent, /2 JÁ ADICIONADOS/);
  assert.ok(dom.window.document.querySelector('.chat-choice-list [data-action="finish-flow"]'));
  assert.equal(prompt.options.length, 1, 'a projeção não muda o snapshot original');
  assert.match(prompt.question, /PRIMEIRO ANEXO/);
  dom.window.close();

  for (const overrides of [
    { activeFlow: { id: 'task' } },
    { messages: [prompt, { id: 'description', role: 'assistant', type: 'text', text: 'Qual é a descrição?' }] },
  ]) {
    const dom = new JSDOM(renderChatMarkup(signedInState({ ...base, attachments: [attachment], ...overrides })));
    assert.equal(dom.window.document.querySelector('.chat-choice-list [data-action="finish-flow"]'), null);
    dom.window.close();
  }
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

test("confirmação de lançamento único mostra valores preenchidos antes das ações", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR UNITÁRIO", value: "175,3333333" },
      { label: "QUANTIDADE", value: "3" },
      { label: "FRETE", value: "12,50" },
      { label: "VALOR TOTAL DO PEDIDO", value: "R$ 538,50" },
    ], launches: { count: 1, lines: [
      { unitPrice: "175.3333333", quantity: "3", freight: "12.50", total: "538.50" },
    ] } },
    messages: [{ id: "confirmar-lancamento", role: "assistant", type: "poll",
      question: "✅ CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
      options: [{ id: "yes", label: "✅ SIM" }, { id: "edit", label: "✏️ EDITAR" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const card = dom.window.document.querySelector(".chat-choice-card");
  const table = card.querySelector('[aria-label="Conferência do lançamento único"]');
  assert.ok(table);
  assert.deepEqual([...table.querySelectorAll("dt")].map(node => node.textContent),
    ["VLOR UN.", "QTD", "FRETE", "TOTAL"]);
  assert.deepEqual([...table.querySelectorAll("dd")].map(node => node.textContent.replace(/\s/g, " ").trim()),
    ["R$ 175,3333333", "3", "R$ 12,50", "R$ 538,50"]);
  assert.ok(card.querySelector("p").compareDocumentPosition(table) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(table.compareDocumentPosition(card.querySelector('[data-reply-id="yes"]')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("não mostra conferência de lançamento único na confirmação de múltiplas linhas", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR UNITÁRIO", value: "100" }, { label: "QUANTIDADE", value: "2" },
    ] },
    messages: [{ id: "confirmar-lancamentos", role: "assistant", type: "poll",
      question: "CONFIRMA A CRIAÇÃO DESTES LANÇAMENTOS NO SHAREPOINT?",
      options: [{ id: "yes", label: "SIM" }],
    }],
  }));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
});

test("não mostra quadro de lançamento único quando a VM confirma duas linhas com pergunta no singular", () => {
  const store = createConversationStore({ historyMode: "current-step" });
  store.ingestRemoteMessages([{ type: "poll", question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
    options: [{ id: "yes", label: "SIM" }] }], { activeFlow: {
    id: "launch", title: "EFETUAR LANÇAMENTO", rows: [{ label: "VALOR TOTAL DO PEDIDO", value: "R$ 2.000,00" }],
    launches: { id: "batch-2", currency: "BRL", count: 2, total: "2000", totalDisplay: "R$ 2.000,00",
      lines: [1, 2].map(index => ({ index, product: `SERVIÇO ${index}`, unit: "UN", quantity: "1",
        unitPrice: "1000", unitPriceDisplay: "R$ 1.000,00", freight: "0", freightDisplay: "R$ 0,00",
        total: "1000", totalDisplay: "R$ 1.000,00" })),
    },
  } });
  assert.equal(store.getState().activeFlow.launches.count, 2);
  const markup = renderChatMarkup(signedInState(store.getState()));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
});

test("confirmação de uma linha usa preço, quantidade e frete da linha mesmo quando rows só contém total", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR TOTAL DO PEDIDO", value: "R$ 2.000,00" },
    ], launches: { count: 1, lines: [
      { unitPrice: "1000", quantity: "2", freight: "0", total: "2000", totalDisplay: "R$ 2.000,00" },
    ] } },
    messages: [{ id: "confirmar-lancamento", role: "assistant", type: "poll",
      question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
      options: [{ id: "yes", label: "SIM" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const values = [...dom.window.document.querySelectorAll(".chat-single-launch-confirmation dd")].map(node => node.textContent);
  assert.deepEqual(values, ["R$ 1.000,00", "2", "R$ 0,00", "R$ 2.000,00"]);
  dom.window.close();
});

test("não mostra quadro de lançamento único sem linha concluída na VM", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR TOTAL DO PEDIDO", value: "R$ 2.000,00" },
    ], launches: { count: 0, lines: [] } },
    messages: [{ id: "confirmar-lancamento", role: "assistant", type: "poll",
      question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
      options: [{ id: "yes", label: "SIM" }],
    }],
  }));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
});

test("não mostra linha já capturada quando o resumo total inclui outra linha corrente", () => {
  const store = createConversationStore({ historyMode: "current-step" });
  store.ingestRemoteMessages([{ type: "poll", question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
    options: [{ id: "yes", label: "SIM" }] }], { activeFlow: {
    id: "launch", title: "EFETUAR LANÇAMENTO", rows: [{ label: "VALOR TOTAL DO PEDIDO", value: "R$ 2.000,00" }],
    launches: { id: "batch-with-current", currency: "BRL", count: 1, total: "1000", totalDisplay: "R$ 1.000,00",
      lines: [{ index: 1, product: "SERVIÇO A", unit: "UN", quantity: "1", unitPrice: "1000",
        unitPriceDisplay: "R$ 1.000,00", freight: "0", freightDisplay: "R$ 0,00",
        total: "1000", totalDisplay: "R$ 1.000,00" }],
    },
  } });
  assert.equal(store.getState().activeFlow.launches.count, 1);
  const markup = renderChatMarkup(signedInState(store.getState()));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
});

test("resposta real normalizada mantém preço e quantidade da única linha no quadro de confirmação", () => {
  const store = createConversationStore({ historyMode: "current-step" });
  store.ingestRemoteMessages([{ type: "poll", question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?",
    options: [{ id: "yes", label: "SIM" }] }], { activeFlow: {
    id: "launch", title: "EFETUAR LANÇAMENTO", rows: [{ label: "VALOR TOTAL DO PEDIDO", value: "R$ 2.000,00" }],
    launches: { id: "batch-1", currency: "BRL", count: 1, total: "2000", totalDisplay: "R$ 2.000,00",
      lines: [{ index: 1, product: "SERVIÇO", unit: "UN", quantity: "2", unitPrice: "1000",
        unitPriceDisplay: "R$ 1.000,00", freight: "0", freightDisplay: "R$ 0,00",
        total: "2000", totalDisplay: "R$ 2.000,00" }],
    },
  } });
  const activeFlow = store.getState().activeFlow;
  assert.equal(activeFlow.launches.count, 1);
  const dom = new JSDOM(renderChatMarkup(signedInState(store.getState())));
  const values = [...dom.window.document.querySelectorAll(".chat-single-launch-confirmation dd")].map(node => node.textContent);
  assert.deepEqual(values, ["R$ 1.000,00", "2", "R$ 0,00", "R$ 2.000,00"]);
  dom.window.close();
});

test("total da conferência usa o cálculo informado pela VM, não o valor unitário arredondado", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR UNITÁRIO", value: "R$ 175,33" },
      { label: "QUANTIDADE", value: "3" },
      { label: "FRETE", value: "R$ 0,00" },
      { label: "VALOR TOTAL DO PEDIDO", value: "R$ 526,00" },
    ], launches: { count: 1, lines: [
      { unitPrice: "175.33", quantity: "3", freight: "0", total: "526" },
    ] } },
    messages: [{ id: "confirmar-lancamento", role: "assistant", type: "poll",
      question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?", options: [{ id: "confirm_yes", label: "SIM" }],
    }],
  }));
  const dom = new JSDOM(markup);
  const values = [...dom.window.document.querySelectorAll(".chat-single-launch-confirmation dd")].map(node => node.textContent);
  assert.deepEqual(values, ["R$ 175,33", "3", "R$ 0,00", "R$ 526,00"]);
  dom.window.close();
});

test("não exibe conferência sem linha confirmada pela VM", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR UNITÁRIO", value: "100" }, { label: "QUANTIDADE", value: "2" },
    ] },
    messages: [{ id: "confirmar-lancamento", role: "assistant", type: "poll",
      question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?", options: [{ id: "confirm_yes", label: "SIM" }],
    }],
  }));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
});

test("não reabre a tabela em uma confirmação antiga durante a edição", () => {
  const markup = renderChatMarkup(signedInState({
    activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO", rows: [
      { label: "VALOR UNITÁRIO", value: "100" },
      { label: "VALOR TOTAL DO PEDIDO", value: "R$ 100,00" },
    ], launches: { count: 1, lines: [
      { unitPrice: "100", quantity: "1", freight: "0", total: "100" },
    ] } },
    messages: [
      { id: "confirmar-antigo", role: "assistant", type: "poll",
        question: "CONFIRMA A CRIAÇÃO DESTE LANÇAMENTO NO SHAREPOINT?", options: [{ id: "confirm_edit", label: "EDITAR" }] },
      { id: "editar", role: "assistant", type: "poll", question: "QUAL CAMPO DESEJA EDITAR?",
        options: [{ id: "unit", label: "VALOR UNITÁRIO" }] },
    ],
  }));
  assert.doesNotMatch(markup, /Conferência do lançamento único/);
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

test("oculta opções legadas de rascunho enviadas por uma VM antiga", () => {
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

  assert.doesNotMatch(markup, /data-reply-id="draft_resume:abc"/);
  assert.doesNotMatch(markup, /data-reply-id="draft_delete:abc"/);
});

test("pendências não exibe rascunhos antigos e confirmação de abandono mantém as duas escolhas", () => {
  const pending = renderChatMarkup(signedInState({ messages: [{
    id: "pending-menu", role: "assistant", type: "poll", question: "PENDÊNCIAS",
    options: [{ id: "draft_menu", label: "📝 RASCUNHOS AGUARDANDO (1)" },
      { id: "pending_payment_provisions", label: "PROVISÕES" }],
  }] }));
  assert.doesNotMatch(pending, /data-reply-id="draft_menu"/);
  assert.match(pending, /data-reply-id="pending_payment_provisions"/);

  const confirmation = renderChatMarkup(signedInState({ messages: [{
    id: "abandon", role: "assistant", type: "poll",
    question: "TEM CERTEZA QUE DESEJA ABANDONAR ESTE FLUXO? TODOS OS REGISTROS PENDENTES SERÃO PERDIDOS.",
    options: [{ id: "portal_draft_exit_discard", label: "SIM, ABANDONAR" },
      { id: "portal_draft_exit_cancel", label: "NÃO, CONTINUAR" }],
  }] }));
  assert.match(confirmation, /data-reply-id="portal_draft_exit_discard"/);
  assert.match(confirmation, /data-reply-id="portal_draft_exit_cancel"/);
  assert.doesNotMatch(confirmation, /CRIAR RASCUNHO/);

  const transfer = renderChatMarkup(signedInState({ messages: [{
    id: "transfer", role: "assistant", type: "poll", question: "TRANSFERIR ANEXOS?",
    options: [{ id: "portal_transfer_draft_discard", label: "SIM, TRANSFERIR" },
      { id: "portal_transfer_cancel", label: "NÃO, CONTINUAR" }],
  }] }));
  assert.match(transfer, /data-reply-id="portal_transfer_draft_discard"/);
  assert.match(transfer, /data-reply-id="portal_transfer_cancel"/);
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

test("PDF existente de documentos pendentes abre a assinatura pela mãozinha da bandeja", () => {
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  view.render(signedInState({
    activeFlow: { id: "pending_document_attachment", title: "DOCUMENTOS PENDENTES" },
    attachments: [{ id: "rhid", fileName: "PONTO-RHID-17-2026-09.pdf", mimeType: "application/pdf", existing: true, readOnly: true }],
  }));
  const sign = root.querySelector('[data-action="open-signature-pad"][data-file-id="rhid"]');
  assert.ok(sign, "o PDF já anexado deve permitir assinatura");
  assert.equal(root.querySelector('[data-action="remove-attachment"]'), null);
  assert.equal(root.querySelector('[data-action="compress-attachment"]'), null);
  sign.click();
  assert.ok(root.querySelector('[data-role="signature-pad"]'), "a mãozinha abre o desenho existente");
  view.destroy();
  dom.window.close();
});

test("assinatura de PDF existente respeita o fluxo, o tipo de arquivo e o processamento", () => {
  for (const [flowId, fileName, busy] of [
    ["task", "contrato.pdf", false],
    ["pending_document_attachment", "foto.jpg", false],
    ["pending_document_attachment", "contrato.pdf", true],
  ]) {
    const dom = new JSDOM(renderChatMarkup(signedInState({
      busy,
      activeText: busy ? { id: "sending" } : null,
      activeFlow: { id: flowId, title: "FLUXO" },
      attachments: [{ id: "old", fileName, existing: true, readOnly: true }],
    })));
    const sign = dom.window.document.querySelector('[data-action="open-signature-pad"][data-file-id="old"]');
    if (busy) assert.equal(sign?.disabled, true);
    else assert.equal(sign, null);
    dom.window.close();
  }
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
      screenX: 120,
      screenY: clientY + 500,
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

test("toque no título ainda fecha a bandeja quando o WebView cancela o ponteiro antes do touchend", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointer = (type, target) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 77, pointerType: "touch", isPrimary: true, clientX: 20, clientY: 20,
    })) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
  };
  const finger = { identifier: 9, clientX: 20, clientY: 20 };
  const touch = (type, target, touches, changedTouches) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", summary);
  touch("touchstart", summary, [finger], [finger]);
  pointer("pointercancel", root);
  touch("touchend", root, [], [finger]);
  summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

  assert.equal(details.open, false);
  view.destroy();
  dom.window.close();
});

test("offset de coordenadas no touchend não transforma toque no título em rolagem", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointer = (type, target, clientY = 20) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 78, pointerType: "touch", isPrimary: true, clientX: 20, clientY,
    })) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
  };
  const start = { identifier: 10, clientX: 20, clientY: 20 };
  const shiftedRelease = { identifier: 10, clientX: 20, clientY: 46 };
  const touch = (type, target, touches, changedTouches) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
    target.dispatchEvent(event);
  };

  pointer("pointerdown", summary);
  touch("touchstart", summary, [start], [start]);
  pointer("pointercancel", root);
  // iOS may report a shifted release point after its pointer stream is
  // cancelled, without delivering a touchmove for a physical scroll.
  touch("touchend", root, [], [shiftedRelease]);
  summary.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

  assert.equal(details.open, false);
  view.destroy();
  dom.window.close();
});

test("mudança do viewport sob o dedo não cancela o fechamento da bandeja", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointer = (type, clientY) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: 81,
      pointerType: "touch",
      isPrimary: true,
      clientX: 20,
      clientY,
      screenX: 140,
      screenY: 620,
    })) Object.defineProperty(event, key, { value, configurable: true });
    return event;
  };

  summary.dispatchEvent(pointer("pointerdown", 20));
  // WKWebView can move the visual viewport under a stationary finger. The
  // client coordinate changes, but the physical screen coordinate does not.
  root.dispatchEvent(pointer("pointermove", 48));
  root.dispatchEvent(pointer("pointerup", 48));

  assert.equal(details.open, false, "um toque parado no título deve fechar a bandeja após um ajuste do viewport");
  view.destroy();
  dom.window.close();
});

test("toque do iPhone completa coordenadas físicas ausentes no pointerdown", () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(signedInState({
    attachments: [{ id: "file-1", fileName: "comprovante.pdf", mimeType: "application/pdf", size: 20 }],
  }));
  const details = root.querySelector(".chat-attachments");
  details.open = true;
  const summary = details.querySelector("summary");
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerDown, {
    pointerId: { value: 82 }, pointerType: { value: "touch" }, isPrimary: { value: true },
    clientX: { value: 20 }, clientY: { value: 20 },
  });
  const finger = (clientY, screenY) => ({ identifier: 12, clientX: 20, clientY, screenX: 140, screenY });
  const touch = (type, target, current, changed = current) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: type === "touchend" ? [] : [current] },
      changedTouches: { value: [changed] },
    });
    target.dispatchEvent(event);
  };

  summary.dispatchEvent(pointerDown);
  touch("touchstart", summary, finger(20, 620));
  touch("touchmove", root, finger(48, 620));
  touch("touchend", root, finger(48, 620));

  assert.equal(details.open, false, "o touchstart deve fornecer a coordenada de tela se pointerdown não a trouxe");
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

test("relatório RHID mostra navegação diária centrada sem o cabeçalho Energético nem o título redundante", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-nav-25", role: "assistant", type: "poll",
    question: "📊 RELATÓRIO DE PRESENÇAS RHID — 25/09/2026", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-25", title: "📋 PRESENÇAS • 25/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
      rows: [["ANA", "07:00", "12:00", "05:00"]],
    },
  }] }));
  const dom = new JSDOM(markup);
  const report = dom.window.document.querySelector(".chat-message--rhid-report");
  const navigation = report.querySelector(".chat-rhid-date-navigation");
  const buttons = navigation?.querySelectorAll("button") || [];

  assert.equal(report.querySelector(".chat-bubble > strong"), null, "remove a marca no início do cartão RHID");
  assert.equal(report.querySelector(".chat-choice-card > p"), null, "não repete o título com emoji de gráfico");
  assert.equal(navigation.querySelector("time")?.textContent, "25/09/2026");
  assert.equal(buttons.length, 3);
  assert.equal(commandFromTarget(buttons[0]).type, "rhid-attendance-report-navigate");
  assert.deepEqual(
    { messageId: commandFromTarget(buttons[0]).messageId, value: commandFromTarget(buttons[0]).value },
    { messageId: "rhid-nav-25", value: "-1" },
  );
  assert.deepEqual(
    { messageId: commandFromTarget(buttons[2]).messageId, value: commandFromTarget(buttons[2]).value },
    { messageId: "rhid-nav-25", value: "1" },
  );
  assert.match(report.textContent, /PRESENÇAS/);
  assert.doesNotMatch(report.textContent, /RELATÓRIO DE PRESENÇAS RHID/);
  dom.window.close();
});

test("ícone de calendário abre o relatório exibido na data atual e consulta a data selecionada no mesmo cartão", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const requests = [];
  view.on("rhid-attendance-report-generate", event => requests.push(event));
  view.render(signedInState({
    activeFlow: { title: "👥 RECURSOS HUMANOS" },
    messages: [{
      id: "rhid-calendar-25", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
      detail_table: {
        kind: "rhid_attendance", reportDate: "2026-09-25", title: "PRESENÇAS • 25/09/2026",
        headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
        rows: [["ANA", "07:00", "12:00", "05:00"]],
      },
    }],
  }));

  const calendar = root.querySelector('.chat-flow-status [data-action="open-rhid-attendance-report"]');
  assert.ok(calendar, "o botão Ver resumo deve virar um ícone de calendário no relatório RHID");
  assert.match(calendar.textContent, /📅/);
  assert.equal(calendar.getAttribute("aria-label"), "Alterar data do relatório RHID");
  assert.equal(calendar.dataset.messageId, "rhid-calendar-25");
  assert.equal(root.querySelector('.chat-flow-status [data-action="show-summary"]'), null);

  calendar.click();
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog] input[type="date"]'), null);
  assert.equal(root.querySelector('[data-role="rhid-calendar-day"][aria-pressed="true"]')?.dataset.value, "2026-09-25", "o calendário deve começar na data já exibida");
  root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-26"]').click();
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();

  assert.deepEqual(requests, [{ type: "rhid-attendance-report-generate", value: "2026-09-26", messageId: "rhid-calendar-25" }]);
  view.destroy();
  dom.window.close();
});

test("data entre as setas abre calendário RHID e distingue dias com e sem presença", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const months = [];
  const reports = [];
  view.on("rhid-attendance-month-load", event => months.push(event));
  view.on("rhid-attendance-report-generate", event => reports.push(event));
  view.render(signedInState({ messages: [{ id: "rhid-calendar-card", role: "assistant", type: "poll", question: "RHID", options: [], detail_table: {
    kind: "rhid_attendance", reportDate: "2026-09-28", headers: ["Nome", "Entrada 1", "Saída 1", "Total"], rows: [],
  } }] }));
  const dateButton = root.querySelector('.chat-rhid-date-navigation [data-action="open-rhid-attendance-report"]');
  assert.equal(dateButton?.textContent.trim(), "28/09/2026");
  dateButton.click();
  assert.equal(months[0]?.value, "2026-09");
  assert.equal(root.querySelectorAll('[data-role="rhid-calendar-day"]').length, 30);
  assert.equal(root.querySelector('[data-rhid-attendance-report-dialog] input[type="date"]'), null);
  view.setRhidAttendanceMonthStatus({ month: "2026-09", presentDates: ["2026-09-28"] });
  assert.ok(root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-28"]').classList.contains("chat-rhid-calendar__day--present"));
  assert.ok(root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-27"]').classList.contains("chat-rhid-calendar__day--absent"));
  root.querySelector('[data-role="rhid-calendar-day"][data-value="2026-09-27"]').click();
  assert.equal(root.querySelector('[data-role="rhid-calendar-day"][aria-pressed="true"]')?.dataset.value, "2026-09-27");
  root.querySelector('[data-action="generate-rhid-attendance-report"]').click();
  assert.equal(reports[0]?.value, "2026-09-27");
  view.destroy();
  dom.window.close();
});

test("relatório RHID também expõe a mesma ação de ressincronização do menu de Recursos Humanos", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  let refreshes = 0;
  view.on("rhid-refresh", () => { refreshes += 1; });
  view.render(signedInState({
    activeFlow: { title: "👥 RECURSOS HUMANOS" },
    messages: [{
      id: "rhid-refresh-report", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
      detail_table: {
        kind: "rhid_attendance", reportDate: "2026-09-25", title: "PRESENÇAS • 25/09/2026",
        headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"],
        rows: [["ANA", "07:00", "12:00", "05:00"]],
      },
    }],
  }));

  const refresh = root.querySelector('.chat-flow-status [data-action="rhid-refresh"]');
  const calendar = root.querySelector('.chat-flow-status [data-action="open-rhid-attendance-report"]');
  assert.ok(refresh, "a tela do relatório deve oferecer ressincronização");
  assert.ok(calendar, "o calendário deve permanecer disponível");
  assert.match(refresh.getAttribute("aria-label"), /atualizar.*rhid.*sharepoint/i);
  refresh.click();
  assert.equal(refreshes, 1);
  view.destroy();
  dom.window.close();
});

test("relatório RHID vazio mantém as setas e informa que não há presenças", () => {
  const markup = renderChatMarkup(signedInState({ messages: [{
    id: "rhid-empty", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-26", title: "PRESENÇAS • 26/09/2026",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"], rows: [],
    },
  }] }));
  const dom = new JSDOM(markup);
  const report = dom.window.document.querySelector(".chat-message--rhid-report");
  assert.equal(report.querySelectorAll(".chat-rhid-date-navigation button").length, 3);
  assert.match(report.textContent, /Nenhuma presença foi encontrada/);
  dom.window.close();
});

test("relatório RHID mostra estado de carregamento e erro sem remover a data", () => {
  const report = extra => ({
    id: "rhid-nav-status", role: "assistant", type: "poll", question: "RELATÓRIO RHID", options: [],
    detail_table: {
      kind: "rhid_attendance", reportDate: "2026-09-25", title: "📋 PRESENÇAS",
      headers: ["Nome", "Entrada 1", "Saída 1", "Total de horas/dia"], rows: [], ...extra,
    },
  });
  const loadingDom = new JSDOM(renderChatMarkup(signedInState({ messages: [report({ navigationBusy: true })] })));
  const loading = loadingDom.window.document.querySelector(".chat-message--rhid-report");
  assert.equal(loading.querySelectorAll(".chat-rhid-date-navigation button:disabled").length, 3);
  assert.match(loading.textContent, /Atualizando dados do RHID/);
  assert.equal(loading.querySelector(".chat-rhid-date-navigation time")?.textContent, "25/09/2026");
  loadingDom.window.close();

  const errorDom = new JSDOM(renderChatMarkup(signedInState({ messages: [report({
    navigationBusy: false, navigationError: "Não foi possível atualizar o relatório. Tente novamente.",
  })] })));
  const error = errorDom.window.document.querySelector('.chat-message--rhid-report [role="alert"]');
  assert.match(error?.textContent || "", /Não foi possível atualizar o relatório/);
  assert.equal(errorDom.window.document.querySelectorAll(".chat-rhid-date-navigation button:disabled").length, 0);
  errorDom.window.close();
});

test('filial e imóvel da provisão ficam recolhidos e a seta funciona mesmo sem anexos', () => {
  for (const status of ['available', 'empty', 'loading', 'error']) {
    const state = signedInState({ pendingProvisions: { due: true, rows: [{ id: '306', branch: 'Obra A', property: 'Imóvel A' }] },
      pendingProvisionAttachments: { 306: { status, items: status === 'available' ? [{ fileName: 'nota.pdf' }] : [] } } });
    const collapsed = new JSDOM(renderChatMarkup(state));
    const branch = collapsed.window.document.querySelector('[data-field="branch"]');
    assert.equal(branch.hidden, true, `filial recolhida com anexos ${status}`);
    assert.equal(collapsed.window.document.querySelector('[data-field="property"]').hidden, true, `imóvel recolhido com anexos ${status}`);
    const arrow = collapsed.window.document.querySelector('[data-action="toggle-pending-provision-attachments"]');
    assert.ok(arrow, `seta disponível com anexos ${status}`);
    assert.equal(arrow.disabled, false);
    assert.equal(arrow.getAttribute('aria-expanded'), 'false');
    assert.equal(commandFromTarget(arrow).paymentId, '306');
    assert.ok(arrow.getAttribute('aria-controls').split(' ').includes(branch.id));
    assert.ok(arrow.getAttribute('aria-controls').split(' ').includes(collapsed.window.document.querySelector('[data-field="property"]').id));
    collapsed.window.close();
    const expanded = new JSDOM(renderChatMarkup({ ...state, pendingProvisionExpandedPaymentId: '306' }));
    assert.equal(expanded.window.document.querySelector('[data-field="branch"]').hidden, false);
    assert.equal(expanded.window.document.querySelector('[data-action="toggle-pending-provision-attachments"]').getAttribute('aria-expanded'), 'true');
    assert.equal(expanded.window.document.querySelector('[data-field="property"]').hidden, false);
    expanded.window.close();
  }
});


test('filial e imóvel ficam recolhidos também em provisões legadas sem ID', () => {
  const dom = new JSDOM(renderChatMarkup(signedInState({pendingProvisions: {due: true, rows: [{supplier: 'Fornecedor', branch: 'Obra A'}]}})));
  assert.equal(dom.window.document.querySelector('[data-field="branch"]').hidden, true);
  assert.equal(dom.window.document.querySelector('[data-field="property"]').hidden, true);
  dom.window.close();
});


test("Novo Pedido insere Efetuar Folha abaixo de Lançamento Múltiplo e não altera Pedido Existente",()=>{
 const message={role:'assistant',type:'poll',question:'COMO DESEJA EFETUAR O LANÇAMENTO?',options:[{id:'choice:tipo_lancamento:1',label:'LANÇAMENTO ÚNICO'},{id:'choice:tipo_lancamento:2',label:'LANÇAMENTO MÚLTIPLO'}]};
 const activeFlow={id:'launch',rows:[{label:'TIPO DE PEDIDO',value:'NOVO PEDIDO'}]};
 const markup=renderChatMarkup(signedInState({messages:[message],activeFlow}));
 assert.match(markup,/action_supplier_payroll_launch/);assert.ok(markup.indexOf('LANÇAMENTO MÚLTIPLO')<markup.indexOf('EFETUAR FOLHA DE PAGAMENTO'));
 assert.doesNotMatch(renderChatMarkup(signedInState({messages:[message],activeFlow:{...activeFlow,rows:[{label:'TIPO DE PEDIDO',value:'PEDIDO EXISTENTE'}]}})),/action_supplier_payroll_launch/);
});
