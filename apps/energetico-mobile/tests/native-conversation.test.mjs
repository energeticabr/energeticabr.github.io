import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createConversationStore } from "../src/chat/conversation-store.js";
import { createAppController } from "../src/app-controller.js";

// Execute the shipped native bootstrap, replacing only device/network ports.
// Reverting its history mode must reproduce the accumulated conversation.
async function startNative() {
  const entry = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const handlers = new Map();
  const view = { render() {}, on(type, handler) { handlers.set(type, handler); return () => {}; },
    focusComposer() {}, destroy() {} };
  const client = { async sendText() { return { status: "processed", messages: [
    { type: "text", text: "Qual é a filial?" },
  ] }; }, async sendFile() { return { status: "processed", messages: [
    { type: "text", text: "Qual é a data?" },
  ] }; } };
  let store, controller, ready;
  const lifecycle = new Map();
  const native = { async importSharedItems() { return []; } };
  runInNewContext(entry.replace(/^import .*;\r?\n/gm, ""), {
    document: { querySelector() { return {}; } }, addEventListener(name, handler) { lifecycle.set(name, handler); },
    APP_CONFIG: {}, MicrosoftAuth: {},
    createAuthService: () => ({ async initialize() { return { homeAccountId: "test" }; } }),
    createChatClient: () => client,
    createNativePorts: () => native,
    createChatView: () => view,
    createConversationStore,
    createAppController(options) {
      store = options.store;
      controller = createAppController(options);
      return { start() { ready = controller.start(); }, stop: controller.stop };
    },
  });
  await ready;
  return { store, client, controller, lifecycle, native, async reply(text) {
    store.setDraft(text);
    await handlers.get("send-text")({ type: "send-text" });
  } };
}

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
