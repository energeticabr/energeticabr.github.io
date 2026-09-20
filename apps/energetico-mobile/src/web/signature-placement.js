import { loadBernardoStamp } from "./signature-stamp.js";

const MAX_CANVAS_PIXELS = 2_000_000;
const MAX_CANVAS_SIDE = 4096;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const DEFAULT_SIGNATURE_SCALE = 0.5;
const MIN_SIGNATURE_SCALE = 0.2;
const MAX_SIGNATURE_SCALE = 2;
const MIN_STAMP_SCALE = 0.2;
const MAX_STAMP_SCALE = 2;
const DEFAULT_STAMP_SCALE = 0.5;

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function boundedScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SIGNATURE_SCALE;
  return Math.max(MIN_SIGNATURE_SCALE, Math.min(MAX_SIGNATURE_SCALE, number));
}

function boundedStampScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_STAMP_SCALE;
  return Math.max(MIN_STAMP_SCALE, Math.min(MAX_STAMP_SCALE, number));
}

function pageNumber(value, total) {
  const number = Number(value);
  if (!Number.isInteger(number)) return 1;
  return Math.max(1, Math.min(total, number));
}

// SIGNATURE_GESTURE_LOCK_START: signature-placement-coordinates
function pointFromEvent(canvas, event = {}, preferredTouchIdentifier = null) {
  const rect = canvas?.getBoundingClientRect?.() || {};
  const width = Math.max(1, Number(rect.width) || Number(canvas?.clientWidth) || Number(canvas?.width) || 1);
  const height = Math.max(1, Number(rect.height) || Number(canvas?.clientHeight) || Number(canvas?.height) || 1);
  const touchCandidates = [
    ...Array.from(event?.changedTouches || []),
    ...Array.from(event?.touches || []),
  ];
  const touch = preferredTouchIdentifier != null
    ? touchCandidates.find(candidate => candidate?.identifier === preferredTouchIdentifier) || null
    : touchCandidates[0] || null;
  const source = touch || event;
  const view = canvas?.ownerDocument?.defaultView;
  const scrollX = Number(view?.scrollX) || 0;
  const scrollY = Number(view?.scrollY) || 0;
  const clientX = Number(source?.clientX);
  const clientY = Number(source?.clientY);
  const pageX = Number(source?.pageX);
  const pageY = Number(source?.pageY);
  const offsetX = Number(source?.offsetX);
  const offsetY = Number(source?.offsetY);
  let localX;
  let localY;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    localX = clientX - Number(rect.left || 0);
    localY = clientY - Number(rect.top || 0);
  } else if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
    localX = pageX - scrollX - Number(rect.left || 0);
    localY = pageY - scrollY - Number(rect.top || 0);
  } else if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
    localX = offsetX;
    localY = offsetY;
  } else {
    // WKWebView can emit an empty pointermove while handing the same finger
    // to the touch stream. Snapping that event to the center used to steal
    // the drag before the first real coordinate arrived.
    return null;
  }
  return {
    x: bounded(localX / width),
    y: bounded(1 - (localY / height)),
  };
}
// SIGNATURE_GESTURE_LOCK_END: signature-placement-coordinates

function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signatureDateLabel(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(value);
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(parsed);
  }
  return String(value);
}

async function loadLocalPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * Renders every PDF page in one vertical, scrollable column. The signature
 * marker belongs to one selected page and can be moved by tapping or dragging.
 * Coordinates are normalized to the selected page, with y measured from the
 * lower-left so the same point can be applied safely by the PDF generator.
 */
