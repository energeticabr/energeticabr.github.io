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

test("prepara e confirma integridade com PDFs reais no canal autenticado separado", async () => {
  const requests = [];
  const id = "0123456789abcdef0123456789abcdef";
  const client = clientWith(async (url, options) => {
    requests.push({ url: new URL(url), ...options });
    return jsonResponse({ id, signedAt: "2026-10-03T23:00:00Z", sourceSha256: "a".repeat(64),
      ...(new URL(url).searchParams.get("operation") === "finalize" ? { finalSha256: "b".repeat(64), status: "confirmed" } : {}) });
  });
  const source = new Blob(["%PDF-original"], { type: "application/pdf" });
  const final = new Blob(["%PDF-assinado"], { type: "application/pdf" });
  const prepared = await client.prepareSignatureEvidence({ documentBlob: source, fileName: "ponto.pdf", documentId: "294", signerName: "CLEITON", requestId: "retry-id" });
  assert.equal(prepared.id, id);
  assert.equal(requests[0].url.pathname, "/api/portal-signature-evidence");
  assert.equal(requests[0].url.searchParams.get("operation"), "prepare");
  assert.equal(requests[0].url.searchParams.get("document_id"), "294");
  assert.equal(requests[0].headers.Authorization, "Bearer graph-token");
  assert.equal(requests[0].headers["X-Portal-Message-Id"], "retry-id");
  assert.equal(requests[0].body, source);
  const confirmed = await client.confirmSignatureEvidence({ recordId: id, documentBlob: final, fileName: "ponto-assinado.pdf" });
  assert.equal(confirmed.finalSha256, "b".repeat(64));
  assert.equal(requests[1].url.searchParams.get("record_id"), id);
  assert.equal(requests[1].body, final);
});

test("integridade recusa confirmação incompleta e erros de autorização", async () => {
  const documentBlob = new Blob(["%PDF"], { type: "application/pdf" });
  await assert.rejects(clientWith(async () => jsonResponse({ id: "x" })).prepareSignatureEvidence({ documentBlob, fileName: "p.pdf" }), /integridade/i);
  await assert.rejects(clientWith(async () => jsonResponse({ error: "Conta não autorizada" }, 403)).confirmSignatureEvidence({ recordId: "0".repeat(32), documentBlob, fileName: "p.pdf" }), /Conta não autorizada/);
});

test("galeria consulta dados autenticados sem responder ao formulário", async () => {
  let sent;
  const client = clientWith(async (url, options) => {
    sent = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], launchGallery: { rows: [{ id: "19" }] } });
  });
  assert.equal(typeof client.launchGalleryRequest, "function");
  const result = await client.launchGalleryRequest("snapshot", { filters: { supplier: "A" }, page: 2 });
  assert.equal(result.rows[0].id, "19");
  assert.equal(sent.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(sent.body), { action: "launch_gallery", operation: "snapshot", payload: { filters: { supplier: "A" }, page: 2 } });
});

test("manual launch refresh uses the current strict VM contract and a fresh no-store request", async () => {
  const sent = [];
  const client = clientWith(async (_url,options) => {
    sent.push(options);
    const body = JSON.parse(options.body);
    if (Object.hasOwn(body.payload,'refresh')) return jsonResponse({error:'Campo de galeria desconhecido'},400);
    return jsonResponse({status:'processed',messages:[],launchGallery:{rows:[{id:String(sent.length)}]}});
  });
  const payload = {filters:{id:'901'},page:1,pageSize:20,sort:'MAIOR ID',refresh:true};
  assert.equal((await client.launchGalleryRequest('snapshot',payload)).rows[0].id,'1');
  assert.equal((await client.launchGalleryRequest('snapshot',payload)).rows[0].id,'2');
  assert.equal(payload.refresh,true,'caller query is untouched');
  for (const options of sent) {
    assert.equal(options.cache,'no-store');
    assert.deepEqual(JSON.parse(options.body).payload,{filters:{id:'901'},page:1,pageSize:20,sort:'MAIOR ID'});
  }
});

test("consulta da galeria encaminha o sinal para permitir cancelar chamadas pendentes", async () => {
  let sent;
  const controller = new AbortController();
  const client = clientWith(async (_url, options) => {
    sent = options;
    return jsonResponse({ status: "processed", messages: [], launchGallery: { rows: [] } });
  });
  await client.launchGalleryRequest("snapshot", {}, { signal: controller.signal });
  assert.equal(sent.signal, controller.signal);
});

