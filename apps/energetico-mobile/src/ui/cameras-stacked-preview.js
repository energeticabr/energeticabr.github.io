const STACKED_ASPECT = 8 / 9;
const MIN_LENS_WIDTH = 0.75;
const MAX_PREVIEW_WIDTH = 960;
const FRAME_INTERVAL = 60;

function splitLayout(width, height, tileWidth, tileHeight, pixelRatio) {
  if (!width || !height || !tileWidth || !tileHeight) return null;
  const originalAspect = width / height;
  // Two 16:9 views in a single stream have an 8:9 aspect ratio.
  if (Math.abs(originalAspect - STACKED_ASPECT) > 0.015) return null;

  const tileAspect = tileWidth / tileHeight;
  const lensHeight = height / 2;
  const cropWidth = Math.max(width * MIN_LENS_WIDTH, Math.min(width, tileAspect * lensHeight / 2));
  const splitAspect = 2 * cropWidth / lensHeight;
  const originalCoverage = Math.min(tileAspect / originalAspect, originalAspect / tileAspect);
  const splitCoverage = Math.min(tileAspect / splitAspect, splitAspect / tileAspect);
  if (splitCoverage < originalCoverage * 1.08) return null;

  const outputWidth = Math.max(1, Math.floor(Math.min(cropWidth, MAX_PREVIEW_WIDTH / 2, tileWidth * pixelRatio / 2)));
  return {
    cropLeft: (width - cropWidth) / 2, cropWidth, lensHeight,
    outputWidth, outputHeight: Math.max(1, Math.round(outputWidth * lensHeight / cropWidth)),
  };
}

export function bindStackedCameraPreview(tile, video, savedFrame, savedImage) {
  const documentRef = tile.ownerDocument;
  const windowRef = documentRef.defaultView;
  if (!windowRef.ResizeObserver || !video.requestVideoFrameCallback || !video.cancelVideoFrameCallback) return null;

  let enabled = true;
  let canvas, context;
  let pendingFrame = null;

  function cancelFrame() {
    if (pendingFrame !== null) video.cancelVideoFrameCallback(pendingFrame);
    pendingFrame = null;
  }

  function refresh() {
    cancelFrame();
    const usingSavedImage = !savedFrame.hidden;
    const width = usingSavedImage ? savedImage.naturalWidth : video.videoWidth;
    const height = usingSavedImage ? savedImage.naturalHeight : video.videoHeight;
    const ready = usingSavedImage ? savedImage.complete : video.readyState >= 2;
    const layout = enabled && ready
      ? splitLayout(width, height, tile.clientWidth, tile.clientHeight, windowRef.devicePixelRatio || 1) : null;
    if (!layout) {
      if (canvas) canvas.hidden = true;
      return;
    }
    if (!canvas) {
      canvas = documentRef.createElement('canvas');
      canvas.className = 'cameras-player__stacked-preview';
      canvas.hidden = true;
      canvas.setAttribute('aria-hidden', 'true');
      context = canvas.getContext('2d', { alpha: false });
      tile.append(canvas);
    }
    if (!context) return;

    const { cropLeft, cropWidth, lensHeight, outputWidth, outputHeight } = layout;
    if (canvas.width !== outputWidth * 2) canvas.width = outputWidth * 2;
    if (canvas.height !== outputHeight) canvas.height = outputHeight;
    const source = usingSavedImage ? savedImage : video;
    function draw() {
      try {
        context.drawImage(source, cropLeft, 0, cropWidth, lensHeight, 0, 0, outputWidth, outputHeight);
        context.drawImage(source, cropLeft, lensHeight, cropWidth, lensHeight, outputWidth, 0, outputWidth, outputHeight);
        canvas.hidden = false;
        return true;
      } catch {
        canvas.hidden = true;
        return false;
      }
    }
    if (!draw() || usingSavedImage || video.paused) return;

    let previousFrameAt = -Infinity;
    function nextFrame(now) {
      pendingFrame = null;
      if (now - previousFrameAt >= FRAME_INTERVAL) {
        if (!draw()) return;
        previousFrameAt = now;
      }
      pendingFrame = video.requestVideoFrameCallback(nextFrame);
    }
    pendingFrame = video.requestVideoFrameCallback(nextFrame);
  }

  const mediaEvents = ['loadeddata', 'playing', 'pause', 'resize', 'emptied'];
  for (const event of mediaEvents) video.addEventListener(event, refresh);
  savedImage.addEventListener('load', refresh);
  const observer = new windowRef.ResizeObserver(refresh);
  observer.observe(tile);
  return {
    refresh,
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      refresh();
    },
    destroy() {
      cancelFrame();
      observer.disconnect();
      for (const event of mediaEvents) video.removeEventListener(event, refresh);
      savedImage.removeEventListener('load', refresh);
      canvas?.remove();
    },
  };
}