export function createSignaturePlacement({
  documentBlob,
  signatureBlob,
  container,
  documentRef = globalThis.document,
  urlApi = globalThis.URL,
  selection = null,
  loadPdfJs = loadLocalPdfJs,
  onPoint = () => {},
  onScale = () => {},
  onSelection = () => {},
  signerName = "USUÁRIO",
  signedAt = null,
  stampBlob = null,
  stampSelection = null,
  loadStampBlob = loadBernardoStamp,
  onStamp = () => {},
  onStampError = () => {},
  signal,
} = {}) {
  if (!container?.append || !documentRef?.createElement) throw new TypeError("Contêiner de posicionamento inválido.");
  const root = element(documentRef, "section", "signature-placement-pdf");
  root.setAttribute("aria-label", "Prévia do documento para posicionar a assinatura");
  root.setAttribute("aria-busy", "true");
  const viewport = element(documentRef, "div", "signature-placement-viewport");
  viewport.setAttribute("aria-label", "Páginas do PDF; toque ou arraste a assinatura");
  root.append(viewport);
  const loadingMessage = () => {
    const message = element(documentRef, "p", "signature-placement-pdf-loading", "Carregando as páginas do documento…");
    message.setAttribute("role", "status");
    return message;
  };
  viewport.append(loadingMessage());
  container.append(root);

  let destroyed = false;
  let loadingTask = null;
  let pdf = null;
  let renderTask = null;
  let renderGeneration = 0;
  let selectedPage = 1;
  let point = selection && Number.isFinite(Number(selection.x)) && Number.isFinite(Number(selection.y))
    ? { page: Number(selection.page) || 1, x: bounded(selection.x), y: bounded(selection.y) }
    : null;
  let signatureScale = boundedScale(selection?.scale);
  let signatureUrl = "";
  let activeCanvas = null;
  let activeMarker = null;
  let bernardoStampBlob = stampBlob;
  let bernardoStampUrl = "";
  let stampPoint = stampSelection && Number.isFinite(Number(stampSelection.x))
    && Number.isFinite(Number(stampSelection.y))
    ? {
      page: Number(stampSelection.page) || 1,
      x: bounded(stampSelection.x),
      y: bounded(stampSelection.y),
    }
    : null;
  let stampScale = boundedStampScale(stampSelection?.scale);
  let activeStampCanvas = null;
  let activeStampMarker = null;
  let stampDragging = false;
  let stampPointerId = null;
  let stampPointerType = null;
  let stampTouchIdentifier = null;
  let stampAnchorPoint = null;
  let stampMoveFamily = null;
  let stampDragListenersAttached = false;
  let stampListener = onStamp;
  let stampErrorListener = onStampError;
  // SIGNATURE_GESTURE_LOCK_START: signature-placement-gesture-state
  let dragging = false;
  let dragPointerId = null;
  let dragPointerType = null;
  let dragTouchIdentifier = null;
  let dragAnchorPoint = null;
  let dragMoveFamily = null;
  let dragListenersAttached = false;
  // SIGNATURE_GESTURE_LOCK_END: signature-placement-gesture-state
  let selectedTarget = "user";
  let pinchTarget = null;
  let pinchPointerFamily = null;
  let pinchPointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartScale = 0;
  let pinching = false;
  let pinchListenersAttached = false;
  const pages = new Map();

  function removeMarker() {
    activeMarker?.remove?.();
    activeMarker = null;
    activeCanvas = null;
  }

  function markerPoint() {
    if (point && point.page === selectedPage) return point;
    return { x: 0.5, y: 0.14 };
  }

  function updateMarker(nextPoint, { emit = true } = {}) {
    const local = nextPoint ? { x: bounded(nextPoint.x), y: bounded(nextPoint.y) } : markerPoint();
    if (activeMarker) {
      activeMarker.hidden = false;
      activeMarker.style.left = `${local.x * 100}%`;
      activeMarker.style.bottom = `${local.y * 100}%`;
      activeMarker.style.setProperty("--signature-scale", String(signatureScale));
    }
    if (emit) {
      point = { page: selectedPage, ...local };
      onPoint({ ...point });
    }
  }

  function resizeSignature(delta) {
    if (destroyed) return signatureScale;
    selectSignatureTarget("user");
    return resizeSelected(delta);
  }

  function clearPages() {
    renderTask?.cancel?.();
    renderTask = null;
    removeMarker();
    for (const entry of pages.values()) {
      entry.canvas.width = entry.canvas.height = 0;
    }
    pages.clear();
    viewport.replaceChildren();
  }

  // SIGNATURE_GESTURE_LOCK_START: signature-placement-event-arbitration
  function eventPointerKey(event) {
    if (event?.pointerId != null) return `pointer:${event.pointerId}`;
    if (String(event?.type || "").startsWith("touch")) {
      const touch = event.changedTouches?.[0] || event.touches?.[0];
      if (touch?.identifier != null) return `touch:${touch.identifier}`;
      return "touch";
    }
    return "mouse";
  }

  function eventPointerType(event) {
    if (event?.pointerType) return String(event.pointerType).toLowerCase();
    if (/^touch/i.test(String(event?.type || ""))) return "touch";
    return "mouse";
  }

  function eventTouchIdentifier(event) {
    const touch = event?.changedTouches?.[0] || event?.touches?.[0];
    return touch?.identifier != null ? touch.identifier : null;
  }

  function eventTouches(event, property) {
    return Array.from(event?.[property] || []);
  }

  function nearestTouch(touches, anchor) {
    if (!touches.length) return null;
    if (!anchor || !Number.isFinite(anchor.clientX) || !Number.isFinite(anchor.clientY)) {
      return touches.length === 1 ? touches[0] : null;
    }
    return touches.reduce((nearest, touch) => {
      const distance = ((Number(touch?.clientX) || 0) - anchor.clientX) ** 2
        + ((Number(touch?.clientY) || 0) - anchor.clientY) ** 2;
      return !nearest || distance < nearest.distance ? { touch, distance } : nearest;
    }, null)?.touch || null;
  }

  /*
   * CODEX: NÃO EDITE NEM "SIMPLIFIQUE" NOVAMENTE ESTA ARBITRAGEM DE GESTOS.
   * Uma correção anterior feita pelo próprio Codex tratou pointer e touch do
   * iPhone como dedos diferentes e quebrou o arraste da assinatura, deixando
   * apenas o clique funcionar. O WKWebView pode alternar nos dois sentidos:
   * pointerdown → touchmove ou touchstart → pointermove. Não volte a exigir
   * que início e movimento pertençam à mesma família de eventos.
   */
  function matchesDragPointer(event) {
    if (dragPointerId == null || eventPointerKey(event) === dragPointerId) return true;
    if (dragPointerType !== "touch" || eventPointerType(event) !== "touch") return false;
    if (event?.pointerId != null) return event?.isPrimary !== false;
    const activeTouches = eventTouches(event, "touches");
    const changedTouches = eventTouches(event, "changedTouches");
    if (dragTouchIdentifier == null) {
      const eventType = String(event?.type || "");
      const changedIds = new Set(changedTouches.map(touch => touch?.identifier));
      const existingTouches = /^touchstart$/i.test(eventType)
        ? activeTouches.filter(touch => !changedIds.has(touch?.identifier))
        : activeTouches;
      const candidates = /^touch(?:end|cancel)$/i.test(eventType)
        ? [...changedTouches, ...activeTouches]
        : existingTouches;
      const candidate = nearestTouch(candidates, dragAnchorPoint)
        || (activeTouches.length === 0 && changedTouches.length === 1 ? changedTouches[0] : null);
      if (candidate?.identifier != null) dragTouchIdentifier = candidate.identifier;
    }
    if (dragTouchIdentifier == null) return false;
    if (changedTouches.length) {
      return changedTouches.some(touch => touch?.identifier === dragTouchIdentifier);
    }
    return activeTouches.some(touch => touch?.identifier === dragTouchIdentifier);
  }

  function removeDragListeners() {
    if (!dragListenersAttached) return;
    const target = documentRef;
    target?.removeEventListener?.("pointermove", moveDrag);
    target?.removeEventListener?.("pointerup", releaseDrag);
    target?.removeEventListener?.("pointercancel", releaseDrag);
    target?.removeEventListener?.("touchmove", moveDrag);
    target?.removeEventListener?.("touchend", releaseDrag);
    target?.removeEventListener?.("touchcancel", releaseDrag);
    target?.removeEventListener?.("mousemove", moveDrag);
    target?.removeEventListener?.("mouseup", releaseDrag);
    dragListenersAttached = false;
  }

  function finishDrag(event = {}) {
    dragging = false;
    dragPointerId = null;
    dragPointerType = null;
    dragTouchIdentifier = null;
    dragAnchorPoint = null;
    dragMoveFamily = null;
    if (event?.pointerId != null && activeMarker) {
      try { activeMarker.releasePointerCapture?.(event.pointerId); } catch { /* optional */ }
    }
    removeDragListeners();
  }

  function releaseDrag(event = {}) {
    if (!dragging || !matchesDragPointer(event)) return;
    finishDrag(event);
  }

  function moveDrag(event) {
    if (!dragging || destroyed || !matchesDragPointer(event)) return;
    const nextPoint = pointFromEvent(activeCanvas, event, dragTouchIdentifier);
    if (!nextPoint) return;
    const eventType = String(event?.type || "").toLowerCase();
    const moveFamily = eventType.startsWith("touch")
      ? "touch"
      : eventType.startsWith("pointer") ? "pointer" : "mouse";
    if (dragMoveFamily && dragMoveFamily !== moveFamily) return;
    dragMoveFamily ||= moveFamily;
    event.preventDefault?.();
    updateMarker(nextPoint);
  }

  function attachDragListeners() {
    if (dragListenersAttached || !documentRef?.addEventListener) return;
    documentRef.addEventListener("pointermove", moveDrag, { passive: false });
    documentRef.addEventListener("pointerup", releaseDrag);
    documentRef.addEventListener("pointercancel", releaseDrag);
    documentRef.addEventListener("touchmove", moveDrag, { passive: false });
    documentRef.addEventListener("touchend", releaseDrag, { passive: false });
    documentRef.addEventListener("touchcancel", releaseDrag, { passive: false });
    documentRef.addEventListener("mousemove", moveDrag, { passive: false });
    documentRef.addEventListener("mouseup", releaseDrag);
    dragListenersAttached = true;
  }

  function beginDrag(marker, event = {}) {
    if (destroyed || activeMarker !== marker || event?.isPrimary === false) return;
    if (dragging) {
      matchesDragPointer(event);
      return;
    }
    const isMouse = event?.pointerType === "mouse"
      || event?.type === "mousedown"
      || (!event?.pointerType && event?.button != null);
    if (isMouse && event.button !== 0) return;
    dragging = true;
    dragPointerId = eventPointerKey(event);
    dragPointerType = eventPointerType(event);
    dragTouchIdentifier = dragPointerType === "touch" ? eventTouchIdentifier(event) : null;
    const source = event?.changedTouches?.[0] || event?.touches?.[0] || event;
    dragAnchorPoint = {
      clientX: Number(source?.clientX),
      clientY: Number(source?.clientY),
    };
    dragMoveFamily = null;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event?.pointerId != null) {
      try { marker.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    }
    attachDragListeners();
  }
  // SIGNATURE_GESTURE_LOCK_END: signature-placement-event-arbitration

  function removeStampDragListeners() {
    if (!stampDragListenersAttached) return;
    documentRef?.removeEventListener?.("pointermove", moveStampDrag);
    documentRef?.removeEventListener?.("pointerup", releaseStampDrag);
    documentRef?.removeEventListener?.("pointercancel", releaseStampDrag);
    documentRef?.removeEventListener?.("touchmove", moveStampDrag);
    documentRef?.removeEventListener?.("touchend", releaseStampDrag);
    documentRef?.removeEventListener?.("touchcancel", releaseStampDrag);
    documentRef?.removeEventListener?.("mousemove", moveStampDrag);
    documentRef?.removeEventListener?.("mouseup", releaseStampDrag);
    stampDragListenersAttached = false;
  }

  function finishStampDrag(event = {}) {
    stampDragging = false;
    stampPointerId = null;
    stampPointerType = null;
    stampTouchIdentifier = null;
    stampAnchorPoint = null;
    stampMoveFamily = null;
    if (event?.pointerId != null && activeStampMarker) {
      try { activeStampMarker.releasePointerCapture?.(event.pointerId); } catch { /* optional */ }
    }
    removeStampDragListeners();
  }

  function matchesStampPointer(event) {
    if (!stampDragging) return false;
    if (stampPointerId == null || eventPointerKey(event) === stampPointerId) return true;
    if (stampPointerType !== "touch" || eventPointerType(event) !== "touch") return false;
    if (event?.pointerId != null) return event?.isPrimary !== false;
    const activeTouches = eventTouches(event, "touches");
    const changedTouches = eventTouches(event, "changedTouches");
    if (stampTouchIdentifier == null) {
      const eventType = String(event?.type || "");
      const changedIds = new Set(changedTouches.map(touch => touch?.identifier));
      const existingTouches = /^touchstart$/i.test(eventType)
        ? activeTouches.filter(touch => !changedIds.has(touch?.identifier))
        : activeTouches;
      const candidates = /^touch(?:end|cancel)$/i.test(eventType)
        ? [...changedTouches, ...activeTouches]
        : existingTouches;
      const candidate = nearestTouch(candidates, stampAnchorPoint)
        || (activeTouches.length === 0 && changedTouches.length === 1 ? changedTouches[0] : null);
      if (candidate?.identifier != null) stampTouchIdentifier = candidate.identifier;
    }
    if (stampTouchIdentifier == null) return false;
    if (changedTouches.length) return changedTouches.some(touch => touch?.identifier === stampTouchIdentifier);
    return activeTouches.some(touch => touch?.identifier === stampTouchIdentifier);
  }

  function updateStampMarker(nextPoint, { emit = false } = {}) {
    if (!stampPoint && !nextPoint) return;
    const local = nextPoint
      ? { x: bounded(nextPoint.x), y: bounded(nextPoint.y) }
      : { x: stampPoint?.x ?? 0.5, y: stampPoint?.y ?? 0.28 };
    stampPoint = {
      page: Number(nextPoint?.page || stampPoint?.page || selectedPage) || selectedPage,
      ...local,
    };
    if (activeStampMarker) {
      activeStampMarker.hidden = false;
      activeStampMarker.style.left = `${stampPoint.x * 100}%`;
      activeStampMarker.style.bottom = `${stampPoint.y * 100}%`;
      activeStampMarker.style.setProperty("--stamp-scale", String(stampScale));
    }
    if (emit) notifyStamp();
  }

  function notifyStamp() {
    if (bernardoStampBlob && stampPoint) stampListener({ blob: bernardoStampBlob, point: getStampPoint() });
  }

  function getScale(target = "user") {
    return target === "bernardo" ? stampScale : signatureScale;
  }

  function selectSignatureTarget(target = "user") {
    selectedTarget = target === "bernardo" ? "bernardo" : "user";
    onSelection({ target: selectedTarget, scale: getScale(selectedTarget) });
    return selectedTarget;
  }

  function applyScale(target, value) {
    if (target === "bernardo") {
      stampScale = boundedStampScale(value);
      activeStampMarker?.style?.setProperty("--stamp-scale", String(stampScale));
      notifyStamp();
      return stampScale;
    }
    signatureScale = boundedScale(value);
    activeMarker?.style?.setProperty("--signature-scale", String(signatureScale));
    onScale(signatureScale, "user");
    return signatureScale;
  }

  function resizeSelected(delta) {
    if (destroyed) return getScale(selectedTarget);
    const target = selectedTarget;
    return applyScale(target, getScale(target) + Number(delta || 0));
  }

  function eventClientPosition(event = {}) {
    const source = event?.pointerId != null
      ? event
      : event?.changedTouches?.[0] || event?.touches?.[0] || event;
    const clientX = Number(source?.clientX);
    const clientY = Number(source?.clientY);
    return Number.isFinite(clientX) && Number.isFinite(clientY)
      ? { clientX, clientY }
      : null;
  }

  function pinchDistance() {
    const points = [...pinchPointers.values()].slice(0, 2);
    if (points.length < 2) return 0;
    return Math.hypot(points[1].clientX - points[0].clientX, points[1].clientY - points[0].clientY);
  }

  function removePinchListeners() {
    if (!pinchListenersAttached) return;
    documentRef?.removeEventListener?.("pointermove", movePinch);
    documentRef?.removeEventListener?.("pointerup", releasePinchPointer);
    documentRef?.removeEventListener?.("pointercancel", releasePinchPointer);
    documentRef?.removeEventListener?.("touchmove", movePinch);
    documentRef?.removeEventListener?.("touchend", releasePinchPointer);
    documentRef?.removeEventListener?.("touchcancel", releasePinchPointer);
    pinchListenersAttached = false;
  }

  function resetPinch() {
    removePinchListeners();
    pinchTarget = null;
    pinchPointerFamily = null;
    pinchPointers = new Map();
    pinchStartDistance = 0;
    pinchStartScale = 0;
    pinching = false;
  }

  function finishPinch() {
    resetPinch();
  }

  function attachPinchListeners() {
    if (pinchListenersAttached || !documentRef?.addEventListener) return;
    documentRef.addEventListener("pointermove", movePinch, { passive: false });
    documentRef.addEventListener("pointerup", releasePinchPointer);
    documentRef.addEventListener("pointercancel", releasePinchPointer);
    documentRef.addEventListener("touchmove", movePinch, { passive: false });
    documentRef.addEventListener("touchend", releasePinchPointer, { passive: false });
    documentRef.addEventListener("touchcancel", releasePinchPointer, { passive: false });
    pinchListenersAttached = true;
  }

  function movePinch(event = {}) {
    if (destroyed || !pinchPointerFamily || eventPointerType(event) === "mouse") return;
    const family = event?.pointerId != null ? "pointer" : "touch";
    if (family !== pinchPointerFamily) return;
    if (family === "pointer") {
      const key = eventPointerKey(event);
      if (pinchPointers.has(key)) {
        const position = eventClientPosition(event);
        if (position) pinchPointers.set(key, position);
      }
    } else {
      for (const touch of eventTouches(event, "touches")) {
        const key = `touch:${touch?.identifier}`;
        if (pinchPointers.has(key)) {
          pinchPointers.set(key, { clientX: Number(touch.clientX), clientY: Number(touch.clientY) });
        }
      }
    }
    if (!pinching || pinchPointers.size < 2) return;
    const distance = pinchDistance();
    if (!(distance > 0) || !(pinchStartDistance > 0)) return;
    event.preventDefault?.();
    applyScale(pinchTarget, pinchStartScale * (distance / pinchStartDistance));
  }

  function releasePinchPointer(event = {}) {
    if (!pinchPointerFamily) return;
    const family = event?.pointerId != null ? "pointer" : "touch";
    if (family !== pinchPointerFamily) return;
    if (family === "pointer") {
      pinchPointers.delete(eventPointerKey(event));
    } else {
      for (const touch of eventTouches(event, "changedTouches")) pinchPointers.delete(`touch:${touch?.identifier}`);
    }
    if (!pinching || pinchPointers.size < 2) finishPinch();
  }

  function prepareSignatureInteraction(target, event = {}) {
    if (destroyed) return;
    selectSignatureTarget(target);
    if (eventPointerType(event) !== "touch") return;
    const family = event?.pointerId != null ? "pointer" : "touch";
    if (pinchPointerFamily && pinchPointerFamily !== family) return;
    const position = eventClientPosition(event);
    if (!position) return;
    if (pinchTarget && pinchTarget !== target) return;
    pinchPointerFamily ||= family;
    pinchTarget ||= target;
    pinchPointers.set(eventPointerKey(event), position);
    attachPinchListeners();
    if (pinchPointers.size < 2 || pinching) return;
    const distance = pinchDistance();
    if (!(distance > 0)) {
      resetPinch();
      return;
    }
    pinchStartDistance = distance;
    pinchStartScale = getScale(target);
    pinching = true;
    if (dragging) finishDrag();
    if (stampDragging) finishStampDrag();
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function moveStampDrag(event) {
    if (!stampDragging || destroyed || !matchesStampPointer(event)) return;
    const nextPoint = pointFromEvent(activeStampCanvas, event, stampTouchIdentifier);
    if (!nextPoint) return;
    const eventType = String(event?.type || "").toLowerCase();
    const moveFamily = eventType.startsWith("touch")
      ? "touch"
      : eventType.startsWith("pointer") ? "pointer" : "mouse";
    if (stampMoveFamily && stampMoveFamily !== moveFamily) return;
    stampMoveFamily ||= moveFamily;
    event.preventDefault?.();
    updateStampMarker({ page: stampPoint?.page || selectedPage, ...nextPoint }, { emit: true });
  }

  function releaseStampDrag(event = {}) {
    if (!stampDragging || !matchesStampPointer(event)) return;
    finishStampDrag(event);
  }

  function attachStampDragListeners() {
    if (stampDragListenersAttached || !documentRef?.addEventListener) return;
    documentRef.addEventListener("pointermove", moveStampDrag, { passive: false });
    documentRef.addEventListener("pointerup", releaseStampDrag);
    documentRef.addEventListener("pointercancel", releaseStampDrag);
    documentRef.addEventListener("touchmove", moveStampDrag, { passive: false });
    documentRef.addEventListener("touchend", releaseStampDrag, { passive: false });
    documentRef.addEventListener("touchcancel", releaseStampDrag, { passive: false });
    documentRef.addEventListener("mousemove", moveStampDrag, { passive: false });
    documentRef.addEventListener("mouseup", releaseStampDrag);
    stampDragListenersAttached = true;
  }

  function beginStampDrag(marker, event = {}) {
    if (destroyed || activeStampMarker !== marker || event?.isPrimary === false) return;
    if (stampDragging) {
      matchesStampPointer(event);
      return;
    }
    const isMouse = event?.pointerType === "mouse"
      || event?.type === "mousedown"
      || (!event?.pointerType && event?.button != null);
    if (isMouse && event.button !== 0) return;
    stampDragging = true;
    stampPointerId = eventPointerKey(event);
    stampPointerType = eventPointerType(event);
    stampTouchIdentifier = stampPointerType === "touch" ? eventTouchIdentifier(event) : null;
    const source = event?.changedTouches?.[0] || event?.touches?.[0] || event;
    stampAnchorPoint = { clientX: Number(source?.clientX), clientY: Number(source?.clientY) };
    stampMoveFamily = null;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (event?.pointerId != null) {
      try { marker.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    }
    attachStampDragListeners();
  }

  function addStampMarker(pageNumberValue) {
    const entry = pages.get(pageNumberValue);
    if (!entry || destroyed || !bernardoStampUrl) return;
    activeStampMarker?.remove?.();
    const marker = element(documentRef, "div", "signature-placement-stamp-marker");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", "Assinatura de Bernardo; arraste para reposicionar");
    const image = element(documentRef, "img", "signature-placement-stamp-marker__image");
    image.alt = "Assinatura de Bernardo";
    image.src = bernardoStampUrl;
    image.draggable = false;
    marker.append(image);
    marker.addEventListener("pointerdown", event => beginStampDrag(marker, event), { passive: false });
    marker.addEventListener("touchstart", event => beginStampDrag(marker, event), { passive: false });
    marker.addEventListener("mousedown", event => beginStampDrag(marker, event), { passive: false });
    marker.addEventListener("pointerdown", event => prepareSignatureInteraction("bernardo", event), {
      capture: true,
      passive: false,
    });
    marker.addEventListener("touchstart", event => prepareSignatureInteraction("bernardo", event), {
      capture: true,
      passive: false,
    });
    entry.wrapper.append(marker);
    activeStampCanvas = entry.canvas;
    activeStampMarker = marker;
    updateStampMarker(null, { emit: false });
  }

  function getStampPoint() {
    return stampPoint ? { ...stampPoint, scale: stampScale } : null;
  }

  async function addBernardoStamp(options = {}) {
    if (destroyed) return false;
    if (options?.blob) bernardoStampBlob = options.blob;
    if (options?.point && Number.isFinite(Number(options.point.x)) && Number.isFinite(Number(options.point.y))) {
      stampPoint = {
        page: Number(options.point.page) || selectedPage,
        x: bounded(options.point.x),
        y: bounded(options.point.y),
      };
      stampScale = boundedStampScale(options.point.scale);
    }
    if (!bernardoStampBlob) {
      try {
        bernardoStampBlob = await loadStampBlob();
      } catch (error) {
        stampErrorListener(error);
        throw error;
      }
    }
    if (!bernardoStampBlob || typeof bernardoStampBlob.arrayBuffer !== "function") {
      const error = new Error("A assinatura de Bernardo não está disponível.");
      stampErrorListener(error);
      throw error;
    }
    if (!bernardoStampUrl && typeof urlApi?.createObjectURL === "function") {
      bernardoStampUrl = urlApi.createObjectURL(bernardoStampBlob);
    }
    await ready;
    if (destroyed || !pdf) return false;
    if (!stampPoint) stampPoint = { page: selectedPage, x: 0.5, y: 0.28 };
    stampPoint = { ...stampPoint, page: pageNumber(stampPoint.page, pdf.numPages) };
    addStampMarker(stampPoint.page);
    updateStampMarker(stampPoint, { emit: options.notify !== false });
    return true;
  }

  function addMarker(pageNumberValue) {
    const entry = pages.get(pageNumberValue);
    if (!entry || destroyed) return;
    removeMarker();
    const marker = element(documentRef, "div", "signature-placement-marker");
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", "Assinatura; arraste para reposicionar");
    if (signatureUrl) {
      const image = element(documentRef, "img", "signature-placement-marker__image");
      image.alt = "Assinatura enviada";
      image.src = signatureUrl;
      image.draggable = false;
      marker.append(image);
    }
    const caption = element(documentRef, "div", "signature-placement-marker__caption");
    const name = String(signerName || "USUÁRIO").trim() || "USUÁRIO";
    const timestamp = signatureDateLabel(signedAt);
    const nameLine = element(documentRef, "span", "signature-placement-marker__name", `ASSINADO DIGITALMENTE POR: ${name}`);
    caption.append(nameLine);
    if (timestamp) caption.append(element(documentRef, "span", "signature-placement-marker__date", `DATA/HORA: ${timestamp}`));
    marker.append(caption);
    // SIGNATURE_GESTURE_LOCK_START: signature-placement-marker-bindings
    marker.addEventListener("pointerdown", event => beginDrag(marker, event), { passive: false });
    marker.addEventListener("touchstart", event => beginDrag(marker, event), { passive: false });
    marker.addEventListener("mousedown", event => beginDrag(marker, event), { passive: false });
    // REGRA DE REGRESSÃO: movimentos e finais pertencem somente aos listeners
    // do documento instalados por beginDrag. Recolocá-los no marcador faz o
    // mesmo evento borbulhar e ser processado duas vezes no iPhone.
    // SIGNATURE_GESTURE_LOCK_END: signature-placement-marker-bindings
    marker.addEventListener("pointerdown", event => prepareSignatureInteraction("user", event), {
      capture: true,
      passive: false,
    });
    marker.addEventListener("touchstart", event => prepareSignatureInteraction("user", event), {
      capture: true,
      passive: false,
    });
    entry.wrapper.append(marker);
    activeCanvas = entry.canvas;
    activeMarker = marker;
    updateMarker(null, { emit: false });
  }

  function selectPage(value, localPoint = null) {
    if (!pdf || destroyed) return;
    selectSignatureTarget("user");
    selectedPage = pageNumber(value, pdf.numPages);
    addMarker(selectedPage);
    const nextPoint = localPoint || (point?.page === selectedPage ? point : null);
    updateMarker(nextPoint, { emit: true });
    root.dataset.pageNumber = String(selectedPage);
  }

  function attachPageEvents(pageNumberValue, canvas) {
    canvas.addEventListener("click", event => {
      if (destroyed || dragging) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      selectPage(pageNumberValue, pointFromEvent(canvas, event));
    });
  }

  async function renderPage(pageNumberValue, generation) {
    const page = await pdf.getPage(pageNumberValue);
    if (destroyed || generation !== renderGeneration) {
      page.cleanup?.();
      return;
    }
    try {
      const natural = page.getViewport({ scale: 1 });
      if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(natural.width + natural.height))) {
        throw new Error("Dimensões de página inválidas.");
      }
      const availableWidth = Math.max(1, viewport.clientWidth
        ? viewport.clientWidth - 8 : (container.clientWidth || 360) - 24);
      const displayScale = availableWidth / natural.width;
      const outputRatio = Math.min(
        Math.max(1, Number(globalThis.devicePixelRatio) || 1), 2,
        MAX_CANVAS_SIDE / Math.max(1, displayScale * natural.width),
        MAX_CANVAS_SIDE / Math.max(1, displayScale * natural.height),
        Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, displayScale * displayScale * natural.width * natural.height)),
      );
      const displayed = page.getViewport({ scale: displayScale });
      const scaled = page.getViewport({ scale: displayScale * outputRatio });
      const wrapper = element(documentRef, "div", "signature-placement-page");
      wrapper.dataset.pageNumber = String(pageNumberValue);
      const canvas = element(documentRef, "canvas", "signature-placement-canvas");
      canvas.width = Math.max(1, Math.floor(scaled.width));
      canvas.height = Math.max(1, Math.floor(scaled.height));
      canvas.style.width = `${Math.floor(displayed.width)}px`;
      canvas.style.height = `${Math.floor(displayed.height)}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Página ${pageNumberValue} de ${pdf.numPages}`);
      wrapper.append(canvas);
      viewport.append(wrapper);
      pages.set(pageNumberValue, { wrapper, canvas });
      attachPageEvents(pageNumberValue, canvas);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("O navegador não oferece canvas para este PDF.");
      renderTask = page.render({ canvasContext: context, viewport: scaled, annotationMode: 0 });
      await renderTask.promise;
      renderTask = null;
      if (destroyed || generation !== renderGeneration) {
        canvas.width = canvas.height = 0;
        wrapper.remove();
        pages.delete(pageNumberValue);
        return;
      }
      if (selectedPage === pageNumberValue) addMarker(pageNumberValue);
    } finally {
      page.cleanup?.();
      renderTask = null;
    }
  }

  async function renderAllPages() {
    const generation = ++renderGeneration;
    clearPages();
    viewport.append(loadingMessage());
    if (!(pdf?.numPages > 0)) throw new Error("O PDF não contém páginas para exibir.");
    for (let page = 1; page <= pdf.numPages; page += 1) {
      if (destroyed || generation !== renderGeneration) return;
      await renderPage(page, generation);
    }
    if (!destroyed && generation === renderGeneration) {
      if (stampPoint && bernardoStampUrl) addStampMarker(pageNumber(stampPoint.page, pdf.numPages));
      viewport.querySelector?.(".signature-placement-pdf-loading")?.remove?.();
      root.setAttribute("aria-busy", "false");
      root.dataset.renderedPages = String(pdf.numPages);
      root.dataset.pageNumber = String(selectedPage);
    }
  }

  const ready = (async () => {
    if (destroyed) return;
    if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") throw new Error("Documento indisponível para posicionamento.");
    if (!signatureBlob || typeof signatureBlob.arrayBuffer !== "function") throw new Error("Assinatura indisponível para posicionamento.");
    if (Number(documentBlob.size) > MAX_PDF_BYTES) throw new Error("Este PDF é muito grande para a pré-visualização. Reduza o arquivo e tente novamente.");
    if (typeof urlApi?.createObjectURL === "function") signatureUrl = urlApi.createObjectURL(signatureBlob);
    const pdfjs = await loadPdfJs();
    if (destroyed) return;
    const data = new Uint8Array(await documentBlob.arrayBuffer());
    if (destroyed) return;
    if (bernardoStampBlob && !bernardoStampUrl && typeof urlApi?.createObjectURL === "function") {
      bernardoStampUrl = urlApi.createObjectURL(bernardoStampBlob);
    }
    const assetBase = new URL("pdfjs/", new URL(import.meta.env?.BASE_URL || "./", documentRef.baseURI));
    loadingTask = pdfjs.getDocument({
      data,
      ownerDocument: documentRef,
      cMapUrl: new URL("cmaps/", assetBase).href,
      standardFontDataUrl: new URL("standard_fonts/", assetBase).href,
      wasmUrl: new URL("wasm/", assetBase).href,
      iccUrl: new URL("iccs/", assetBase).href,
      cMapPacked: true,
      enableXfa: false,
      canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
    });
    pdf = await loadingTask.promise;
    if (destroyed) return;
    selectedPage = pageNumber(point?.page || 1, pdf.numPages);
    await renderAllPages();
  })();
  ready.catch(error => {
    if (destroyed) return;
    root.setAttribute("aria-busy", "false");
    root.dataset.loadError = "true";
    viewport.replaceChildren(element(
      documentRef,
      "p",
      "signature-placement-pdf-error",
      error?.message || "Não foi possível abrir este PDF.",
    ));
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (dragging) finishDrag();
    if (stampDragging) finishStampDrag();
    if (pinchListenersAttached) finishPinch();
    renderGeneration += 1;
    signal?.removeEventListener?.("abort", destroy);
    clearPages();
    activeStampMarker?.remove?.();
    activeStampMarker = null;
    activeStampCanvas = null;
    root.remove();
    if (loadingTask) Promise.resolve(loadingTask.destroy?.()).catch(() => {});
    if (signatureUrl) urlApi?.revokeObjectURL?.(signatureUrl);
    if (bernardoStampUrl) urlApi?.revokeObjectURL?.(bernardoStampUrl);
    pdf = null;
  }

  signal?.addEventListener?.("abort", destroy, { once: true });
  if (signal?.aborted) destroy();
  return Object.freeze({
    ready,
    destroy,
    getPoint: () => (point ? { ...point } : null),
    addBernardoStamp,
    hasStamp: () => Boolean(bernardoStampBlob && stampPoint),
    setStampListener: ({ onStamp: nextOnStamp, onStampError: nextOnStampError } = {}) => {
      stampListener = typeof nextOnStamp === "function" ? nextOnStamp : () => {};
      stampErrorListener = typeof nextOnStampError === "function" ? nextOnStampError : () => {};
    },
    getStamp: () => bernardoStampBlob && stampPoint
      ? { blob: bernardoStampBlob, point: getStampPoint() }
      : null,
    getSelectedTarget: () => selectedTarget,
    selectSignatureTarget,
    resizeSelected,
    resizeSignature,
    getScale,
    getSummary: () => pdf ? `${pdf.numPages === 1 ? "1 página" : `${pdf.numPages} páginas`} • ${documentBlob.size} bytes` : "",
  });
}
