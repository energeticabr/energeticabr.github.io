import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";

import { signPdfAttachment } from "../src/web/pdf-signing.js";
import { signatureLayoutGeometry } from "../src/web/signature-document-layout.js";

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

function boldTextPlacement(content, label, occurrence = 0) {
  const hex = Buffer.from(label, "latin1").toString("hex").toUpperCase();
  const matches = [...content.matchAll(new RegExp(`/Helvetica-Bold-[^\\n]+ ([\\d.]+) Tf\\n24 TL\\n1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\\n<${hex}> Tj`, "g"))];
  const match = matches[occurrence];
  assert.ok(match, `Texto não encontrado no PDF: ${label}`);
  return { size: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

test("reserva a maior parte do cartão de comprovante para o traço", () => {
  const epi = signatureLayoutGeometry("epi", { pageWidth: 595, pageHeight: 842, scale: 1 });
  const payment = signatureLayoutGeometry("payment", { pageWidth: 595, pageHeight: 842, scale: 1 });

  assert.equal(epi.widthRatio, 0.42);
  assert.equal(epi.aspectRatio, 2.1);
  assert.equal(epi.captionRatio, 0.32);
  assert.ok(epi.height * (1 - epi.captionRatio) > 80);
  assert.equal(payment.widthRatio, 0.54);
  assert.equal(payment.captionRatio, 0.28);
});

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
  const content = pageContent(signed, 2);
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
});

test("mantém a largura proporcional em páginas grandes", async () => {
  const source = await PDFDocument.create();
  source.addPage([1000, 1400]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.5, scale: 1 },
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  assert.match(content, /0 0 m\n0 26 l\n640 26 l\n640 0 l/);
});

test("comprovante EPI usa cartão centralizado com assinatura, nome e data", async () => {
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
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  const signerHex = Buffer.from("RAFAEL GONTIJO", "latin1").toString("hex").toUpperCase();
  const dateHex = Buffer.from("DATA/HORA: 20/09/2026 às 00:32", "latin1").toString("hex").toUpperCase();

  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
  assert.match(content, new RegExp(`<${signerHex}> Tj`));
  assert.match(content, new RegExp(`<${dateHex}> Tj`));
  assert.match(content, /\/Helvetica-Bold-/);
  assert.match(content, /0\.05 0\.18 0\.36 rg/);
  assert.match(content, /0\.08 0\.18 0\.34 RG/);
  assert.match(content, /0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nB/);
  assert.match(content, /175\.5488 231\.18 m\n175\.5488 231\.18 m\n419\.4512 231\.18 l\nS/);
});

test("comprovante de pagamento coloca a linha dentro do retângulo da assinatura", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-pagamento-2026-09-20.pdf",
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.25, scale: 1 },
    signerName: "COPIADORA ALTERNATIVA",
    signedAt: "2026-09-20T12:17:00-03:00",
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  const signerHex = Buffer.from("COPIADORA ALTERNATIVA", "latin1").toString("hex").toUpperCase();

  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
  assert.match(content, new RegExp(`<${signerHex}> Tj`));
  assert.match(content, /0\.08 0\.18 0\.34 RG/);
  assert.match(content, /0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nB/);
  assert.match(content, /140\.7056 176\.84 m\n140\.7056 176\.84 m\n454\.2944 176\.84 l\nS/);
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

test("PDF final emoldura a assinatura de Bernardo e identifica nome, função e data/hora", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });
  const stampBlob = new Blob([PNG_1X1], { type: "image/png" });
  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-entrega-epi.pdf",
    signatureBlob,
    point: { page: 1, x: 0.7, y: 0.3, scale: 0.5 },
    stampBlob,
    stampPoint: { page: 1, x: 0.3, y: 0.3, scale: 0.5 },
    signerName: "RAFAEL GONTIJO",
    signedAt: "2026-09-24T13:16:00-03:00",
  });
  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  for (const label of ["BERNARDO NOTINI", "RESPONSÁVEL TÉCNICO", "DATA: 24/09/2026 às 13:16"]) {
    const hex = Buffer.from(label, "latin1").toString("hex").toUpperCase();
    assert.match(content, new RegExp(`<${hex}> Tj`));
  }
  const bernardo = boldTextPlacement(content, "BERNARDO NOTINI");
  const signer = boldTextPlacement(content, "RAFAEL GONTIJO");
  const date = boldTextPlacement(content, "DATA: 24/09/2026 às 13:16");
  assert.equal(signer.size, bernardo.size);
  assert.ok(date.y > 230, "A data de Bernardo deve ficar afastada da borda inferior do cartão");
  const signerDate = boldTextPlacement(content, "DATA/HORA: 24/09/2026 às 13:16");
  assert.ok(signerDate.y > 227.4, "A data do usuário também deve ter margem inferior");
  assert.ok((content.match(/0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nS/g) || []).length >= 2);
  assert.ok((content.match(/0\.08 0\.18 0\.34 RG/g) || []).length >= 2);
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
