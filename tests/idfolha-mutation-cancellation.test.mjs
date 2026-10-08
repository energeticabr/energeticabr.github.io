import assert from "node:assert/strict";
import test from "node:test";
import { createGraphClient } from "../portal/data/graph-client.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import { createSharePointRestTransport } from "../portal/data/attachments.js";

const site = { host: "example.sharepoint.com", path: "/sites/portal" };
const listId = "11111111-1111-1111-1111-111111111111";
const savedItem = { id: "42", eTag: '"42,2"', fields: { Title: "UPDATED" } };
const uploaded = { FileName: "receipt.pdf", ServerRelativeUrl: "/sites/portal/Lists/Receipts/Attachments/42/receipt.pdf" };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function pause() {
  const entered = deferred();
  const released = deferred();
  return {
    entered: entered.promise,
    release: released.resolve,
    async wait() {
      entered.resolve();
      await released.promise;
    },
  };
}

function response(payload, status = 200) {
  return { ok: true, status, headers: new Headers(), async json() { return payload; } };
}

// Keep repository methods and both transports real; only token acquisition and HTTP are fake.
// HTTP deliberately ignores AbortSignal so an attempted mutation cannot hide behind fetch aborting it.
function harness({ writeTransport = "graph", graphToken, restToken } = {}) {
  const graphHttp = [];
  const restHttp = [];
  const restScopes = [];
  const config = { ...site, readTransport: writeTransport, writeTransport };
  const graph = createGraphClient(graphToken || (async () => "graph-token"), {
    fetch: async (url, options) => {
      graphHttp.push({ url, options });
      if (options.method === "PATCH") return response({});
      if (url.endsWith("?$expand=fields")) return response(savedItem);
      assert.equal(url, "https://graph.microsoft.com/v1.0/sites/example.sharepoint.com:/sites/portal");
      return response({ id: "portal-site" });
    },
  });
  const rest = createSharePointRestTransport({
    allowedSites: [config],
    tokenProvider: async scopes => {
      restScopes.push(scopes);
      return restToken ? restToken(scopes) : "rest-token";
    },
    fetch: async (url, options) => {
      restHttp.push({ url, options });
      if (url.includes("/AttachmentFiles/add(")) return response(uploaded);
      if (options.method === "POST") return response(undefined, 204);
      return response({ Id: 42, Title: "UPDATED", "@odata.etag": '"42,2"' });
    },
  });
  const repository = createSharePointRepository(graph, { company: config }, { attachmentTransport: rest });
  return { repository, rest, config, graphHttp, restHttp, restScopes };
}

function file(arrayBuffer = async () => Uint8Array.from([1, 2, 3]).buffer) {
  return { name: "receipt.pdf", type: "application/pdf", size: 3, arrayBuffer };
}

// Observe rejection immediately, including when production rejects before the paused work releases.
function outcome(promise) {
  return promise.then(value => ({ value }), error => ({ error }));
}

function assertCancelled(result) {
  assert.ok(result.error, "cancelled mutation must reject");
  assert.ok(result.error.name === "AbortError" || result.error.code === "request_aborted", result.error.message);
}

