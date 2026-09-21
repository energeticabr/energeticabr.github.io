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

function touch(window, type, touches, changedTouches = touches) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  const normalized = entries => entries.map(({ identifier, clientX, clientY }) => ({ identifier, clientX, clientY }));
  Object.defineProperties(event, {
    touches: { value: normalized(touches) },
    changedTouches: { value: normalized(changedTouches) },
  });
  return event;
}

test("zoom por pinça é suave e simétrico", t => {
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

  assert.ok(zoom.getZoom() > 1.4 && zoom.getZoom() < 1.7, "dobrar a distância não deve dobrar bruscamente o zoom");

  documentRef.dispatchEvent(pointer(dom.window, "pointermove", 2, 200, 200));
  assert.equal(zoom.getZoom(), 1, "voltar à distância inicial deve voltar exatamente ao zoom inicial");
});

test("continuação pointer para touch reconstrói os dedos ativos e permite afastar o PDF", t => {
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
  const expandedZoom = zoom.getZoom();
  documentRef.dispatchEvent(pointer(dom.window, "pointerup", 2, 300, 200));

  const resumedAsTouch = touch(dom.window, "touchstart", [
    { identifier: 1, clientX: 100, clientY: 200 },
    { identifier: 2, clientX: 300, clientY: 200 },
  ], [{ identifier: 2, clientX: 300, clientY: 200 }]);
  viewport.dispatchEvent(resumedAsTouch);
  const closingMove = touch(dom.window, "touchmove", [
    { identifier: 1, clientX: 150, clientY: 200 },
    { identifier: 2, clientX: 250, clientY: 200 },
  ]);
  documentRef.dispatchEvent(closingMove);

  assert.equal(resumedAsTouch.defaultPrevented, true, "a continuação com dois dedos deve assumir a pinça");
  assert.equal(closingMove.defaultPrevented, true, "a pinça deve bloquear o arraste do documento");
  assert.ok(zoom.getZoom() < expandedZoom, "aproximar os dedos deve reduzir o zoom após a troca de eventos do iOS");
});

test("pinça iniciada fora do visualizador não é capturada pelo listener global", t => {
  const dom = new JSDOM("<div id=viewport></div><div id=outside></div>");
  const documentRef = dom.window.document;
  const viewport = documentRef.querySelector("#viewport");
  const outside = documentRef.querySelector("#outside");
  const zoom = createPinchZoom({ element: viewport, documentRef });
  t.after(() => {
    zoom.destroy();
    dom.window.close();
  });

  const outsideMove = touch(dom.window, "touchmove", [
    { identifier: 1, clientX: 100, clientY: 200 },
    { identifier: 2, clientX: 250, clientY: 200 },
  ]);
  outside.dispatchEvent(outsideMove);

  assert.equal(outsideMove.defaultPrevented, false);
  assert.equal(zoom.getZoom(), 1);
});

test("zoom permanece limitado entre 100% e 400%", t => {
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
  documentRef.dispatchEvent(pointer(dom.window, "pointermove", 2, 10100, 200));
  assert.equal(zoom.getZoom(), 4);

  documentRef.dispatchEvent(pointer(dom.window, "pointermove", 2, 101, 200));
  assert.equal(zoom.getZoom(), 1);
});

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
  assert.ok(zoom.getZoom() > 1 && zoom.getZoom() < 2);

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
