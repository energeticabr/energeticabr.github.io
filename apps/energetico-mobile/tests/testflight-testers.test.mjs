import test from "node:test";
import assert from "node:assert/strict";
import {
  createTesterPayload,
  normalizeEmail,
  parseAllowedEmails,
  planTesterChanges,
  reconcileTestFlightTesters,
} from "../scripts/manage-testflight-testers.mjs";

test("normaliza e valida a lista de testadores permitidos", () => {
  assert.equal(normalizeEmail("  BERNARDONOTINI@ENERGETICABR.COM "), "bernardonotini@energeticabr.com");
  assert.deepEqual(parseAllowedEmails("bernardonotini@energeticabr.com; bernardonotini@energeticabr.com"), [
    "bernardonotini@energeticabr.com",
  ]);
  assert.throws(() => parseAllowedEmails("yan"), /e-mail/i);
});

test("planeja manter Bernardo e remover os outros testadores do grupo", () => {
  const plan = planTesterChanges([
    { id: "bernardo", attributes: { email: "BERNARDONOTINI@ENERGETICABR.COM" } },
    { id: "yan", attributes: { email: "yan@energeticabr.com" } },
  ], ["bernardonotini@energeticabr.com"]);

  assert.deepEqual(plan.keep.map(item => item.id), ["bernardo"]);
  assert.deepEqual(plan.remove.map(item => item.id), ["yan"]);
  assert.deepEqual(plan.missing, []);
});

test("payload de criação associa o e-mail ao grupo correto", () => {
  assert.deepEqual(createTesterPayload("bernardonotini@energeticabr.com", "group-id"), {
    data: {
      type: "betaTesters",
      attributes: { email: "bernardonotini@energeticabr.com" },
      relationships: { betaGroups: { data: [{ type: "betaGroups", id: "group-id" }] } },
    },
  });
});

test("reconciliação adiciona os permitidos antes de remover os extras e confirma o estado final", async () => {
  let groupTesters = [
    { id: "yan", type: "betaTesters", attributes: { email: "yan@energeticabr.com" } },
  ];
  const calls = [];
  const client = {
    async request(method, path, payload) {
      calls.push({ method, path, payload });
      if (method === "GET" && path.startsWith("/v1/betaGroups?")) {
        return { data: [{ id: "group-id", attributes: { name: "ENERGETICO Validacao", isInternalGroup: true } }] };
      }
      if (method === "GET" && path.startsWith("/v1/betaGroups/group-id/betaTesters")) return { data: groupTesters };
      if (method === "GET" && path.startsWith("/v1/betaTesters?")) return { data: [] };
      if (method === "POST" && path === "/v1/betaTesters") {
        const created = { id: "bernardo", type: "betaTesters", attributes: { email: "bernardonotini@energeticabr.com" } };
        groupTesters = [...groupTesters, created];
        return { data: created };
      }
      if (method === "DELETE" && path === "/v1/betaGroups/group-id/relationships/betaTesters") {
        const removed = new Set((payload.data || []).map(item => item.id));
        groupTesters = groupTesters.filter(item => !removed.has(item.id));
        return {};
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };

  const result = await reconcileTestFlightTesters(client, { allowedEmails: ["bernardonotini@energeticabr.com"] });

  assert.deepEqual(result.added, ["bernardonotini@energeticabr.com"]);
  assert.deepEqual(result.removed, ["yan@energeticabr.com"]);
  assert.deepEqual(groupTesters.map(item => item.attributes.email), ["bernardonotini@energeticabr.com"]);
  assert.ok(calls.findIndex(call => call.method === "POST") < calls.findIndex(call => call.method === "DELETE"));
});

test("reconciliação reutiliza um testador existente quando o filtro por e-mail não o retorna", async () => {
  const existing = { id: "bernardo", type: "betaTesters", attributes: { email: "bernardonotini@energeticabr.com" } };
  let groupTesters = [
    { id: "yan", type: "betaTesters", attributes: { email: "yan@energeticabr.com" } },
  ];
  const calls = [];
  const client = {
    async request(method, path, payload) {
      calls.push({ method, path, payload });
      if (method === "GET" && path.startsWith("/v1/betaGroups?")) {
        return { data: [{ id: "group-id", attributes: { name: "ENERGETICO Validacao", isInternalGroup: true } }] };
      }
      if (method === "GET" && path.startsWith("/v1/betaGroups/group-id/betaTesters")) return { data: groupTesters };
      if (method === "GET" && path.includes("filter%5Bemail%5D")) return { data: [] };
      if (method === "GET" && path === "/v1/betaTesters?limit=200") return { data: [existing] };
      if (method === "POST" && path === "/v1/betaGroups/group-id/relationships/betaTesters") {
        groupTesters = [...groupTesters, existing];
        return {};
      }
      if (method === "DELETE" && path === "/v1/betaGroups/group-id/relationships/betaTesters") {
        const removed = new Set((payload.data || []).map(item => item.id));
        groupTesters = groupTesters.filter(item => !removed.has(item.id));
        return {};
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };

  const result = await reconcileTestFlightTesters(client, { allowedEmails: ["bernardonotini@energeticabr.com"] });

  assert.deepEqual(result.added, ["bernardonotini@energeticabr.com"]);
  assert.deepEqual(result.removed, ["yan@energeticabr.com"]);
  assert.deepEqual(groupTesters.map(item => item.attributes.email), ["bernardonotini@energeticabr.com"]);
  assert.equal(calls.some(call => call.method === "POST" && call.path === "/v1/betaTesters"), false);
});