test("upload da galeria usa destino separado sem cair na bandeja", async () => {
  let sent;
  const client = clientWith(async (url, options) => {
    sent = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], launchGallery: { ok: true } });
  });
  assert.equal(typeof client.uploadLaunchGalleryFile, "function");
  const file = new File(["pdf"], "nota.pdf", { type: "application/pdf" });
  await client.uploadLaunchGalleryFile("19", file, { operation: "attachment_add", confirm: true });
  const url = new URL(sent.url);
  assert.equal(url.searchParams.get("gallery_id"), "19");
  assert.equal(url.searchParams.get("gallery_operation"), "attachment_add");
  assert.equal(url.searchParams.get("confirm"), "true");
  assert.equal(sent.body, file);
  assert.equal(sent.headers.Authorization, "Bearer graph-token");
  await assert.rejects(client.uploadLaunchGalleryFile("19", file, { operation: "signature", confirm: false }), /confirm/i);
});

test("galeria resposta ausente falha em vez de mostrar lista vazia", async () => {
  const client = clientWith(async () => jsonResponse({ status: "processed", messages: [] }));
  assert.equal(typeof client.launchGalleryRequest, "function");
  await assert.rejects(client.launchGalleryRequest("snapshot", {}), /galeria/);
});

test("galeria atualiza opções dependentes pelo canal autenticado", async () => {
  let body;
  const client = clientWith(async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({ status: "processed", messages: [], launchGallery: { fields: [] } });
  });
  await client.launchGalleryRequest("schema", { id: 19, scope: "measurement", fields: { NUMEROCONTRATO: "7" } });
  assert.deepEqual(body, { action: "launch_gallery", operation: "schema", payload: {
    id: 19, scope: "measurement", fields: { NUMEROCONTRATO: "7" },
  } });
});

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

test("consulta provisões vencidas sem enviar texto ou iniciar um fluxo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({
      status: "processed",
      messages: [],
      pendingProvisions: {
        due: true,
        count: 1,
        rows: [{ supplier: "Fornecedor A", dueDate: "11/09/2026" }],
      },
    });
  });

  const snapshot = await client.getPendingProvisionSnapshot();

  assert.equal(snapshot.rows[0].supplier, "Fornecedor A");
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), { action: "pending_provisions_snapshot" });
});

test("consulta notas sem lançamento sem enviar texto ao fluxo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], pendingNotes: {
      count: 1, rows: [{ id: "13", supplier: "Terceiro", label: "13 - Terceiro" }],
    } });
  });
  const snapshot = await client.getPendingNotesSnapshot();
  assert.deepEqual(snapshot.rows.map(row => row.id), ["13"]);
  assert.deepEqual(JSON.parse(request.body), { action: "pending_notes_snapshot" });
});

test("consulta o relatório RHID do dia selecionado com a sessão Microsoft", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({
      status: "processed",
      messages: [],
      attendanceReport: { date: "2026-09-25", rows: [{ Id: 81, NOME_COLABORADOR: "Pessoa A" }] },
    });
  });

  const report = await client.getRhidAttendanceReport("2026-09-25");

  assert.equal(report.rows[0].NOME_COLABORADOR, "Pessoa A");
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), { action: "rhid_attendance_report", date: "2026-09-25" });
});

test("abre validação RHID vinculada ao ID pendente usando sessão autenticada", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [{ type: "poll", question: "PRESENÇA?", options: [] }] });
  });
  const result = await client.startRhidPendingValidation({ date: "2026-09-25", personKey: "rhid:9", presenceId: "21" });
  assert.equal(result.messages[0].question, "PRESENÇA?");
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), {
    action: "rhid_pending_validation_start", date: "2026-09-25", personKey: "rhid:9", presenceId: "21",
  });
  await assert.rejects(client.startRhidPendingValidation({ date: "2026-09-25", personKey: "rhid:9", presenceId: "0" }), /presença inválido/i);
});

test("consulta resumo mensal RHID autenticado sem baixar relatórios diários", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [], attendanceMonth: {
      month: "2026-09", presentDates: ["2026-09-28"],
    } });
  });
  assert.deepEqual((await client.getRhidAttendanceMonth("2026-09")).presentDates, ["2026-09-28"]);
  assert.equal(request.headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(request.body), { action: "rhid_attendance_month", month: "2026-09" });
  await assert.rejects(client.getRhidAttendanceMonth("2026-13"), /mês válido/i);
});

test("salva ajuste RHID autenticado com horário e justificativa e recusa justificativa vazia", async () => {
  const requests = [];
  const client = clientWith(async (url, options) => {
    requests.push({ url, ...options });
    return jsonResponse({ status: "processed", messages: [], attendanceAdjustment: { id: 7, time: "17:00" } });
  });
  const payload = { date: "2026-09-25", personKey: "rhid:23", slot: "exit2", time: "17:00", reason: "Batida conferida" };
  const result = await client.saveRhidAttendanceAdjustment(payload);
  assert.equal(result.time, "17:00");
  assert.equal(requests[0].headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(requests[0].body), { action: "rhid_attendance_adjust", ...payload });
  await assert.rejects(client.saveRhidAttendanceAdjustment({ ...payload, reason: "  " }), /justificativa/i);
  assert.equal(requests.length, 1);
});

