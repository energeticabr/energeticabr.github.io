import test from "node:test";
import assert from "node:assert/strict";

import { createConversationStore } from "../src/chat/conversation-store.js";

test("falha de mensagem preserva o rascunho e não cria mensagem confirmada", () => {
  const store = createConversationStore({ randomUUID: () => "text-op" });
  store.setDraft("Criar diário");

  const operation = store.beginText();
  store.failText(operation, new Error("offline"));

  assert.equal(store.getState().draft, "Criar diário");
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().error, "offline");
});

test("confirmação de texto inclui usuário e resposta da VM", () => {
  const store = createConversationStore({ randomUUID: () => "text-op" });
  store.setDraft("Criar diário");

  const operation = store.beginText();
  store.confirmText(operation, {
    status: "processed",
    messages: [{ type: "text", text: "Qual é a data?" }],
  });

  assert.equal(store.getState().draft, "");
  assert.deepEqual(store.getState().messages.map(message => [message.role, message.text]), [
    ["user", "Criar diário"],
    ["assistant", "Qual é a data?"],
  ]);
});

test("resposta antiga não apaga rascunho digitado depois do envio", () => {
  const store = createConversationStore({ randomUUID: () => "text-op" });
  store.setDraft("Primeiro texto");
  const operation = store.beginText();
  store.setDraft("Próximo texto");

  store.confirmText(operation, { status: "processed", messages: [] });

  assert.equal(store.getState().draft, "Próximo texto");
  assert.equal(store.getState().messages[0].text, "Primeiro texto");
});

test("falha de upload mantém somente o arquivo não confirmado", () => {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}` });
  const first = { name: "a.jpg", size: 2, type: "image/jpeg" };
  const second = { name: "b.pdf", size: 3, type: "application/pdf" };
  store.queueFiles([first, second]);

  const firstItem = store.getState().pendingFiles[0];
  const secondItem = store.getState().pendingFiles[1];
  store.confirmFile(store.beginFile(firstItem.id), { status: "processed", messages: [] });
  store.failFile(store.beginFile(secondItem.id), new Error("timeout"));

  assert.deepEqual(store.getState().pendingFiles.map(item => [item.file.name, item.status]), [
    ["b.pdf", "failed"],
  ]);
  assert.equal(store.getState().messages[0].fileName, "a.jpg");
});

test("reset confirmado limpa conversa mas preserva anexos pendentes", () => {
  let next = 0;
  const store = createConversationStore({ randomUUID: () => `id-${++next}` });
  store.ingestRemoteMessages([{ type: "text", text: "Antiga" }]);
  store.queueFiles([{ name: "rascunho.pdf", size: 3, type: "application/pdf" }]);

  store.ingestRemoteMessages(
    [{ type: "poll", question: "Continuar?", options: [{ id: "yes", label: "Sim" }] }],
    { resetConversation: true },
  );

  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().messages[0].type, "poll");
  assert.equal(store.getState().pendingFiles.length, 1);
});

test("deduplica itens importados pelo identificador estável da caixa compartilhada", () => {
  const store = createConversationStore({ randomUUID: () => "local" });
  const shared = { id: "share-1", name: "nota.pdf", size: 4, type: "application/pdf" };

  store.replaceImportedFiles([shared]);
  store.replaceImportedFiles([shared]);

  assert.equal(store.getState().pendingFiles.length, 1);
  assert.equal(store.getState().pendingFiles[0].sourceId, "share-1");
});

test("preserva campos estruturados de texto, enquete, imagem e documento", () => {
  const store = createConversationStore();
  store.ingestRemoteMessages([
    { type: "text", text: "Mensagem" },
    { type: "poll", question: "Escolha", options: [{ id: "1", label: "Um" }] },
    { type: "image", mediaUrl: "/api/portal-media/img", fileName: "foto.jpg" },
    { type: "document", mediaUrl: "/api/portal-media/pdf", fileName: "ata.pdf" },
  ]);

  assert.deepEqual(store.getState().messages.map(message => message.type), [
    "text", "poll", "image", "document",
  ]);
  assert.equal(store.getState().messages[1].options[0].label, "Um");
  assert.equal(store.getState().messages[3].fileName, "ata.pdf");
});

test("notifica assinantes com snapshots congelados", () => {
  const store = createConversationStore();
  const snapshots = [];
  const unsubscribe = store.subscribe(state => snapshots.push(state));

  store.setDraft("Oi");
  unsubscribe();
  store.setDraft("Tchau");

  assert.equal(snapshots.length, 1);
  assert.equal(Object.isFrozen(snapshots[0]), true);
  assert.equal(Object.isFrozen(snapshots[0].messages), true);
});
