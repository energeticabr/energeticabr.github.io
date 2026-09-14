import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserPorts } from "../src/web/browser-ports.js";

test("câmera pede imagem com captura traseira e devolve o arquivo selecionado", async () => {
  const calls = [];
  const photo = new File(["foto"], "obra.jpg", { type: "image/jpeg" });
  const ports = createBrowserPorts({
    selectFiles: async options => { calls.push(options); return [photo]; },
  });

  assert.deepEqual(await ports.capturePhoto(), [photo]);
  assert.deepEqual(calls, [{ accept: "image/*", capture: "environment", multiple: false }]);
});

test("cancelar seleção devolve lista vazia sem criar pendência", async () => {
  const ports = createBrowserPorts({ selectFiles: async () => [] });
  assert.deepEqual(await ports.pickDocuments(), []);
});

test("clipe seleciona uma ou várias fotos sem ativar a câmera", async () => {
  const calls = [];
  const photo = new File(["foto"], "obra.jpg", { type: "image/jpeg" });
  const ports = createBrowserPorts({
    selectFiles: async options => { calls.push(options); return [photo]; },
  });

  assert.deepEqual(await ports.pickPhotos(), [photo]);
  assert.deepEqual(calls, [{ accept: "image/*", multiple: true }]);
});

test("exporta pela folha de compartilhamento quando arquivos são suportados", async () => {
  const calls = [];
  const navigatorRef = {
    canShare: ({ files }) => files.length === 1,
    async share(options) { calls.push(options); },
  };
  const ports = createBrowserPorts({ navigatorRef });
  const blob = new Blob(["pdf"], { type: "application/pdf" });

  const result = await ports.exportMedia(blob, "resumo.pdf");

  assert.equal(result, "shared");
  assert.equal(calls[0].files[0].name, "resumo.pdf");
  assert.equal(await calls[0].files[0].text(), "pdf");
});

test("faz download local quando a folha não aceita arquivos", async () => {
  const calls = [];
  const anchor = { click() { calls.push("click"); }, remove() { calls.push("remove"); } };
  const documentRef = {
    body: { append(element) { assert.equal(element, anchor); calls.push("append"); } },
    createElement(tag) { assert.equal(tag, "a"); return anchor; },
  };
  const urlApi = {
    createObjectURL() { calls.push("create"); return "blob:download"; },
    revokeObjectURL(value) { calls.push(`revoke:${value}`); },
  };
  const ports = createBrowserPorts({ documentRef, navigatorRef: {}, urlApi });

  assert.equal(await ports.exportMedia(new Blob(["x"]), "relatório.pdf"), "downloaded");
  assert.deepEqual(calls, ["create", "append", "click", "remove", "revoke:blob:download"]);
  assert.equal(anchor.download, "relatório.pdf");
  assert.equal(anchor.href, "blob:download");
});

test("fallback do navegador notifica anexo sem postagem e cancela ao agir", async () => {
  const timers = [];
  const notifications = [];
  function Notification(title, options) { notifications.push({ title, options }); }
  Notification.permission = "granted";
  const ports = createBrowserPorts({
    notificationApi: Notification,
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutImpl: timer => { timer.cancelled = true; },
  });

  assert.equal(await ports.scheduleAttachmentReminder(), true);
  assert.equal(timers[0].delay, 5 * 60 * 1000);
  timers[0].callback();
  assert.equal(notifications[0].options.body, "Anexo recebido há 5 minutos sem postagem");

  assert.equal(await ports.scheduleAttachmentReminder(), true);
  const next = timers.at(-1);
  await ports.cancelAttachmentReminder();
  next.callback();
  assert.equal(notifications.length, 1);
});
