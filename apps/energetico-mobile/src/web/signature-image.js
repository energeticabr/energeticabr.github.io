const MIN_SIGNATURE_LONG_SIDE = 1200;
const MAX_SIGNATURE_LONG_SIDE = 2400;
const SIGNATURE_STROKE_WEIGHT = 1.15;

export function renderSignatureStrokes(context, strokes, {
  sourceWidth,
  sourceHeight,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  color = "#000000",
} = {}) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const outputScale = Math.max(0.01, Number(scale) || 1);
  if (!context || !Array.isArray(strokes)) return false;

  const x = point => ((Number(point?.x) * width) - offsetX) * outputScale;
  const y = point => ((Number(point?.y) * height) - offsetY) * outputScale;
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(5, width / 125) * SIGNATURE_STROKE_WEIGHT * outputScale;

  let rendered = false;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length) continue;
    rendered = true;
    if (stroke.length === 1) {
      context.beginPath();
      context.arc(x(stroke[0]), y(stroke[0]), context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(x(stroke[0]), y(stroke[0]));
    for (const point of stroke.slice(1)) context.lineTo(x(point), y(point));
    context.stroke();
  }
  return rendered;
}

export function normalizeSignaturePixels(pixels, width, height) {
  const data = pixels instanceof Uint8ClampedArray ? pixels : pixels?.data;
  const imageWidth = Math.max(0, Number(width) || 0);
  const imageHeight = Math.max(0, Number(height) || 0);
  if (!data || !imageWidth || !imageHeight) return null;

  let left = imageWidth;
  let top = imageHeight;
  let right = -1;
  let bottom = -1;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    const nearWhite = data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245;
    if (!alpha || nearWhite) {
      data[offset + 3] = 0;
      continue;
    }

    // Keep the original alpha so the anti-aliased edge stays smooth, but
    // normalize the ink itself to a strong neutral black in every PDF path.
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    const index = offset / 4;
    const x = index % imageWidth;
    const y = Math.floor(index / imageWidth);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  return right < left || bottom < top ? null : { left, top, right, bottom };
}

export function signatureOutputSize(width, height) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const scale = longestSide < MIN_SIGNATURE_LONG_SIDE
    ? MIN_SIGNATURE_LONG_SIDE / longestSide
    : longestSide > MAX_SIGNATURE_LONG_SIDE
    ? MAX_SIGNATURE_LONG_SIDE / longestSide
    : 1;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
  };
}
