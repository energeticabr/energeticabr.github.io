import test from "node:test";
import assert from "node:assert/strict";

import { createShortcutClient } from "../src/web/shortcut-client.js";

test('consulta credencial existente sem emitir ou expor segredo', async () => {
  const client = createShortcutClient({
    apiBaseUrl: 'https://163-176-171-217.sslip.io', tokenProvider: async () => 'microsoft-token',
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, '/api/portal-shortcut-token');
      assert.deepEqual(JSON.parse(init.body), { action: 'status' });
      assert.equal(init.headers.Authorization, 'Bearer microsoft-token');
      return new Response(JSON.stringify({ status: 'active', token: 'never-expose' }));
    },
  });
  assert.equal(typeof client.status, 'function');
  assert.deepEqual(await client.status(), { status: 'active' });
});

test("emite credencial com autenticação Microsoft sem colocar segredo na URL", async () => {
  const requests = [];
  const client = createShortcutClient({
    apiBaseUrl: "https://163-176-171-217.sslip.io",
    tokenProvider: async () => "microsoft-token",
    fetchImpl: async (url, init) => {
      requests.push([url, init]);
      return new Response(JSON.stringify({
        status: "issued",
        token: "atalho-segredo",
        uploadUrl: "https://163-176-171-217.sslip.io/api/shortcut-upload",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await client.issue();

  assert.equal(result.token, "atalho-segredo");
  assert.equal(requests[0][0], "https://163-176-171-217.sslip.io/api/portal-shortcut-token");
  assert.equal(requests[0][0].includes("atalho-segredo"), false);
  assert.equal(requests[0][1].headers.Authorization, "Bearer microsoft-token");
  assert.deepEqual(JSON.parse(requests[0][1].body), { action: "issue" });
});

test("recusa resposta que tenta redirecionar o upload para outra origem", async () => {
  const client = createShortcutClient({
    apiBaseUrl: "https://163-176-171-217.sslip.io",
    tokenProvider: async () => "token",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "issued",
      token: "segredo",
      uploadUrl: "https://exemplo-malicioso.test/coletar",
    }), { status: 200 }),
  });

  await assert.rejects(client.issue(), /endereço seguro/);
});

test("revoga a credencial ativa com o mesmo canal autenticado", async () => {
  let body;
  const client = createShortcutClient({
    apiBaseUrl: "https://163-176-171-217.sslip.io",
    tokenProvider: async () => "token",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ status: "revoked" }), { status: 200 });
    },
  });

  assert.deepEqual(await client.revoke(), { status: "revoked" });
  assert.deepEqual(body, { action: "revoke" });
});

test("propaga erro seguro da VM e não aceita sucesso truncado", async () => {
  const failed = createShortcutClient({
    apiBaseUrl: "https://163-176-171-217.sslip.io",
    tokenProvider: async () => "token",
    fetchImpl: async () => new Response(JSON.stringify({ error: "Acesso negado." }), { status: 403 }),
  });
  await assert.rejects(failed.issue(), /Acesso negado/);

  const truncated = createShortcutClient({
    apiBaseUrl: "https://163-176-171-217.sslip.io",
    tokenProvider: async () => "token",
    fetchImpl: async () => new Response("{", { status: 200 }),
  });
  await assert.rejects(truncated.issue(), /confirmação válida/);
});
