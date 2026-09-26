import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  return import("../src/ui/gallery-attachment-counts.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND" && error.message.includes("gallery-attachment-counts.js")) return {};
    throw error;
  });
}

test("normaliza a quantidade de anexos disponível nos metadados da galeria", async () => {
  const module = await loadModule();
  assert.equal(typeof module.knownGalleryAttachmentCount, "function");
  assert.equal(module.knownGalleryAttachmentCount({ fields: { "QUANTIDADE DE ANEXOS": "3" } }), 3);
  assert.equal(module.knownGalleryAttachmentCount({ attachments: [{ name: "a.pdf" }, { name: "b.jpg" }] }), 2);
  assert.equal(module.knownGalleryAttachmentCount({ hasAttachments: false }), 0);
  assert.equal(module.knownGalleryAttachmentCount({ hasAttachments: true }), null);
});

test("consulta a contagem real uma vez e reutiliza os anexos carregados", async () => {
  const module = await loadModule();
  assert.equal(typeof module.createGalleryAttachmentCounts, "function");
  let calls = 0;
  const changes = [];
  const files = [{ fileName: "nota.pdf" }, { fileName: "foto.jpg" }];
  const counter = module.createGalleryAttachmentCounts({
    loadAttachments: async row => { calls += 1; assert.equal(row.id, "doc-1"); return files; },
    onChange: row => changes.push(row.id),
  });
  const row = { id: "doc-1", hasAttachments: true };

  assert.equal(counter.label(row), "Contando anexos…");
  await counter.request([row]);
  assert.equal(counter.label(row), "2 anexos");
  assert.deepEqual(counter.attachmentsFor(row), files);
  await counter.load(row, { force: true });
  assert.equal(calls, 1);
  assert.deepEqual(changes, ["doc-1"]);
  counter.destroy();
});

test("informa que a quantidade está indisponível sem repetir falhas automaticamente", async () => {
  const module = await loadModule();
  const row = { id: "doc-2" };
  let calls = 0;
  const counter = module.createGalleryAttachmentCounts({
    loadAttachments: async () => { calls += 1; throw new Error("offline"); },
  });

  await counter.request([row]);
  await counter.request([row]);
  assert.equal(counter.label(row), "Quantidade indisponível");
  assert.equal(calls, 1);
  counter.destroy();
});

test("ignora a resposta de contagem que chega depois da atualização da galeria", async () => {
  const module = await loadModule();
  let finish;
  const updates = [];
  const row = { id: "doc-3" };
  const counter = module.createGalleryAttachmentCounts({
    loadAttachments: () => new Promise(resolve => { finish = resolve; }),
    onChange: item => updates.push(item.id),
  });

  const pending = counter.request([row]);
  await Promise.resolve();
  counter.reset();
  finish([{ fileName: "stale.pdf" }]);
  await pending;

  assert.equal(counter.attachmentsFor(row), null);
  assert.equal(counter.label(row), "Contando anexos…");
  assert.deepEqual(updates, []);
  counter.destroy();
});
