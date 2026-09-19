import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

function bounded(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function printableText(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateLabel(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return printableText(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function fitText(text, font, size, width) {
  const value = printableText(text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  const suffix = "...";
  let end = value.length;
  while (end > 0 && font.widthOfTextAtSize(`${value.slice(0, end)}${suffix}`, size) > width) end -= 1;
  return `${value.slice(0, end)}${suffix}`;
}

async function embedSignature(pdf, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = String(blob.type || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return pdf.embedJpg(bytes);
  try {
    return await pdf.embedPng(bytes);
  } catch (pngError) {
    try {
      return await pdf.embedJpg(bytes);
    } catch {
      throw new Error("A imagem da assinatura não está em um formato compatível.", { cause: pngError });
    }
  }
}

/**
 * Inserts a handwritten signature into an existing PDF using the normalized
 * point selected in the on-screen preview. The white fill is deliberately
 * restricted to the horizontal identification strip; it must never cover the
 * signature image or the rest of the document.
 */
export async function signPdfAttachment({
  documentBlob,
  signatureBlob,
  point,
  signerName = "USUÁRIO",
  signedAt = new Date(),
} = {}) {
  if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") throw new TypeError("PDF de origem inválido.");
  if (!signatureBlob || typeof signatureBlob.arrayBuffer !== "function") throw new TypeError("Imagem de assinatura inválida.");

  const pdf = await PDFDocument.load(await documentBlob.arrayBuffer());
  const pages = pdf.getPages();
  const pageNumber = Number(point?.page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) {
    throw new RangeError("A página escolhida para a assinatura não existe.");
  }

  const page = pages[pageNumber - 1];
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = bounded(point?.scale, MIN_SCALE, MAX_SCALE);
  const markerWidth = Math.min(
    Math.min(pageWidth * 0.64, 420) * scale,
    Math.max(1, pageWidth - 4),
    Math.max(1, (pageHeight - 4) * 3),
  );
  const markerHeight = markerWidth / 3;
  const captionHeight = Math.max(18, Math.min(34, markerHeight * 0.28));
  const signatureHeight = markerHeight - captionHeight;
  const centerX = bounded(point?.x, 0, 1) * pageWidth;
  const centerY = bounded(point?.y, 0, 1) * pageHeight;
  const left = bounded(centerX - markerWidth / 2, 0, Math.max(0, pageWidth - markerWidth));
  const bottom = bounded(centerY - markerHeight / 2, 0, Math.max(0, pageHeight - markerHeight));

  const signature = await embedSignature(pdf, signatureBlob);
  const inset = Math.max(2, markerWidth * 0.012);
  const availableWidth = markerWidth - inset * 2;
  const availableHeight = signatureHeight - inset * 2;
  const ratio = Math.min(availableWidth / signature.width, availableHeight / signature.height);
  const imageWidth = signature.width * ratio;
  const imageHeight = signature.height * ratio;
  page.drawImage(signature, {
    x: left + (markerWidth - imageWidth) / 2,
    y: bottom + captionHeight + (signatureHeight - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  });

  // Keep document content from crossing only the signer/date identification
  // lines. A previous implementation filled the whole signature rectangle and
  // incorrectly hid content behind the handwritten signature.
  page.drawRectangle({
    x: left,
    y: bottom,
    width: markerWidth,
    height: captionHeight,
    color: rgb(1, 1, 1),
    opacity: 0.96,
  });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = bounded(markerWidth / 48, 5.5, 8.5);
  const textWidth = markerWidth - inset * 2;
  const name = fitText(`ASSINADO DIGITALMENTE POR: ${printableText(signerName) || "USUÁRIO"}`, font, fontSize, textWidth);
  const timestamp = fitText(`DATA/HORA: ${dateLabel(signedAt)}`, font, fontSize, textWidth);
  page.drawText(name, { x: left + inset, y: bottom + captionHeight - fontSize - 2, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });
  page.drawText(timestamp, { x: left + inset, y: bottom + 2, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });

  const bytes = await pdf.save();
  return new Blob([bytes], { type: "application/pdf" });
}
