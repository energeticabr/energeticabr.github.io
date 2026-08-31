import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  attachmentPanelMarkup,
  attachmentViewerMarkup,
  bindAttachmentViewerBackdrop,
  createAttachmentPreviewController,
} from "../portal/ui/attachments-panel.js";
import { galleryAttachmentButtonMarkup } from "../portal/ui/entity-page.js";

const files = Object.freeze([
  { name: "FACHADA.jpg", type: "image/jpeg" },
  { name: "CONTRATO.pdf", type: "application/pdf" },
]);
const adminCss = readFileSync(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

test("painel nao enumera nem incorpora arquivo quando a leitura nao esta autorizada", () => {
  const markup = attachmentPanelMarkup({ availability: "forbidden", canView: false, files });
  assert.doesNotMatch(markup, /FACHADA\.jpg|CONTRATO\.pdf/);
  assert.doesNotMatch(markup, /data-attachment-open|blob:|sharepoint/i);
});

test("controlador baixa cada previa mediante autorizacao e navega anterior e proximo", async () => {
  const downloads = [];
  const revoked = [];
  let sequence = 0;
  const controller = createAttachmentPreviewController({
    files,
    actions: {
      canView: () => true,
      async downloadAttachment(name) { downloads.push(name); return new Uint8Array([sequence += 1]).buffer; },
    },
    urlApi: {
      createObjectURL: () => `blob:seguro-${sequence}`,
      revokeObjectURL: url => revoked.push(url),
    },
  });

  assert.equal((await controller.open(0)).name, "FACHADA.jpg");
  assert.equal((await controller.next()).name, "CONTRATO.pdf");
  assert.equal((await controller.previous()).name, "FACHADA.jpg");
  assert.deepEqual(downloads, ["FACHADA.jpg", "CONTRATO.pdf", "FACHADA.jpg"]);
  assert.deepEqual(revoked, ["blob:seguro-1", "blob:seguro-2"]);
  controller.cleanup();
  assert.deepEqual(revoked, ["blob:seguro-1", "blob:seguro-2", "blob:seguro-3"]);
});

test("controlador recusa previa antes de baixar quando a ACL nao autoriza leitura", async () => {
  let downloads = 0;
  let urls = 0;
  const controller = createAttachmentPreviewController({
    files,
    actions: {
      canView: () => false,
      async downloadAttachment() { downloads += 1; },
    },
    urlApi: {
      createObjectURL() { urls += 1; return "blob:indevido"; },
      revokeObjectURL() {},
    },
  });

  await assert.rejects(controller.open(0), /permissão/i);
  assert.equal(downloads, 0);
  assert.equal(urls, 0);
});

test("visualizador usa imagem ou PDF e oferece navegacao e download", () => {
  const image = attachmentViewerMarkup({ files, activeIndex: 0, preview: { name: "FACHADA.jpg", type: "image/jpeg", url: "blob:imagem" }, canEdit: true });
  assert.match(image, /<img[^>]+blob:imagem/);
  assert.match(image, /class="attachment-preview-stage"/);
  assert.match(image, /attachment-nav-button is-previous[^>]*data-attachment-previous[\s\S]*?attachment-preview-content[\s\S]*?attachment-nav-button is-next[^>]*data-attachment-next/);
  assert.match(image, /data-attachment-preview-download/);
  assert.match(image, /data-attachment-previous[^>]+disabled/);
  assert.match(image, /data-attachment-preview-upload/);
  assert.match(image, /data-attachment-preview-file/);

  const pdf = attachmentViewerMarkup({ files, activeIndex: 1, preview: { name: "CONTRATO.pdf", type: "application\/pdf", url: "blob:pdf" } });
  assert.match(pdf, /<iframe[^>]+blob:pdf/);
  assert.doesNotMatch(pdf, /<iframe[^>]+sandbox(?:=|\s|>)/, "o sandbox vazio bloqueia o visualizador PDF nativo do navegador");
  assert.match(pdf, /data-attachment-previous/);
  assert.match(pdf, /data-attachment-next[^>]+disabled/);
  assert.doesNotMatch(pdf, /data-attachment-preview-upload/);
});

test("clicar no fundo transparente fecha o visualizador sem fechar ao clicar no documento", () => {
  const listeners = new Map();
  const dialog = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  let closes = 0;
  const unbind = bindAttachmentViewerBackdrop(dialog, () => { closes += 1; });

  listeners.get("click")({ target: {} });
  assert.equal(closes, 0);
  listeners.get("click")({ target: dialog });
  assert.equal(closes, 1);
  unbind();
  assert.equal(listeners.has("click"), false);
});

test("visualizador ocupa a tela e posiciona a navegacao nas laterais do documento", () => {
  assert.match(adminCss, /\.attachment-viewer\s*\{[^}]*width:\s*min\(94vw,/s);
  assert.match(adminCss, /\.attachment-preview-stage\s*\{[^}]*position:\s*relative/s);
  assert.match(adminCss, /\.attachment-nav-button\.is-previous\s*\{[^}]*left:/s);
  assert.match(adminCss, /\.attachment-nav-button\.is-next\s*\{[^}]*right:/s);
  assert.match(adminCss, /\.attachment-preview-content iframe\s*\{[^}]*height:\s*100%/s);
});

test("gatilho da galeria mostra miniatura somente quando o primeiro arquivo e imagem e PDF somente quando existe", () => {
  const firstImage = galleryAttachmentButtonMarkup(files, "blob:miniatura");
  assert.match(firstImage, /<img[^>]+blob:miniatura/);

  const pdfFirst = galleryAttachmentButtonMarkup([
    { name: "CONTRATO.pdf", type: "application/pdf" },
    { name: "FACHADA.jpg", type: "image/jpeg" },
  ], "blob:nao-usar");
  assert.doesNotMatch(pdfFirst, /<img/);
  assert.match(pdfFirst, /entity-gallery-file-icon[^>]*>PDF</);

  const imageOnly = galleryAttachmentButtonMarkup([{ name: "FACHADA.jpg", type: "image/jpeg" }]);
  assert.doesNotMatch(imageOnly, />PDF</);
});

test("visualizador recusa URL remota mesmo se um chamador tentar injeta-la", () => {
  const markup = attachmentViewerMarkup({
    files: [{ name: "CONTRATO.pdf", type: "application/pdf" }],
    activeIndex: 0,
    preview: { name: "CONTRATO.pdf", type: "application/pdf", url: "https://energeticaltda.sharepoint.com/arquivo?token=segredo" },
  });

  assert.doesNotMatch(markup, /https:|sharepoint|token=segredo/i);
  assert.match(markup, /prévia segura não está disponível/i);
});
