import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createPinchZoom } from "../src/web/pinch-zoom.js";

function pointer(window, type, pointerId, clientX, clientY) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    isPrimary: { value: pointerId === 1 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

test("nova pinça reutiliza o dedo que continuou na tela e permite reduzir o zoom", t => {
  const dom = new JSDOM("<div id=viewport></div>");
  const documentRef = dom.window.document;
  const viewport = documentRef.querySelector("#viewport");
  const zoom = createPinchZoom({ element: viewport, documentRef });
  t.after(() => {
    zoom.destroy();
    dom.window.close();
  });

  viewport.dispatchEvent(pointer(dom.window, "pointerdown", 1, 100, 200));
  viewport.dispatchEvent(pointer(dom.window, "pointerdown", 2, 200, 200));
  documentRef.dispatchEvent(pointer(dom.window, "pointermove", 2, 300, 200));
  assert.equal(zoom.getZoom(), 2);

  documentRef.dispatchEvent(pointer(dom.window, "pointerup", 2, 300, 200));
  const remainingFingerMove = pointer(dom.window, "pointermove", 1, 120, 200);
  documentRef.dispatchEvent(remainingFingerMove);
  assert.equal(
    remainingFingerMove.defaultPrevented,
    true,
    "o dedo remanescente não deve transformar a pinça encerrada em arraste",
  );
  viewport.dispatchEvent(pointer(dom.window, "pointerdown", 2, 300, 200));
  const closingMove = pointer(dom.window, "pointermove", 2, 210, 200);
  documentRef.dispatchEvent(closingMove);

  assert.equal(closingMove.defaultPrevented, true, "dois dedos devem bloquear o arraste do documento");
  assert.equal(zoom.getZoom(), 1, "a segunda pinça deve reduzir o zoom sem exigir retirar os dois dedos");
});
