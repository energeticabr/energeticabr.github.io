import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import { signPdfAttachment } from "../src/web/pdf-signing.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function pageContent(pdf, pageNumber = 1) {
  const page = pdf.getPages()[pageNumber - 1];
  const streams = page.node.Contents();
  return Array.from({ length: streams.size() }, (_, index) => {
    const stream = page.node.context.lookup(streams.get(index));
    return inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  }).join("\n");
}

test("gera um PDF assinado válido na página e posição escolhidas", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 2, x: 0.75, y: 0.2, scale: 0.8 },
    signerName: "Bernardo Notini",
    signedAt: "2026-09-18T20:20:00-03:00",
  });

  assert.equal(result.type, "application/pdf");
  assert.ok(result.size > documentBlob.size);
  const signed = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(signed.getPageCount(), 2);
});

test("comprovante EPI centraliza o responsável e usa data com calendário", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-entrega-epi.pdf",
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.3, scale: 1 },
    signerName: "RAFAEL GONTIJO",
    signedAt: "2026-09-20T00:32:00-03:00",
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  const nameHex = Buffer.from("ASSINADO DIGITALMENTE POR: RAFAEL GONTIJO", "latin1").toString("hex").toUpperCase();
  const dateHex = Buffer.from("20/09/2026 às 00:32", "latin1").toString("hex").toUpperCase();

  assert.match(content, new RegExp(`<${nameHex}> Tj`));
  assert.match(content, new RegExp(`<${dateHex}> Tj`));
  assert.match(content, /\/Helvetica-Bold-/);
  assert.match(content, /0\.05 0\.18 0\.36 rg/);
  assert.match(content, /0 0 m\n[\d.]+ [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nS/);
});

test("inclui o carimbo de Bernardo quando solicitado", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });
  const stampBlob = new Blob([PNG_1X1], { type: "image/png" });

  const withoutStamp = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });
  const withStamp = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
    stampBlob,
    stampPoint: { page: 1, x: 0.5, y: 0.65, scale: 0.8 },
  });

  assert.ok(withStamp.size > withoutStamp.size);
  assert.equal((await PDFDocument.load(await withStamp.arrayBuffer())).getPageCount(), 1);
});

test("rejeita uma página inexistente sem alterar o arquivo original", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  await assert.rejects(
    signPdfAttachment({ documentBlob, signatureBlob, point: { page: 3, x: 0.5, y: 0.5, scale: 1 } }),
    /página escolhida/i,
  );
});
