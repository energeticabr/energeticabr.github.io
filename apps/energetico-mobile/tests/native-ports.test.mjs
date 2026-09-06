import test from "node:test";
import assert from "node:assert/strict";

import { NativePermissionError, createNativePorts } from "../src/native/native-ports.js";

test("normaliza uma foto da câmera como arquivo enviável", async () => {
  const ports = createNativePorts({
    camera: { getPhoto: async () => ({ webPath: "blob:photo", format: "jpeg" }) },
    fetchImpl: async () => new Response(new Blob(["x"], { type: "image/jpeg" })),
    randomUUID: () => "photo-id",
  });

  const [photo] = await ports.capturePhoto();

  assert.deepEqual(
    { id: photo.id, name: photo.name, size: photo.size, type: photo.type },
    { id: "photo-id", name: "foto-photo-id.jpeg", size: 1, type: "image/jpeg" },
  );
  assert.equal(await photo.text(), "x");
});

test("cancelamento da câmera devolve seleção vazia", async () => {
  const ports = createNativePorts({
    camera: { getPhoto: async () => { throw Object.assign(new Error("User cancelled photos app"), { code: "PICKER_CANCELLED" }); } },
  });

  assert.deepEqual(await ports.capturePhoto(), []);
});

test("negação de câmera vira erro de permissão estável", async () => {
  const ports = createNativePorts({
    camera: { getPhoto: async () => { throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }); } },
  });

  await assert.rejects(ports.capturePhoto(), error => (
    error instanceof NativePermissionError && error.code === "NATIVE_PERMISSION_DENIED"
  ));
});

test("converte documentos nativos e preserva metadados", async () => {
  const ports = createNativePorts({
    documentPicker: {
      pick: async () => ({
        items: [{ id: "doc-id", uri: "file:///cache/ata.pdf", name: "ata.pdf", size: 3, type: "application/pdf" }],
      }),
    },
    filesystem: { readFile: async () => ({ data: "cGRm" }) },
  });

  const [document] = await ports.pickDocuments();

  assert.equal(document.id, "doc-id");
  assert.equal(document.name, "ata.pdf");
  assert.equal(document.type, "application/pdf");
  assert.equal(await document.text(), "pdf");
});

test("importa a caixa compartilhada sem apagar os itens", async () => {
  const removed = [];
  const ports = createNativePorts({
    shareInbox: {
      list: async () => ({ items: [{ id: "share-id", name: "foto.jpg", size: 1, type: "image/jpeg" }] }),
      read: async () => ({ data: "eA==" }),
      remove: async ({ id }) => removed.push(id),
    },
  });

  const [shared] = await ports.importSharedItems();

  assert.equal(shared.sourceId, "share-id");
  assert.equal(await shared.text(), "x");
  assert.deepEqual(removed, []);

  await ports.discardSharedItem("share-id");
  assert.deepEqual(removed, ["share-id"]);
});

test("preserva confirmação feita pela extensão junto ao arquivo importado", async () => {
  const confirmation = { status: "processed", messages: [{ type: "text", text: "Recebido" }] };
  const ports = createNativePorts({
    shareInbox: {
      async list() {
        return { items: [{
          id: "shared-confirmed",
          name: "foto.jpg",
          size: 2,
          type: "image/jpeg",
          confirmedResult: confirmation,
        }] };
      },
      async read() { return { data: "AQI=" }; },
    },
  });

  const [file] = await ports.importSharedItems();
  assert.deepEqual(file.confirmedResult, confirmation);
});

test("recusa metadado nativo grande antes de ler seu conteúdo", async () => {
  let reads = 0;
  const ports = createNativePorts({
    documentPicker: {
      async pick() {
        return { items: [{
          id: "huge",
          uri: "file:///huge.bin",
          name: "grande.pdf",
          size: 60 * 1024 * 1024 + 1,
          type: "application/pdf",
        }] };
      },
    },
    filesystem: { async readFile() { reads += 1; return { data: "" }; } },
  });

  await assert.rejects(ports.pickDocuments(), /60 MB/);
  assert.equal(reads, 0);
});

test("exporta mídia por arquivo temporário e folha nativa", async () => {
  const calls = [];
  const ports = createNativePorts({
    filesystem: {
      writeFile: async options => {
        calls.push(["write", options]);
        return { uri: "file:///cache/resumo.pdf" };
      },
    },
    share: { share: async options => calls.push(["share", options]) },
  });

  await ports.exportMedia(new Blob(["pdf"], { type: "application/pdf" }), "resumo.pdf");

  assert.equal(calls[0][0], "write");
  assert.equal(calls[0][1].path, "resumo.pdf");
  assert.equal(calls[1][0], "share");
  assert.deepEqual(calls[1][1].files, ["file:///cache/resumo.pdf"]);
});
