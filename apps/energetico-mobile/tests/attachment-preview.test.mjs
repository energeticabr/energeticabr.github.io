import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAttachmentPreview } from "../src/web/attachment-preview.js";

function setup(t, options = {}) {
  const dom = new JSDOM('<main><textarea>rascunho preservado</textarea><section id="messages">Conversa</section></main>');
  const documentRef = dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  const revoked = [];
  let urlCount = 0;
  const preview = createAttachmentPreview({
    documentRef,
    urlApi: { createObjectURL: () => `blob:preview-${++urlCount}`, revokeObjectURL: url => revoked.push(url) },
    ...options,
  });
  t.after(() => { preview.destroy(); dom.window.close(); });
  return { preview, documentRef, dom, revoked };
}

test("abre antes de ler o arquivo e preserva conversa, rascunho, rolagem e foco ao fechar", async t => {
  let finishRead;
  const { preview, documentRef } = setup(t, { readText: () => new Promise(resolve => { finishRead = resolve; }) });
  const draft = documentRef.querySelector("textarea");
  const messages = documentRef.querySelector("#messages");
  messages.scrollTop = 231;
  draft.focus();
  const ready = preview.open(new Blob(["texto"], { type: "text/plain" }), "relatório.txt");
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.equal(documentRef.querySelector("h2").textContent, "relatório.txt");
  preview.close();
  finishRead("resposta atrasada");
  await ready;
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.equal(documentRef.querySelector("textarea"), draft);
  assert.equal(draft.value, "rascunho preservado");
  assert.equal(messages.scrollTop, 231);
  assert.equal(documentRef.activeElement, draft);
  assert.equal(documentRef.querySelector("dialog").textContent.includes("resposta atrasada"), false);
});

test("imagem usa URL local e libera a anterior ao substituir e ao cancelar", async t => {
  const { preview, documentRef, dom, revoked } = setup(t);
  await preview.open(new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
  assert.equal(documentRef.querySelector("dialog img").src, "blob:preview-1");
  await preview.open(new Blob(["outra imagem"], { type: "image/png" }), "foto2.png");
  assert.deepEqual(revoked, ["blob:preview-1"]);
  documentRef.querySelector("dialog").dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
});

test("imagem não suportada oferece exportação explícita sem sair da conversa", async t => {
  let exported;
  const { preview, documentRef, dom, revoked } = setup(t, { exportMedia: (blob, name) => { exported = { blob, name }; return "shared"; } });
  const blob = new Blob(["heic"], { type: "image/heic" });
  await preview.open(blob, "obra.heic");
  documentRef.querySelector("dialog img").dispatchEvent(new dom.window.Event("error"));
  assert.match(documentRef.querySelector("dialog").textContent, /não conseguiu mostrar esta imagem/i);
  documentRef.querySelector('[data-preview-action="export"]').click();
  assert.deepEqual(exported, { blob, name: "obra.heic" });
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.deepEqual(revoked, ["blob:preview-1"]);
});

test("texto e CSV são texto escapado e a leitura é limitada", async t => {
  let readSize;
  const { preview, documentRef } = setup(t, { maxTextBytes: 12, readText: blob => { readSize = blob.size; return blob.text(); } });
  await preview.open(new Blob(['<img src=x onerror="alert(1)">'], { type: "text/csv" }), "itens.csv");
  assert.equal(readSize, 12);
  assert.equal(documentRef.querySelector("dialog pre").textContent, "<img src=x o");
  assert.equal(documentRef.querySelector("dialog img"), null);
  assert.match(documentRef.querySelector("dialog").textContent, /início do arquivo/i);
});

test("HTML, SVG e Office nunca criam documentos executáveis no visualizador", async t => {
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  for (const [name, type] of [["a.html", "text/html"], ["a.svg", "image/svg+xml"], ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]) {
    await preview.open(new Blob(["<script>alert(1)</script>"], { type }), name);
    assert.equal(documentRef.querySelector("dialog iframe, dialog object, dialog embed, dialog script, dialog svg, dialog img"), null);
    assert.match(documentRef.querySelector("dialog").textContent, /outro app/);
  }
});

test("fechar durante importação PDF impede criação tardia do visualizador", async t => {
  let resolveLoader;
  let created = 0;
  const { preview, documentRef } = setup(t, { loadPdfPreview: () => new Promise(resolve => { resolveLoader = resolve; }) });
  const ready = preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  assert.equal(documentRef.querySelector("dialog").open, true);
  preview.close();
  resolveLoader({ createPdfPreview: () => { created++; return { ready: Promise.resolve(), destroy() {} }; } });
  await ready;
  assert.equal(created, 0);
});

test("trocar PDF cancela trabalho anterior e ignora erro tardio", async t => {
  let rejectRender;
  let disposed = 0;
  let signal;
  const { preview, documentRef } = setup(t, { loadPdfPreview: async () => ({ createPdfPreview: options => {
    signal = options.signal;
    return { ready: new Promise((resolve, reject) => { rejectRender = reject; }), destroy() { disposed++; } };
  } }) });
  const ready = preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  await Promise.resolve();
  await preview.open(new Blob(["novo"], { type: "text/plain" }), "atual.txt");
  rejectRender(new Error("erro antigo"));
  await ready;
  assert.equal(signal.aborted, true);
  assert.equal(disposed, 1);
  assert.equal(documentRef.querySelector("dialog pre").textContent, "novo");
  assert.equal(documentRef.querySelector("dialog").textContent.includes("erro antigo"), false);
});

test("falha de PDF mantém opção de exportar e voltar; destroy remove a janela", async t => {
  const { preview, documentRef } = setup(t, { exportMedia: () => {}, loadPdfPreview: async () => { throw new Error("falha"); } });
  await preview.open(new Blob(["%PDF"], { type: "application/pdf" }), "ata.pdf");
  assert.match(documentRef.querySelector("dialog").textContent, /não foi possível/i);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, false);
  preview.destroy();
  assert.equal(documentRef.querySelector("dialog"), null);
});

test("arquivo da rede abre janela imediatamente e só permite exportar depois de carregar", async t => {
  let resolveDownload;
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  const ready = preview.open(new Promise(resolve => { resolveDownload = resolve; }), "resposta.txt");
  assert.equal(documentRef.querySelector("dialog").open, true);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, true);
  resolveDownload(new Blob(["resposta baixada"], { type: "text/plain" }));
  await ready;
  assert.equal(documentRef.querySelector("dialog pre").textContent, "resposta baixada");
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, false);
});

test("erro da rede fica na janela e resposta atrasada após fechar não altera o chat", async t => {
  let rejectDownload;
  const { preview, documentRef } = setup(t, { exportMedia: () => {} });
  await preview.open(Promise.reject(new Error("offline")), "resposta.pdf");
  assert.match(documentRef.querySelector("dialog").textContent, /não foi possível carregar/i);
  assert.equal(documentRef.querySelector('[data-preview-action="export"]').disabled, true);
  const ready = preview.open(new Promise((resolve, reject) => { rejectDownload = reject; }), "outra.pdf");
  preview.close();
  rejectDownload(new Error("falha atrasada"));
  await ready;
  assert.equal(documentRef.querySelector("dialog").open, false);
  assert.equal(documentRef.querySelector("textarea").value, "rascunho preservado");
});
