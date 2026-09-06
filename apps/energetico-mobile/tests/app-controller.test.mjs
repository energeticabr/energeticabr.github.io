import test from "node:test";
import assert from "node:assert/strict";

import { createAppController } from "../src/app-controller.js";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { renderChatMarkup } from "../src/ui/chat-view.js";

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

function makeHarness({ account = { homeAccountId: "a1", name: "Bernardo" }, historyMode } = {}) {
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

test("inicia sessão armazenada e retoma a VM sem responder à pergunta atual", async () => {
  const harness = makeHarness();
  await harness.controller.start();

  assert.equal(harness.view.renders.at(-1).sessionStatus, "authenticated");
  assert.deepEqual(harness.chatCalls[0], ["text", { text: "", replyId: "input_continue" }]);
  assert.equal(harness.store.getState().messages[0].text, "Confirmado");
  assert.equal(harness.store.getState().messages.some(message => message.text === "input_continue"), false);
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
  assert.match(markup, /Relatório disponível\./);
  assert.match(markup, /O que deseja fazer agora\?/);
  assert.match(markup, /Menu inicial/);
  assert.deepEqual(harness.store.getState().messages.map(message => message.type), ["text", "document", "poll"]);

  await harness.view.emit("open-media", { messageId: "report" });
  assert.deepEqual(harness.exported, [[9, "relatório.pdf"]]);
  assert.deepEqual(harness.chatCalls.at(-1), ["media", "report"]);
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
