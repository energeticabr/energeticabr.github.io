import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

function isEpiDeliveryDocument(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
  return normalized.includes("ENTREGAEPI") || normalized.includes("COMPROVANTEEPI");
}

function isPaymentReceiptDocument(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
  return normalized.includes("COMPROVANTEPAGAMENTO") || normalized.includes("COMPROVANTEPGTO");
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

function drawImageLayer(page, image, point, { baseWidthRatio, minScale, maxScale }) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = boundedScale(point?.scale, minScale, maxScale);
  const aspectRatio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const requestedWidth = pageWidth * baseWidthRatio * scale;
  const width = Math.min(
    requestedWidth,
    Math.max(1, pageWidth - 4),
    Math.max(1, (pageHeight - 4) * aspectRatio),
  );
  const height = width / aspectRatio;
  const centerX = bounded(point?.x, 0, 1) * pageWidth;
  const centerY = bounded(point?.y, 0, 1) * pageHeight;
  const left = bounded(centerX - width / 2, 0, Math.max(0, pageWidth - width));
  const bottom = bounded(centerY - height / 2, 0, Math.max(0, pageHeight - height));
  page.drawImage(image, { x: left, y: bottom, width, height });
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
    drawImageLayer(stampPage, stamp, stampPoint, {
      baseWidthRatio: 0.38,
      minScale: MIN_STAMP_SCALE,
      maxScale: MAX_STAMP_SCALE,
    });
  }

  const scale = boundedScale(point?.scale, MIN_SCALE, MAX_SCALE);
  const epiCaption = isEpiDeliveryDocument(documentFileName);
  const paymentCaption = isPaymentReceiptDocument(documentFileName);
  const markerAspectRatio = paymentCaption ? 2 : 3;
  const markerWidthRatio = paymentCaption ? 0.5 : 0.64;
  const markerWidth = Math.min(
    pageWidth * markerWidthRatio * scale,
    Math.max(1, pageWidth - 4),
    Math.max(1, (pageHeight - 4) * markerAspectRatio),
  );
  const markerHeight = markerWidth / markerAspectRatio;
  const captionHeight = paymentCaption
    ? Math.max(54, Math.min(76, markerHeight * 0.38))
    : epiCaption
    ? Math.max(30, Math.min(42, markerHeight * 0.32))
    : Math.max(18, Math.min(34, markerHeight * 0.28));
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
  if (paymentCaption) {
    // Payment receipts own their signature area. Paint over the old template
    // line first, then draw the new border and internal divider so the line
    // can never remain outside the signature rectangle.
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
  if (!paymentCaption) {
    page.drawRectangle({
      x: left,
      y: bottom,
      width: markerWidth,
      height: captionHeight,
      color: rgb(1, 1, 1),
      opacity: 0.96,
    });
  }
  const font = await pdf.embedFont(epiCaption || paymentCaption ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const fontSize = paymentCaption
    ? bounded(markerWidth / 48, 7, 10)
    : epiCaption
    ? bounded(markerWidth / 38, 7, 12)
    : bounded(markerWidth / 48, 5.5, 8.5);
  const textWidth = markerWidth - inset * 2;
  const captionColor = epiCaption || paymentCaption ? rgb(0.05, 0.18, 0.36) : rgb(0.12, 0.12, 0.12);
  const name = fitText(`ASSINADO DIGITALMENTE POR: ${printableText(signerName) || "USUÁRIO"}`, font, fontSize, textWidth);
  const nameWidth = font.widthOfTextAtSize(name, fontSize);
  if (paymentCaption) {
    page.drawLine({
      start: { x: left + inset, y: bottom + captionHeight },
      end: { x: left + markerWidth - inset, y: bottom + captionHeight },
      color: paymentBorderColor,
      thickness: 1.2,
    });
    const label = fitText("ASSINADO DIGITALMENTE POR:", font, fontSize, textWidth);
    const labelWidth = font.widthOfTextAtSize(label, fontSize);
    page.drawText(label, {
      x: left + Math.max(inset, (markerWidth - labelWidth) / 2),
      y: bottom + captionHeight - fontSize - 5,
      size: fontSize,
      font,
      color: captionColor,
    });
    const signer = fitText(printableText(signerName) || "USUÁRIO", font, fontSize, textWidth);
    const signerWidth = font.widthOfTextAtSize(signer, fontSize);
    page.drawText(signer, {
      x: left + Math.max(inset, (markerWidth - signerWidth) / 2),
      y: bottom + captionHeight - (fontSize * 2) - 9,
      size: fontSize,
      font,
      color: captionColor,
    });
    const timestamp = fitText(`DATA/HORA: ${dateLabel(signedAt).replace(", ", " ")}`, font, fontSize, textWidth);
    const timestampWidth = font.widthOfTextAtSize(timestamp, fontSize);
    page.drawText(timestamp, {
      x: left + Math.max(inset, (markerWidth - timestampWidth) / 2),
      y: bottom + 6,
      size: fontSize,
      font,
      color: captionColor,
    });
  } else if (epiCaption) {
    page.drawText(name, {
      x: left + Math.max(inset, (markerWidth - nameWidth) / 2),
      y: bottom + captionHeight - fontSize - 5,
      size: fontSize,
      font,
      color: captionColor,
    });
    const timestamp = fitText(epiDateLabel(signedAt), font, fontSize, textWidth);
    const iconSize = Math.max(8, fontSize * 1.55);
    const dateWidth = iconSize + 4 + font.widthOfTextAtSize(timestamp, fontSize);
    const dateLeft = left + Math.max(inset, (markerWidth - dateWidth) / 2);
    drawCalendarIcon(page, {
      x: dateLeft,
      y: bottom + 4,
      size: iconSize,
      color: captionColor,
    });
    page.drawText(timestamp, {
      x: dateLeft + iconSize + 4,
      y: bottom + 5,
      size: fontSize,
      font,
      color: captionColor,
    });
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
