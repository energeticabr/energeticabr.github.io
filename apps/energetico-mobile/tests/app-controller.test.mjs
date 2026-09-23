import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createAppController, shouldRemoveSignedSource } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";

function makeView() {
  const handlers = new Map();
  const renders = [];
  return {
    renders,
    render(state) { renders.push(state); },
    on(type, handler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {},
    destroy() { handlers.clear(); },
  };
}

function makeHarness({ account = { homeAccountId: "a1", name: "Bernardo" }, historyMode, mediaLoadTimeoutMs, authTimeoutMs, authSignInTimeoutMs, signPdfAttachment, launchGalleryFactory, ordersGalleryFactory, ordersGalleryDataFactory, databaseFilterDebounceMs } = {}) {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}`, historyMode });
  const view = makeView();
  const chatCalls = [];
  const client = {
    async sendText(payload) {
      chatCalls.push(["text", payload]);
      return { status: "processed", messages: [{ type: "text", text: "Confirmado" }] };
    },
    async sendFile(file) {
      chatCalls.push(["file", file.name]);
      return { status: "processed", messages: [{ type: "text", text: `Recebi ${file.name}` }] };
    },
    async deleteAttachment(id) {
      chatCalls.push(["delete-attachment", id]);
      return { status: "processed", messages: [], attachments: [] };
    },
    async fetchMedia(message) {
      chatCalls.push(["media", message.id]);
      return new Blob(["conteúdo"], { type: "application/pdf" });
    },
  };
  const auth = {
    async initialize() { return account; },
    async signIn() { return { homeAccountId: "a2", name: "Bernardo" }; },
    async getToken() { return "token"; },
    async signOut() {},
  };
  const discarded = [];
  const exported = [];
  const native = {
    async capturePhoto() { return []; },
    async pickDocuments() { return []; },
    async importSharedItems() { return []; },
    async discardSharedItem(id) { discarded.push(id); },
    async exportMedia(blob, name) { exported.push([blob.size, name]); },
  };
  const controller = createAppController({ store, view, client, auth, native, mediaLoadTimeoutMs, authTimeoutMs, authSignInTimeoutMs, signPdfAttachment, launchGalleryFactory, ordersGalleryFactory, ordersGalleryDataFactory, databaseFilterDebounceMs });
  return { store, view, client, auth, native, controller, chatCalls, discarded, exported };
}

test("abre galeria sem enviar escolha ao fluxo e captura assinatura sem usar bandeja", async t => {
  let callbacks;
  let opens = 0;
  let destroys = 0;
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() { opens++; }, destroy() { destroys++; } };
  } });
  h.view.openSignaturePad = () => true;
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_launch_gallery", label: "GALERIA LANÇAMENTOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  const signature = callbacks.captureSignature();
  const file = new File(["png"], "assinatura.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file, fileId: "launch-gallery" });
  assert.equal(await signature, file);
  assert.equal(h.chatCalls.length, before);
  const cancelled = callbacks.captureSignature();
  await h.view.emit("signature-cancelled", { fileId: "launch-gallery" });
  assert.equal(await cancelled, null);
  h.controller.stop();
  assert.equal(destroys, 1);
});

test("galeria abre coleção de anexos pelo visualizador sem cair no detalhe do lançamento", async t => {
  let callbacks;
  let collection;
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() {}, destroy() {} };
  } });
  h.native.previewMediaCollection = async items => { collection = items; };
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  await callbacks.openMediaCollection([
    { id: 3429, fileName: "foto.jpg", mediaUrl: "/api/portal-media/foto-3429" },
    { id: 3429, fileName: "comprovante.pdf", mediaUrl: "/api/portal-media/pdf-3429" },
  ]);
  assert.equal(collection.length, 2);
  assert.deepEqual(collection.map(item => ({ id: item.id, fileName: item.fileName })), [
    { id: 3429, fileName: "foto.jpg" },
    { id: 3429, fileName: "comprovante.pdf" },
  ]);
  assert.deepEqual(collection.map(item => item.mediaUrl), [
    "/api/portal-media/foto-3429",
    "/api/portal-media/pdf-3429",
  ]);
});

test("Galeria Lançamentos abre localmente a partir do menu de Suprimentos", async t => {
  let opens = 0;
  const h = makeHarness({ historyMode: "current-step", launchGalleryFactory: async () => ({
    open() { opens++; },
    destroy() {},
  }) });
  h.client.launchGalleryRequest = async () => ({ rows: [] });
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?",
    options: [{ id: "new_document", label: "📄 LANÇAMENTOS", reply: "new_document" }],
  }], { resetConversation: true });
  const before = h.chatCalls.length;

  await h.view.emit("select-reply", { replyId: "action_launch_gallery", label: "GALERIA LANÇAMENTOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before, "abrir a galeria também deve permanecer local");
});

test("Galeria Pedidos abre a Screen10 SharePoint localmente e usa o visualizador compartilhado", async t => {
  let callbacks;
  let opens = 0;
  let scopesRequested;
  let previewItems;
  const h = makeHarness({
    ordersGalleryFactory: async options => {
      callbacks = options;
      return { async open() { opens++; }, destroy() {} };
    },
    ordersGalleryDataFactory: async ({ tokenProvider }) => ({
      async loadSnapshot() { return { rows: [], token: await tokenProvider(["Sites.Read.All"]) }; },
    }),
  });
  h.auth.getToken = async scopes => { scopesRequested = scopes; return "sharepoint-token"; };
  h.native.previewMediaCollection = async items => { previewItems = items; };
  h.client.launchGalleryRequest = async () => { throw new Error("não deve consultar a galeria de lançamentos"); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  const before = h.chatCalls.length;
  await h.view.emit("select-reply", { replyId: "action_orders_gallery", label: "GALERIA PEDIDOS" });
  assert.equal(opens, 1);
  assert.equal(h.chatCalls.length, before);
  const result = await callbacks.data.loadSnapshot();
  assert.equal(result.token, "sharepoint-token");
  assert.deepEqual(scopesRequested, ["Sites.Read.All"]);
  await callbacks.openMediaCollection([{ fileName: "nota.pdf", source: Promise.resolve(new Blob(["pdf"])) }]);
  assert.equal(previewItems.length, 1);
  assert.equal(previewItems[0].fileName, "nota.pdf");
});

test("retoma a Galeria Pedidos depois do retorno de consentimento Microsoft no navegador", async t => {
  let opens = 0;
  const h = makeHarness({
    ordersGalleryFactory: async () => ({ async open() { opens++; }, destroy() {} }),
    ordersGalleryDataFactory: async () => ({}),
  });
  h.auth.consumePendingAction = () => "action_orders_gallery";
  t.after(() => h.controller.stop());

  await h.controller.start();

  assert.equal(opens, 1);
});

test("Galeria Pedidos solicita consentimento interativo quando SharePoint exige outro escopo", async t => {
  let tokenProvider;
  const authorizationCalls = [];
  const h = makeHarness({
    ordersGalleryFactory: async () => ({ async open() {}, destroy() {} }),
    ordersGalleryDataFactory: async options => {
      tokenProvider = options.tokenProvider;
      return { async loadSnapshot() { return { rows: [] }; } };
    },
  });
  let tokenAttempts = 0;
  h.auth.getToken = async scopes => {
    tokenAttempts++;
    if (tokenAttempts === 1) throw { code: "AUTH_REQUIRED", message: "interação necessária" };
    return "sharepoint-token";
  };
  h.auth.authorize = async scopes => { authorizationCalls.push(scopes); };
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_orders_gallery", label: "GALERIA PEDIDOS" });

  assert.equal(await tokenProvider(["https://energeticaltda-my.sharepoint.com/AllSites.Read"]), "sharepoint-token");
  assert.deepEqual(authorizationCalls, [["https://energeticaltda-my.sharepoint.com/AllSites.Read"]]);
  assert.equal(tokenAttempts, 2);
});

test("sair da conta invalida consulta em andamento e fecha galeria", async t => {
  let callbacks;
  let destroyed = 0;
  const response = deferred();
  const h = makeHarness({ launchGalleryFactory: async options => {
    callbacks = options;
    return { open() {}, destroy() { destroyed++; } };
  } });
  h.client.launchGalleryRequest = () => response.promise;
  t.after(() => h.controller.stop());
  await h.controller.start();
  await h.view.emit("select-reply", { replyId: "action_launch_gallery" });
  const query = callbacks.request("snapshot", {});
  const rejection = assert.rejects(query, /sessão.*encerrada/);
  await h.view.emit("sign-out");
  response.resolve({ rows: [{ id: "secret" }] });
  await rejection;
  assert.equal(destroyed, 1);
});

test("filtro de banco é automático, preserva a digitação e limpa ao selecionar", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const filterPoll = options => ({
    type: "poll",
    question: "QUAL O PRODUTO?",
    databaseFilter: true,
    databaseFilterKey: "document_signing_payment_product",
    options,
  });
  h.store.ingestRemoteMessages([
    filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }]),
  ], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (!payload.replyId) {
      return {
        status: "processed",
        activeFlow,
        messages: [filterPoll([{ id: "5", label: "AREIA MÉDIA", reply: "5" }])],
      };
    }
    return {
      status: "processed",
      activeFlow,
      messages: [{ type: "text", text: "PRODUTO SELECIONADO" }],
    };
  };

  await h.view.emit("draft-changed", { value: "are" });
  await h.view.emit("database-filter-changed", {
    value: "are",
    filterKey: "document_signing_payment_product",
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(payloads[0].text, "are");
  assert.equal(h.store.getState().draft, "are");
  assert.equal(h.store.getState().messages.filter(message => message.role === "user").length, 0);
  assert.equal(h.store.getState().messages.at(-1).options[0].label, "AREIA MÉDIA");

  await h.view.emit("draft-changed", { value: "areia" });
  await h.view.emit("database-filter-changed", {
    value: "areia",
    filterKey: "document_signing_payment_product",
  });
  await h.view.emit("select-reply", { replyId: "5", label: "AREIA MÉDIA" });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(payloads.slice(1), [{ text: "AREIA MÉDIA", replyId: "5" }]);
  assert.equal(h.store.getState().draft, "");
});

test("após validar uma presença mostra primeiro somente o mesmo dia e oferece outras datas", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "presence_validation", title: "VALIDAR PRESENÇAS APONTADAS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "👷 VALIDAR PRESENÇA\\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
    detail_table: {
      kind: "presence",
      rows: [[{ label: "DATA", value: "12/09/2026" }]],
    },
    options: [{ id: "present", reply: "present", label: "✅ PRESENTE" }],
  }], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    return {
      status: "processed",
      activeFlow,
      messages: [
        { type: "text", text: "✅ PRESENÇA ATUALIZADA NA BASE DE DADOS" },
        {
          type: "poll",
          presentation: "accordion",
          question: "OS SEGUINTES ITENS AINDA ESTÃO PENDENTES DE VALIDAÇÃO DE PRESENÇA.",
          options: [
            { id: "12", reply: "12", label: "12 - PESSOA DOZE (12/09/2026)" },
            { id: "19", reply: "19", label: "19 - PESSOA DEZENOVE (19/09/2026)" },
          ],
        },
      ],
    };
  };

  await h.view.emit("select-reply", { replyId: "present", label: "✅ PRESENTE" });

  let poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), [
    "12 - PESSOA DOZE (12/09/2026)",
    "📅 VER OUTRAS DATAS",
  ]);
  assert.equal(payloads.length, 1);

  await h.view.emit("select-reply", {
    replyId: "presence_other_dates",
    label: "📅 VER OUTRAS DATAS",
  });

  poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), [
    "12 - PESSOA DOZE (12/09/2026)",
    "19 - PESSOA DEZENOVE (19/09/2026)",
  ]);
  assert.equal(payloads.length, 1);
});

test("mantém anexos transferidos visíveis nos menus até entrar no próximo fluxo", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();

  const originalFlow = { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO", contextId: "ctx-transfer" };
  const nextFlow = { id: "launch", title: "EFETUAR LANÇAMENTO", contextId: "ctx-next" };
  const attachment = {
    id: "carried-file",
    fileName: "foto-da-obra.jpg",
    mimeType: "image/jpeg",
    size: 512,
    mediaUrl: "/api/portal-media/carried-file",
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "ADICIONAR DOCUMENTO",
    options: [],
  }], { activeFlow: originalFlow });
  h.store.syncAttachments([attachment]);

  h.client.sendText = async payload => {
    if (payload.replyId === "portal_transfer_attachments") {
      return {
        status: "processed",
        activeFlow: originalFlow,
        messages: [{
          type: "poll",
          question: "TRANSFERIR ANEXOS PARA O MENU PRINCIPAL?",
          options: [{ id: "confirm-transfer", reply: "confirm-transfer", label: "SIM, TRANSFERIR" }],
        }],
      };
    }
    if (payload.replyId === "confirm-transfer") {
      return {
        status: "processed",
        activeFlow: originalFlow,
        attachments: [],
        messages: [
          { type: "text", text: "OS DADOS DO FLUXO FORAM ELIMINADOS. OS ANEXOS FORAM TRANSFERIDOS PARA O PRÓXIMO FLUXO." },
          {
            type: "poll",
            question: "TRANSFERÊNCIA CONCLUÍDA",
            options: [{ id: "transfer-finished-to-menu", reply: "transfer-finished-to-menu", label: "IR AO MENU PRINCIPAL" }],
          },
        ],
      };
    }
    if (payload.replyId === "transfer-finished-to-menu") {
      return {
        status: "processed",
        returned_to_main_menu: true,
        resetConversation: true,
        activeFlow: null,
        attachments: [],
        messages: [{
          type: "poll",
          question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
          options: [{ id: "supplies", reply: "supplies", label: "SUPRIMENTOS" }],
        }],
      };
    }
    if (payload.replyId === "supplies") {
      return {
        status: "processed",
        stage: "choosing_group",
        resetConversation: true,
        activeFlow: null,
        attachments: [],
        messages: [{
          type: "poll",
          question: "SUPRIMENTOS — QUAL FLUXO DESEJA INICIAR?",
          options: [{ id: "launches", reply: "launches", label: "LANÇAMENTOS" }],
        }],
      };
    }
    return {
      status: "processed",
      activeFlow: nextFlow,
      attachments: [],
      messages: [{ type: "poll", question: "QUAL OPERAÇÃO DE LANÇAMENTO?", options: [] }],
    };
  };

  await h.view.emit("transfer-attachments");
  await h.view.emit("select-reply", { replyId: "confirm-transfer", label: "SIM, TRANSFERIR" });
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "transfer-finished-to-menu", label: "IR AO MENU PRINCIPAL" });

  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "supplies", label: "SUPRIMENTOS" });
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);

  await h.view.emit("select-reply", { replyId: "launches", label: "LANÇAMENTOS" });
  assert.equal(h.store.getState().activeFlow.id, "launch");
  assert.equal(h.store.getState().attachments.length, 1);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(1\)/);
});

test("cancelar a transferência permite que uma saída normal limpe os anexos", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();

  const activeFlow = { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO", contextId: "ctx-cancel-transfer" };
  const attachment = {
    id: "cancelled-transfer-file",
    fileName: "documento.pdf",
    mimeType: "application/pdf",
    size: 256,
    mediaUrl: "/api/portal-media/cancelled-transfer-file",
  };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "ADICIONAR DOCUMENTO",
    options: [],
  }], { activeFlow });
  h.store.syncAttachments([attachment]);

  h.client.sendText = async payload => {
    if (payload.replyId === "portal_transfer_attachments") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "TRANSFERIR ANEXOS PARA O MENU PRINCIPAL?",
          options: [{ id: "cancel-transfer", reply: "cancel-transfer", label: "CANCELAR" }],
        }],
      };
    }
    if (payload.replyId === "cancel-transfer") {
      return {
        status: "processed",
        activeFlow,
        attachments: [attachment],
        messages: [{
          type: "poll",
          question: "ADICIONAR DOCUMENTO",
          options: [{ id: "navigation_main_menu", reply: "navigation_main_menu", label: "RETORNAR AO MENU INICIAL" }],
        }],
      };
    }
    return {
      status: "processed",
      returned_to_main_menu: true,
      resetConversation: true,
      activeFlow: null,
      attachments: [],
      messages: [{ type: "poll", question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?", options: [] }],
    };
  };

  await h.view.emit("transfer-attachments");
  await h.view.emit("select-reply", { replyId: "cancel-transfer", label: "CANCELAR" });
  await h.view.emit("select-reply", { replyId: "navigation_main_menu", label: "RETORNAR AO MENU INICIAL" });

  assert.deepEqual(h.store.getState().attachments, []);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(/);
});

test("quando a data validada não tem pendências mostra resumo e permite ver outras datas", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "presence_validation", title: "VALIDAR PRESENÇAS APONTADAS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "👷 VALIDAR PRESENÇA\nSELECIONE PRESENTE, AUSENTE OU EDITAR.",
    detail_table: {
      kind: "presence",
      rows: [[{ label: "DATA", value: "12/09/2026" }]],
    },
    options: [{ id: "present", reply: "present", label: "✅ PRESENTE" }],
  }], { activeFlow });
  h.client.sendText = async () => ({
    status: "processed",
    activeFlow,
    messages: [{
      type: "poll",
      presentation: "accordion",
      question: "OS SEGUINTES ITENS AINDA ESTÃO PENDENTES DE VALIDAÇÃO DE PRESENÇA.",
      options: [{ id: "19", reply: "19", label: "19 - PESSOA DEZENOVE (19/09/2026)" }],
    }],
  });

  await h.view.emit("select-reply", { replyId: "present", label: "✅ PRESENTE" });

  const poll = h.store.getState().messages.at(-1);
  assert.deepEqual(poll.options.map(option => option.label), ["📅 VER OUTRAS DATAS"]);
  assert.deepEqual(poll.presenceDateSummary, { date: "2026-09-12", count: 1 });
});

test("finalizar na seleção de produto envia FINALIZAR diretamente e limpa a retomada antiga", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map([["energetico.document-line-selection:a1", JSON.stringify({
    contextId: "documento-anterior",
    productKind: "epi",
    finalizeOption: { id: "no", reply: "no", label: "❌ NÃO" },
  })]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 QUAL PRODUTO FOI PAGO?",
    options: [{ id: "document_line_finalize", reply: "document_line_finalize", label: "✅ FINALIZAR" }],
  }], { activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" } });

  await h.view.emit("select-reply", { replyId: "document_line_finalize", label: "✅ FINALIZAR" });

  assert.deepEqual(h.chatCalls.at(-1), ["text", {
    text: "✅ FINALIZAR",
    replyId: "document_line_finalize",
  }]);
  assert.equal(records.has("energetico.document-line-selection:a1"), false);
});

test("avança automaticamente a pergunta intermediária de outra linha", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "📦 QUAL PRODUTO FOI PAGO?",
    options: [{ id: "3", reply: "3", label: "3 - ARGAMASSA" }],
  }], { activeFlow });
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "3") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "DESEJA APONTAR OUTRO PRODUTO?",
          options: [{ id: "yes", reply: "yes", label: "✅ SIM" }, { id: "no", reply: "no", label: "❌ NÃO" }],
        }],
      };
    }
    return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "📦 QUAL PRODUTO FOI PAGO?",
        options: [{ id: "4", reply: "4", label: "4 - GESSO" }],
      }],
    };
  };

  await h.view.emit("select-reply", { replyId: "3", label: "3 - ARGAMASSA" });

  assert.deepEqual(h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(call => call[1]), [
    { text: "3 - ARGAMASSA", replyId: "3" },
    { text: "✅ SIM", replyId: "yes" },
  ]);
  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.label), [
    "✅ FINALIZAR",
    "4 - GESSO",
  ]);
});

for (const scenario of [
  {
    name: "comprovante de pagamento",
    productQuestion: "📦 QUAL PRODUTO FOI PAGO?",
    moreQuestion: "DESEJA APONTAR OUTRO PRODUTO?",
    firstProduct: { id: "3", reply: "3", label: "3 - ARGAMASSA" },
    nextProduct: { id: "4", reply: "4", label: "4 - GESSO" },
  },
  {
    name: "entrega de EPI",
    productQuestion: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    moreQuestion: "DESEJA APONTAR OUTRO PRODUTO EPI?",
    firstProduct: { id: "612", reply: "612", label: "612 - CAPACETE DE SEGURANÇA (UN)" },
    nextProduct: { id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" },
  },
]) {
  test(`mantém FINALIZAR funcional na próxima lista de produtos do ${scenario.name}`, async t => {
    const h = makeHarness();
    t.after(() => h.controller.stop());
    await h.controller.start();
    const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
    const morePoll = () => ({
      type: "poll",
      question: scenario.moreQuestion,
      options: [
        { id: "yes", reply: "yes", label: "✅ SIM" },
        { id: "no", reply: "no", label: "❌ NÃO" },
      ],
    });
    h.store.ingestRemoteMessages([{
      type: "poll",
      question: scenario.productQuestion,
      options: [scenario.firstProduct],
    }], { activeFlow });
    h.client.sendText = async payload => {
      h.chatCalls.push(["text", payload]);
      if (payload.replyId === scenario.firstProduct.reply) {
        return { status: "processed", activeFlow, messages: [morePoll()] };
      }
      if (payload.replyId === "yes") {
        return {
          status: "processed",
          activeFlow,
          messages: [{
            type: "poll",
            question: scenario.productQuestion,
            options: [scenario.nextProduct],
          }],
        };
      }
      if (payload.replyId === "navigation_back") {
        return { status: "processed", activeFlow, messages: [morePoll()] };
      }
      if (payload.replyId === "no") {
        return {
          status: "processed",
          activeFlow,
          messages: [{
            type: "poll",
            question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
            options: [{ id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" }],
          }],
        };
      }
      throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
    };

    await h.view.emit("select-reply", {
      replyId: scenario.firstProduct.reply,
      label: scenario.firstProduct.label,
    });

    const productPoll = h.store.getState().messages.at(-1);
    assert.deepEqual(productPoll.options.map(option => option.id), [
      "document_line_finalize",
      scenario.nextProduct.id,
    ]);

    await h.view.emit("select-reply", {
      replyId: "document_line_finalize",
      label: "✅ FINALIZAR",
    });

    assert.deepEqual(
      h.chatCalls.filter(([, payload]) => payload.replyId !== "input_continue").map(([, payload]) => payload.replyId),
      [scenario.firstProduct.reply, "yes", "navigation_back", "no"],
    );
    assert.equal(h.store.getState().messages.at(-1).question, "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.");
  });
}

test("restaura FINALIZAR ao reabrir o app na lista seguinte de produtos", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });

  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS", contextId: "documento-123" };
  const productPoll = {
    type: "poll",
    question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
    options: [{ id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" }],
  };
  const morePoll = {
    type: "poll",
    question: "DESEJA APONTAR OUTRO PRODUTO EPI?",
    options: [
      { id: "yes", reply: "yes", label: "✅ SIM" },
      { id: "no", reply: "no", label: "❌ NÃO" },
    ],
  };

  const first = makeHarness();
  await first.controller.start();
  first.store.ingestRemoteMessages([productPoll], { activeFlow });
  first.client.sendText = async payload => {
    first.chatCalls.push(["text", payload]);
    if (payload.replyId === "629") return { status: "processed", activeFlow, messages: [morePoll] };
    if (payload.replyId === "yes") return { status: "processed", activeFlow, messages: [productPoll] };
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };
  await first.view.emit("select-reply", { replyId: "629", label: "629 - PROTETOR SOLAR (UN)" });
  first.controller.stop();

  const reopened = makeHarness();
  t.after(() => reopened.controller.stop());
  reopened.client.sendText = async payload => {
    reopened.chatCalls.push(["text", payload]);
    if (payload.replyId === "input_continue") return { status: "processed", activeFlow, messages: [productPoll] };
    if (payload.replyId === "navigation_back") return { status: "processed", activeFlow, messages: [morePoll] };
    if (payload.replyId === "no") {
      return {
        status: "processed",
        activeFlow,
        messages: [{
          type: "poll",
          question: "PDF GERADO. ESCOLHA COMO DESEJA CONTINUAR.",
          options: [{ id: "document_signing_draw_signature", label: "✍️ ASSINAR NA TELA" }],
        }],
      };
    }
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };

  await reopened.controller.start();
  assert.deepEqual(reopened.store.getState().messages.at(-1).options.map(option => option.id), [
    "document_line_finalize",
    "629",
  ]);

  await reopened.view.emit("select-reply", {
    replyId: "document_line_finalize",
    label: "✅ FINALIZAR",
  });

  assert.deepEqual(
    reopened.chatCalls.map(([, payload]) => payload.replyId),
    ["input_continue", "navigation_back", "no"],
  );
});

test("não restaura FINALIZAR quando a VM omite o contexto do documento", { concurrency: false }, async t => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const records = new Map([["energetico.document-line-selection:a1", JSON.stringify({
    contextId: "documento-anterior",
    productKind: "epi",
    finalizeOption: { id: "no", reply: "no", label: "❌ NÃO" },
  })]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return records.get(key) ?? null; },
      setItem(key, value) { records.set(key, String(value)); },
      removeItem(key) { records.delete(key); },
    },
  });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });

  const h = makeHarness();
  t.after(() => h.controller.stop());
  h.client.sendText = async payload => {
    h.chatCalls.push(["text", payload]);
    if (payload.replyId === "input_continue") {
      return {
        status: "processed",
        activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
        messages: [{
          type: "poll",
          question: "📦 🦺 QUAL PRODUTO EPI FOI ENTREGUE?",
          options: [{ id: "629", reply: "629", label: "629 - PROTETOR SOLAR (UN)" }],
        }],
      };
    }
    throw new Error(`Resposta inesperada: ${JSON.stringify(payload)}`);
  };

  await h.controller.start();

  assert.deepEqual(h.store.getState().messages.at(-1).options.map(option => option.id), ["629"]);
});

test("apagar a busca durante uma resposta restaura a lista completa", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const filterPoll = options => ({
    type: "poll",
    question: "QUAL O PRODUTO?",
    databaseFilter: true,
    databaseFilterKey: "product",
    options,
  });
  h.store.ingestRemoteMessages([filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }])], { activeFlow });
  const firstResponse = deferred();
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    if (payload.replyId === "filter_clear") {
      return { status: "processed", activeFlow, messages: [filterPoll([{ id: "3", label: "ARGAMASSA", reply: "3" }])] };
    }
    return firstResponse.promise;
  };

  await h.view.emit("draft-changed", { value: "are" });
  await h.view.emit("database-filter-changed", { value: "are", filterKey: "product" });
  await new Promise(resolve => setTimeout(resolve, 10));
  await h.view.emit("draft-changed", { value: "" });
  await h.view.emit("database-filter-changed", { value: "", filterKey: "product" });
  firstResponse.resolve({
    status: "processed",
    activeFlow,
    messages: [filterPoll([{ id: "5", label: "AREIA MÉDIA", reply: "5" }])],
  });
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.deepEqual(payloads, [
    { text: "are" },
    { text: "Limpar filtro", replyId: "filter_clear" },
  ]);
  assert.equal(h.store.getState().draft, "");
  assert.equal(h.store.getState().messages.at(-1).options[0].label, "ARGAMASSA");
});

test("três palavras aguardam o envio manual e então limpam o campo", async t => {
  const h = makeHarness({ databaseFilterDebounceMs: 1 });
  t.after(() => h.controller.stop());
  await h.controller.start();
  const activeFlow = { id: "flow", title: "FLUXO" };
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "QUAL O FORNECEDOR?",
    databaseFilter: true,
    databaseFilterKey: "supplier",
    options: [{ id: "1", label: "FORNECEDOR", reply: "1" }],
  }], { activeFlow });
  const payloads = [];
  h.client.sendText = async payload => {
    payloads.push(payload);
    return {
      status: "processed",
      activeFlow,
      messages: [{
        type: "poll",
        question: "QUAL O FORNECEDOR?",
        databaseFilter: true,
        databaseFilterKey: "supplier",
        options: [{ id: "2", label: "EMPRESA DE TESTE LTDA", reply: "2" }],
      }],
    };
  };

  await h.view.emit("draft-changed", { value: "empresa de teste" });
  await h.view.emit("database-filter-changed", { value: "empresa de teste", filterKey: "supplier" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(payloads, []);
  assert.equal(h.store.getState().draft, "empresa de teste");

  await h.view.emit("send-text", {});
  assert.deepEqual(payloads, [{ text: "empresa de teste" }]);
  assert.equal(h.store.getState().draft, "");
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sharedFile(id) {
  const file = new File(["pdf"], `${id}.pdf`, { type: "application/pdf" });
  Object.defineProperty(file, "sourceId", { value: id });
  return file;
}

test("lixeira de documento pendente exige confirmação antes de enviar exclusão", async t => {
  const h = makeHarness();
  const previousConfirm = globalThis.confirm;
  const prompts = [];
  t.after(() => { h.controller.stop(); globalThis.confirm = previousConfirm; });
  await h.controller.start();
  const initialCalls = h.chatCalls.length;

  globalThis.confirm = prompt => { prompts.push(prompt); return false; };
  await h.view.emit("select-reply", {
    replyId: "pending_document_delete:262",
    label: "Excluir documento 262",
  });
  assert.equal(h.chatCalls.length, initialCalls);
  assert.match(prompts[0], /262/);

  globalThis.confirm = () => true;
  await h.view.emit("select-reply", {
    replyId: "pending_document_delete:262",
    label: "Excluir documento 262",
  });
  assert.equal(h.chatCalls.at(-1)[0], "text");
  assert.equal(h.chatCalls.at(-1)[1].replyId, "pending_document_delete_confirmed:262");
});

test("finalizar anexos envia o comando literal para avançar a pergunta", async () => {
  const h = makeHarness();
  await h.controller.start();

  await h.view.emit("finish-flow");

  assert.deepEqual(h.chatCalls.at(-1), ["text", { text: "FINALIZAR" }]);
  h.controller.stop();
});

test("fluxo ativo agenda lembrete nativo ao sair do aplicativo", async () => {
  const h = makeHarness();
  let onBackground;
  const scheduled = [];
  let cancelled = 0;
  h.native.onResume = async (_onResume, background) => {
    onBackground = background;
    return () => {};
  };
  h.native.scheduleFlowReminder = async details => {
    scheduled.push(details);
    return true;
  };
  h.native.cancelFlowReminder = async () => { cancelled += 1; };
  h.client.sendText = async payload => ({
    status: "processed",
    messages: [{ type: "text", text: "Pergunta" }],
    activeFlow: { id: "task", title: "ADICIONAR UMA NOVA TAREFA" },
  });

  await h.controller.start();
  assert.equal(typeof onBackground, "function");
  await onBackground();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled.length, 1);
  assert.match(scheduled[0].body, /ADICIONAR UMA NOVA TAREFA/);
  await h.view.emit("sign-out");
  assert.ok(cancelled >= 2, "o lembrete deve ser cancelado ao voltar ou sair");
  h.controller.stop();
});

test("abre provisões vencidas e aplica o adiamento de duas horas ao fechar", async () => {
  const h = makeHarness();
  const scheduled = [];
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026", product: "Material", total: "R$ 120,00" }],
  });
  h.native.scheduleProvisionReminder = async details => { scheduled.push(details); return true; };
  h.native.cancelProvisionReminder = async () => {};

  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  await h.view.emit("close-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  await h.view.emit("pending-provisions-reminder-choice", { value: "2h" });
  assert.equal(h.view.renders.at(-1).pendingProvisions, null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 2 * 60 * 60 * 1000);
  h.controller.stop();
});

test("o X das provisões abre a escolha de lembrete sem reabrir no retorno à tela", async () => {
  const h = makeHarness();
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026" }],
  });

  await h.controller.start();
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);

  await h.view.emit("dismiss-pending-provisions");

  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  await h.controller.handleForeground();
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  h.controller.stop();
});

test("o primeiro toque no X abre a escolha de lembrete na integração real do iPhone", async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  const root = dom.window.document.querySelector("#app");
  const store = createConversationStore();
  const view = createChatView(root);
  const controller = createAppController({
    store,
    view,
    auth: { initialize: async () => ({ homeAccountId: "iphone", name: "Bernardo" }) },
    native: { importSharedItems: async () => [] },
    client: {
      sendText: async () => ({ status: "processed", messages: [] }),
      getPendingProvisionSnapshot: async () => ({
        due: true,
        rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
      }),
    },
  });
  t.after(() => {
    controller.stop();
    view.destroy();
    dom.window.close();
  });

  await controller.start();
  const close = root.querySelector('[data-action="close-pending-provisions"]');
  assert.ok(close);
  const pointerDown = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerDown, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(pointerDown);

  const pointerUp = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerUp, {
    isPrimary: { value: true },
    pointerType: { value: "touch" },
  });
  close.dispatchEvent(pointerUp);

  assert.ok(root.querySelector('[data-action="pending-provisions-reminder-choice"][data-value="2h"]'));
});

test("lembrar provisões em duas horas fecha a escolha na integração real", async t => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://example.test/" });
  const root = dom.window.document.querySelector("#app");
  const store = createConversationStore();
  const view = createChatView(root);
  const scheduled = [];
  const controller = createAppController({
    store,
    view,
    auth: { initialize: async () => ({ homeAccountId: "iphone-reminder", name: "Bernardo" }) },
    native: {
      importSharedItems: async () => [],
      scheduleProvisionReminder: async details => { scheduled.push(details); return true; },
      cancelProvisionReminder: async () => {},
    },
    client: {
      sendText: async () => ({ status: "processed", messages: [] }),
      getPendingProvisionSnapshot: async () => ({
        due: true,
        rows: [{ supplier: "Fornecedor A", dueDate: "18/09/2026" }],
      }),
    },
  });
  t.after(() => {
    controller.stop();
    view.destroy();
    dom.window.close();
  });

  await controller.start();
  assert.ok(root.querySelector('[data-action="close-pending-provisions"]'));

  const openReminder = dom.window.document.createElement("button");
  openReminder.dataset.action = "close-pending-provisions";
  root.append(openReminder);
  openReminder.click();

  const twoHours = root.querySelector('[data-action="pending-provisions-reminder-choice"][data-value="2h"]');
  assert.ok(twoHours);
  twoHours.click();

  assert.equal(root.querySelector("[data-pending-provisions-dialog]"), null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 2 * 60 * 60 * 1000);
});

test("cancelar o lembrete de provisões fecha somente a escolha e preserva a lista", async () => {
  const h = makeHarness();
  h.client.getPendingProvisionSnapshot = async () => ({
    due: true,
    rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026" }],
  });

  await h.controller.start();
  await h.view.emit("close-pending-provisions");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, true);
  await h.view.emit("cancel-pending-provisions-reminder");
  assert.equal(h.view.renders.at(-1).pendingProvisionReminderOpen, false);
  assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
  h.controller.stop();
});

test("a opção de não lembrar hoje expira quando muda a data local", async () => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
  });
  try {
    const h = makeHarness();
    h.client.getPendingProvisionSnapshot = async () => ({ due: true, rows: [{ supplier: "Fornecedor A" }] });
    await h.controller.start();
    await h.view.emit("close-pending-provisions");
    await h.view.emit("pending-provisions-reminder-choice", { value: "today" });
    assert.equal(h.view.renders.at(-1).pendingProvisions, null);
    const key = [...values.keys()][0];
    values.set(key, JSON.stringify({ mode: "today", date: "2000-01-01" }));
    await h.controller.handleForeground();
    assert.equal(h.view.renders.at(-1).pendingProvisions.rows.length, 1);
    h.controller.stop();
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
  }
});

for (const endSession of ["sign-out", "stop"]) {
  for (const fails of [false, true]) {
    test(`retomada ignora ${fails ? "erro" : "arquivo"} atrasado após ${endSession}`, async () => {
      const h = makeHarness();
      let resume;
      h.native.onResume = async handler => { resume = handler; return () => {}; };
      await h.controller.start();
      const read = deferred();
      h.native.importSharedItems = () => read.promise;
      const pending = resume();
      await new Promise(resolve => setImmediate(resolve));
      if (endSession === "stop") h.controller.stop();
      else await h.view.emit("sign-out");
      const renderCount = h.view.renders.length;
      if (fails) read.reject(new Error("Erro da conta anterior"));
      else read.resolve([sharedFile("conta-anterior")]);
      await pending;
      try {
        assert.deepEqual(h.store.getState().pendingFiles, []);
        assert.equal(h.view.renders.length, renderCount, "resultado obsoleto não deve renderizar");
        if (endSession === "sign-out") {
          await h.view.emit("sign-in");
          assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), []);
        }
      } finally { h.controller.stop(); }
    });
  }
}

test("novo retorno durante upload envia também o segundo compartilhamento", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  const inbox = new Map([["primeiro", sharedFile("primeiro")]]);
  const uploadStarted = deferred(), uploadFinished = deferred();
  h.native.importSharedItems = async () => [...inbox.values()];
  h.native.discardSharedItem = async id => { inbox.delete(id); };
  const sendFile = h.client.sendFile;
  h.client.sendFile = async file => {
    if (file.sourceId === "primeiro") { uploadStarted.resolve(); await uploadFinished.promise; }
    return sendFile(file);
  };
  const pending = resume();
  await uploadStarted.promise;
  inbox.set("segundo", sharedFile("segundo"));
  const next = resume();
  uploadFinished.resolve();
  try {
    await Promise.all([pending, next]);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "primeiro.pdf"], ["file", "segundo.pdf"]]);
    assert.equal(inbox.size, 0);
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("sair antes da leitura agendada impede reintroduzir anexo privado", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  h.native.importSharedItems = async () => [sharedFile("sessao-encerrada")];
  const pending = resume();
  await h.view.emit("sign-out");
  try {
    await pending;
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("retorno da nova conta é processado após descartar leitura da sessão anterior", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  const oldRead = deferred(), reading = deferred();
  h.native.importSharedItems = () => { reading.resolve(); return oldRead.promise; };
  const oldResume = resume();
  await reading.promise;
  await h.view.emit("sign-out");
  await h.view.emit("sign-in");
  h.native.importSharedItems = async () => [sharedFile("conta-nova")];
  const newResume = resume();
  oldRead.resolve([sharedFile("conta-antiga")]);
  try {
    await Promise.all([oldResume, newResume]);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "conta-nova.pdf"]]);
    assert.deepEqual(h.store.getState().pendingFiles, []);
  } finally { h.controller.stop(); }
});

test("retorno durante retomada inicial da VM recebe compartilhamento sem nova ativação", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  const conversationStarted = deferred(), conversationFinished = deferred();
  const sendText = h.client.sendText;
  h.client.sendText = async payload => {
    conversationStarted.resolve();
    await conversationFinished.promise;
    return sendText(payload);
  };
  const starting = h.controller.start();
  await conversationStarted.promise;
  h.native.importSharedItems = async () => [sharedFile("durante-inicio")];
  const resumed = resume?.();
  conversationFinished.resolve();
  try {
    await starting;
    await resumed;
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "durante-inicio.pdf"]]);
  } finally { h.controller.stop(); }
});

test("retorno sem conta preserva compartilhamento e envia após entrar", async () => {
  const h = makeHarness({ account: null });
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  h.native.importSharedItems = async () => [sharedFile("sem-conta")];
  try {
    await resume();
    assert.equal(h.store.getState().pendingFiles.length, 1);
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), []);
    await h.view.emit("sign-in");
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "sem-conta.pdf"]]);
  } finally { h.controller.stop(); }
});

test("início sem sessão não bloqueia a tela de login esperando a caixa nativa", async () => {
  const h = makeHarness({ account: null });
  h.native.importSharedItems = () => new Promise(() => {});
  try {
    await h.controller.start();
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
  } finally { h.controller.stop(); }
});

test("início não bloqueia a tela de login se o observador Android não responder", async () => {
  const h = makeHarness({ account: null });
  h.native.onResume = () => new Promise(() => {});
  try {
    const completed = await Promise.race([
      h.controller.start().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
  } finally { h.controller.stop(); }
});

test("início deixa o login disponível enquanto a sessão armazenada é verificada", async () => {
  const h = makeHarness({ account: null, authTimeoutMs: 20 });
  h.auth.initialize = () => new Promise(() => {});
  const starting = h.controller.start();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    await starting;
  } finally { h.controller.stop(); }
});

test("início não bloqueia a tela de login se a sessão Microsoft não responder", async () => {
  const h = makeHarness({ account: null, authTimeoutMs: 20 });
  h.auth.initialize = () => new Promise(() => {});
  let cancelled = 0;
  h.auth.cancelSignIn = async () => { cancelled++; };
  try {
    const completed = await Promise.race([
      h.controller.start().then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    assert.equal(cancelled, 1, "o timeout deve liberar a inicialização nativa antes do próximo toque");
  } finally { h.controller.stop(); }
});

test("login não fica preso em verificando sessão se o retorno Microsoft não responder", async () => {
  const h = makeHarness({ account: null, authSignInTimeoutMs: 20 });
  h.auth.signIn = () => new Promise(() => {});
  let cancelled = 0;
  h.auth.cancelSignIn = async () => { cancelled++; };
  try {
    await h.controller.start();
    const completed = await Promise.race([
      h.view.emit("sign-in").then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completed, true);
    assert.equal(h.view.renders.at(-1).sessionStatus, "signed-out");
    assert.equal(cancelled, 1, "o timeout deve cancelar a chamada nativa pendente");
  } finally { h.controller.stop(); }
});

test("login importa anexo recebido antes da autenticação", async () => {
  const h = makeHarness({ account: null });
  h.native.importSharedItems = async () => [sharedFile("antes-do-login")];
  try {
    await h.controller.start();
    await h.view.emit("sign-in");
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "antes-do-login.pdf"]]);
  } finally { h.controller.stop(); }
});

test("retornar do WhatsApp importa e envia novo anexo sem reiniciar o app", async () => {
  const h = makeHarness({ historyMode: "current-step" });
  let resume;
  let removedListener = false;
  h.native.onResume = async handler => { resume = handler; return () => { removedListener = true; }; };
  await h.controller.start();
  try {
    h.store.setDraft("Texto ainda não enviado");
    const file = new File(["pdf"], "whatsapp.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    assert.equal(typeof resume, "function", "o app deve observar a volta ao primeiro plano");
    await resume();
    assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "whatsapp.pdf"]]);
    assert.deepEqual(h.discarded, ["whatsapp-1"]);
    assert.equal(h.store.getState().draft, "Texto ainda não enviado");
    assert.equal(h.store.getState().pendingFiles.length, 0);
    assert.equal(h.store.getState().messages.at(-1).text, "Recebi whatsapp.pdf");
  } finally { h.controller.stop(); }
  assert.equal(removedListener, true);
});

test("eventos simultâneos de retorno não enviam o mesmo compartilhamento duas vezes", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  try {
    const file = new File(["pdf"], "whatsapp.pdf");
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    assert.equal(typeof resume, "function");
    await Promise.all([resume(), resume(), resume()]);
    assert.equal(h.chatCalls.filter(call => call[0] === "file").length, 1);
  } finally { h.controller.stop(); }
});

test("retorno com falha de envio remove o arquivo e não apaga a caixa compartilhada", async () => {
  const h = makeHarness();
  let resume;
  h.native.onResume = async handler => { resume = handler; return () => {}; };
  await h.controller.start();
  try {
    const file = new File(["pdf"], "whatsapp.pdf");
    Object.defineProperty(file, "sourceId", { value: "whatsapp-1" });
    h.native.importSharedItems = async () => [file];
    h.client.sendFile = async () => { throw new Error("offline"); };
    assert.equal(typeof resume, "function");
    await resume();
    assert.deepEqual(h.store.getState().pendingFiles, []);
    assert.match(h.store.getState().error, /whatsapp\.pdf não foi enviado e foi removido da lista/);
    assert.deepEqual(h.discarded, []);
  } finally { h.controller.stop(); }
});

test("anexo PDF sem MIME também solicita a prévia pelo nome do arquivo", async () => {
  const harness = makeHarness();
  let fetched = false;
  harness.client.getAttachments = async () => [{ id: "pdf-no-mime", fileName: "NOTA.PDF", mediaUrl: "/api/portal-media/pdf" }];
  harness.client.fetchMedia = async () => { fetched = true; throw new Error("download simulado"); };
  try {
    await harness.controller.start();
    await harness.controller.refreshAttachments();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(fetched, true);
  } finally { harness.controller.stop(); }
});

test("inicia sessão armazenada e retoma a VM sem responder à pergunta atual", async () => {
  const harness = makeHarness();
  await harness.controller.start();

  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "", replyId: "input_continue" }]);
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
  assert.equal(harness.store.getState().messages.some(message => message.text === "input_continue"), false);
});

test("prosseguir sem anexo envia apenas a continuação da etapa preservada", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{
    id: "expired-temporary",
    fileName: "Comprovante_20260920_014255.pdf",
    mimeType: "application/pdf",
    mediaUrl: "/api/portal-media/expired-temporary",
  }]);
  harness.client.getAttachments = async () => [];
  harness.store.ingestRemoteMessages([{
    type: "poll",
    question: "⚠️ UM ANEXO TEMPORÁRIO NÃO ESTÁ MAIS DISPONÍVEL. OS DADOS DO FORMULÁRIO FORAM PRESERVADOS. REENVIE O ARQUIVO: Comprovante_20260920_014255.pdf",
    options: [{ id: "attachment_upload_continue", label: "📎 ENVIAR ANEXO" }],
  }], { activeFlow: { id: "launch", title: "EFETUAR LANÇAMENTO" } });
  harness.chatCalls.length = 0;

  await harness.view.emit("select-reply", {
    replyId: "attachment_upload_skip",
    label: "➡️ PROSSEGUIR SEM ANEXO",
  });

  assert.deepEqual(harness.chatCalls, [["text", { text: "", replyId: "input_continue" }]]);
  assert.deepEqual(harness.store.getState().attachments, []);
  harness.controller.stop();
});

test("retomada consulta a coleção de anexos e restaura a lista suspensa do fluxo", async () => {
  const harness = makeHarness();
  harness.client.getAttachments = async () => [{
    id: "resume-attachment",
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    size: 1024,
    mediaUrl: "/api/portal-media/resume-attachment",
  }];
  await harness.controller.start();

  assert.equal(harness.store.getState().attachments[0].id, "resume-attachment");
  assert.match(renderChatMarkup(harness.view.renders.at(-1)), /Anexos \(1\)/);
});

test('imagem da VM sem id ganha prévia e abre o arquivo sem perder a conversa', async () => {
  const h = makeHarness();
  h.client.sendText = async () => ({ status: 'processed', messages: [
    { type: 'image', fileName: 'log.png', mimeType: 'image/png', mediaUrl: '/api/portal-media/log', caption: 'LOG DE AÇÕES' },
  ] });
  h.client.fetchMedia = async message => {
    h.chatCalls.push(['media', message.id]);
    return new Blob(['test image'], { type: 'image/png' });
  };
  try {
    await h.controller.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    const message = h.store.getState().messages[0];
    assert.ok(message.id);
    assert.match(message.previewUrl, /^blob:/);
    assert.match(renderChatMarkup(h.view.renders.at(-1)), /class="chat-media-preview__image"/);
    await h.view.emit('open-media', { messageId: message.id });
    assert.equal(h.exported.length, 1);
    assert.equal(h.store.getState().messages[0].previewUrl, message.previewUrl);
  } finally { h.controller.stop(); }
});

test('ao abrir identifica o fluxo ativo e permite resumo em imagem sem substituir pergunta ou rascunho', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'task', title: 'ADICIONAR TAREFA' };
  h.client.sendText = async () => ({ status: 'processed', activeFlow, messages: [{type:'text', text:'Qual é a filial?'}] });
  await h.controller.start();
  assert.deepEqual(h.store.getState().activeFlow, activeFlow);
  assert.match(renderChatMarkup(h.view.renders.at(-1)), /Ver resumo/);
  h.store.setDraft('Rascunho em andamento');
  const messages = h.store.getState().messages;
  h.client.sendText = async payload => {
    assert.equal(payload.replyId, 'flow_summary');
    return {status:'processed', activeFlow, results:[{status:'flow_summary'}], messages:[{type:'image',mediaUrl:'/api/portal-media/summary',fileName:'resumo.png'}]};
  };
  const previews = [];
  h.native.previewMedia = async (source, name) => { previews.push([await source,name]); };
  await h.view.emit('show-summary');
  assert.equal(previews.length, 1);
  assert.equal(previews[0][1], 'resumo.png');
  assert.equal(h.store.getState().messages, messages);
  assert.equal(h.store.getState().draft, 'Rascunho em andamento');
});

test('res digitado abre resumo, e conclusão remove a opção do fluxo anterior', async () => {
  const h = makeHarness({historyMode:'current-step'});
  await h.controller.start();
  const messages = h.store.getState().messages;
  h.client.sendText = async () => ({status:'processed',activeFlow:{id:'task',title:'TAREFA'},results:[{status:'flow_summary'}],messages:[{type:'image',mediaUrl:'/api/portal-media/summary'}]});
  h.store.setDraft('res');
  await h.controller.sendText();
  assert.equal(h.store.getState().draft, '');
  assert.equal(h.store.getState().messages, messages);
  assert.equal(h.exported.length, 1);
  h.client.sendText = async () => ({status:'processed',activeFlow:null,messages:[{type:'text',text:'Concluído'}]});
  await h.controller.sendText('Sim');
  assert.equal(h.store.getState().activeFlow, null);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Ver resumo/);
});

test('resumo sem fluxo ou indisponível preserva a pergunta e informa o motivo', async () => {
  const h = makeHarness({historyMode:'current-step'});
  await h.controller.start();
  const messages = h.store.getState().messages;
  h.client.sendText = async () => ({status:'processed',activeFlow:null,results:[{status:'no_active_flow'}],messages:[{type:'text',text:'Não há nenhum fluxo em andamento.'}]});
  await h.controller.sendText('res');
  assert.equal(h.store.getState().messages, messages);
  assert.match(h.view.renders.at(-1).error, /nenhum fluxo/);
});

test('menu do portal pergunta pelo rascunho antes de sair e não mostra prévia sobre o menu', async () => {
  const h = makeHarness({ historyMode: 'current-step' });
  const activeFlow = { id: 'task', title: 'EFETUAR LANÇAMENTO', contextId: 'ctx-1' };
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    if (payload.replyId === 'portal_confirm_main_menu') {
      return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
        { id: 'portal_draft_exit_save', label: 'SIM, SALVAR COMO RASCUNHO' },
        { id: 'portal_draft_exit_discard', label: 'NÃO, SAIR SEM SALVAR' },
      ] }] };
    }
    return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
      results: [{ draft_saved: true }], activeFlow: null,
      messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [] }] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{ type: 'poll', question: 'Pergunta do fluxo', options: [
    { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
  ] }], { activeFlow });
  assert.ok(h.store.getState().activeFlow);
  await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });
  assert.equal(calls.at(-1).replyId, 'portal_confirm_main_menu');
  assert.match(h.store.getState().messages.at(-1).question, /Deseja deixar como rascunho/);
  await h.view.emit('select-reply', { label: 'SIM, SALVAR COMO RASCUNHO', replyId: 'portal_draft_exit_save' });
  assert.equal(calls.at(-1).replyId, 'portal_draft_exit_save');
  assert.equal(h.view.renders.at(-1).recoveryReference, null);
  assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Rascunho da conversa anterior/);
});

for (const decision of ['portal_draft_exit_save', 'portal_draft_exit_discard']) {
  test(`ao sair para o menu (${decision === 'portal_draft_exit_save' ? 'salvar' : 'descartar'}), limpa a lista de anexos do fluxo`, async () => {
    const h = makeHarness({ historyMode: 'current-step' });
    const activeFlow = { id: 'document', title: 'ADICIONAR UM NOVO DOCUMENTO', contextId: 'ctx-attachments' };
    h.client.sendText = async payload => {
      if (payload.replyId === 'portal_confirm_main_menu') {
        return { status: 'processed', activeFlow, messages: [{ type: 'poll', question: 'Deseja deixar como rascunho?', options: [
          { id: 'portal_draft_exit_save', label: 'CRIAR RASCUNHO' },
          { id: 'portal_draft_exit_discard', label: 'ELIMINAR FORMULÁRIO' },
        ] }] };
      }
      return { status: 'processed', returned_to_main_menu: true, resetConversation: true,
        activeFlow: null, messages: [{ type: 'poll', question: 'MENU PRINCIPAL', options: [] }] };
    };
    await h.controller.start();
    h.store.ingestRemoteMessages([{ type: 'poll', question: 'Qual documento?', options: [
      { id: 'navigation_main_menu', label: 'RETORNAR AO MENU INICIAL' },
    ] }], { activeFlow });
    h.store.syncAttachments([{ id: 'flow-file', fileName: 'contrato.pdf', mimeType: 'application/pdf', size: 123, mediaUrl: '/api/portal-media/flow-file' }]);
    assert.equal(h.store.getState().attachments.length, 1);

    await h.view.emit('select-reply', { label: 'RETORNAR AO MENU INICIAL', replyId: 'navigation_main_menu' });
    await h.view.emit('select-reply', { label: decision === 'portal_draft_exit_save' ? 'CRIAR RASCUNHO' : 'ELIMINAR FORMULÁRIO', replyId: decision });

    assert.deepEqual(h.store.getState().attachments, [], 'o menu principal não pode herdar anexos do fluxo anterior');
    assert.doesNotMatch(renderChatMarkup(h.view.renders.at(-1)), /Anexos \(/);
  });
}

test("toques repetidos durante envio não criam uma segunda operação", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolve;
  let calls = 0;
  harness.client.sendText = () => { calls++; return new Promise(done => { resolve = done; }); };
  const sending = harness.controller.sendText('Sim', 'yes');
  const second = harness.controller.sendText('Sim', 'yes');
  assert.equal(calls, 1);
  assert.equal(await second, false);
  resolve({ status: 'processed', messages: [{ type: 'text', text: 'Próxima pergunta' }] });
  await sending;
  assert.equal(harness.store.getState().messages.at(-1).text, 'Próxima pergunta');
});

test("anexo selecionado durante resposta em trânsito aguarda e depois é enviado", async () => {
  const h = makeHarness();
  await h.controller.start();
  let finishText;
  h.client.sendText = () => new Promise(resolve => { finishText = resolve; });
  const sending = h.controller.sendText('Resposta');
  h.native.pickDocuments = async () => [{ name: 'foto.jpg', size: 4, type: 'image/jpeg' }];
  const selecting = h.view.emit('pick-files');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.chatCalls.filter(call => call[0] === 'file').length, 0);
  finishText({ status: 'processed', messages: [] });
  await sending; await selecting;
  assert.deepEqual(h.chatCalls.filter(call => call[0] === 'file'), [['file', 'foto.jpg']]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("anexo grande abre a prévia de compactação depois de ser confirmado", async () => {
  const h = makeHarness();
  const largeFile = { name: "comprovante.pdf", size: 6_400_000, type: "application/pdf" };
  h.native.pickDocuments = async () => [largeFile];
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: `Recebi ${file.name}` }],
    activeFlow: { id: "asset", title: "CADASTRAR IMOBILIZADO" },
    attachments: [{
      id: "large-attachment",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "/api/portal-media/large-attachment",
    }],
  });
  h.client.compressAttachment = async attachmentId => {
    h.chatCalls.push(["compress-attachment", attachmentId]);
    return {
      status: "processed",
      messages: [{
        type: "poll",
        question: "Deseja usar a versão compactada?",
        options: [
          { id: "attachment_compression_use", reply: "attachment_compression_use", label: "SIM" },
          { id: "attachment_compression_keep", reply: "attachment_compression_keep", label: "NÃO" },
        ],
      }],
      attachments: [{
        id: "large-attachment",
        fileName: largeFile.name,
        mimeType: largeFile.type,
        size: 1_200_000,
        mediaUrl: "/api/portal-media/large-attachment",
      }],
    };
  };
  await h.controller.start();
  await h.view.emit("pick-files");

  assert.deepEqual(h.chatCalls.filter(call => call[0] === "compress-attachment"), [
    ["compress-attachment", "large-attachment"],
  ]);
  const compressionPrompt = h.store.getState().messages.at(-1);
  assert.match(compressionPrompt?.question || "", /versão compactada/);
  assert.deepEqual(compressionPrompt?.attachment_compression_preview, {
    original: {
      id: "large-attachment",
      fileName: "comprovante.pdf",
      mimeType: "application/pdf",
      size: 6_400_000,
      mediaUrl: "/api/portal-media/large-attachment",
    },
    compressed: {
      id: "large-attachment",
      fileName: "comprovante.pdf",
      mimeType: "application/pdf",
      size: 1_200_000,
      mediaUrl: "/api/portal-media/large-attachment",
    },
  });
  h.controller.stop();
});

test("arquivos soltos no chat usam a mesma fila de envio dos anexos selecionados", async t => {
  const h = makeHarness();
  t.after(() => h.controller.stop());
  await h.controller.start();
  const files = [
    new File(["pdf"], "arrastado.pdf", { type: "application/pdf" }),
    new File(["foto"], "arrastada.jpg", { type: "image/jpeg" }),
  ];

  await h.view.emit("files-dropped", { files });

  assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [
    ["file", "arrastado.pdf"],
    ["file", "arrastada.jpg"],
  ]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("assinatura desenhada entra na fila de anexos e é enviada pela VM", async () => {
  const h = makeHarness();
  await h.controller.start();
  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });
  assert.deepEqual(h.chatCalls.filter(call => call[0] === "file"), [["file", "assinatura-desenhada.png"]]);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("assinatura capturada não aparece como anexo separado na bandeja", async () => {
  const h = makeHarness();
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: "Assinatura recebida" }],
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: file.name, mimeType: file.type, size: file.size, mediaUrl: "/assinatura" },
    ],
  });
  await h.controller.start();
  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });

  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  const markup = renderChatMarkup(h.view.renders.at(-1));
  const attachmentTray = markup.slice(markup.indexOf('<div class="chat-file-tray">'));
  assert.doesNotMatch(attachmentTray, /assinatura-desenhada\.png/);
  h.controller.stop();
});

test("primeira assinatura desenhada abre o posicionamento sem exigir um segundo envio", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([item.id], {
      type: item.mimeType || (item.fileName.endsWith(".pdf") ? "application/pdf" : "image/png"),
    });
  };
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: "Assinatura recebida" }],
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: { stage: "document_signing_waiting_position" },
    },
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: file.name, mimeType: file.type, size: file.size, mediaUrl: "/assinatura" },
    ],
  });
  await h.controller.start();

  const file = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(h.store.getState().activeFlow.documentSigningPlacement, {
    stage: "document_signing_waiting_position",
    scope: null,
    document: {
      id: "documento",
      fileName: "contrato.pdf",
      mimeType: "application/pdf",
      mediaUrl: "/documento",
    },
    signature: {
      id: "assinatura",
      fileName: "assinatura-desenhada.png",
      mimeType: "image/png",
      mediaUrl: "/assinatura",
    },
  });
  assert.deepEqual(fetched.sort(), ["assinatura", "documento"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  h.controller.stop();
});

test("comprovante gerado preserva o PDF fonte ao enviar a prévia assinada", () => {
  assert.equal(
    shouldRemoveSignedSource("payment-source", true),
    false,
  );
  assert.equal(shouldRemoveSignedSource("tray-source", false), true);
  assert.equal(shouldRemoveSignedSource("", false), false);
});

test("assina PDF da bandeja, abre o posicionamento e só substitui o original após confirmar o assinado", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-pdf"], { type: "application/pdf" });
    },
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => {
    h.chatCalls.push(["media", item.id]);
    return new Blob(["original-pdf"], { type: "application/pdf" });
  };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return {
      status: "processed",
      messages: [
        { type: "text", text: "📎 ANEXO RECEBIDO. Continue preenchendo o formulário." },
        { type: "text", text: "Qual é a próxima informação?" },
      ],
      activeFlow,
      attachments: [refreshedOriginal, uploaded],
    };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow, attachments: [uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  const signature = new File(["png"], "assinatura-desenhada.png", { type: "image/png" });
  await h.view.emit("signature-captured", { file: signature, fileId: "report" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(h.chatCalls, [["media", "report"]], "a assinatura não deve ser enviada à etapa da tarefa");

  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.2 } });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].point.scale, 0.2);
  assert.equal(signedCalls[0].documentBlob.type, "application/pdf");
  assert.equal(signedCalls[0].signatureBlob, signature);
  assert.deepEqual(h.chatCalls, [
    ["media", "report"],
    ["file", "relatorio-assinado.pdf"],
    ["delete-attachment", "report-v2"],
  ]);
  assert.equal(h.store.getState().activeFlow.id, "task");
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("substitui o PDF da bandeja incluindo o carimbo de Bernardo", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-with-stamp"], { type: "application/pdf" });
    },
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => {
    h.chatCalls.push(["media", item.id]);
    return new Blob([item.id], { type: item.id === "report" ? "application/pdf" : "image/png" });
  };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [refreshedOriginal, uploaded] };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow, attachments: [uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const stamp = new Blob(["stamp"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(signedCalls[0].stampPoint, { page: 1, x: 0.5, y: 0.7, scale: 0.8 });
  assert.deepEqual(h.chatCalls, [["media", "report"], ["file", "relatorio-assinado.pdf"], ["delete-attachment", "report-v2"]]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  h.controller.stop();
});

test("mantém o processamento original da VM ao assinar pela bandeja no fluxo dedicado", async () => {
  const h = makeHarness();
  const activeFlow = { id: "document_signing", title: "ASSINAR DOCUMENTOS" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });

  assert.deepEqual(h.chatCalls, [["file", "assinatura-desenhada.png"]]);
  h.controller.stop();
});

test("preserva o PDF original quando a VM não confirma o documento assinado", async () => {
  const h = makeHarness({
    signPdfAttachment: async () => new Blob(["signed-pdf"], { type: "application/pdf" }),
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    throw new Error("upload indisponível");
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.8 } });

  assert.deepEqual(h.chatCalls.map(call => call[0]), ["media", "file"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio.pdf"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.match(h.view.renders.at(-1).error, /não foi confirmado|indisponível/i);
  h.controller.stop();
});

test("avisa quando PDFs originais idênticos impedem identificar qual deve ser retirado", async () => {
  const h = makeHarness({
    signPdfAttachment: async () => new Blob(["signed-pdf"], { type: "application/pdf" }),
  });
  const activeFlow = { id: "task", title: "ADICIONAR UMA NOVA TAREFA" };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const duplicate = { ...original, id: "report-copy", mediaUrl: "/report-copy" };
  const refreshedOriginal = { ...original, id: "report-v2", mediaUrl: "/report-v2" };
  const refreshedDuplicate = { ...duplicate, id: "report-copy-v2", mediaUrl: "/report-copy-v2" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow, attachments: [refreshedOriginal, refreshedDuplicate, uploaded] };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [original, duplicate] });
  h.chatCalls.length = 0;

  await h.view.emit("signature-captured", {
    file: new File(["png"], "assinatura-desenhada.png", { type: "image/png" }),
    fileId: "report",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await h.view.emit("signature-placement-position", { point: { page: 1, x: 0.5, y: 0.65, scale: 0.8 } });

  assert.deepEqual(h.chatCalls.map(call => call[0]), ["media", "file"]);
  assert.match(String(h.view.renders.at(-1).error || ""), /original.*não pôde ser identificado|originais idênticos/i);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["report-v2", "report-copy-v2", "signed"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("snapshot do fluxo de assinatura também oculta a assinatura na bandeja", async () => {
  const h = makeHarness();
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      signature: {
        id: "assinatura",
        fileName: "assinatura-desenhada.png",
        mediaUrl: "/assinatura",
      },
    },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/documento" },
      { id: "assinatura", fileName: "assinatura-desenhada.png", mimeType: "image/png", size: 3, mediaUrl: "/assinatura" },
    ],
  });

  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["contrato.pdf"]);
  h.controller.stop();
});

test("carrega o PDF e envia a página e o ponto escolhido no posicionamento da assinatura", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([item.id], { type: item.id === "documento" ? "application/pdf" : "image/png" });
  };
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
    },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/api/portal-media/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/api/portal-media/assinatura" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetched.sort(), ["assinatura", "documento"]);
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");

  let request;
  h.client.sendText = async payload => {
    request = payload;
    return { status: "processed", activeFlow, messages: [{ type: "text", text: "Assinatura posicionada" }] };
  };
  await h.view.emit("signature-placement-position", { point: { page: 2, x: 0.25, y: 0.75, scale: 1.4 } });
  assert.equal(request.replyId, "document_signing_position_point:2:0.250000:0.750000:1.400000");
  h.controller.stop();
});

test("adiciona a assinatura de Bernardo ao PDF que já contém a assinatura de outra pessoa", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["pdf-com-duas-assinaturas"], { type: "application/pdf" });
    },
  });
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "epi-pdf", fileName: "entrega-epi.pdf", mimeType: "application/pdf", mediaUrl: "/epi-pdf" },
      signature: { id: "assinatura-fornecedor", fileName: "assinatura-fornecedor.png", mimeType: "image/png", mediaUrl: "/assinatura-fornecedor" },
    },
  };
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "epi-pdf" ? "application/pdf" : "image/png",
  });
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return {
      status: "processed",
      activeFlow: null,
      resetConversation: true,
      messages: [{ type: "text", text: "Documento com as duas assinaturas recebido." }],
      results: [{ status: "document_signed" }],
      uploadedName: file.name,
    };
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow, attachments: [] });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;

  const stamp = new Blob(["assinatura-bernardo"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.7, y: 0.3, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.35, y: 0.7, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].signatureBlob.type, "image/png");
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(signedCalls[0].stampPoint, { page: 1, x: 0.7, y: 0.3, scale: 0.8 });
  assert.deepEqual(h.chatCalls, [["file", "entrega-epi-assinado.pdf"]]);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("substitui localmente um PDF do fluxo dedicado quando o carimbo é adicionado", async () => {
  const signedCalls = [];
  const h = makeHarness({
    signPdfAttachment: async input => {
      signedCalls.push(input);
      return new Blob(["signed-with-stamp"], { type: "application/pdf" });
    },
  });
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: { stage: "document_signing_waiting_position" },
  };
  const original = { id: "report", fileName: "relatorio.pdf", mimeType: "application/pdf", size: 1200, mediaUrl: "/report" };
  const uploaded = { id: "signed", fileName: "relatorio-assinado.pdf", mimeType: "application/pdf", size: 2400, mediaUrl: "/signed" };
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "report" ? "application/pdf" : "image/png",
  });
  h.client.sendFile = async file => {
    h.chatCalls.push(["file", file.name]);
    return { status: "processed", messages: [], activeFlow: { id: activeFlow.id, title: activeFlow.title }, attachments: [original, uploaded] };
  };
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], activeFlow: { id: activeFlow.id, title: activeFlow.title }, attachments: [uploaded] };
  };
  const queuedItems = [];
  const unsubscribe = h.store.subscribe(state => {
    queuedItems.push(...state.pendingFiles);
  });
  await h.controller.start();
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      original,
      { id: "signature", fileName: "assinatura.png", mimeType: "image/png", size: 3, mediaUrl: "/signature" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  h.chatCalls.length = 0;

  const stamp = new Blob(["stamp"], { type: "image/png" });
  await h.view.emit("signature-placement-stamp", {
    stampBlob: stamp,
    stampPoint: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });
  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });

  assert.equal(signedCalls.length, 1);
  assert.equal(signedCalls[0].stampBlob, stamp);
  assert.deepEqual(h.chatCalls, [["file", "relatorio-assinado.pdf"], ["delete-attachment", "report"]]);
  assert.equal(queuedItems.at(-1).hideFromAttachmentTray, true);
  assert.deepEqual(h.store.getState().attachments.map(item => item.fileName), ["relatorio-assinado.pdf"]);
  unsubscribe();
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("anexo confirmado agenda lembrete de cinco minutos e o cancela ao postar", async () => {
  const h = makeHarness();
  const scheduled = [];
  let cancelled = 0;
  h.native.scheduleAttachmentReminder = async details => {
    scheduled.push(details);
    return true;
  };
  h.native.cancelAttachmentReminder = async () => { cancelled += 1; };
  h.client.sendFile = async file => ({
    status: "processed",
    messages: [{ type: "text", text: `Recebi ${file.name}` }],
    attachments: [{
      id: "attachment-1",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "https://vm.test/attachment-1",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "documento.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 5 * 60 * 1000);
  assert.equal(scheduled[0].body, "Anexo recebido há 5 minutos sem postagem");

  await h.controller.sendText("continuar");
  assert.ok(cancelled >= 1, "qualquer postagem deve cancelar o lembrete do anexo");
  h.controller.stop();
});

test("upload concluído não deixa o anexo postado na bandeja", async () => {
  const h = makeHarness();
  let cancelled = 0;
  h.native.cancelAttachmentReminder = async () => { cancelled += 1; };
  h.client.sendFile = async file => ({
    status: "processed",
    returned_to_main_menu: true,
    messages: [{ type: "text", text: `Documento ${file.name} postado.` }],
    attachments: [{
      id: "posted-upload",
      fileName: file.name,
      mimeType: file.type,
      mediaUrl: "/api/portal-media/posted-upload",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "postado.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.deepEqual(h.store.getState().attachments, []);
  assert.ok(cancelled >= 1);
  h.controller.stop();
});

test("upload que devolve o menu sem marcador de reset não mantém o anexo postado", async () => {
  const h = makeHarness();
  h.client.sendFile = async file => ({
    status: "processed",
    activeFlow: { id: "document", title: "ADICIONAR UM NOVO DOCUMENTO" },
    messages: [{ type: "poll", question: "📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options: [] }],
    attachments: [{
      id: "posted-with-menu",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      mediaUrl: "/api/portal-media/posted-with-menu",
    }],
  });

  await h.controller.start();
  h.store.queueFiles([new File(["pdf"], "postado-menu.pdf", { type: "application/pdf" })]);
  const fileId = h.store.getState().pendingFiles[0].id;
  assert.equal(await h.controller.uploadFile(fileId), true);
  assert.equal(h.store.getState().activeFlow, null);
  assert.deepEqual(h.store.getState().attachments, []);
  h.controller.stop();
});

test("carrega tarefas delegadas pendentes e conclui pela galeria", async () => {
  const h = makeHarness();
  const calls = [];
  h.client.getDelegatedTasks = async () => ({
    rows: [
      { id: "501", task: "Enviar contrato", responsible: "Bernardo" },
      { id: "503", task: "Conferir prazo", responsible: "Ana" },
    ],
  });
  h.client.completeDelegatedTask = async id => {
    calls.push(String(id));
    return { delegatedTasks: { rows: [{ id: "503", task: "Conferir prazo", responsible: "Ana" }] } };
  };

  await h.controller.start();
  assert.equal(h.view.renders.at(-1).delegatedTasks.rows.length, 2);
  await h.view.emit("complete-delegated-task", { taskId: "501" });
  assert.deepEqual(calls, ["501"]);
  assert.equal(h.view.renders.at(-1).delegatedTasks.rows.length, 1);
  h.controller.stop();
});

test("ações da prévia permitem editar assinatura ou voltar para a escolha", async () => {
  const h = makeHarness();
  h.client.fetchMedia = async item => new Blob([item.id], {
    type: item.id === "documento" ? "application/pdf" : "image/png",
  });
  await h.controller.start();
  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: { stage: "document_signing_waiting_position" },
  };
  h.store.ingestRemoteMessages([], {
    activeFlow,
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/assinatura" },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  let request;
  h.client.sendText = async payload => {
    request = payload;
    return { status: "processed", activeFlow, messages: [{ type: "text", text: "Escolha" }] };
  };
  await h.view.emit("signature-placement-edit");
  assert.equal(request.replyId, "document_signing_edit_signature");
  await h.view.emit("signature-placement-close");
  assert.equal(request.replyId, "document_signing_position_back");
  h.controller.stop();
});

test("retornar ao menu na tela final da assinatura funciona sem fluxo ativo local", async () => {
  const h = makeHarness({ historyMode: "current-step" });
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    return {
      status: "processed",
      activeFlow: null,
      resetConversation: true,
      returned_to_main_menu: true,
      messages: [{ type: "poll", question: "MENU PRINCIPAL", options: [] }],
    };
  };
  await h.controller.start();
  calls.length = 0;
  h.store.ingestRemoteMessages([{
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    caption: "✍️ DOCUMENTO ASSINADO — ASSINATURA APLICADA EM UM ÚNICO LOCAL",
    mediaUrl: "/signed",
  }], { activeFlow: null, resetConversation: true });
  await h.view.emit("select-reply", {
    label: "🏠 RETORNAR AO MENU INICIAL",
    replyId: "navigation_main_menu",
  });
  assert.equal(calls.at(-1).replyId, "portal_confirm_main_menu");
  h.controller.stop();
});

test("reabre o PDF gerado para alterar tamanho e posição sem voltar ao menu", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id || item.mediaUrl);
    return new Blob([String(item.id || item.mediaUrl)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  h.client.sendText = async () => {
    throw new Error("não deve enviar uma resposta para o menu");
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf" },
      signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature" },
    },
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.deepEqual(fetched.sort(), ["original-pdf", "signature"]);
  await h.view.emit("signature-placement-close");
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("voltar e ajustar assinatura do comprovante abre as fontes enviadas na lista de anexos", async () => {
  const h = makeHarness();
  const fetched = [];
  const replyIds = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([String(item.id)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    type: "poll",
    question: "CONFIRA A PRÉVIA DO PDF E CONFIRME O CADASTRO.",
    options: [{
      id: "document_signing_payment_adjust",
      reply: "document_signing_payment_adjust",
      label: "VOLTAR E AJUSTAR ASSINATURA",
    }],
  }], {
    activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
  });
  h.client.sendText = async payload => {
    replyIds.push(payload.replyId);
    if (payload.replyId === "document_signing_payment_adjust") {
      return {
        status: "processed",
        messages: [{ type: "text", text: "ASSINATURA RECEBIDA. TOQUE NO PDF." }],
        activeFlow: {
          id: "document_signing",
          title: "ASSINAR DOCUMENTOS",
          documentSigningPlacement: {
            stage: "document_signing_waiting_position",
            preserveSource: true,
            document: { fileName: "COMPROVANTE-PAGAMENTO.pdf" },
            signature: { fileName: "assinatura-desenhada.png" },
          },
        },
        attachments: [
          {
            id: "payment-source",
            fileName: "COMPROVANTE-PAGAMENTO.pdf",
            mimeType: "application/pdf",
            size: 1200,
            mediaUrl: "/api/portal-media/payment-source",
          },
          {
            id: "payment-signature",
            fileName: "assinatura-desenhada.png",
            mimeType: "image/png",
            size: 300,
            mediaUrl: "/api/portal-media/payment-signature",
          },
        ],
      };
    }
    assert.match(payload.replyId, /^document_signing_position_point:/);
    return {
      status: "processed",
      messages: [{
        type: "document",
        fileName: "COMPROVANTE-PAGAMENTO-assinado.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-preview",
      }],
      activeFlow: { id: "document_signing", title: "ASSINAR DOCUMENTOS" },
      attachments: [{
        id: "payment-source",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        size: 1200,
        mediaUrl: "/api/portal-media/payment-source",
      }],
    };
  };

  await h.view.emit("select-reply", {
    replyId: "document_signing_payment_adjust",
    label: "VOLTAR E AJUSTAR ASSINATURA",
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.store.getState().activeFlow.documentSigningPlacement.preserveSource, true);
  assert.deepEqual(fetched.sort(), ["payment-signature", "payment-source"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["payment-source"]);
  assert.equal(h.view.renders.at(-1).error, null);

  await h.view.emit("signature-placement-position", {
    point: { page: 1, x: 0.5, y: 0.7, scale: 0.8 },
  });

  assert.deepEqual(replyIds, [
    "document_signing_payment_adjust",
    "document_signing_position_point:1:0.500000:0.700000:0.800000",
  ]);
  assert.equal(h.chatCalls.some(call => call[0] === "delete-attachment"), false);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["payment-source"]);
  assert.equal(h.view.renders.at(-1).error, null);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("não abre PDF homônimo quando a fonte declarada do reposicionamento é ambígua", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.id);
    return new Blob([String(item.id)], { type: item.mimeType });
  };
  await h.controller.start();

  h.store.ingestRemoteMessages([{ type: "text", text: "ASSINATURA RECEBIDA. TOQUE NO PDF." }], {
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: {
        stage: "document_signing_waiting_position",
        document: { fileName: "COMPROVANTE-PAGAMENTO.pdf" },
        signature: { fileName: "assinatura-desenhada.png" },
      },
    },
    attachments: [
      {
        id: "payment-source-old",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-source-old",
      },
      {
        id: "payment-source-new",
        fileName: "COMPROVANTE-PAGAMENTO.pdf",
        mimeType: "application/pdf",
        mediaUrl: "/api/portal-media/payment-source-new",
      },
      {
        id: "payment-signature",
        fileName: "assinatura-desenhada.png",
        mimeType: "image/png",
        mediaUrl: "/api/portal-media/payment-signature",
      },
    ],
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fetched, []);
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  h.controller.stop();
});

test("ao confirmar novo posicionamento, fecha o editor e mostra o documento gerado", async () => {
  const h = makeHarness();
  h.client.fetchMedia = async item => new Blob([String(item.mediaUrl || item.id)], {
    type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
  });
  await h.controller.start();
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed-old",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf-old" },
      signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature-old" },
    },
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");

  let request;
  h.client.sendText = async payload => {
    request = payload;
    return {
      status: "processed",
      activeFlow: null,
      messages: [{
        id: "signed-pdf-new",
        type: "document",
        fileName: "contrato-NOVO-ASSINADO.pdf",
        mediaUrl: "/signed-new",
        caption: "DOCUMENTO ASSINADO NOVAMENTE",
        signatureEdit: {
          document: { id: "original-pdf", fileName: "contrato.pdf", mediaUrl: "/pdf-old" },
          signature: { id: "signature", fileName: "assinatura.png", mediaUrl: "/signature-old" },
        },
      }],
    };
  };

  await h.view.emit("signature-placement-position", {
    point: { page: 2, x: 0.25, y: 0.75, scale: 1.4 },
  });

  assert.equal(request.replyId, "document_signing_position_point:2:0.250000:0.750000:1.400000");
  assert.equal(h.view.renders.at(-1).signaturePlacement, null);
  assert.equal(h.view.renders.at(-1).messages.at(-1).fileName, "contrato-NOVO-ASSINADO.pdf");
  h.controller.stop();
});

test("ao editar a assinatura após redimensionar, usa a nova assinatura devolvida pela VM", async () => {
  const h = makeHarness();
  const fetched = [];
  h.client.fetchMedia = async item => {
    fetched.push(item.mediaUrl || item.id);
    return new Blob([String(item.id || item.mediaUrl)], {
      type: String(item.fileName || "").endsWith(".pdf") ? "application/pdf" : "image/png",
    });
  };
  await h.controller.start();
  const previousFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "documento", fileName: "contrato-antigo.pdf", mediaUrl: "/pdf-antigo" },
      signature: { id: "assinatura", fileName: "assinatura-antiga.png", mediaUrl: "/assinatura-antiga" },
    },
  };
  h.store.ingestRemoteMessages([{
    id: "signed-pdf-local",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    mediaUrl: "/signed",
    caption: "DOCUMENTO ASSINADO",
    signatureEdit: {
      document: previousFlow.documentSigningPlacement.document,
      signature: previousFlow.documentSigningPlacement.signature,
    },
  }], {
    activeFlow: previousFlow,
    attachments: [
      { id: "documento", fileName: "contrato-antigo.pdf", mimeType: "application/pdf", mediaUrl: "/pdf-antigo" },
      { id: "assinatura", fileName: "assinatura-antiga.png", mimeType: "image/png", mediaUrl: "/assinatura-antiga" },
    ],
  });
  await h.view.emit("resize-signature", { messageId: "signed-pdf-local" });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.fileName, "assinatura-antiga.png");

  const activeFlow = {
    id: "document_signing",
    title: "ASSINAR DOCUMENTOS",
    documentSigningPlacement: {
      stage: "document_signing_waiting_position",
      document: { id: "documento", fileName: "contrato-novo.pdf", mediaUrl: "/pdf-novo" },
      signature: { id: "assinatura", fileName: "assinatura-nova.png", mediaUrl: "/assinatura-nova" },
    },
  };
  h.client.sendText = async payload => {
    assert.equal(payload.replyId, "document_signing_edit_signature");
    return {
      status: "processed",
      activeFlow,
      attachments: [
        { id: "documento", fileName: "contrato-novo.pdf", mimeType: "application/pdf", mediaUrl: "/pdf-novo" },
        { id: "assinatura", fileName: "assinatura-nova.png", mimeType: "image/png", mediaUrl: "/assinatura-nova" },
      ],
      messages: [{ type: "text", text: "Envie a nova assinatura." }],
    };
  };

  await h.view.emit("signature-placement-edit");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "ready");
  assert.equal(h.view.renders.at(-1).signaturePlacement.signature.fileName, "assinatura-nova.png");
  assert.ok(fetched.includes("/assinatura-nova"));
  assert.equal(fetched.includes("/assinatura-antiga"), true);
  h.controller.stop();
});

test("redimensionar sem fonte local preserva a conversa e não navega para o menu", async () => {
  const h = makeHarness();
  const calls = [];
  h.client.sendText = async payload => {
    calls.push(payload);
    throw new Error("não deve enviar comando para um fluxo encerrado");
  };
  await h.controller.start();
  calls.length = 0;
  h.store.ingestRemoteMessages([{
    id: "signed-without-source",
    type: "document",
    fileName: "contrato-ASSINADO.pdf",
    caption: "DOCUMENTO ASSINADO",
    signatureEditAvailable: true,
  }], { activeFlow: null, attachments: [] });
  await h.view.emit("resize-signature", { messageId: "signed-without-source" });
  assert.deepEqual(calls, []);
  assert.match(String(h.view.renders.at(-1).error || ""), /fonte.*disponível/i);
  h.controller.stop();
});

test("não deixa o posicionamento preso em Carregando quando a mídia demora", async () => {
  const h = makeHarness({ mediaLoadTimeoutMs: 5 });
  h.client.fetchMedia = () => new Promise(() => {});
  await h.controller.start();
  h.store.ingestRemoteMessages([], {
    activeFlow: {
      id: "document_signing",
      title: "ASSINAR DOCUMENTOS",
      documentSigningPlacement: { stage: "document_signing_waiting_position" },
    },
    attachments: [
      { id: "documento", fileName: "contrato.pdf", mimeType: "application/pdf", mediaUrl: "/api/portal-media/documento" },
      { id: "assinatura", fileName: "assinatura.png", mimeType: "image/png", mediaUrl: "/api/portal-media/assinatura" },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.view.renders.at(-1).signaturePlacement.status, "error");
  assert.match(h.view.renders.at(-1).signaturePlacement.error, /tempo|demorou/i);
  h.controller.stop();
});

test("sair apaga dados locais antes do redirecionamento Microsoft terminar", async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.setDraft('Rascunho privado');
  let finishLogout;
  h.auth.signOut = () => new Promise(resolve => { finishLogout = resolve; });
  const logout = h.view.emit('sign-out');
  assert.equal(h.view.renders.at(-1).sessionStatus, 'signed-out');
  assert.equal(h.store.getState().draft, '');
  assert.deepEqual(h.store.getState().messages, []);
  finishLogout(); await logout;
});

test("seleção antiga que retorna após sair não entra na próxima conta", async () => {
  const h = makeHarness();
  await h.controller.start();
  let finishSelection;
  h.native.pickDocuments = () => new Promise(resolve => { finishSelection = resolve; });
  const selecting = h.view.emit('pick-files');
  await h.view.emit('sign-out');
  await h.view.emit('sign-in');
  finishSelection([{ name: 'privado.jpg', size: 4, type: 'image/jpeg' }]);
  await selecting;
  assert.equal(h.chatCalls.filter(call => call[0] === 'file').length, 0);
  assert.equal(h.store.getState().pendingFiles.length, 0);
});

test("sem conta aguarda login antes de falar com a VM", async () => {
  const harness = makeHarness({ account: null });
  await harness.controller.start();
  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");

  await harness.view.emit("sign-in");
  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "", replyId: "input_continue" }]);
});

test("redirecionamento de login não autentica antes de existir uma conta", async () => {
  const harness = makeHarness({ account: null });
  harness.auth.signIn = async () => null;
  await harness.controller.start();

  await harness.view.emit("sign-in");

  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");
});

test("falha preserva rascunho e não confirma mensagem local", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([], { resetConversation: true });
  harness.client.sendText = async () => { throw new Error("VM indisponível"); };

  harness.store.setDraft("Criar registro");
  await harness.controller.sendText("Criar registro");

  assert.equal(harness.store.getState().draft, "Criar registro");
  assert.equal(harness.store.getState().messages.some(message => message.text === "Criar registro"), false);
  assert.equal(harness.store.getState().error, "VM indisponível");
});

test("cancelar a câmera não cria anexo", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  await harness.view.emit("capture-photo");
  assert.equal(harness.store.getState().pendingFiles.length, 0);
});

test("envia vários anexos em série e remove o que falhou da bandeja", async () => {
  const harness = makeHarness();
  const attempts = [];
  harness.native.pickDocuments = async () => [
    { name: "a.jpg", size: 1, type: "image/jpeg" },
    { name: "b.pdf", size: 1, type: "application/pdf" },
    { name: "c.txt", size: 1, type: "text/plain" },
  ];
  harness.client.sendFile = async file => {
    attempts.push(file.name);
    if (file.name === "b.pdf") throw new Error("falhou b");
    return { status: "processed", messages: [] };
  };
  await harness.controller.start();

  await harness.view.emit("pick-files");

  assert.deepEqual(attempts, ["a.jpg", "b.pdf", "c.txt"]);
  assert.deepEqual(harness.store.getState().pendingFiles, []);
  assert.match(harness.view.renders.at(-1).error, /b\.pdf não foi enviado e foi removido da lista/);
});

test("não deixa anexo visualmente confirmado quando a VM não confirma o snapshot", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.queueFiles([{ name: "sem-confirmacao.jpg", size: 10, type: "image/jpeg" }]);
  const [item] = harness.store.getState().pendingFiles;
  harness.client.sendFile = async () => ({
    status: "processed",
    messages: [{ type: "text", text: "Anexo recebido" }],
    attachments: [],
  });
  harness.client.getAttachments = async () => [];

  const sent = await harness.controller.uploadFile(item.id);

  assert.equal(sent, false);
  assert.equal(harness.store.getState().attachments.length, 0);
  assert.deepEqual(harness.store.getState().pendingFiles, []);
  assert.equal(harness.store.getState().messages.some(message => message.text === "Anexo recebido"), false);

  harness.store.setDraft("responder sem o anexo");
  const beforeTextCalls = harness.chatCalls.filter(call => call[0] === "text").length;
  assert.equal(await harness.controller.sendText(), true);
  assert.equal(harness.chatCalls.filter(call => call[0] === "text").length, beforeTextCalls + 1);
  harness.controller.stop();
});

test("bloqueia a submissão se um anexo da bandeja desapareceu da VM", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{
    id: "stale-attachment",
    fileName: "diario.jpg",
    mimeType: "image/jpeg",
    size: 10,
    mediaUrl: "/api/portal-media/stale-attachment",
  }]);
  harness.client.getAttachments = async () => [];
  harness.store.setDraft("Concluir diário");

  const sent = await harness.controller.sendText();

  assert.equal(sent, false);
  assert.deepEqual(harness.chatCalls.filter(call => call[0] === "text"), [
    ["text", { text: "", replyId: "input_continue" }],
  ]);
  assert.deepEqual(harness.store.getState().attachments.map(item => item.id), ["stale-attachment"]);
  assert.match(harness.view.renders.at(-1).error, /não confirmou .*anexos|bloqueada|mantidos/i);
  harness.controller.stop();
});

test("exibe confirmação do anexo sozinha e troca pela próxima pergunta após um segundo", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.queueFiles([{ name: "foto.jpg", size: 4, type: "image/jpeg" }]);
  const [file] = harness.store.getState().pendingFiles;
  harness.client.sendFile = async () => ({
    status: "processed",
    messages: [
      { type: "text", text: "📎 ANEXO RECEBIDO. Continue preenchendo o formulário." },
      { type: "text", text: "Qual é a data?" },
    ],
    attachments: [],
  });
  harness.client.getAttachments = async () => [{
    id: "vm-pdf",
    fileName: "anexo-lancamento.pdf",
    mimeType: "application/pdf",
    size: 42,
    mediaUrl: "/api/portal-media/vm-pdf",
  }];

  await harness.controller.uploadFile(file.id);
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), [
    "📎 ANEXO RECEBIDO. Continue preenchendo o formulário.",
  ]);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Qual é a data?"]);
  assert.equal(harness.store.getState().attachments[0].fileName, "anexo-lancamento.pdf");
  harness.controller.stop();
});

test("aplica a mesma transição quando uma tarefa é enviada antes da pergunta", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{ type: "text", text: "Informe a data." }]);
  harness.store.setDraft("Registrar tarefa antecipada");
  harness.client.sendText = async () => ({
    status: "processed",
    messages: [
      { type: "text", text: "✅ TAREFA RECEBIDA." },
      { type: "text", text: "Qual é a data?" },
    ],
  });

  await harness.controller.sendText();
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["✅ TAREFA RECEBIDA."]);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Qual é a data?"]);
  harness.controller.stop();
});

test("responde enquete, exporta mídia protegida e encerra sessão", async () => {
  const harness = makeHarness();
  let signedOut = false;
  harness.auth.signOut = async () => { signedOut = true; };
  await harness.controller.start();
  harness.store.ingestRemoteMessages([
    { id: "poll", type: "poll", question: "Escolha", options: [] },
    { id: "media", type: "document", fileName: "relatório.pdf", mediaUrl: "/api/portal-media/1" },
  ]);

  await harness.view.emit("select-reply", { label: "Sim", replyId: "yes" });
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "Sim", replyId: "yes" }]);
  await harness.view.emit("open-media", { messageId: "media" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  await harness.view.emit("sign-out");
  assert.equal(signedOut, true);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");
});

test("importa compartilhados e só remove a origem depois da confirmação", async () => {
  const harness = makeHarness();
  harness.native.importSharedItems = async () => [{
    id: "share-1",
    sourceId: "share-1",
    name: "obra.jpg",
    size: 1,
    type: "image/jpeg",
  }];

  await harness.controller.start();

  assert.deepEqual(harness.chatCalls.filter(([kind]) => kind === "file"), [["file", "obra.jpg"]]);
  assert.deepEqual(harness.discarded, ["share-1"]);
  assert.equal(harness.store.getState().pendingFiles.length, 0);
});

test("não duplica upload já confirmado pela extensão", async () => {
  const harness = makeHarness();
  const confirmation = {
    status: "processed",
    messages: [{ type: "text", text: "Já confirmado" }],
  };
  const shared = {
    id: "share-2",
    sourceId: "share-2",
    name: "medição.pdf",
    size: 1,
    type: "application/pdf",
    confirmedResult: confirmation,
  };
  harness.native.importSharedItems = async () => [shared];

  await harness.controller.start();

  assert.deepEqual(harness.chatCalls.filter(([kind]) => kind === "file"), []);
  assert.equal(harness.store.getState().messages.some(message => message.text === "Já confirmado"), true);
  assert.deepEqual(harness.discarded, ["share-2"]);
});

test("web mostra só a nova etapa após responder enquete e permite abrir a mídia atual", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([
    { type: "poll", question: "Gerar relatório?", options: [{ id: "yes", label: "Gerar agora" }] },
  ]);
  harness.client.sendText = async payload => {
    harness.chatCalls.push(["text", payload]);
    return { status: "processed", messages: [
      { type: "text", text: "Relatório disponível." },
      { id: "report", type: "document", fileName: "relatório.pdf", mediaUrl: "/api/portal-media/1" },
      { type: "poll", question: "O que deseja fazer agora?", options: [{ id: "menu", label: "Menu inicial" }] },
    ] };
  };

  await harness.view.emit("select-reply", { label: "Gerar agora", replyId: "yes" });

  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "Gerar agora", replyId: "yes" }]);
  const markup = renderChatMarkup(harness.view.renders.at(-1));
  assert.doesNotMatch(markup, /Gerar relatório\?|Gerar agora|Confirmado/);
  assert.match(markup, /Relatório.*disponível\./s);
  assert.match(markup, /O que deseja fazer agora\?/);
  assert.match(markup, /Menu inicial/);
  assert.deepEqual(harness.store.getState().messages.map(message => message.type), ["text", "document", "poll"]);

  await harness.view.emit("open-media", { messageId: "report" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  assert.deepEqual(harness.chatCalls.at(-1), ["media", "report"]);
});

test("envia DD/ como DD para preservar a regra de data parcial", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Qual é a data da compra do imobilizado?",
  }]);
  harness.store.setDraft("15/");

  await harness.controller.sendText();

  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15" }]);
  harness.controller.stop();
});

test("envia DD/MM/ como DD/MM e mantém a data completa intacta", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Informe a data de vencimento no formato DD/MM/AAAA.",
  }]);

  harness.store.setDraft("15/09/");
  await harness.controller.sendText();
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15/09" }]);

  harness.store.ingestRemoteMessages([{
    type: "text",
    text: "Informe a data de vencimento no formato DD/MM/AAAA.",
  }]);
  harness.store.setDraft("15/09/2026");
  await harness.controller.sendText();
  assert.deepEqual(harness.chatCalls.at(-1), ["text", { text: "15/09/2026" }]);
  harness.controller.stop();
});

test("web conserva a pergunta durante envio e falha e a troca depois de tentar novamente", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{ type: "text", text: "Descreva as atividades." }]);
  let rejectSend;
  harness.client.sendText = () => new Promise((resolve, reject) => { rejectSend = reject; });
  harness.view.emit("draft-changed", { value: "Concretagem da laje" });
  const sending = harness.view.emit("send-text");
  assert.match(renderChatMarkup(harness.view.renders.at(-1)), /Descreva as atividades\./);
  rejectSend(new Error("Conexão perdida"));
  await sending;
  assert.equal(harness.store.getState().draft, "Concretagem da laje");
  assert.deepEqual(harness.store.getState().messages.map(message => message.text), ["Descreva as atividades."]);

  harness.client.sendText = async () => ({ status: "processed", messages: [{ type: "text", text: "Houve ocorrências?" }] });
  await harness.view.emit("send-text");
  const markup = renderChatMarkup(harness.view.renders.at(-1));
  assert.doesNotMatch(markup, /Descreva as atividades\.|Concretagem da laje|Conexão perdida/);
  assert.match(markup, /Houve ocorrências\?/);
});

test("visualiza anexo local confirmado e pendente sem reenviar nem alterar a pergunta", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  const previews = [];
  harness.native.previewMedia = async (source, name) => previews.push([await source, name]);
  await harness.controller.start();
  const file = new File(["foto"], "obra.jpg", { type: "image/jpeg" });
  harness.store.queueFiles([file]);
  const [item] = harness.store.getState().pendingFiles;
  await harness.view.emit("open-file", { fileId: item.id });
  assert.equal(previews.length, 1);
  assert.equal(previews[0][0], file);
  harness.store.confirmFile(harness.store.beginFile(item.id), { messages: [{ type: "text", text: "Pergunta atual" }] });
  harness.store.setDraft("Rascunho");
  await harness.view.emit("open-file", { fileId: item.id });
  assert.equal(previews.length, 2);
  assert.equal(harness.store.getState().draft, "Rascunho");
  assert.equal(harness.store.getState().messages[0].text, "Pergunta atual");
  assert.equal(harness.chatCalls.filter(([kind]) => kind === "file").length, 0);
});

test("encaminha apenas o anexo selecionado com nome e conteúdo originais", async t => {
  const h = makeHarness({ historyMode: "current-step" });
  const exported = [];
  h.client.fetchMedia = async item => new Blob([item.id], { type: "image/jpeg" });
  h.native.exportMedia = async (blob, name) => exported.push([name, await blob.text()]);
  t.after(() => h.controller.stop());
  await h.controller.start();
  h.store.syncAttachments([
    { id: "old", fileName: "antiga.jpg", mediaUrl: "/api/old", existing: true, readOnly: true },
    { id: "new", fileName: "nova.jpg", mediaUrl: "/api/new" },
  ]);
  h.store.setDraft("Rascunho");

  assert.equal(await h.view.emit("share-attachment", { fileId: "old" }), true);
  assert.deepEqual(exported, [["antiga.jpg", "old"]]);
  assert.equal(h.store.getState().draft, "Rascunho");
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["old", "new"]);
});

test("retorno do Atalho atualiza somente anexos e entrega mídia remota ao visualizador", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  const previews = [];
  harness.native.previewMedia = async (source, name) => previews.push([await source, name]);
  await harness.controller.start();
  harness.client.getAttachments = async () => [{ id: "from-shortcut", fileName: "planta.pdf", mediaUrl: "/api/portal-media/a" }];
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  await harness.controller.refreshAttachments();
  await harness.view.emit("open-file", { fileId: "from-shortcut" });
  assert.deepEqual(harness.chatCalls, [["text", { text: "", replyId: "input_continue" }], ["media", "from-shortcut"]]);
  assert.equal(previews[0][1], "planta.pdf");
  assert.equal(await previews[0][0].text(), "conteúdo");
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
});

test('lixeira exclui apenas o anexo confirmado selecionado dentro do fluxo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.syncAttachments([
    { id: "remove-me", fileName: "remover.jpg", mediaUrl: "/api/portal-media/a" },
    { id: "keep-me", fileName: "manter.pdf", mediaUrl: "/api/portal-media/b" },
  ]);
  h.client.deleteAttachment = async id => {
    h.chatCalls.push(["delete-attachment", id]);
    return { status: "processed", messages: [], attachments: [
      { id: "keep-me", fileName: "manter.pdf", mediaUrl: "/api/portal-media/b" },
    ] };
  };
  await h.view.emit("remove-attachment", { fileId: "remove-me" });
  assert.deepEqual(h.chatCalls.at(-1), ["delete-attachment", "remove-me"]);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ["keep-me"]);
  h.controller.stop();
});

test('eliminar todos confirma a ação e preserva anexos existentes em fluxo ativo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.ingestRemoteMessages([], { activeFlow: {
    id: 'task', title: 'EDITAR DIÁRIO', allowBulkAttachmentDelete: true,
  } });
  h.store.syncAttachments([
    { id: 'old', fileName: 'existente.jpg', mediaUrl: '/api/portal-media/old', existing: true, readOnly: true },
    { id: 'new', fileName: 'novo.jpg', mediaUrl: '/api/portal-media/new' },
  ]);
  h.client.deleteAllAttachments = async () => {
    h.chatCalls.push(['delete-all-attachments']);
    return { status: 'processed', messages: [], attachments: [
      { id: 'old', fileName: 'existente.jpg', mediaUrl: '/api/portal-media/old', existing: true, readOnly: true },
    ] };
  };
  const previousConfirm = globalThis.confirm;
  const prompts = [];
  globalThis.confirm = prompt => { prompts.push(prompt); return true; };
  try {
    await h.view.emit('delete-all-attachments');
  } finally {
    globalThis.confirm = previousConfirm;
    h.controller.stop();
  }
  assert.deepEqual(prompts, ['TEM CERTEZA QUE DESEJA DELETAR TODOS OS ANEXOS DESSE FLUXO?']);
  assert.deepEqual(h.chatCalls.at(-1), ['delete-all-attachments']);
  assert.deepEqual(h.store.getState().attachments.map(item => item.id), ['old']);
});

test('compactação renova o id do anexo quando a bandeja ficou com snapshot antigo', async () => {
  const h = makeHarness();
  await h.controller.start();
  h.store.syncAttachments([{
    id: 'id-antigo', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 2048,
    mediaUrl: '/api/portal-media/antigo',
  }]);
  h.client.getAttachments = async () => [{
    id: 'id-atual', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 2500,
    mediaUrl: '/api/portal-media/atual',
  }];
  h.client.compressAttachment = async id => {
    h.chatCalls.push(['compress-attachment', id]);
    return { status: 'processed', messages: [], attachments: [{
      id: 'id-atual', fileName: 'foto.jpg', mimeType: 'image/jpeg', size: 900,
      mediaUrl: '/api/portal-media/comprimido',
    }] };
  };
  await h.view.emit('compress-attachment', { fileId: 'id-antigo' });
  assert.deepEqual(h.chatCalls.at(-1), ['compress-attachment', 'id-atual']);
  assert.equal(h.store.getState().attachments[0].size, 900);
  h.controller.stop();
});

test("snapshot atrasado não sobrescreve anexos da resposta mais nova", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolveSnapshot;
  harness.client.getAttachments = () => new Promise(resolve => { resolveSnapshot = resolve; });
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  const refresh = harness.controller.refreshAttachments();
  harness.client.sendText = async () => ({ status: "processed", messages: [], attachments: [
    { id: "new", fileName: "novo.pdf", mediaUrl: "/api/portal-media/new" },
  ] });
  await harness.controller.sendText("Continuar");
  resolveSnapshot([{ id: "old", fileName: "velho.pdf", mediaUrl: "/api/portal-media/old" }]);
  await refresh;
  assert.deepEqual(harness.store.getState().attachments.map(item => item.id), ["new"]);
});

test("mídia expirada renova snapshot sem reenviar resposta ao fluxo", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  harness.store.syncAttachments([{ id: "file", fileName: "nota.pdf", mediaUrl: "/api/portal-media/old" }]);
  harness.client.getAttachments = async () => [{ id: "file", fileName: "nota.pdf", mediaUrl: "/api/portal-media/new" }];
  harness.client.fetchMedia = async item => {
    if (item.mediaUrl.endsWith("old")) throw Object.assign(new Error("expirou"), { status: 404 });
    return new Blob(["renovado"]);
  };
  let previewText;
  harness.native.previewMedia = async source => { previewText = await (await source).text(); };
  await harness.view.emit("open-file", { fileId: "file" });
  assert.equal(previewText, "renovado");
  assert.equal(harness.chatCalls.length, 1);
});

test("ao digitar outra data no LOG o controlador solicita e exibe somente o novo relatório", async () => {
  const harness = makeHarness({ historyMode: "current-step" });
  await harness.controller.start();
  harness.store.ingestRemoteMessages([{
    type: "poll",
    question: "LOG DE AÇÕES — 08/09/2026",
    options: [{ id: "audit_log_row:old", label: "1 • TAREFAS • CRIADO • 10:00" }],
  }]);
  harness.client.sendText = async payload => {
    assert.equal(payload.text, "07/09/2026");
    return { status: "processed", messages: [{
      type: "poll",
      question: "LOG DE AÇÕES — 07/09/2026",
      options: [{ id: "audit_log_row:new", label: "2 • TAREFAS • EDITADO • 11:00" }],
    }] };
  };
  harness.store.setDraft("07/09/2026");
  await harness.controller.sendText();
  const state = harness.store.getState();
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].question, /07\/09\/2026/);
  assert.equal(state.messages[0].options[0].id, "audit_log_row:new");
  harness.controller.stop();
});

test("sair fecha prévia e impede snapshot antigo de restaurar anexos privados", async () => {
  const harness = makeHarness();
  await harness.controller.start();
  let resolveSnapshot;
  let closed = false;
  harness.native.closePreview = () => { closed = true; };
  harness.client.getAttachments = () => new Promise(resolve => { resolveSnapshot = resolve; });
  assert.equal(typeof harness.controller.refreshAttachments, "function");
  const refresh = harness.controller.refreshAttachments();
  await harness.view.emit("sign-out");
  resolveSnapshot([{ id: "old", fileName: "privado.pdf", mediaUrl: "/api/portal-media/old" }]);
  await refresh;
  assert.equal(closed, true);
  assert.deepEqual(harness.store.getState().attachments, []);
});
