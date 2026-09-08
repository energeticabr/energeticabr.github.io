import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { createAppController } from "../src/app-controller.js";
import { createRecoveryStorage } from "../src/web/recovery-storage.js";

function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) };
}

function conversation(contextId = "flow-a") {
  return { status: "processed", activeFlow: { id: "payment", title: "Pagamento", contextId },
    messages: [{ type: "text", text: "Qual é a filial?" }] };
}

// Execute the shipped native bootstrap, replacing only device/network ports.
// Reverting its history mode must reproduce the accumulated conversation.
async function startNative({ storage = memoryStorage(), accountId = "test", initialResponse = conversation(), waitForReady = true } = {}) {
  const entry = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const handlers = new Map();
  const renders = [], sent = [];
  const view = { render(state) { renders.push(state); }, on(type, handler) { handlers.set(type, handler); return () => {}; },
    focusComposer() {}, destroy() {} };
  const client = { async sendText(payload) { sent.push(payload); return initialResponse; }, async sendFile() { return { status: "processed", messages: [
    { type: "text", text: "Qual é a data?" },
  ] }; } };
  let store, controller, ready;
  const lifecycle = new Map();
  const native = { async importSharedItems() { return []; } };
  runInNewContext(entry.replace(/^import .*;\r?\n/gm, ""), {
    document: { querySelector() { return {}; } }, addEventListener(name, handler) { lifecycle.set(name, handler); },
    APP_CONFIG: {}, MicrosoftAuth: {},
    createAuthService: () => ({ async initialize() { return { homeAccountId: accountId }; }, async signOut() {} }),
    createChatClient: () => client,
    createNativePorts: () => native,
    createChatView: () => view,
    createConversationStore,
    createRecoveryStorage: () => createRecoveryStorage({ storage }),
    createAppController(options) {
      store = options.store;
      controller = createAppController(options);
      return { start() { ready = controller.start(); }, stop: controller.stop, flushRecovery: controller.flushRecovery };
    },
  });
  if (waitForReady) await ready;
  return { store, client, controller, lifecycle, native, storage, renders, sent, ready,
    emit(type, payload = {}) { return handlers.get(type)?.({ type, ...payload }); }, async reply(text) {
    store.setDraft(text);
    await handlers.get("send-text")({ type: "send-text" });
  } };
}

test("ocultar a página nativa grava a prévia pendente em cada saída", async () => {
  const h = await startNative();
  try {
    h.store.setDraft("Texto ainda não enviado");
    h.lifecycle.get("pagehide")?.({ persisted: true });
    const key = "energetico:flow-preview:v1:test";
    assert.equal(JSON.parse(h.storage.getItem(key))?.draft, "Texto ainda não enviado");
    h.store.setDraft("Texto revisado na segunda saída");
    h.lifecycle.get("pagehide")?.({ persisted: true });
    assert.equal(JSON.parse(h.storage.getItem(key))?.draft, "Texto revisado na segunda saída");
    assert.equal(h.store.getState().draft, "Texto revisado na segunda saída");
  } finally { h.controller.stop(); }
});

test("prévia nativa reabre na mesma conta e só restaura após reconciliar a pergunta da VM", async () => {
  const storage = memoryStorage();
  const first = await startNative({ storage });
  first.store.setDraft("Filial ainda não enviada");
  first.lifecycle.get("pagehide")?.({ persisted: true });
  first.controller.stop();
  let finish;
  const initialResponse = new Promise(resolve => { finish = resolve; });
  const reopened = await startNative({ storage, initialResponse, waitForReady: false });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reopened.renders.at(-1).recoveryPreview?.draft, "Filial ainda não enviada");
    assert.equal(reopened.renders.at(-1).recoveryBlocked, true);
    assert.equal(reopened.store.getState().draft, "");
    finish(conversation());
    await reopened.ready;
    assert.equal(reopened.store.getState().draft, "Filial ainda não enviada");
    assert.equal(reopened.renders.at(-1).recoveryBlocked, false);
    assert.deepEqual(reopened.sent, [{ text: "", replyId: "input_continue" }]);
  } finally { finish(conversation()); await reopened.ready; reopened.controller.stop(); }
});