test("atualização RHID usa a sessão Microsoft e exige conclusão do fluxo", async () => {
  const requests = [];
  const client = clientWith(async (url, options) => {
    requests.push({ url, ...options });
    const action = JSON.parse(options.body).action;
    return jsonResponse({ status: "processed", messages: [], rhidRefresh: {
      status: action === "rhid_refresh" ? "running" : "completed",
      requestId: "a".repeat(32),
    } });
  });
  const refresh = await client.refreshRhidAttendance();
  assert.equal(refresh.status, "running");
  assert.equal(requests[0].headers.Authorization, "Bearer graph-token");
  assert.deepEqual(JSON.parse(requests[0].body), { action: "rhid_refresh" });
  const final = await client.getRhidRefreshStatus(refresh.requestId);
  assert.equal(final.status, "completed");
  assert.deepEqual(JSON.parse(requests[1].body), { action: "rhid_refresh_status", requestId: "a".repeat(32) });
});

test("relatório RHID rejeita datas inexistentes antes de consultar a VM", async () => {
  let calls = 0;
  const client = clientWith(async () => { calls += 1; return jsonResponse({ status: "processed", messages: [] }); });
  await assert.rejects(client.getRhidAttendanceReport("2026-02-30"), /data/i);
  assert.equal(calls, 0);
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

test("consulta tarefas delegadas pendentes", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({
      status: "processed",
      messages: [],
      delegatedTasks: { rows: [{ id: "501", task: "Enviar contrato" }] },
    });
  });

  const snapshot = await client.getDelegatedTasks();

  assert.equal(snapshot.rows[0].id, "501");
  assert.equal(request.url, `${API_BASE}/api/portal-chat`);
  assert.deepEqual(JSON.parse(request.body), { action: "delegated_tasks_snapshot" });
});

test("encaminha o cancelamento ao download de mídia", async () => {
  let receivedSignal;
  const client = clientWith(async (_url, options) => {
    receivedSignal = options.signal;
    return new Response("arquivo");
  });
  const controller = new AbortController();
  await client.fetchMedia({ mediaUrl: "/api/portal-media/id" }, { signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
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

test("casinha envia contrato seletivo no mesmo endpoint autenticado", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [] });
  });
  await client.sendText({ replyId: "portal_transfer_attachments", homeAttachmentIds: ["a".repeat(64)], expectedContextId: "original-context" });
  assert.deepEqual(JSON.parse(request.body), {
    messageId: "message-id", text: "", replyId: "portal_transfer_attachments",
    action: "home_attachment_transfer", attachmentIds: ["a".repeat(64)], expectedContextId: "original-context",
  });
});

test("confirmação da casinha envia a identidade do recibo sem usar transferência legada", async () => {
  let body;
  const client = clientWith(async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({ status: "processed", messages: [] });
  });
  const receipt = { requestId: "home-start", contextId: "context", attachmentIds: ["a".repeat(64)] };
  await client.sendText({ replyId: "portal_transfer_draft_discard", homeTransferReceipt: receipt });
  assert.equal(body.action, "home_attachment_transfer");
  assert.equal(body.operation, "confirm");
  assert.deepEqual(body.homeTransferReceipt, receipt);
});

test("seleção em branco do pedido EPI envia somente o replyId, sem texto", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [] });
  });

  await client.sendText({
    text: "0 - EM BRANCO",
    replyId: "document_signing_epi_order_blank",
  });

  assert.deepEqual(JSON.parse(request.body), {
    messageId: "message-id",
    replyId: "document_signing_epi_order_blank",
  });
});

test("opção vazia enviada silenciosamente omite o texto sem depender do rótulo", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [] });
  });

  await client.sendText({ replyId: "payment_provision_form_blank", omitText: true });

  assert.deepEqual(JSON.parse(request.body), {
    messageId: "message-id",
    replyId: "payment_provision_form_blank",
  });
});

test("CPF/CNPJ EPI em branco não envia rótulo nem texto ao backend", async () => {
  let request;
  const client = clientWith(async (url, options) => {
    request = { url, ...options };
    return jsonResponse({ status: "processed", messages: [] });
  });

  await client.sendText({
    text: "⬜ EM BRANCO",
    replyId: "document_signing_epi_supplier_document_blank",
  });

  assert.deepEqual(JSON.parse(request.body), {
    messageId: "message-id",
    replyId: "document_signing_epi_supplier_document_blank",
  });
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

test("nova tentativa do mesmo PDF assinado reutiliza o identificador idempotente", async () => {
  const ids = [];
  const client = clientWith(async (_url, options) => {
    ids.push(options.headers["X-Portal-Message-Id"]);
    return jsonResponse({ status: "processed", messages: [] });
  });
  const file = {
    name: "documento-assinado.pdf",
    size: 3,
    type: "application/pdf",
    uploadMessageId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };

  await client.sendFile(file);
  await client.sendFile(file);

  assert.deepEqual(ids, [file.uploadMessageId, file.uploadMessageId]);
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
