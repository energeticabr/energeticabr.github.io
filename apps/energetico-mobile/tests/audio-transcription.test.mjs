import assert from "node:assert/strict";
import test from "node:test";

import { createChatClient } from "../src/chat/chat-client.js";
import { isAudioFile } from "../src/chat/audio-transcription.js";

const API_BASE = "https://example.test";

function clientWith(fetchImpl) {
  return createChatClient({
    apiBaseUrl: API_BASE,
    tokenProvider: async () => "graph-token",
    fetchImpl,
    randomUUID: () => "message-id",
  });
}

test("reconhece arquivos de áudio por MIME e extensão", () => {
  assert.equal(isAudioFile({ type: "audio/mpeg", name: "registro.bin" }), true);
  assert.equal(isAudioFile({ type: "", name: "registro.m4a" }), true);
  assert.equal(isAudioFile({ type: "application/pdf", name: "registro.pdf" }), false);
});

test("envia áudio para transcrição autenticada e devolve o texto", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ text: "Execução de concretagem da laje." }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const audio = { name: "diario.m4a", type: "audio/mp4", size: 12 };

  const result = await client.transcribeAudio(audio);

  assert.equal(result, "Execução de concretagem da laje.");
  assert.equal(request.url, `${API_BASE}/api/portal-transcribe`);
  assert.equal(request.options.headers.Authorization, "Bearer graph-token");
  assert.equal(request.options.headers["X-Portal-File-Name"], encodeURIComponent("diario.m4a"));
  assert.equal(request.options.body, audio);
});

test("não aceita resposta de transcrição sem texto", async () => {
  const client = clientWith(async () => new Response(JSON.stringify({ status: "processed" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));

  await assert.rejects(client.transcribeAudio({ name: "diario.wav", type: "audio/wav", size: 2 }), /texto transcrito/i);
});

test("falha de rede na transcrição mostra orientação em português", async () => {
  const client = clientWith(async () => { throw new TypeError("Load failed"); });
  await assert.rejects(
    client.transcribeAudio({ name: "diario.m4a", type: "audio/mp4", size: 2 }),
    error => /conexão.*transcri/i.test(error.message) && !/Load failed/.test(error.message),
  );
});
