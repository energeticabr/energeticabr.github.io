const SIGNATURE_LAYOUTS = Object.freeze({
  generic: Object.freeze({ widthRatio: 0.64, aspectRatio: 3, captionRatio: 0.22 }),
  payment: Object.freeze({ widthRatio: 0.54, aspectRatio: 2.1, captionRatio: 0.28 }),
  epi: Object.freeze({ widthRatio: 0.42, aspectRatio: 2.1, captionRatio: 0.28 }),
});

function normalizedDocumentName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

export function signatureDocumentLayout(value) {
  const normalized = normalizedDocumentName(value);
  if (normalized.includes("COMPROVANTEPAGAMENTO") || normalized.includes("COMPROVANTEPGTO")) return "payment";
  if (normalized.includes("ENTREGAEPI") || normalized.includes("COMPROVANTEEPI")) return "epi";
  return "";
}

export function signatureLayoutGeometry(layout, { pageWidth, pageHeight, scale = 1 } = {}) {
  const width = Math.max(1, Number(pageWidth) || 1);
  const height = Math.max(1, Number(pageHeight) || 1);
  const factor = Math.max(0.2, Math.min(2, Number(scale) || 0.5));
  const config = SIGNATURE_LAYOUTS[layout] || SIGNATURE_LAYOUTS.generic;
  const markerWidth = Math.min(
    width * config.widthRatio * factor,
    Math.max(1, width - 4),
    Math.max(1, (height - 4) * config.aspectRatio),
  );
  return {
    width: markerWidth,
    height: markerWidth / config.aspectRatio,
    widthRatio: config.widthRatio,
    aspectRatio: config.aspectRatio,
    captionRatio: config.captionRatio,
  };
}

export function constrainSignaturePoint(point, { layout = "", pageWidth, pageHeight, scale = 1 } = {}) {
  const width = Math.max(1, Number(pageWidth) || 1);
  const height = Math.max(1, Number(pageHeight) || 1);
  const geometry = signatureLayoutGeometry(layout, { pageWidth: width, pageHeight: height, scale });
  const halfX = geometry.width / (2 * width);
  const halfY = geometry.height / (2 * height);
  const rawX = Number(point?.x);
  const rawY = Number(point?.y);
  return {
    x: Math.max(halfX, Math.min(1 - halfX, Number.isFinite(rawX) ? rawX : 0.5)),
    y: Math.max(halfY, Math.min(1 - halfY, Number.isFinite(rawY) ? rawY : 0.5)),
  };
}
