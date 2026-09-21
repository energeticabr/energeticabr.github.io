const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function eventFamily(event) {
  return event?.pointerId != null ? "pointer" : /^touch/i.test(String(event?.type || "")) ? "touch" : "mouse";
}

function eventKey(event, family = eventFamily(event)) {
  if (family === "pointer") return `pointer:${event.pointerId}`;
  const touch = event?.changedTouches?.[0] || event?.touches?.[0];
  return `touch:${touch?.identifier}`;
}

function eventPoints(event, family = eventFamily(event)) {
  if (family === "pointer") {
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    return Number.isFinite(clientX) && Number.isFinite(clientY) ? [{ clientX, clientY }] : [];
  }
  return Array.from(event?.touches || [])
    .map(touch => ({
      key: `touch:${touch?.identifier}`,
      clientX: Number(touch?.clientX),
      clientY: Number(touch?.clientY),
    }))
    .filter(point => Number.isFinite(point.clientX) && Number.isFinite(point.clientY));
}

function distance(points) {
  if (points.length < 2) return 0;
  return Math.hypot(points[1].clientX - points[0].clientX, points[1].clientY - points[0].clientY);
}

function midpoint(points) {
  if (points.length < 2) return { clientX: 0, clientY: 0 };
  return {
    clientX: (points[0].clientX + points[1].clientX) / 2,
    clientY: (points[0].clientY + points[1].clientY) / 2,
  };
}

export function createPinchZoom({
  element,
  documentRef = globalThis.document,
  initialZoom = MIN_ZOOM,
  onZoom = () => {},
} = {}) {
  if (!element?.addEventListener) return Object.freeze({ destroy() {}, getZoom: () => MIN_ZOOM });

  let zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(initialZoom) || MIN_ZOOM));
  let family = null;
  let pointers = new Map();
  let startDistance = 0;
  let startZoom = zoom;
  let pinching = false;
  let pinchSequenceActive = false;
  let destroyed = false;

  function updateZoom(next, event) {
    const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(next) || MIN_ZOOM));
    if (bounded === zoom) return;
    const previousZoom = zoom;
    zoom = bounded;
    onZoom(zoom, {
      previousZoom,
      midpoint: midpoint([...pointers.values()]),
      ratio: zoom / previousZoom,
      event,
    });
  }

  function reset() {
    family = null;
    pointers = new Map();
    startDistance = 0;
    startZoom = zoom;
    pinching = false;
    pinchSequenceActive = false;
  }

  function begin(event) {
    if (destroyed) return;
    const type = String(event?.pointerType || (/^touch/i.test(String(event?.type || "")) ? "touch" : "mouse")).toLowerCase();
    if (type !== "touch" && type !== "pen") return;
    const nextFamily = eventFamily(event);
    if (family && family !== nextFamily) return;
    family ||= nextFamily;
    if (nextFamily === "pointer") {
      const point = eventPoints(event, nextFamily)[0];
      if (point) pointers.set(eventKey(event, nextFamily), point);
    } else {
      for (const point of eventPoints(event, nextFamily)) pointers.set(point.key, point);
    }
    if (pointers.size < 2) return;
    const nextDistance = distance([...pointers.values()]);
    if (!(nextDistance > 0)) { reset(); return; }
    startDistance = nextDistance;
    startZoom = zoom;
    pinching = true;
    pinchSequenceActive = true;
    event.preventDefault?.();
  }

  function move(event) {
    if (destroyed || !family || eventFamily(event) !== family) return;
    if (family === "pointer") {
      const key = eventKey(event, family);
      const point = eventPoints(event, family)[0];
      if (pointers.has(key) && point) pointers.set(key, point);
    } else {
      for (const point of eventPoints(event, family)) {
        if (pointers.has(point.key)) pointers.set(point.key, point);
      }
    }
    if (pointers.size < 2) {
      if (pinchSequenceActive) event.preventDefault?.();
      return;
    }
    if (!pinching) return;
    const nextDistance = distance([...pointers.values()]);
    if (!(nextDistance > 0) || !(startDistance > 0)) return;
    event.preventDefault?.();
    updateZoom(startZoom * (nextDistance / startDistance), event);
  }

  function end(event) {
    if (!family || eventFamily(event) !== family) return;
    if (family === "pointer") pointers.delete(eventKey(event, family));
    else for (const touch of Array.from(event?.changedTouches || [])) pointers.delete(`touch:${touch?.identifier}`);
    if (pointers.size === 0) {
      reset();
      return;
    }
    if (pointers.size < 2) {
      startDistance = 0;
      startZoom = zoom;
      pinching = false;
    }
  }

  element.addEventListener("pointerdown", begin, { passive: false });
  element.addEventListener("touchstart", begin, { passive: false });
  documentRef?.addEventListener?.("pointermove", move, { passive: false });
  documentRef?.addEventListener?.("pointerup", end);
  documentRef?.addEventListener?.("pointercancel", end);
  documentRef?.addEventListener?.("touchmove", move, { passive: false });
  documentRef?.addEventListener?.("touchend", end, { passive: false });
  documentRef?.addEventListener?.("touchcancel", end, { passive: false });

  return Object.freeze({
    getZoom: () => zoom,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      element.removeEventListener("pointerdown", begin);
      element.removeEventListener("touchstart", begin);
      documentRef?.removeEventListener?.("pointermove", move);
      documentRef?.removeEventListener?.("pointerup", end);
      documentRef?.removeEventListener?.("pointercancel", end);
      documentRef?.removeEventListener?.("touchmove", move);
      documentRef?.removeEventListener?.("touchend", end);
      documentRef?.removeEventListener?.("touchcancel", end);
      reset();
    },
  });
}
