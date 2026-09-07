import test from "node:test";
import assert from "node:assert/strict";

import { createChatClient } from "../src/chat/chat-client.js";

const API_BASE = "https://163-176-171-217.sslip.io";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(fetchImpl, overrides = {}) {
  return createChatClient({
    apiBaseUrl: API_BASE,
    tokenProvider: async () => "graph-token",
    fetchImpl,
    randomUUID: () => "message-id",
    ...overrides,
  });
}

test("consulta anexos com autenticação sem enviar texto nem resposta ao fluxo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], attachments: [{ id: "a", fileName: "foto.jpg", mediaUrl: "/api/portal-media/a" }] });
  });
  assert.equal(typeof client.getAttachments, "function");
  const attachments = await client.getAttachments();
  assert.equal(attachments[0].id, "a");
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), { action: "attachment_snapshot" });
});

test("snapshot ausente não vira lista vazia nem apaga os anexos conhecidos", async () => {
  const client = clientWith(async () => jsonResponse({ status: "processed", messages: [] }));
  assert.equal(typeof client.getAttachments, "function");
  await assert.rejects(client.getAttachments(), /anexos/);
});

test("exclui um anexo confirmado sem enviar texto para o fluxo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], attachments: [] });
  });

  const result = await client.deleteAttachment("vm-1");

  assert.deepEqual(result.attachments, []);
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.deepEqual(JSON.parse(request.body), { action: "attachment_delete", attachmentId: "vm-1" });
  assert.equal(request.headers.Authorization, "Bearer graph-token");
});

test("falha transitória ao consultar anexos é recuperada sem enviar comando ao fluxo", async () => {
  const bodies = [];
  const client = clientWith(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw new TypeError('Load failed');
    return jsonResponse({ status: 'processed', messages: [], attachments: [] });
  }, { retryDelay: async () => {} });
  assert.deepEqual(await client.getAttachments(), []);
  assert.deepEqual(bodies, [{ action: 'attachment_snapshot' }, { action: 'attachment_snapshot' }]);
});

test("queda após enviar resposta não provoca segunda gravação automática", async () => {
  let calls = 0;
  const client = clientWith(async () => { calls++; throw new TypeError('Load failed'); });
  await assert.rejects(client.sendText({ text: 'Confirmar' }), error => {
    assert.equal(error.code, 'NETWORK_UNCERTAIN');
    assert.match(error.message, /Retomar conversa/);
    return true;
  });
  assert.equal(calls, 1);
});

test("falha ao ler corpo de resposta também é falha de comunicação, não JSON inválido", async () => {
  const client = clientWith(async () => ({ ok: true, json: async () => { throw new TypeError('Load failed'); } }));
  await assert.rejects(client.sendText({ text: 'Sim' }), error => error.code === 'NETWORK_UNCERTAIN');
});

test("anexo com falha de rede na leitura é baixado novamente sem reenviar arquivo", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls++;
    if (calls === 1) return { ok: true, blob: async () => { throw new TypeError('Load failed'); } };
    return new Response('arquivo');
  }, { retryDelay: async () => {} });
  assert.equal(await (await client.fetchMedia({ mediaUrl: '/api/portal-media/id' })).text(), 'arquivo');
  assert.equal(calls, 2);
});

test("envia texto autenticado e exige confirmação estruturada", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [{ type: "text", text: "Certo" }] });
  });

  const result = await client.sendText({ text: "Criar registro", replyId: "create" });

  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), {
    messageId: "message-id",
    text: "Criar registro",
    replyId: "create",
  });
  assert.equal(result.messages[0].text, "Certo");
});

test("não aceita sucesso HTTP com JSON truncado ou confirmação inválida", async () => {
  const truncated = clientWith(async () => new Response("{", { status: 200 }));
  const invalid = clientWith(async () => jsonResponse({ status: "queued" }));

  await assert.rejects(truncated.sendText({ text: "Oi" }), /confirmação válida/);
  await assert.rejects(invalid.sendText({ text: "Oi" }), /confirmação válida/);
});

test("envia arquivo binário com nome codificado e só remove após confirmação", async () => {
  const file = { name: "Foto 1.jpg", size: 4, type: "image/jpeg" };
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [] });
  });

  await client.sendFile(file);

  assert.equal(request.url, `${API_BASE}/api/portal-upload`);
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.equal(request.headers["X-Portal-File-Name"], encodeURIComponent("Foto 1.jpg"));
  assert.equal(request.headers["X-Portal-Message-Id"], "message-id");
  assert.equal(request.headers["Content-Type"], "image/jpeg");
  assert.equal(request.body, file);
});

test("mantém falha quando upload 2xx não traz confirmação estrita", async () => {
  const client = clientWith(async () => jsonResponse({ status: "processed_with_recovery", messages: [] }));

  await assert.rejects(
    client.sendFile({ name: "foto.jpg", size: 4, type: "image/jpeg" }),
    /confirmação válida/,
  );
});

test("propaga mensagem segura do servidor em resposta não 2xx", async () => {
  const client = clientWith(async () => jsonResponse({ error: "sessão expirada" }, 401));

  await assert.rejects(client.sendText({ text: "Oi" }), /sessão expirada/);
});

test("recusa ausência de token antes de acessar a rede", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return jsonResponse({ status: "processed", messages: [] });
  }, { tokenProvider: async () => undefined });

  await assert.rejects(client.sendText({ text: "Oi" }), /sessão Microsoft/);
  assert.equal(calls, 0);
});

test("baixa mídia somente da origem e do caminho opaco permitidos", async () => {
  let requestedUrl;
  const client = clientWith(async (url) => {
    requestedUrl = url;
    return new Response(new Blob(["pdf"], { type: "application/pdf" }), { status: 200 });
  });

  const blob = await client.fetchMedia({ mediaUrl: `${API_BASE}/api/portal-media/opaque-id` });
  assert.equal(requestedUrl, `${API_BASE}/api/portal-media/opaque-id`);
  assert.equal(blob.type, "application/pdf");

  await assert.rejects(
    client.fetchMedia({ mediaUrl: "https://evil.example/api/portal-media/id" }),
    /mídia inválido/,
  );
  await assert.rejects(
    client.fetchMedia({ mediaUrl: `${API_BASE}/health` }),
    /mídia inválido/,
  );
});
