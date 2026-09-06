import test from "node:test";
import assert from "node:assert/strict";

test("voltar ao aplicativo consulta anexos sem retomar ou responder à pergunta", async () => {
  const { bindAttachmentSync } = await import("../src/web/attachment-sync.js");
  const documentRef = new EventTarget();
  const windowRef = new EventTarget();
  documentRef.visibilityState = "hidden";
  const calls = [];
  const unbind = bindAttachmentSync({ documentRef, windowRef, refresh: options => { calls.push(options); } });
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls.length, 0);
  documentRef.visibilityState = "visible";
  documentRef.dispatchEvent(new Event("visibilitychange"));
  windowRef.dispatchEvent(new Event("focus"));
  assert.deepEqual(calls, [{ silent: true }]);
  unbind();
  windowRef.dispatchEvent(new Event("focus"));
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls.length, 1);
});
