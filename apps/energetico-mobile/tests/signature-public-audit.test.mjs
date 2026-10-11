import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PDFDocument, PDFName } from "pdf-lib";
import { signPdfAttachment } from "../src/web/pdf-signing.js";
import { createChatClient } from "../src/chat/chat-client.js";

const id = "a".repeat(32);
const url = `https://163-176-171-217.sslip.io/assinaturas/${id}/${"b".repeat(64)}`;
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV8AAAAASUVORK5CYII=", "base64"));

test("PDF button preserves a real public URI annotation", async () => {
  const source = await PDFDocument.create(); source.addPage([595, 842]);
  const blob = await signPdfAttachment({ documentBlob: new Blob([await source.save()]), signatureBlob: new Blob([png], { type: "image/png" }), point: { page: 1, x: 0.7, y: 0.08, scale: 0.5 }, signerName: "EXEMPLO", integrityId: id, verificationUrl: url });
  const result = await PDFDocument.load(await blob.arrayBuffer());
  const annotations = result.getPages()[0].node.Annots();
  assert.ok(annotations?.size(), "Missing public verification link");
  const annotation = result.context.lookup(annotations.get(0));
  const action = annotation.lookup(PDFName.of("A"));
  assert.equal(action.get(PDFName.of("URI")).decodeText(), url);
  const rect = annotation.lookup(PDFName.of("Rect")).asArray().map(n => n.asNumber());
  assert.ok(rect[0] >= 0 && rect[1] >= 0 && rect[2] <= 595 && rect[3] <= 842);
  assert.ok(rect[0] > 595 * 0.7 && rect[1] > 842 * 0.08, 'The check must be beside the ink, above the identification rows');
  assert.equal(annotation.get(PDFName.of('Contents')).decodeText(), 'Ver registro da assinatura');
});

test("client opts in public preparation and sends trace in authenticated JSON", async () => {
  const requests = [];
  const record = { id, signedAt: "2026-10-10T12:00:00Z", sourceSha256: "c".repeat(64), verificationUrl: url };
  const client = createChatClient({ apiBaseUrl: "https://api.example.com", tokenProvider: async () => "token", fetchImpl: async (uri, options) => { requests.push({ uri, options }); return new Response(JSON.stringify(record)); } });
  await client.prepareSignatureEvidence({ documentBlob: new Blob(["pdf"]), fileName: "example.pdf", publicVerification: true });
  assert.equal(new URL(requests[0].uri).searchParams.get("public_verification"), "true");
  assert.equal(typeof client.captureSignatureEvidence, "function");
  await client.captureSignatureEvidence({ recordId: id, capture: { version: 1, mode: "unavailable", strokes: [], durationMs: 0, truncated: false, inkSha256: "d".repeat(64) } });
  assert.equal(requests[1].options.headers.Authorization, "Bearer token");
  assert.equal(requests[1].options.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(requests[1].options.body).mode, "unavailable");
});

test("passive observer keeps pen timing and pressure, clears and ignores unrelated input", async () => {
  const module = await import("../src/web/signature-trace.js").catch(() => ({}));
  assert.equal(typeof module.observeSignatureTrace, "function", "Trace observation is absent");
  const dom = new JSDOM('<div id="root"><canvas data-role="signature-pad"></canvas><button data-action="clear-signature-pad"></button></div>');
  const root = dom.window.document.querySelector("#root"); const canvas = root.querySelector("canvas");
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 100 });
  let now = 100;
  const observer = module.observeSignatureTrace(root, { now: () => now });
  const emit = (type, data) => { const event = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, pointerType: "pen", clientX: 20, clientY: 40, pressure: 0.4, tiltX: 12, tiltY: 5, ...data }); canvas.dispatchEvent(event); assert.equal(event.defaultPrevented, false); };
  emit("pointerdown"); now += 10; emit("pointermove", { clientX: 40, pressure: 0.8 }); now += 5; emit("pointerup", { pressure: 0 });
  const trace = observer.snapshot();
  assert.equal(trace.mode, "live"); assert.equal(trace.durationMs, 15);
  assert.equal(trace.strokes.length, 1); assert.equal(trace.strokes[0].input, "pen");
  assert.deepEqual(trace.strokes[0].points[0], { x: 0.1, y: 0.2, t: 0, pressure: 0.4, tiltX: 12, tiltY: 5 });
  root.querySelector("button").click(); assert.equal(observer.snapshot().mode, "unavailable");
  observer.destroy(); emit("pointerdown"); assert.equal(observer.snapshot().mode, "unavailable");
});

function traceHarness() {
  const dom = new JSDOM('<div id="root"><canvas data-role="signature-pad"></canvas></div>');
  const root = dom.window.document.querySelector('#root'), canvas = root.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  let time = 0;
  const emit = (type, data = {}) => { time++; const event = new dom.window.Event(type, { bubbles: true }); Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10, ...data }); canvas.dispatchEvent(event); };
  return { root, emit, now: () => time };
}

test('stationary pointer does not discard the real primary touch movement', async () => {
  const { observeSignatureTrace } = await import('../src/web/signature-trace.js');
  const h = traceHarness(), observer = observeSignatureTrace(h.root, { now: h.now });
  h.emit('pointerdown'); h.emit('pointermove');
  h.emit('touchmove', { touches: [{ identifier: 7, clientX: 50, clientY: 60 }], changedTouches: [{ identifier: 7, clientX: 50, clientY: 60 }] });
  h.emit('touchmove', { touches: [{ identifier: 7, clientX: 60, clientY: 70 }, { identifier: 8, clientX: 90, clientY: 90 }], changedTouches: [{ identifier: 8, clientX: 90, clientY: 90 }] });
  assert.deepEqual(observer.snapshot().strokes[0].points.at(-1), { x: 0.5, y: 0.6, t: 2 });
});

test('trace cap retains valid nonempty strokes and marks partial data', async () => {
  const { observeSignatureTrace } = await import('../src/web/signature-trace.js');
  const h = traceHarness(), observer = observeSignatureTrace(h.root, { now: h.now });
  h.emit('pointerdown');
  for (let i = 0; i < 21000; i++) h.emit('pointermove', { clientX: i % 2 ? 40 : 60 });
  h.emit('pointerup'); h.emit('pointerdown');
  const trace = observer.snapshot();
  assert.equal(trace.truncated, true);
  assert.ok(trace.strokes.every(stroke => stroke.points.length > 0));
  assert.equal(trace.strokes.flatMap(stroke => stroke.points).length, 20000);
});

test('pause without pointerup preserves the prior stroke and accepts the next', async () => {
  const { observeSignatureTrace } = await import('../src/web/signature-trace.js');
  const h = traceHarness(), observer = observeSignatureTrace(h.root, { now: h.now });
  h.emit('pointerdown'); h.emit('pointermove', { clientX: 40 });
  observer.pause();
  h.emit('pointerdown', { clientX: 70 }); h.emit('pointermove', { clientX: 90 });
  assert.equal(observer.snapshot().strokes.length, 2);
  assert.equal(observer.snapshot().strokes[1].points[0].x, 0.7);
});
