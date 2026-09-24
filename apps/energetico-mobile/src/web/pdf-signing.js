import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { signatureDocumentLayout, signatureLayoutGeometry } from "./signature-document-layout.js";

const DEFAULT_SCALE = 0.5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2;
const MIN_STAMP_SCALE = 0.2;
const MAX_STAMP_SCALE = 2;

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

function epiDateLabel(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return printableText(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(date).replace(", ", " às ");
}

function drawCalendarIcon(page, { x, y, size, color }) {
  const stroke = Math.max(0.7, size * 0.09);
  const height = size * 0.8;
  page.drawRectangle({
    x,
    y,
    width: size,
    height,
    borderColor: color,
    borderWidth: stroke,
  });
  page.drawLine({
    start: { x, y: y + height * 0.58 },
    end: { x: x + size, y: y + height * 0.58 },
    color,
    thickness: stroke,
  });
  for (const offset of [size * 0.25, size * 0.75]) {
    page.drawLine({
      start: { x: x + offset, y: y + height },
      end: { x: x + offset, y: y + height * 0.76 },
      color,
      thickness: stroke,
    });
  }
}

function fitText(text, font, size, width) {
  const value = printableText(text);
  if (font.widthOfTextAtSize(value, size) <= width) return value;
  const suffix = "...";
  let end = value.length;
  while (end > 0 && font.widthOfTextAtSize(`${value.slice(0, end)}${suffix}`, size) > width) end -= 1;
  return `${value.slice(0, end)}${suffix}`;
}

function boundedScale(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SCALE;
  return Math.max(minimum, Math.min(maximum, number));
}

async function drawBernardoStampCard(pdf, page, image, point, { signedAt }) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = boundedScale(point?.scale, MIN_STAMP_SCALE, MAX_STAMP_SCALE);
  const aspectRatio = 2.1;
  const requestedWidth = pageWidth * 0.38 * scale;
  const width = Math.min(
    requestedWidth,
    Math.max(1, pageWidth - 4),
    Math.max(1, (pageHeight - 4) * aspectRatio),
  );
  const height = width / aspectRatio;
  const captionHeight = height * 0.5;
  const imageHeight = height - captionHeight;
  const centerX = bounded(point?.x, 0, 1) * pageWidth;
  const centerY = bounded(point?.y, 0, 1) * pageHeight;
  const left = bounded(centerX - width / 2, 0, Math.max(0, pageWidth - width));
  const bottom = bounded(centerY - height / 2, 0, Math.max(0, pageHeight - height));
  const borderColor = rgb(0.08, 0.18, 0.34);
  page.drawRectangle({
    x: left, y: bottom, width, height,
    color: rgb(1, 1, 1), opacity: 0.96,
    borderColor, borderWidth: 1.2,
  });
  const inset = Math.max(2, width * 0.012);
  const imageScale = Math.min((width - inset * 2) / image.width, (imageHeight - inset * 2) / image.height);
  const drawnWidth = image.width * imageScale;
  const drawnHeight = image.height * imageScale;
  page.drawImage(image, {
    x: left + (width - drawnWidth) / 2,
    y: bottom + captionHeight + (imageHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  });
  page.drawLine({
    start: { x: left + inset, y: bottom + captionHeight },
    end: { x: left + width - inset, y: bottom + captionHeight },
    color: borderColor, thickness: 1.2,
  });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontSize = bounded(Math.min(width / 20, captionHeight / 3.6), 2.2, 8);
  const bottomInset = Math.min(5, Math.max(1, captionHeight * 0.18));
  const lineHeight = (captionHeight - bottomInset - 1 - fontSize) / 2;
  const labels = [
    `DATA: ${epiDateLabel(signedAt)}`,
    "RESPONSÁVEL TÉCNICO",
    "BERNARDO NOTINI",
  ];
  for (const [index, label] of labels.entries()) {
    const dateIconSize = index === 0 ? Math.max(4, fontSize * 1.1) : 0;
    const fitted = fitText(label, font, fontSize, width - inset * 2 - (dateIconSize ? dateIconSize + 4 : 0));
    const textWidth = font.widthOfTextAtSize(fitted, fontSize);
    const combinedWidth = textWidth + (dateIconSize ? dateIconSize + 4 : 0);
    const textLeft = left + (width - combinedWidth) / 2;
    const baseline = bottom + bottomInset + index * lineHeight;
    if (dateIconSize) drawCalendarIcon(page, {
      x: textLeft,
      y: baseline,
      size: dateIconSize,
      color: rgb(0.05, 0.18, 0.36),
    });
    page.drawText(fitted, {
      x: textLeft + (dateIconSize ? dateIconSize + 4 : 0),
      y: baseline,
      font, size: fontSize, color: rgb(0.05, 0.18, 0.36),
    });
  }
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
  documentFileName = "",
  signatureBlob,
  point,
  stampBlob = null,
  stampPoint = null,
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

  if (stampBlob) {
    if (!stampPoint || !Number.isInteger(Number(stampPoint.page))) {
      throw new RangeError("A página escolhida para o carimbo não existe.");
    }
    const stampPageNumber = Number(stampPoint.page);
    if (stampPageNumber < 1 || stampPageNumber > pages.length) {
      throw new RangeError("A página escolhida para o carimbo não existe.");
    }
    const stampPage = pages[stampPageNumber - 1];
    const stamp = await embedSignature(pdf, stampBlob);
    await drawBernardoStampCard(pdf, stampPage, stamp, stampPoint, {
      signedAt,
    });
  }

  const scale = boundedScale(point?.scale, MIN_SCALE, MAX_SCALE);
  const documentLayout = signatureDocumentLayout(documentFileName);
  const epiCaption = documentLayout === "epi";
  const paymentCaption = documentLayout === "payment";
  const cardCaption = epiCaption || paymentCaption;
  const markerGeometry = signatureLayoutGeometry(documentLayout, { pageWidth, pageHeight, scale });
  const markerWidth = markerGeometry.width;
  const markerHeight = markerGeometry.height;
  const captionHeight = cardCaption
    ? markerHeight * markerGeometry.captionRatio
    : Math.max(14, Math.min(26, markerHeight * markerGeometry.captionRatio));
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

  const paymentBorderColor = rgb(0.08, 0.18, 0.34);
  if (cardCaption) {
    // EPI and payment receipts own their signature area. Paint over the old
    // template line first, then draw the new border and internal divider so
    // the line can never remain outside the signature rectangle.
    page.drawRectangle({
      x: left,
      y: bottom,
      width: markerWidth,
      height: markerHeight,
      color: rgb(1, 1, 1),
      opacity: 0.96,
      borderColor: paymentBorderColor,
      borderWidth: 1.2,
    });
  }

  page.drawImage(signature, {
    x: left + (markerWidth - imageWidth) / 2,
    y: bottom + captionHeight + (signatureHeight - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
  });

  // Keep document content from crossing only the signer/date identification
  // lines. A previous implementation filled the whole signature rectangle and
  // incorrectly hid content behind the handwritten signature.
  if (!cardCaption) {
    page.drawRectangle({
      x: left,
      y: bottom,
      width: markerWidth,
      height: captionHeight,
      color: rgb(1, 1, 1),
      opacity: 0.96,
    });
  }
  const font = await pdf.embedFont(cardCaption ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const fontSize = paymentCaption
    ? bounded(markerWidth / 48, 5, 10)
    : epiCaption
    ? bounded(pageWidth * 0.38 * scale / 20, 2.2, 8)
    : bounded(markerWidth / 48, 5.5, 8.5);
  const textWidth = markerWidth - inset * 2;
  const captionColor = cardCaption ? rgb(0.05, 0.18, 0.36) : rgb(0.12, 0.12, 0.12);
  const name = fitText(printableText(signerName) || "USUÁRIO", font, fontSize, textWidth);
  const nameWidth = font.widthOfTextAtSize(name, fontSize);
  if (paymentCaption || epiCaption) {
    page.drawLine({
      start: { x: left + inset, y: bottom + captionHeight },
      end: { x: left + markerWidth - inset, y: bottom + captionHeight },
      color: paymentBorderColor,
      thickness: 1.2,
    });
    const signer = fitText(printableText(signerName) || "USUÁRIO", font, fontSize, textWidth);
    const signerWidth = font.widthOfTextAtSize(signer, fontSize);
    page.drawText(signer, {
      x: left + Math.max(inset, (markerWidth - signerWidth) / 2),
      y: bottom + captionHeight - fontSize - (epiCaption ? 1 : 3),
      size: fontSize,
      font,
      color: captionColor,
    });
    const timestamp = fitText(
      `DATA/HORA: ${paymentCaption ? dateLabel(signedAt).replace(", ", " ") : epiDateLabel(signedAt)}`,
      font,
      fontSize,
      textWidth,
    );
    const timestampWidth = font.widthOfTextAtSize(timestamp, fontSize);
    if (epiCaption) {
      const iconSize = Math.max(6, fontSize * 1.3);
      const dateWidth = iconSize + 4 + timestampWidth;
      const dateLeft = left + Math.max(inset, (markerWidth - dateWidth) / 2);
      const dateBaseline = bottom + Math.min(5, Math.max(2, captionHeight * 0.25));
      drawCalendarIcon(page, {
        x: dateLeft,
        y: dateBaseline,
        size: iconSize,
        color: captionColor,
      });
      page.drawText(timestamp, {
        x: dateLeft + iconSize + 4,
        y: dateBaseline,
        size: fontSize,
        font,
        color: captionColor,
      });
    } else {
      page.drawText(timestamp, {
        x: left + Math.max(inset, (markerWidth - timestampWidth) / 2),
        y: bottom + 3,
        size: fontSize,
        font,
        color: captionColor,
      });
    }
  } else {
    page.drawText(name, {
      x: left + Math.max(inset, (markerWidth - nameWidth) / 2),
      y: bottom + captionHeight - fontSize - 2,
      size: fontSize,
      font,
      color: captionColor,
    });
    const timestamp = fitText(`DATA/HORA: ${dateLabel(signedAt)}`, font, fontSize, textWidth);
    page.drawText(timestamp, {
      x: left + inset,
      y: bottom + 2,
      size: fontSize,
      font,
      color: captionColor,
    });
  }

  const bytes = await pdf.save();
  return new Blob([bytes], { type: "application/pdf" });
}