test("updateItem sends no Graph PATCH when aborted while the write token is pending", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  const { repository, graphHttp } = harness({
    graphToken: async scopes => {
      if (scopes.includes("Sites.ReadWrite.All")) await gate.wait();
      return "graph-token";
    },
  });
  const pending = outcome(repository.updateItem("company", listId, "42", { Title: "UPDATED" }, { eTag: '"42,1"', signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(graphHttp.filter(call => call.options.method === "PATCH").length, 0);
  assertCancelled(result);
});

test("updateItem stops after cancelled authorization before acquiring a Graph token", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  let tokens = 0;
  const { repository, graphHttp } = harness({ graphToken: async () => { tokens += 1; return "graph-token"; } });
  repository.setAuthorizationProvider({ authorize: () => gate.wait() });
  const pending = outcome(repository.updateItem("company", listId, "42", { Title: "UPDATED" }, { eTag: '"42,1"', signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(tokens, 0);
  assert.equal(graphHttp.length, 0);
  assertCancelled(result);
});

test("uploadAttachment sends no POST when aborted while file.arrayBuffer is pending", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  const { repository, restHttp, restScopes } = harness();
  const receipt = file(async () => { await gate.wait(); return Uint8Array.from([1, 2, 3]).buffer; });
  const pending = outcome(repository.uploadAttachment("company", listId, "42", receipt, receipt.name, { signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(restHttp.length, 0, "aborted file preparation must not dispatch HTTP");
  assert.equal(restScopes.length, 0, "aborted file preparation must not acquire a write token");
  assertCancelled(result);
});

test("uploadAttachment stops after cancelled authorization before reading the file", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  let reads = 0;
  const { repository, restHttp } = harness();
  repository.setAuthorizationProvider({ authorize: () => gate.wait() });
  const receipt = file(async () => { reads += 1; return new ArrayBuffer(3); });
  const pending = outcome(repository.uploadAttachment("company", listId, "42", receipt, receipt.name, { signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(reads, 0);
  assert.equal(restHttp.length, 0);
  assertCancelled(result);
});

test("uploadAttachment sends no POST when aborted while the REST write token is pending", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  const { repository, restHttp } = harness({ restToken: async scopes => {
    assert.deepEqual(scopes, ["https://example.sharepoint.com/AllSites.Write"]);
    await gate.wait();
    return "rest-token";
  } });
  const receipt = file();
  const pending = outcome(repository.uploadAttachment("company", listId, "42", receipt, receipt.name, { signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(restHttp.length, 0);
  assertCancelled(result);
});

test("updateItem sends no REST MERGE POST when aborted while the write token is pending", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  const { repository, restHttp } = harness({ writeTransport: "rest", restToken: async () => {
    await gate.wait();
    return "rest-token";
  } });
  const pending = outcome(repository.updateItem("company", listId, "42", { Title: "UPDATED" }, { eTag: '"42,1"', signal: controller.signal }));
  await gate.entered;
  controller.abort();
  gate.release();
  const result = await pending;
  assert.equal(restHttp.length, 0);
  assertCancelled(result);
});

test("REST transport checks cancellation after token acquisition before calling fetch", { timeout: 2000 }, async () => {
  const gate = pause();
  const controller = new AbortController();
  const { rest, config, restHttp } = harness({ restToken: async () => { await gate.wait(); return "rest-token"; } });
  const pending = outcome(rest.request(config, "/_api/web/ensureuser", { method: "POST", permission: "write", signal: controller.signal }));
  await gate.entered;
  controller.abort("editor closed");
  gate.release();
  const result = await pending;
  assert.equal(restHttp.length, 0);
  assertCancelled(result);
});

test("uncancelled Graph update retains ETag, fields and the refreshed item", async () => {
  const controller = new AbortController();
  const { repository, graphHttp } = harness();
  const result = await repository.updateItem("company", listId, "42", { Title: "UPDATED" }, { eTag: '"42,1"', signal: controller.signal });
  assert.deepEqual(result, savedItem);
  const patch = graphHttp.find(call => call.options.method === "PATCH");
  assert.equal(patch.url, `https://graph.microsoft.com/v1.0/sites/portal-site/lists/${listId}/items/42/fields`);
  assert.equal(patch.options.headers["If-Match"], '"42,1"');
  assert.equal(patch.options.body, '{"Title":"UPDATED"}');
});

test("uncancelled upload forwards its signal and preserves the REST payload", async () => {
  const controller = new AbortController();
  const { repository, restHttp } = harness();
  const receipt = file();
  assert.deepEqual(await repository.uploadAttachment("company", listId, "42", receipt, receipt.name, { signal: controller.signal }), uploaded);
  assert.equal(restHttp.length, 1);
  assert.equal(restHttp[0].options.signal, controller.signal);
  assert.equal(restHttp[0].options.headers["Content-Type"], "application/pdf");
  assert.deepEqual([...new Uint8Array(restHttp[0].options.body)], [1, 2, 3]);
});

test("legacy upload calls accept omitted filename, omitted options and explicit undefined options", async () => {
  const { repository, restHttp } = harness();
  const receipt = file();
  assert.deepEqual(await repository.uploadAttachment("company", listId, "42", receipt), uploaded);
  assert.deepEqual(await repository.uploadAttachment("company", listId, "42", receipt, receipt.name), uploaded);
  assert.deepEqual(await repository.uploadAttachment("company", listId, "42", receipt, receipt.name, undefined), uploaded);
  assert.equal(restHttp.length, 3);
  for (const call of restHttp) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.url, `https://example.sharepoint.com/sites/portal/_api/web/lists(guid'${listId}')/items(42)/AttachmentFiles/add(FileName='receipt.pdf')`);
  }
});