test("prévia nativa de outro fluxo fica como referência e nunca responde à nova pergunta", async () => {
  const storage = memoryStorage();
  const first = await startNative({ storage });
  first.store.setDraft("Resposta do fluxo antigo");
  first.lifecycle.get("pagehide")?.({ persisted: true });
  first.controller.stop();
  const reopened = await startNative({ storage, initialResponse: conversation("flow-b") });
  try {
    assert.equal(reopened.store.getState().draft, "");
    assert.equal(reopened.renders.at(-1).recoveryReference?.draft, "Resposta do fluxo antigo");
    assert.deepEqual(reopened.sent, [{ text: "", replyId: "input_continue" }]);
  } finally { reopened.controller.stop(); }
});

test("prévia nativa é isolada por conta e logout limpa somente a conta atual", async () => {
  const storage = memoryStorage();
  const first = await startNative({ storage, accountId: "account-a" });
  first.store.setDraft("Privado da conta A");
  first.lifecycle.get("pagehide")?.({ persisted: true });
  first.controller.stop();
  const second = await startNative({ storage, accountId: "account-b" });
  try {
    assert.equal(second.store.getState().draft, "");
    assert.ok(second.renders.every(state => !state.recoveryPreview?.draft && !state.recoveryReference?.draft));
    assert.deepEqual(second.sent, [{ text: "", replyId: "input_continue" }]);
    second.store.setDraft("Privado da conta B");
    second.lifecycle.get("pagehide")?.({ persisted: true });
    assert.equal(JSON.parse(storage.getItem("energetico:flow-preview:v1:account-a"))?.draft, "Privado da conta A");
    assert.equal(JSON.parse(storage.getItem("energetico:flow-preview:v1:account-b"))?.draft, "Privado da conta B");
    await second.emit("sign-out");
    assert.equal(storage.getItem("energetico:flow-preview:v1:account-b"), null);
    assert.equal(JSON.parse(storage.getItem("energetico:flow-preview:v1:account-a"))?.draft, "Privado da conta A");
  } finally { second.controller.stop(); }
});

test("ocultar página nativa não desliga a conversa ao alternar para outro aplicativo", async () => {
  const h = await startNative();
  try {
    h.lifecycle.get("pagehide")?.({ persisted: true });
    h.client.sendText = async () => ({ status: "processed", messages: [{ type: "text", text: "Nova etapa" }] });
    await h.reply("Resposta após retornar");
    assert.equal(h.store.getState().messages.at(-1).text, "Nova etapa");
  } finally { h.controller.stop(); }
});

test("bootstrap nativo mostra só a pergunta nova após resposta confirmada", async () => {
  const h = await startNative();
  try {
    h.client.sendText = async () => ({ status: "processed", messages: [
      { type: "poll", question: "Qual é a data?", options: [{ id: "today", label: "Hoje" }] },
    ] });
    await h.reply("Ouro Preto");
    assert.equal(h.store.getState().messages.length, 1);
    assert.equal(h.store.getState().messages[0].question, "Qual é a data?");
    assert.equal(h.store.getState().messages[0].role, "assistant");
    assert.equal(h.store.getState().draft, "");
  } finally { h.controller.stop(); }
});

test("bootstrap nativo mantém pergunta e texto na falha, troca no retry e preserva anexos", async () => {
  const h = await startNative();
  try {
    h.store.syncAttachments([{ id: "file1", fileName: "obra.txt", size: 3,
      mediaUrl: "/api/portal-media/file1", mimeType: "text/plain" }]);
    h.client.sendText = async () => { throw new Error("offline"); };
    await h.reply("Ouro Preto");
    assert.equal(h.store.getState().messages[0].text, "Qual é a filial?");
    assert.equal(h.store.getState().draft, "Ouro Preto");
    h.client.sendText = async () => ({ status: "processed", messages: [
      { type: "text", text: "Qual é a data?" },
    ] });
    await h.reply("Ouro Preto");
    assert.deepEqual(h.store.getState().messages.map(m => m.text), ["Qual é a data?"]);
    assert.equal(h.store.getState().attachments[0].id, "file1");
  } finally { h.controller.stop(); }
});
