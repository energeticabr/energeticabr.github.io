const MIN_SIGNATURE_LONG_SIDE = 1200;
const MAX_SIGNATURE_LONG_SIDE = 2400;

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
