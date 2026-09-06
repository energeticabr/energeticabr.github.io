import test from "node:test";
import assert from "node:assert/strict";

import { createAppController } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";

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

function makeHarness({ account = { homeAccountId: "a1", name: "Bernardo" } } = {}) {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}` });
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
  const controller = createAppController({ store, view, client, auth, native });
  return { store, view, client, auth, native, controller, chatCalls, discarded, exported };
}

test("inicia sessão armazenada e retoma a VM com CONTINUAR", async () => {
  const harness = makeHarness();
  await harness.controller.start();

  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "CONTINUAR" }]);
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
  assert.equal(harness.store.getState().messages.some(message => message.text === "CONTINUAR"), false);
});

test("sem conta aguarda login antes de falar com a VM", async () => {
  const harness = makeHarness({ account: null });
  await harness.controller.start();
  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.view.renders.at(-1).sessionStatus, "signed-out");

  await harness.view.emit("sign-in");
  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "CONTINUAR" }]);
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

test("envia vários anexos em série e mantém apenas o que falhou", async () => {
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
  assert.deepEqual(harness.store.getState().pendingFiles.map(item => [item.file.name, item.status]), [
    ["b.pdf", "failed"],
  ]);
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
