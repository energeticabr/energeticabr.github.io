import { validateAttachment } from "./file-policy.js";
import { audioTranscriptionText } from "./audio-transcription.js";

const TOKEN_SCOPES = Object.freeze(["User.Read"]);
const EMPTY_EPI_REPLY_IDS = new Set([
  "document_signing_epi_order_blank",
  "document_signing_epi_supplier_document_blank",
]);

function parseBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") {
    throw new TypeError("O Energético requer uma API HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function acquireToken(tokenProvider) {
  const token = await tokenProvider([...TOKEN_SCOPES]);
  if (!token) throw new Error("A sessão Microsoft precisa ser renovada.");
  return token;
}

function checkRequestCancellation(signal) {
  if (signal?.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
}

async function cancellableToken(tokenProvider, signal) {
  checkRequestCancellation(signal);
  if (!signal) return acquireToken(tokenProvider);
  let cancel;
  const cancellation = new Promise((_, reject) => {
    cancel = () => reject(new DOMException('Consulta cancelada.', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    const token = await Promise.race([acquireToken(scopes => tokenProvider(scopes, { signal })), cancellation]);
    checkRequestCancellation(signal);
    return token;
  } finally { signal.removeEventListener('abort', cancel); }
}

function validIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name !== "SyntaxError") throw error;
    return undefined;
  }
}

function confirmedResult(result, { allowRecovery = false } = {}) {
  const acceptedStatuses = allowRecovery
    ? new Set(["processed", "processed_with_recovery"])
    : new Set(["processed"]);
  return Boolean(
    result
      && acceptedStatuses.has(result.status)
      && Array.isArray(result.messages),
  );
}

async function parsePortalResponse(response, failurePrefix, options = {}) {
  const result = await readJson(response);
  if (!response.ok) {
    const message = result?.error || `${failurePrefix} respondeu com erro ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    // A body that was interrupted while it was being streamed is safe to
    // resend. The server keys uploads by X-Portal-Message-Id, so the retry
    // cannot create a second attachment when the first request reached it.
    error.transient = response.status === 422 && /incompleto|não confirmou|temporariamente/i.test(String(message));
    throw error;
  }
  if (!confirmedResult(result, options)) {
    throw new Error("A VM não devolveu uma confirmação válida.");
  }
  return result;
}

export function createChatClient({
  apiBaseUrl,
  apiPrefix = "/api",
  tokenProvider,
  fetchImpl = globalThis.fetch,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
  retryDelay = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (typeof tokenProvider !== "function" || typeof fetchImpl !== "function") {
    throw new TypeError("O Energético requer autenticação Microsoft e acesso de rede.");
  }

  const baseUrl = parseBaseUrl(apiBaseUrl);
  if (!["/api", "/api/demo"].includes(apiPrefix)) throw new TypeError("Prefixo de API inválido.");
  const chatUrl = new URL(`${apiPrefix}/portal-chat`, baseUrl);
  const uploadUrl = new URL(`${apiPrefix}/portal-upload`, baseUrl);
  const transcriptionUrl = new URL(`${apiPrefix}/portal-transcribe`, baseUrl);

  async function signatureEvidence(operation, { documentBlob, fileName = "documento.pdf", recordId, documentId = "", signerName = "", requestId } = {}) {
    if (!documentBlob || typeof documentBlob.arrayBuffer !== "function") throw new TypeError("PDF inválido para registrar integridade.");
    const token = await acquireToken(tokenProvider);
    const destination = new URL(`${apiPrefix}/portal-signature-evidence`, baseUrl);
    destination.searchParams.set("operation", operation);
    if (operation === "prepare") {
      destination.searchParams.set("document_id", String(documentId));
      destination.searchParams.set("signer_name", String(signerName));
    } else {
      if (!/^[a-f0-9]{32}$/.test(String(recordId || ""))) throw new TypeError("Registro de integridade inválido.");
      destination.searchParams.set("record_id", recordId);
    }
    return request(destination.href, {
      method: "POST", headers: {
        Accept: "application/json", Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf", "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": requestId || newMessageId(),
      }, body: documentBlob, cache: "no-store", credentials: "omit",
    }, async response => {
      const result = await readJson(response);
      if (!response.ok) {
        const error = new Error(result?.error || `Não foi possível registrar a integridade (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (!/^[a-f0-9]{32}$/.test(String(result?.id || ""))
        || !Number.isFinite(Date.parse(result?.signedAt))
        || !/^[a-f0-9]{64}$/.test(String(result?.sourceSha256 || ""))
        || (operation === "finalize" && (result.status !== "confirmed" || !/^[a-f0-9]{64}$/.test(String(result.finalSha256 || ""))))
        || (operation === "verify" && typeof result.matches !== "boolean")) {
        throw new Error("O servidor não confirmou o registro de integridade.");
      }
      return result;
    }, true);
  }

  const prepareSignatureEvidence = options => signatureEvidence("prepare", options);
  const confirmSignatureEvidence = options => signatureEvidence("finalize", options);
  const verifySignatureEvidence = options => signatureEvidence("verify", options);

  async function request(url, options, read, readOnly = false, { retryTransient = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      checkRequestCancellation(options.signal);
      try {
        const result = await read(await fetchImpl(url, apiPrefix === "/api/demo" ? { ...options, redirect: "error" } : options));
        checkRequestCancellation(options.signal);
        if (apiPrefix === "/api/demo" && result?.status === "processed") {
          // Server preview URLs must not become direct <img> network requests.
          // The controller builds local previews from validated fetchMedia blobs.
          const withoutPreview = item => {
            if (!item || typeof item !== "object") return item;
            const { previewUrl, ...safe } = item;
            return safe;
          };
          return { ...result,
            ...(Array.isArray(result.messages) ? { messages: result.messages.map(withoutPreview) } : {}),
            ...(Array.isArray(result.attachments) ? { attachments: result.attachments.map(withoutPreview) } : {}),
          };
        }
        return result;
      } catch (error) {
        checkRequestCancellation(options.signal);
        const networkFailure = error instanceof TypeError || ["NetworkError", "AbortError"].includes(error?.name);
        const transientHttpFailure = retryTransient && (
          error?.transient === true
          || [408, 425, 429, 500, 502, 503, 504].includes(Number(error?.status))
        );
        if (!networkFailure && !transientHttpFailure) throw error;
        if (retryTransient && (networkFailure || transientHttpFailure)
          && attempt < 2 && globalThis.navigator?.onLine !== false) {
          await retryDelay((attempt + 1) * 750);
          continue;
        }
        if (!networkFailure) throw error;
        if (readOnly && attempt === 0 && globalThis.navigator?.onLine !== false) {
          await retryDelay(300);
          continue;
        }
        const translated = new Error(readOnly
          ? "A conexão foi interrompida. Verifique a internet e tente abrir novamente."
          : "A conexão foi interrompida antes da confirmação. Sua resposta pode ter chegado à VM. Use Retomar conversa antes de enviar novamente.");
        translated.code = readOnly ? "NETWORK_UNAVAILABLE" : "NETWORK_UNCERTAIN";
        throw translated;
      }
    }
  }

  const newMessageId = () => (
    typeof randomUUID === "function"
      ? randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  async function sendText({ text = "", replyId, omitText = false, homeAttachmentIds, expectedContextId, homeTransferReceipt } = {}) {
    const token = await acquireToken(tokenProvider);
    const blankEpiReply = EMPTY_EPI_REPLY_IDS.has(String(replyId || ""));
    const payload = {
      messageId: newMessageId(),
      ...(!(blankEpiReply || omitText) ? { text: String(text || "").trim() } : {}),
      ...(replyId ? { replyId: String(replyId) } : {}),
      ...(Array.isArray(homeAttachmentIds) ? {
        action: "home_attachment_transfer",
        attachmentIds: [...homeAttachmentIds],
        expectedContextId: String(expectedContextId || ""),
      } : {}),
      ...(homeTransferReceipt ? {
        action: "home_attachment_transfer", operation: "confirm",
        homeTransferReceipt: { requestId: homeTransferReceipt.requestId,
          contextId: homeTransferReceipt.contextId, attachmentIds: [...homeTransferReceipt.attachmentIds] },
      } : {}),
    };
    return request(chatUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O canal do Energético", { allowRecovery: true }));
  }

  async function sendFile(file) {
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    // Keep the native inbox identifier across retries, without accepting arbitrary headers.
    const suppliedId = [file.uploadMessageId, file.sourceId].find(value => (
      typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ));
    const sourceId = suppliedId || newMessageId();
    return request(uploadUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": String(file.type || "application/octet-stream"),
        "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": sourceId,
      },
      body: file,
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O upload"), false, { retryTransient: true });
  }

  async function transcribeAudio(file) {
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    let response;
    try {
      response = await fetchImpl(transcriptionUrl.href, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": String(file.type || "application/octet-stream"),
          "X-Portal-File-Name": encodeURIComponent(fileName),
          "X-Portal-Message-Id": newMessageId(),
        },
        body: file,
        cache: "no-store",
        credentials: "omit",
      });
    } catch (error) {
      if (error instanceof TypeError || ["NetworkError", "AbortError"].includes(error?.name)) {
        throw new Error("Falha de conexão com o serviço de transcrição. Verifique a internet e tente enviar o áudio novamente.", { cause: error });
      }
      throw error;
    }
    const result = await readJson(response);
    if (!response.ok) {
      const error = new Error(result?.error || `A transcrição respondeu com erro ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return audioTranscriptionText(result);
  }

  async function getAttachments() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "attachment_snapshot" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta de anexos"), true);
    if (!Array.isArray(result.attachments)) throw new Error("A VM não devolveu a lista de anexos.");
    return result.attachments;
  }

  async function launchGalleryRequest(operation, payload = {}, { signal } = {}) {
    const allowed = new Set(["snapshot", "detail", "schema", "update", "delete", "payment", "measurement", "attachment", "attachment_delete"]);
    if (!allowed.has(operation)) throw new Error("Operação de galeria inválida.");
    const token = await acquireToken(tokenProvider);
    const readOnly = ["snapshot", "detail", "schema", "attachment"].includes(operation);
    // The VM reads launch rows afresh on every snapshot and rejects unknown keys.
    // Refresh is a UI loader hint, not an additional server contract field.
    const requestPayload = { ...payload };
    if (operation === "snapshot") delete requestPayload.refresh;
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "launch_gallery", operation, payload: requestPayload }),
      cache: "no-store", credentials: "omit", ...(signal ? { signal } : {}),
    }, response => parsePortalResponse(response, "A galeria de lançamentos"), readOnly);
    if (!result.launchGallery || typeof result.launchGallery !== "object") throw new Error("A VM não devolveu os dados da galeria.");
    return result.launchGallery;
  }

  async function uploadLaunchGalleryFile(itemId, file, options = {}) {
    const id = String(itemId || "").trim();
    if (!/^[1-9][0-9]*$/.test(id)) throw new Error("Lançamento inválido.");
    if (options.confirm !== true) throw new Error("Confirme o envio para o lançamento.");
    const operation = options.operation || "attachment_add";
    if (!["attachment_add", "signature"].includes(operation)) throw new Error("Operação de upload inválida.");
    const fileName = validateAttachment(file);
    const token = await acquireToken(tokenProvider);
    const destination = new URL(uploadUrl.href);
    destination.searchParams.set("gallery_id", id);
    destination.searchParams.set("gallery_operation", operation);
    destination.searchParams.set("confirm", "true");
    if (options.expectedModified) destination.searchParams.set("expected_modified", options.expectedModified);
    const result = await request(destination.href, {
      method: "POST",
      headers: {
        Accept: "application/json", Authorization: `Bearer ${token}`,
        "Content-Type": String(file.type || "application/octet-stream"),
        "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": options.requestId || newMessageId(),
      },
      body: file, cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "O envio para a galeria"));
    if (!result.launchGallery || typeof result.launchGallery !== "object") throw new Error("A VM não confirmou o envio para a galeria.");
    return result.launchGallery;
  }

  async function getPendingProvisionSnapshot() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pending_provisions_snapshot" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta de provisões pendentes", { allowRecovery: true }), true);
    const snapshot = result?.pendingProvisions;
    if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("A VM não devolveu a lista de provisões pendentes.");
    return snapshot;
  }

  async function getPendingNotesSnapshot() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pending_notes_snapshot" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta de notas pendentes", { allowRecovery: true }), true);
    const snapshot = result?.pendingNotes;
    if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("A VM não devolveu a lista de notas pendentes.");
    return snapshot;
  }

  async function getDelegatedTasks() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delegated_tasks_snapshot" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta de tarefas delegadas", { allowRecovery: true }), true);
    const snapshot = result?.delegatedTasks;
    if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("A VM não devolveu a lista de tarefas delegadas.");
    return snapshot;
  }

  async function getRhidAttendanceReport(selectedDate) {
    const date = String(selectedDate || "").trim();
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para o relatório RHID.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_attendance_report", date }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O relatório de presenças RHID", { allowRecovery: true }), true);
    const report = result?.attendanceReport;
    if (!report || report.date !== date || !Array.isArray(report.rows)) {
      throw new Error("A VM não devolveu o relatório RHID da data escolhida.");
    }
    return report;
  }

  async function startRhidPendingValidation({ date, personKey, presenceId } = {}) {
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para validar presença.");
    if (!/^(?:rhid|id):[^\s:]+$/.test(String(personKey || ""))) throw new Error("Colaborador RHID inválido.");
    if (!/^[1-9]\d*$/.test(String(presenceId || ""))) throw new Error("ID de presença inválido.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_pending_validation_start", date, personKey, presenceId: String(presenceId) }),
      cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "A validação de presença", { allowRecovery: true }));
    if (!Array.isArray(result?.messages) || !result.messages.length) throw new Error("A VM não abriu a validação de presença.");
    return result;
  }

  async function getRhidAttendanceMonth(selectedMonth, { signal } = {}) {
    const month = String(selectedMonth || "").trim();
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("Selecione um mês válido para o calendário RHID.");
    const token = await cancellableToken(tokenProvider, signal);
    checkRequestCancellation(signal);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_attendance_month", month }),
      ...(signal ? { signal } : {}),
      cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "O calendário de presenças RHID", { allowRecovery: true }), true);
    const summary = result?.attendanceMonth;
    if (!summary || summary.month !== month || !Array.isArray(summary.presentDates)) {
      throw new Error("A VM não devolveu o calendário RHID do mês escolhido.");
    }
    return summary;
  }

  async function saveRhidAttendanceAdjustment({ date, personKey, slot, time, reason } = {}) {
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para o ajuste RHID.");
    if (!/^(?:rhid|id):[^\s:]+$/.test(String(personKey || ""))) throw new Error("Colaborador RHID inválido.");
    if (!["entry1", "exit1", "entry2", "exit2"].includes(slot)) throw new Error("Campo de ponto inválido.");
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) throw new Error("Informe o horário em HH:MM.");
    if (!String(reason || "").trim()) throw new Error("Informe a justificativa do ajuste.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_attendance_adjust", date, personKey, slot, time, reason: String(reason).trim() }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O ajuste de ponto RHID"));
    if (!result?.attendanceAdjustment || result.attendanceAdjustment.time !== time) {
      throw new Error("A VM não confirmou o ajuste de ponto RHID.");
    }
    return result.attendanceAdjustment;
  }

  async function refreshRhidAttendance() {
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_refresh" }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A atualização RHID"));
    if (result?.rhidRefresh?.status !== "running" || !result.rhidRefresh.requestId) {
      throw new Error("A VM não confirmou o início da atualização RHID.");
    }
    return result.rhidRefresh;
  }

  async function getRhidRefreshStatus(requestId) {
    const id = String(requestId || "").trim();
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("Pedido RHID inválido.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_refresh_status", requestId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O acompanhamento RHID", { allowRecovery: true }), true);
    if (!result?.rhidRefresh || result.rhidRefresh.requestId !== id) {
      throw new Error("A VM não confirmou o estado da atualização RHID.");
    }
    return result.rhidRefresh;
  }

  async function completeDelegatedTask(taskId) {
    const id = String(taskId || "").trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0) throw new Error("A tarefa delegada não foi identificada.");
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delegated_task_complete", taskId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A conclusão da tarefa delegada", { allowRecovery: true }));
  }

  async function deleteAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a excluir não foi identificado.");
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "attachment_delete", attachmentId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A exclusão do anexo"));
  }

  async function attachmentAction(action, payload, failurePrefix) {
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, failurePrefix));
  }

  async function deleteAllAttachments() {
    return attachmentAction("attachment_delete_all", {}, "A exclusão dos anexos");
  }

  async function compressAttachment(attachmentId) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a compactar não foi identificado.");
    return attachmentAction("attachment_compress", { attachmentId: id }, "A compactação do anexo");
  }

  async function chooseAttachmentCompression(choice) {
    const value = String(choice || "").trim();
    if (!value) throw new Error("A versão do anexo não foi escolhida.");
    return attachmentAction("attachment_compression_choice", { choice: value }, "A escolha da versão compactada");
  }

  async function getCompletionMenu(completionId) {
    const id = String(completionId || "").trim();
    if (!id) throw new Error("A conclusão do fluxo não foi identificada.");
    const token = await acquireToken(tokenProvider);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "completion_menu", completionId: id }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "A consulta do menu"), true);
  }

  async function fetchMedia(message = {}, { signal } = {}) {
    let mediaUrl;
    try {
      mediaUrl = new URL(String(message.mediaUrl || ""), baseUrl);
    } catch {
      throw new Error("Endereço de mídia inválido.");
    }
    if (mediaUrl.origin !== baseUrl.origin || !mediaUrl.pathname.startsWith(`${apiPrefix}/portal-media/`)) {
      throw new Error("Endereço de mídia inválido.");
    }

    const token = await acquireToken(tokenProvider);
    return request(mediaUrl.href, {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${token}`,
      },
      ...(signal ? { signal } : {}),
      cache: "no-store",
      credentials: "omit",
    }, response => {
      if (!response.ok) {
        const error = new Error(`Não foi possível carregar o arquivo (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      return response.blob();
    }, true);
  }

  return Object.freeze({ sendText, sendFile, transcribeAudio, fetchMedia, getAttachments, launchGalleryRequest, uploadLaunchGalleryFile, getPendingProvisionSnapshot, getPendingNotesSnapshot, getDelegatedTasks, getRhidAttendanceReport, startRhidPendingValidation, getRhidAttendanceMonth, saveRhidAttendanceAdjustment, refreshRhidAttendance, getRhidRefreshStatus, completeDelegatedTask, deleteAttachment, deleteAllAttachments, compressAttachment, chooseAttachmentCompression, getCompletionMenu, prepareSignatureEvidence, confirmSignatureEvidence, verifySignatureEvidence });
}
