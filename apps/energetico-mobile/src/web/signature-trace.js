// Evidence observation only: never renders, captures a pointer or cancels input.
const MAX_POINTS = 20000;
const MAX_STROKES = 256;
const RESET_ACTIONS = new Set(["open-signature-pad", "clear-signature-pad", "cancel-signature-pad"]);

export async function signatureInkHash(blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function signatureInkImage(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new Error('A imagem da assinatura excede o limite de 1 MB.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function observeSignatureTrace(root, { now = () => globalThis.performance.now() } = {}) {
  let strokes = [], active = null, started = null, lastTime = 0, count = 0, truncated = false;
  const document = root.ownerDocument;
  const reset = () => { strokes = []; active = null; started = null; lastTime = 0; count = 0; truncated = false; };
  const family = event => event.type.startsWith("touch") ? "touch" : event.type.startsWith("pointer") ? "pointer" : "mouse";
  const point = (event, canvas, observedAt = now()) => {
    const source = family(event) === "touch"
      ? [...(event.changedTouches || []), ...(event.touches || [])].find(touch => active?.touchId == null || touch.identifier === active.touchId)
      : event;
    if (!source || !Number.isFinite(source.clientX) || !Number.isFinite(source.clientY)) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    if (observedAt - started > 600000) truncated = true;
    const t = Math.min(600000, Math.max(lastTime, Math.round(observedAt - started)));
    const sample = { x: Math.max(0, Math.min(1, (source.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (source.clientY - rect.top) / rect.height)), t };
    // Mouse/touch default 0.5 is not a pressure measurement of a pen.
    if (active?.stroke.input === "pen") {
      const pressure = source.pressure ?? source.force;
      if (Number.isFinite(pressure) && pressure >= 0 && pressure <= 1) sample.pressure = pressure;
      for (const key of ["tiltX", "tiltY"]) if (Number.isFinite(source[key]) && Math.abs(source[key]) <= 90) sample[key] = source[key];
    }
    return sample;
  };
  const add = sample => {
    if (!sample) return false;
    if (count >= MAX_POINTS) { truncated = true; return false; }
    active.stroke.points.push(sample); count++; lastTime = sample.t; return true;
  };
  const begin = event => {
    const canvas = event.target?.closest?.('[data-role="signature-pad"]');
    if (!canvas || !root.contains(canvas) || active || event.isPrimary === false
      || (family(event) === "mouse" && event.button !== 0) || (event.touches?.length > 1)) return;
    if (strokes.length >= MAX_STROKES || count >= MAX_POINTS) { truncated = true; return; }
    const touch = event.changedTouches?.[0];
    const input = event.pointerType === "pen" || touch?.touchType === "stylus" ? "pen"
      : event.pointerType === "touch" || touch ? "touch" : "mouse";
    const stroke = { input, points: [] };
    started ??= now();
    active = { canvas, stroke, family: family(event), moveFamily: null, pointerId: event.pointerId, touchId: touch?.identifier,
      touchLike: event.pointerType === 'touch' || Boolean(touch), anchor: touch || event };
    const sample = point(event, canvas);
    if (!sample) { active = null; return; }
    strokes.push(stroke); add(sample);
  };
  const matches = event => {
    if (!active) return false;
    const stream = family(event);
    if (event.isPrimary === false) return false;
    if (stream === "pointer" && active.pointerId != null && event.pointerId !== active.pointerId) return false;
    if (stream === "mouse" && active.family !== "mouse") return false;
    if (stream === "touch") {
      if (!active.touchLike) return false;
      const changed = Array.from(event.changedTouches || []), contacts = Array.from(event.touches || []);
      if (active.touchId == null) {
        const candidates = /touch(?:end|cancel)/.test(event.type) ? [...changed, ...contacts] : contacts;
        const nearest = candidates.reduce((best, touch) => {
          const distance = Math.hypot(touch.clientX - active.anchor.clientX, touch.clientY - active.anchor.clientY);
          return !best || distance < best.distance ? { touch, distance } : best;
        }, null)?.touch;
        if (nearest) active.touchId = nearest.identifier;
      }
      if (active.touchId == null || !(changed.length ? changed : contacts).some(touch => touch.identifier === active.touchId)) return false;
    }
    return true;
  };
  const move = event => {
    if (!matches(event)) return;
    const stream = family(event);
    if (active.moveFamily && active.moveFamily !== stream) return;
    if ((stream === 'pointer' && !active.touchLike && event.buttons === 0) || (stream === 'touch' && event.touches?.length === 0)) { active = null; return; }
    if (!root.contains(active.canvas)) active.canvas = root.querySelector('[data-role="signature-pad"]') || active.canvas;
    const sample = point(event, active.canvas);
    if (!sample) return;
    const previous = active.stroke.points.at(-1), rect = active.canvas.getBoundingClientRect();
    if (previous && Math.hypot((sample.x - previous.x) * rect.width, (sample.y - previous.y) * rect.height) < 0.5) return;
    active.moveFamily ||= stream;
    const samples = event.getCoalescedEvents?.();
    if (samples?.length) {
      const receivedAt = now();
      for (const item of samples) {
        const age = event.timeStamp - item.timeStamp;
        add(point(item, active.canvas, Number.isFinite(age) && age >= 0 && age <= 1000 ? receivedAt - age : receivedAt));
      }
    }
    else add(sample);
  };
  const end = event => {
    if (!matches(event)) return;
    add(point(event, active.canvas)); active = null;
  };
  const click = event => {
    if (RESET_ACTIONS.has(event.target?.closest?.("[data-action]")?.dataset.action)) reset();
  };
  const listeners = [];
  const listen = (target, type, fn) => { if (!target?.addEventListener) return; target.addEventListener(type, fn, { capture: true, passive: true }); listeners.push([target, type, fn]); };
  for (const type of ["pointerdown", "touchstart", "mousedown"]) listen(root, type, begin);
  for (const type of ["pointermove", "touchmove", "mousemove"]) listen(document, type, move);
  for (const type of ["pointerup", "pointercancel", "touchend", "touchcancel", "mouseup"]) listen(document, type, end);
  listen(root, "click", click);
  return Object.freeze({ reset, pause: () => { active = null; },
    snapshot: () => ({ version: 1, mode: count ? "live" : "unavailable", durationMs: count ? lastTime : 0,
      truncated, strokes: strokes.map(stroke => ({ input: stroke.input, points: stroke.points.map(sample => ({ ...sample })) })) }),
    destroy() { for (const [target, type, fn] of listeners) target.removeEventListener(type, fn, { capture: true }); reset(); },
  });
}
