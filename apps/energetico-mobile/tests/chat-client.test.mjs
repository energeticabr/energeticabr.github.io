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

test("solicita a exclusão de todos os anexos sem enviar texto ao fluxo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], attachments: [] });
  });

  const result = await client.deleteAllAttachments();

  assert.deepEqual(result.attachments, []);
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.deepEqual(JSON.parse(request.body), { action: "attachment_delete_all" });
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

test("aceita recuperação estruturada da VM para respostas de texto", async () => {
  const client = clientWith(async () => jsonResponse({
    status: "processed_with_recovery",
    messages: [
      { type: "text", text: "O formulário foi preservado." },
      { type: "poll", question: "Como deseja continuar?", options: [] },
    ],
  }));

  const result = await client.sendText({ text: "compact_all_attachments" });

  assert.equal(result.status, "processed_with_recovery");
  assert.equal(result.messages[0].text, "O formulário foi preservado.");
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

test("repete upload quando a conexão cai antes da confirmação", async () => {
  const calls = [];
  const client = clientWith(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError("Load failed");
    return jsonResponse({ status: "processed", messages: [] });
  }, { retryDelay: async () => {} });
  const file = { name: "semana.pdf", size: 43_120_147, type: "application/pdf" };

  await client.sendFile(file);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["X-Portal-Message-Id"], "message-id");
  assert.equal(calls[1].options.headers["X-Portal-Message-Id"], "message-id");
  assert.equal(calls[1].options.body, file);
});

test("repete upload quando a VM informa que recebeu o arquivo incompleto", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: "Upload incompleto" }, 422);
    return jsonResponse({ status: "processed", messages: [] });
  }, { retryDelay: async () => {} });

  await client.sendFile({ name: "semana.pdf", size: 43_120_147, type: "application/pdf" });
  assert.equal(calls, 2);
});

test("não repete erro definitivo de upload", async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return jsonResponse({ error: "Arquivo excede o limite" }, 413);
  }, { retryDelay: async () => {} });

  await assert.rejects(client.sendFile({ name: "semana.pdf", size: 43_120_147, type: "application/pdf" }), error => {
    assert.equal(error.status, 413);
    return true;
  });
  assert.equal(calls, 1);
});

test("retentativa de compartilhamento usa o mesmo identificador da extensão sem duplicar o evento", async () => {
  const ids = [];
  const client = clientWith(async (_url, options) => {
    ids.push(options.headers["X-Portal-Message-Id"]);
    return jsonResponse({ status: "processed", messages: [] });
  });
  const file = { name: "documento.pdf", size: 3, type: "application/pdf", sourceId: "12345678-1234-4234-8234-123456789abc" };
  await client.sendFile(file);
  await client.sendFile(file);
  assert.deepEqual(ids, ["12345678-1234-4234-8234-123456789abc", "12345678-1234-4234-8234-123456789abc"]);
});

test("propaga mensagem segura do servidor em resposta não 2xx", async () => {
  const client = clientWith(async () => jsonResponse({ error: "sessão expirada" }, 401));

  await assert.rejects(client.sendText({ text: "Oi" }), /sessão expirada/);
});

test("identificador de origem inválido não é encaminhado como cabeçalho", async () => {
  let id;
  const client = clientWith(async (_url, options) => {
    id = options.headers["X-Portal-Message-Id"];
    return jsonResponse({ status: "processed", messages: [] });
  });
  await client.sendFile({ name: "foto.jpg", size: 3, type: "image/jpeg", sourceId: "invalid\r\nHeader: value" });
  assert.equal(id, "message-id");
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
