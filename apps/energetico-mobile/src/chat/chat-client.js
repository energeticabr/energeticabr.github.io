import { validateSefazReceipt, isSefazRequestId } from './sefaz-sync-receipt.js';
import { validateDdaPaymentReceipt } from './dda-payment-confirmation.js';
import { validateAttachment } from "./file-policy.js";
import { audioTranscriptionText } from "./audio-transcription.js";
import { startDiaryProgress } from "./diary-attachment-progress.js";
import { uploadWithProgress } from "./upload-transport.js";
import { readDownloadBlob } from "../../../../portal/data/download-progress.js";
import { beginLoadingTask } from "../ui/loading-task.js";

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

async function readMediaBlob(response, maxBytes, options = {}) {
  const tooLarge = () => Object.assign(new Error('O original excede o limite da prévia automática.'), { code: 'MEDIA_PREVIEW_TOO_LARGE' });
  return readDownloadBlob(response, { ...options, maxBytes, tooLarge });
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
    if (options.allowFailureCode && typeof result?.code === "string" && /^[a-z_]+$/.test(result.code)) {
      error.code = result.code;
    }
    if (response.status === 422 && result?.code === "ATTACHMENT_UNAVAILABLE"
      && Array.isArray(result.unavailableAttachmentIds)) {
      error.code = "ATTACHMENT_UNAVAILABLE";
      error.unavailableAttachmentIds = [...new Set(result.unavailableAttachmentIds
        .filter(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0, 1000))];
    }
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
  xhrFactory = typeof globalThis.XMLHttpRequest === 'function' ? () => new globalThis.XMLHttpRequest() : null,
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

  async function signatureEvidence(operation, { documentBlob, fileName = "documento.pdf", recordId, documentId = "", signerName = "", requestId, publicVerification = false, capture } = {}) {
    if (operation !== "capture" && (!documentBlob || typeof documentBlob.arrayBuffer !== "function")) throw new TypeError("PDF inválido para registrar integridade.");
    const token = await acquireToken(tokenProvider);
    const destination = new URL(`${apiPrefix}/portal-signature-evidence`, baseUrl);
    destination.searchParams.set("operation", operation);
    if (operation === "prepare") {
      destination.searchParams.set("document_id", String(documentId));
      destination.searchParams.set("signer_name", String(signerName));
      if (publicVerification) destination.searchParams.set("public_verification", "true");
    } else {
      if (!/^[a-f0-9]{32}$/.test(String(recordId || ""))) throw new TypeError("Registro de integridade inválido.");
      destination.searchParams.set("record_id", recordId);
    }
    return request(destination.href, {
      method: "POST", headers: {
        Accept: "application/json", Authorization: `Bearer ${token}`,
        "Content-Type": operation === "capture" ? "application/json" : "application/pdf", "X-Portal-File-Name": encodeURIComponent(fileName),
        "X-Portal-Message-Id": requestId || newMessageId(),
      }, body: operation === "capture" ? JSON.stringify(capture) : documentBlob, cache: "no-store", credentials: "omit",
    }, async response => {
      const result = await readJson(response);
      if (!response.ok) {
        const error = new Error(result?.error || `Não foi possível registrar a integridade (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      if (!/^[a-f0-9]{32}$/.test(String(result?.id || ""))
        || (operation !== "prepare" && result?.id !== recordId)
        || !Number.isFinite(Date.parse(result?.signedAt))
        || !/^[a-f0-9]{64}$/.test(String(result?.sourceSha256 || ""))
        || (operation === "finalize" && (result.status !== "confirmed" || !/^[a-f0-9]{64}$/.test(String(result.finalSha256 || ""))))
        || (operation === "verify" && typeof result.matches !== "boolean")) {
        throw new Error("O servidor não confirmou o registro de integridade.");
      }
      if (operation === "prepare" && publicVerification) {
        let verification;
        try { verification = new URL(result.verificationUrl); } catch { throw new Error("O servidor não confirmou o link público da assinatura."); }
        if (verification.protocol !== "https:" || verification.username || verification.password || verification.search || verification.hash
          || !new RegExp(`^/assinaturas/${result.id}/[a-f0-9]{64}$`).test(verification.pathname)) throw new Error("Link público da assinatura inválido.");
      }
      return result;
    }, true);
  }

  const prepareSignatureEvidence = options => signatureEvidence("prepare", options);
  const confirmSignatureEvidence = options => signatureEvidence("finalize", options);
  const verifySignatureEvidence = options => signatureEvidence("verify", options);
  const captureSignatureEvidence = options => signatureEvidence("capture", options);

  async function request(url, options, read, readOnly = false, { retryTransient = false, transport = fetchImpl } = {}) {
    for (let attempt = 0; ; attempt++) {
      checkRequestCancellation(options.signal);
      try {
        const result = await read(await transport(url, apiPrefix === "/api/demo" ? { ...options, redirect: "error" } : options));
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

  function operationMonitor(callback, signal, requestId) {
    if (typeof callback !== "function") return null;
    const task = beginLoadingTask(callback, { signal });
    let polling;
    return {
      prepared() {
        task.prepared();
        polling = startDiaryProgress({ onProgress: task.report, signal,
          read: pollSignal => getDiaryAttachmentProgress(requestId, { signal: pollSignal, action: "operation_progress" }) });
      },
      accept(result) {
        task.acquired();
        if (result.status === "processed" && !result.error
          && !result.results?.some(item => /error|fail|paused|invalid|unavailable|reupload/i.test(String(item?.status || "")))) task.complete();
      },
      stop() { polling?.stop(); task.stop(); },
    };
  }

  async function sendText({ text = "", replyId, omitText = false, homeAttachmentIds, expectedContextId, homeTransferReceipt,
    onProgress, onOperationProgress: defaultOperationProgress, progressSignal: defaultProgressSignal } = {},
  { onOperationProgress = defaultOperationProgress, progressSignal = defaultProgressSignal } = {}) {
    const messageId = newMessageId();
    const operation = operationMonitor(onOperationProgress, progressSignal, messageId);
    let progress;
    try {
    const resumeControl = replyId === 'input_continue' && !String(text || '').trim()
      && !homeAttachmentIds && !homeTransferReceipt;
    const token = await (resumeControl ? cancellableToken(tokenProvider, progressSignal) : acquireToken(tokenProvider));
    operation?.prepared();
    const blankEpiReply = EMPTY_EPI_REPLY_IDS.has(String(replyId || ""));
    const payload = {
      messageId,
      ...(operation ? { progressRequestId: messageId } : {}),
      ...(typeof onProgress === "function" ? { trackDiaryEvidence: true } : {}),
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
    progress = typeof onProgress === "function" ? startDiaryProgress({
      onProgress, signal: progressSignal,
      read: signal => getDiaryAttachmentProgress(payload.messageId, { signal }),
    }) : null;
      const result = await request(chatUrl.href, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
      ...(resumeControl && progressSignal ? { signal: progressSignal } : {}),
      }, response => parsePortalResponse(response, "O canal do Energético", { allowRecovery: true }));
      if (result.status === "processed" && !result.error
          && !result.results?.some(item => /error|fail|paused|invalid|unavailable|reupload/i.test(String(item?.status || "")))
          && result.diaryEvidenceProgress?.requestId === payload.messageId) progress?.complete(result.diaryEvidenceProgress);
      operation?.accept(result);
      return result;
    } finally { progress?.stop(); operation?.stop(); }
  }

  async function getDiaryAttachmentProgress(requestId, { signal, action = "diary_evidence_progress" } = {}) {
    const token = await cancellableToken(tokenProvider, signal);
    return request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestId }),
      cache: "no-store", credentials: "omit", signal,
    }, async response => {
      if (!response.ok) throw new Error("Progresso indisponível");
      const value = await readJson(response);
      if (value?.requestId !== requestId || !["running", "complete", "failed", "unavailable"].includes(value.status)) {
        throw new Error("Progresso inválido");
      }
      return value;
    }, true);
  }

  async function waitForDiaryEvidence({ signal, onProgress } = {}) {
    // The isolated demonstration has no corporate diary jobs or this action.
    if (apiPrefix === '/api/demo') return;
    for (;;) {
      checkRequestCancellation(signal);
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 30_000);
      let result;
      try {
        const token = await cancellableToken(tokenProvider, abort.signal);
        result = await request(chatUrl.href, {
          method: 'POST', signal: abort.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'diary_evidence_pending' }), cache: 'no-store', credentials: 'omit',
        }, async response => {
          if (response.status === 404) return { status: 'unavailable' };
          const value = await readJson(response);
          // Before this action existed, the bridge rejected its action-only
          // payload as an empty message, before any workflow mutation.
          if (response.status === 422 && value?.error === 'Mensagem vazia') return { status: 'unavailable' };
          if (!response.ok) throw Object.assign(new Error('Não foi possível acompanhar o PDF. Verifique a conexão e retome a conversa.'), { status: response.status });
          if (value?.status === 'unavailable') return value;
          if (value?.status !== 'running' || typeof value.requestId !== 'string'
              || !Number.isFinite(value.percent) || value.percent < 0 || value.percent > 99) {
            throw new Error('A VM não confirmou o processamento do PDF.');
          }
          return value;
        }, true);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
      checkRequestCancellation(signal);
      if (result.status !== 'running') return;
      onProgress?.(result);
      await retryDelay(1000);
    }
  }

  async function uploadFile(file, { onProgress, progressSignal, uploadId } = {}, target = uploadUrl) {
    const fileName = validateAttachment(file);
    let previousPercent;
    const progress = percent => {
      if (progressSignal?.aborted || previousPercent === percent) return;
      previousPercent = percent;
      // Optional presentation must never break or retry a real upload.
      try { onProgress?.({ percent }); } catch { /* telemetry only */ }
    };
    checkRequestCancellation(progressSignal);
    progress(0);
    const token = await cancellableToken(tokenProvider, progressSignal);
    // Keep the native inbox identifier across retries, without accepting arbitrary headers.
    const suppliedId = [uploadId, file.uploadMessageId, file.sourceId].find(value => (
      typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ));
    const sourceId = suppliedId || newMessageId();
    const result = await request(target.href, {
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
      ...(progressSignal ? { signal: progressSignal } : {}),
    }, response => parsePortalResponse(response, "O upload"), false, {
      retryTransient: true,
      ...(typeof onProgress === 'function' && typeof xhrFactory === 'function' && apiPrefix !== '/api/demo'
        ? { transport: (url, options) => uploadWithProgress(url, options, { xhrFactory, onProgress: progress }) } : {}),
    });
    if (!result.error && !result.results?.some(item => /error|fail|paused|invalid|unavailable|reupload/i.test(String(item?.status || '')))) progress(100);
    return result;
  }

  function sendFile(file, options) { return uploadFile(file, options); }

  async function replaceAttachment(attachmentId, file, { expectedSha256, requestId, onProgress, progressSignal } = {}) {
    const id = String(attachmentId || ''), sha = String(expectedSha256 || '');
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(sha)
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(requestId || ''))) {
      throw new TypeError('Identificador ou hash da substituição inválido.');
    }
    if (file?.type !== 'application/pdf' || !/\.pdf$/i.test(file?.name || '')) {
      throw new TypeError('A substituição deve ser um PDF.');
    }
    const target = new URL(uploadUrl);
    for (const [key, value] of Object.entries({ operation: 'attachment_replace', attachment_id: id,
      expected_sha256: sha, request_id: requestId })) target.searchParams.set(key, value);
    const result = await uploadFile(file, { progressSignal, uploadId: requestId,
      ...(typeof onProgress === 'function' ? { onProgress: progress => onProgress({ percent: Math.min(99, progress.percent) }) } : {}),
    }, target);
    const replacement = result.replacement;
    if (result.operation !== 'attachment_replaced' || result.requestId !== requestId
      || result.previousAttachmentId !== id || !/^[a-f0-9]{64}$/.test(replacement?.id || '')
      || replacement.id === id || replacement.fileName !== file.name || replacement.mimeType !== 'application/pdf'
      || replacement.size !== file.size || !replacement.mediaUrl || !Array.isArray(result.attachments)
      || result.attachments.some(item => item.id === id)
      || !result.attachments.some(item => item.id === replacement.id && item.mediaUrl === replacement.mediaUrl
        && item.fileName === replacement.fileName && item.size === file.size && item.mimeType === 'application/pdf')) {
      throw new Error('A VM não confirmou a substituição deste anexo. Atualize a bandeja antes de tentar novamente.');
    }
    checkRequestCancellation(progressSignal);
    try { onProgress?.({ percent: 100 }); } catch { /* presentation only */ }
    return result;
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

  async function getAttachments({ signal } = {}) {
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "attachment_snapshot" }),
      cache: "no-store",
      credentials: "omit",
      ...(signal ? { signal } : {}),
    }, response => parsePortalResponse(response, "A consulta de anexos"), true);
    if (!Array.isArray(result.attachments)) throw new Error("A VM não devolveu a lista de anexos.");
    return result.attachments;
  }

  async function launchGalleryRequest(operation, payload = {}, { signal, onProgress } = {}) {
    const reads = ["snapshot", "detail", "schema", "attachment", "payroll_pending", "payroll_targets", "payroll_detail"];
    const writes = ["update", "delete", "payment", "measurement", "attachment_delete", "payroll_apply", "payroll_legacy_link", "payroll_provision_link"];
    const readOnly = reads.includes(operation);
    if (!readOnly && !writes.includes(operation)) throw new Error("Operação de galeria inválida.");
    const payrollRequest = operation.startsWith("payroll_");
    const progressId = typeof onProgress === "function" ? newMessageId() : null;
    const progress = operationMonitor(onProgress, signal, progressId);
    try {
    const token = await cancellableToken(tokenProvider, signal);
    progress?.prepared();
    // The VM reads launch rows afresh on every snapshot and rejects unknown keys.
    // Refresh is a UI loader hint, not an additional server contract field.
    const requestPayload = { ...payload };
    if (operation === "snapshot") delete requestPayload.refresh;
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "launch_gallery", operation, payload: requestPayload,
        ...(progress ? { progressRequestId: progressId } : {}) }),
      cache: "no-store", credentials: "omit", ...(signal ? { signal } : {}),
    }, response => parsePortalResponse(response, "A galeria de lançamentos", { allowFailureCode: payrollRequest }), readOnly);
    if (!result.launchGallery || typeof result.launchGallery !== "object") throw new Error("A VM não devolveu os dados da galeria.");
    progress?.accept(result);
    return result.launchGallery;
    } finally { progress?.stop(); }
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

  async function getPendingProvisionSnapshot(options = {}) {
    const result = await portalAction("pending_provisions_snapshot", { sourceKind: "provision-description" }, "A consulta de provisões pendentes", options, { readOnly: true, allowRecovery: true });
    const snapshot = result?.pendingProvisions;
    if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("A VM não devolveu a lista de provisões pendentes.");
    return snapshot;
  }

  async function getPendingNotesSnapshot(options = {}) {
    const result = await portalAction("pending_notes_snapshot", {}, "A consulta de notas pendentes", options, { readOnly: true, allowRecovery: true });
    const snapshot = result?.pendingNotes;
    if (!snapshot || !Array.isArray(snapshot.rows)) throw new Error("A VM não devolveu a lista de notas pendentes.");
    return snapshot;
  }

  async function getRhidAttendanceReport(selectedDate, { includeRegistration = false, ...options } = {}) {
    const date = String(selectedDate || "").trim();
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para o relatório RHID.");
    const result = await portalAction("rhid_attendance_report", { date, ...(includeRegistration === true ? { includeRegistration: true } : {}) }, "O relatório de presenças RHID", options, { readOnly: true, allowRecovery: true });
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

  async function startRhidDayValidation(selectedDate) {
    const date = String(selectedDate || "").trim();
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para validar presenças.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rhid_day_validation_start", date }),
      cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "A lista de presenças pendentes", { allowRecovery: true }));
    if (!Array.isArray(result?.messages) || !result.messages.length) throw new Error("A VM não abriu a lista de presenças pendentes.");
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

  async function saveRhidAttendanceAdjustment({ date, personKey, slot, time, reason, fillMissing = false } = {}) {
    if (!validIsoDate(date)) throw new Error("Selecione uma data válida para o ajuste RHID.");
    if (!/^(?:rhid|id):[^\s:]+$/.test(String(personKey || ""))) throw new Error("Colaborador RHID inválido.");
    if (!["entry1", "exit1", "entry2", "exit2"].includes(slot)) throw new Error("Campo de ponto inválido.");
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""))) throw new Error("Informe o horário em HH:MM.");
    if (!String(reason || "").trim()) throw new Error("Informe a justificativa do ajuste.");
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: fillMissing === true ? "rhid_attendance_fill_missing" : "rhid_attendance_adjust",
        date, personKey, slot, time, reason: String(reason).trim() }),
      cache: "no-store",
      credentials: "omit",
    }, response => parsePortalResponse(response, "O ajuste de ponto RHID"));
    if (!result?.attendanceAdjustment || result.attendanceAdjustment.time !== time) {
      throw new Error("A VM não confirmou o ajuste de ponto RHID.");
    }
    return result.attendanceAdjustment;
  }

  async function deleteRhidAttendanceAdjustment({ date, personKey, slot, revisionId } = {}) {
    if (!validIsoDate(date)) throw new Error('Selecione uma data válida para o ajuste RHID.');
    if (!/^(?:rhid|id):[^\s:]+$/.test(String(personKey || ''))) throw new Error('Colaborador RHID inválido.');
    if (!['entry1', 'exit1', 'entry2', 'exit2'].includes(slot)) throw new Error('Campo de ponto inválido.');
    if (!/^[1-9]\d*$/.test(String(revisionId || ''))) throw new Error('Registro de ajuste inválido.');
    const token = await acquireToken(tokenProvider);
    const result = await request(chatUrl.href, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rhid_attendance_adjust_delete', date, personKey, slot, revisionId: String(revisionId) }),
      cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, 'A exclusão do ajuste de ponto RHID'));
    const deletion = result?.attendanceAdjustmentDeletion;
    if (deletion?.deleted !== true || String(deletion.revisionId) !== String(revisionId)) throw new Error('A VM não confirmou a exclusão do registro.');
    return deletion;
  }

  async function sefazRequest(action, requestId, {signal} = {}, extra = {}) {
    if (extra.mode !== 'pending' && !isSefazRequestId(requestId)) throw Error('Pedido fiscal inválido.');
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method:'POST', signal,
      headers:{Accept:'application/json', Authorization:'Bearer '+token, 'Content-Type':'application/json'},
      body:JSON.stringify({action, ...(requestId ? {requestId} : {}), ...extra}), cache:'no-store', credentials:'omit',
    }, response => parsePortalResponse(response, 'A consulta fiscal'), action === 'sefaz_refresh_status');
    const receipt = result?.sefazRefresh;
    if (extra.mode === 'pending') {
      if (receipt?.status !== 'pending' || !Array.isArray(receipt.requests)) throw Error('Não foi possível recuperar as consultas fiscais.');
      const pending={status:'pending',requests:receipt.requests.map(validateSefazReceipt)};
      if (receipt.lastSuccessfulUtc !== undefined) {
        if (typeof receipt.lastSuccessfulUtc !== 'string'
          || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(receipt.lastSuccessfulUtc)
          || !Number.isFinite(Date.parse(receipt.lastSuccessfulUtc))) throw Error('Não foi possível recuperar as consultas fiscais.');
        pending.lastSuccessfulUtc=receipt.lastSuccessfulUtc;
      }
      if (receipt.lastSuccessfulCreatedItemIds !== undefined) {
        const ids=receipt.lastSuccessfulCreatedItemIds;
        if (!Array.isArray(ids) || ids.some(id=>!Number.isSafeInteger(id)||id<=0)) throw Error('Não foi possível recuperar as consultas fiscais.');
        pending.lastSuccessfulCreatedItemIds=[...new Set(ids)];
      }
      return pending;
    }
    if (extra.acknowledge) {
      if (receipt?.status !== 'acknowledged' || receipt.requestId !== requestId) throw Error('Reconhecimento fiscal não confirmado.');
      return {status:'acknowledged',requestId};
    }
    const safe = validateSefazReceipt(receipt);
    if (action === 'sefaz_refresh_status' && safe.requestId !== requestId) throw Error('Pedido fiscal divergente.');
    return safe;
  }
  function refreshSefaz(options) { return sefazRequest('sefaz_refresh', options?.requestId, options); }
  function getSefazRefreshStatus(requestId, options) { return sefazRequest('sefaz_refresh_status', requestId, options); }
  function getSefazRefreshPending(options) { return sefazRequest('sefaz_refresh_status', null, options, {mode:'pending'}); }
  function acknowledgeSefazRefresh(requestId, options) { return sefazRequest('sefaz_refresh_status', requestId, options, {acknowledge:true}); }

  async function ddaRequest(action, requestId, { signal } = {}, extra = {}) {
    const sicoob = action.startsWith('sicoob_');
    const isStatus = action.endsWith('_refresh_status');
    const source = sicoob ? 'Sicoob' : 'DDA';
    if ((requestId || (isStatus && !extra.mode) || (sicoob && !isStatus)) && !/^[a-f0-9]{32}$/.test(String(requestId || ''))) throw new Error(`Pedido ${source} inválido.`);
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: 'POST', signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(requestId ? { requestId } : {}), ...extra }),
      cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, `A consulta ${source}`), isStatus);
    const receipt = sicoob ? result?.sicoobRefresh : result?.ddaRefresh;
    if (sicoob && extra.mode === 'latest') {
      return validateSicoobLatestAttempt(receipt);
    }
    const allowed=extra.mode==='pending'?['pending']:extra.acknowledge?['acknowledged']:['queued', 'running', 'succeeded', 'failed', 'unavailable', 'busy'];
    if (!receipt || !allowed.includes(receipt.status)
      || (isStatus && requestId && receipt.requestId !== requestId)
      || (extra.mode==='pending' && !Array.isArray(receipt.requests))) throw new Error(`A VM não confirmou a consulta ${source}.`);
    return receipt;
  }
  function validateSicoobLatestAttempt(receipt) {
    if (receipt?.status === 'unknown') return null;
    const completedAt = Date.parse(receipt?.completedUtc);
    const lastSuccessfulAt = receipt?.lastSuccessfulUtc == null ? null : Date.parse(receipt.lastSuccessfulUtc);
    if (!['succeeded', 'failed'].includes(receipt?.status) || !Number.isFinite(completedAt)
      || (lastSuccessfulAt !== null && (!Number.isFinite(lastSuccessfulAt) || lastSuccessfulAt > completedAt))
      || (receipt.status === 'succeeded' && lastSuccessfulAt !== completedAt)) {
      throw new Error('A VM não confirmou a última atualização Sicoob.');
    }
    return { status: receipt.status, completedAt, lastSuccessfulAt };
  }
  function getSicoobLatestAttempt(options) { return ddaRequest('sicoob_refresh_status', null, options, { mode: 'latest' }); }
  function refreshSicoob(options) { return ddaRequest('sicoob_refresh', options?.requestId, options); }
  function getSicoobRefreshStatus(requestId, options) { return ddaRequest('sicoob_refresh_status', requestId, options); }
  function getSicoobRefreshPending(options) { return ddaRequest('sicoob_refresh_status', null, options, { mode: 'pending' }); }
  function acknowledgeSicoobRefresh(requestId, options) { return ddaRequest('sicoob_refresh_status', requestId, options, { acknowledge: true }); }
  async function swileRequest(operation, payload = {}, { signal } = {}) {
    if (apiPrefix === '/api/demo') throw new Error('A integração Swile está disponível no ambiente da empresa.');
    if (!['directory', 'preview', 'confirm', 'orders', 'provision'].includes(operation)) throw new TypeError('Operação Swile inválida.');
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: 'POST', signal, redirect: 'error',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action: `swile_${operation}` }),
      cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, 'A consulta Swile'), !['confirm', 'provision'].includes(operation)).catch(error => {
      if (operation === 'confirm' && error.code === 'NETWORK_UNCERTAIN') {
        throw new Error('O envio ficou sem confirmação. Consulte Pedidos enviados na aba Swile antes de reenviar.', { cause: error });
      }
      throw error;
    });
    if (!result?.swile || typeof result.swile !== 'object') throw new Error('A integração Swile ainda não está disponível.');
    return result.swile;
  }
  async function trancidRechargeRequest(operation, payload = {}, { signal } = {}) {
    if (apiPrefix === '/api/demo') throw new Error('A integração Trancid está disponível no ambiente da empresa.');
    if (!['directory', 'preview', 'confirm', 'history', 'details', 'boleto', 'provision_preview', 'provision'].includes(operation)) {
      throw new TypeError('Operação Trancid inválida.');
    }
    const token = await cancellableToken(tokenProvider, signal);
    const readOnly = !['confirm', 'provision'].includes(operation);
    try {
      const result = await request(chatUrl.href, {
        method: 'POST', signal, redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, action: `trancid_recharge_${operation}` }),
        cache: 'no-store', credentials: 'omit',
      }, response => parsePortalResponse(response, 'A consulta Trancid'), readOnly);
      if (!result?.trancid || typeof result.trancid !== 'object') throw new Error('A integração Trancid ainda não está disponível.');
      return result.trancid;
    } catch (error) {
      if (operation === 'provision' && error.code === 'NETWORK_UNCERTAIN') {
        throw new Error('A confirmação da provisão não foi recebida. Abra a conferência novamente para retomar.', { cause: error });
      }
      if (operation === 'confirm' && (error.code === 'NETWORK_UNCERTAIN' || !error.status || error.status >= 500)) {
        throw Object.assign(new Error('O envio ficou sem confirmação. Confira a Galeria Trancid antes de reenviar.', { cause: error }), {
          code: 'TRANCID_CONFIRMATION_UNCERTAIN',
        });
      }
      throw error;
    }
  }
  async function getSicoobBalance({ signal } = {}) {
    if (apiPrefix === '/api/demo') return null;
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: 'POST', signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sicoob_balance' }),
      cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, 'A consulta de saldo Sicoob'), true);
    const balance = result?.sicoobBalance;
    if (balance === null) return null;
    if (!Number.isSafeInteger(balance?.balanceCents) || typeof balance.asOf !== 'string'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(balance.asOf) || !Number.isFinite(Date.parse(balance.asOf))) {
      throw new Error('O banco não confirmou o saldo da conta corrente.');
    }
    return { balanceCents: balance.balanceCents, asOf: balance.asOf };
  }
  async function confirmDdaPayment({ itemId, key, signal } = {}) {
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || itemId > 2147483647 || !/^[a-f0-9]{64}$/.test(String(key || ''))) throw new Error('DDA inválido para confirmação.');
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: 'POST', signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dda_payment_confirm', itemId, key }), cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, 'A confirmação do pagamento DDA'));
    return validateDdaPaymentReceipt(result?.ddaPaymentConfirmation, { itemId, key });
  }
  async function scheduleDdaPayment(operation, payload = {}, { signal } = {}) {
    if (!['list', 'quote', 'confirm', 'status'].includes(operation)) throw new Error('Operação de agendamento inválida.');
    if (apiPrefix === '/api/demo') return { status: 'unavailable' };
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: 'POST', signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action: `dda_schedule_${operation}` }), cache: 'no-store', credentials: 'omit',
    }, response => parsePortalResponse(response, 'O agendamento DDA'), operation !== 'confirm');
    const schedule = result?.ddaSchedule;
    if (!schedule || typeof schedule.status !== 'string' || (operation === 'list' && !Array.isArray(schedule.entries))) {
      throw new Error('O servidor não confirmou a situação do agendamento.');
    }
    return schedule;
  }
  function refreshDda(options) { return ddaRequest('dda_refresh', options?.requestId || null, options); }
  function getDdaRefreshStatus(requestId, options) { return ddaRequest('dda_refresh_status', requestId, options); }
  function getDdaRefreshPending(options) { return ddaRequest('dda_refresh_status', null, options, {mode:'pending'}); }
  function acknowledgeDdaRefresh(requestId, options) { return ddaRequest('dda_refresh_status', requestId, options, {acknowledge:true}); }

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

  async function refreshRecurringProvisions({ signal } = {}) {
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "provision_refresh" }), signal,
      cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "A sincronização de provisões"));
    if (result?.provisionRefresh?.status !== "running" || !/^[a-f0-9]{32}$/i.test(String(result.provisionRefresh.requestId || ""))) {
      throw new Error("A VM não confirmou o início da sincronização de provisões.");
    }
    return result.provisionRefresh;
  }

  async function getRecurringProvisionRefreshStatus(requestId, { signal } = {}) {
    const id = String(requestId || "").trim();
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error("Pedido de sincronização de provisões inválido.");
    const token = await cancellableToken(tokenProvider, signal);
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "provision_refresh_status", requestId: id }), signal,
      cache: "no-store", credentials: "omit",
    }, response => parsePortalResponse(response, "O acompanhamento da sincronização de provisões", { allowRecovery: true }), true);
    if (!result?.provisionRefresh || result.provisionRefresh.requestId !== id) {
      throw new Error("A VM não confirmou o estado da sincronização de provisões.");
    }
    return result.provisionRefresh;
  }

  async function deleteAttachment(attachmentId, options = {}) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a excluir não foi identificado.");
    return portalAction("attachment_delete", { attachmentId: id }, "A exclusão do anexo", options);
  }

  async function portalAction(action, payload, failurePrefix, options = {}, { readOnly = false, allowRecovery = false } = {}) {
    const callback = options.onProgress || options.onOperationProgress;
    const progressId = typeof callback === "function" ? newMessageId() : null;
    const progress = operationMonitor(callback, options.progressSignal || options.signal, progressId);
    try {
    const token = await acquireToken(tokenProvider);
    progress?.prepared();
    const result = await request(chatUrl.href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload, ...(progress ? { progressRequestId: progressId } : {}) }),
      cache: "no-store",
      credentials: "omit",
      ...(readOnly && options.signal ? { signal: options.signal } : {}),
    }, response => parsePortalResponse(response, failurePrefix, { allowRecovery }), readOnly);
    progress?.accept(result);
    return result;
    } finally { progress?.stop(); }
  }

  async function deleteAllAttachments(options = {}) {
    return portalAction("attachment_delete_all", {}, "A exclusão dos anexos", options);
  }

  async function compressAttachment(attachmentId, options = {}) {
    const id = String(attachmentId || "").trim();
    if (!id) throw new Error("O anexo a compactar não foi identificado.");
    return portalAction("attachment_compress", { attachmentId: id }, "A compactação do anexo", options);
  }

  async function chooseAttachmentCompression(choice, options = {}) {
    const value = String(choice || "").trim();
    if (!value) throw new Error("A versão do anexo não foi escolhida.");
    return portalAction("attachment_compression_choice", { choice: value }, "A escolha da versão compactada", options);
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

  async function cameraRequest(payload, signal) {
    if (apiPrefix !== "/api") return payload.action === "status-events"
      ? { events: [], cursor: 0, generation: "00000000000000000000000000000000" }
      : { channels: [], visuals: [] };
    const token = await cancellableToken(tokenProvider, signal);
    return request(new URL("/api/portal-cameras", baseUrl).href, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload), credentials: "omit", cache: "no-store", redirect: "error", signal,
    }, async response => {
      if (response.status === 403) throw Object.assign(new Error("Sua conta não tem acesso às câmeras."), { status: 403 });
      if (response.status === 429) throw Object.assign(new Error(payload.action === "move"
        ? "Aguarde um instante antes de mover novamente."
        : "O serviço de câmeras está ocupado. Tente novamente em instantes."), { status: 429 });
      if (!response.ok) throw Object.assign(new Error("O serviço de câmeras está indisponível. Tente novamente em instantes."),
        { status: response.status });
      return readJson(response);
    }, payload.action !== "move");
  }

  async function listCameraChannels({ signal } = {}) {
    const result = await cameraRequest({ action: "list" }, signal);
    if (!Array.isArray(result?.channels)) throw new Error("Não foi possível carregar as câmeras.");
    return result.channels.filter(channel => /^[a-z0-9-]{1,48}$/.test(channel?.id)
      && typeof channel.label === "string" && channel.label.length <= 120).map(channel => {
      const lastOnlineAt = typeof channel.lastOnlineAt === "string"
        && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(channel.lastOnlineAt)
        && Number.isFinite(Date.parse(channel.lastOnlineAt)) ? channel.lastOnlineAt : null;
      const camera = {
        id: channel.id,
        label: channel.label,
        status: channel.status === "online" || channel.status === "offline" ? channel.status : "unknown",
        lastOnlineAt,
      };
      if (typeof channel.cameraGroup === "string" && /^[a-z0-9-]{1,48}$/.test(channel.cameraGroup)) {
        camera.cameraGroup = channel.cameraGroup;
        if (typeof channel.cameraLabel === "string" && channel.cameraLabel.length <= 120 && channel.cameraLabel.trim()) {
          camera.cameraLabel = channel.cameraLabel;
        }
      }
      return camera;
    });
  }

  async function listCameraStatusEvents({ after, signal } = {}) {
    const result = await cameraRequest({ action: "status-events", ...(after !== undefined ? { after } : {}) }, signal);
    if (!Array.isArray(result?.events) || !Number.isSafeInteger(result?.cursor) || result.cursor < 0
      || !/^[a-f0-9]{32}$/.test(result?.generation || "")
      || result.events.length > 100) throw new Error("Não foi possível consultar as mudanças de status das câmeras.");
    const events = result.events.filter(event => Number.isSafeInteger(event?.id) && event.id > 0
      && /^[a-z0-9-]{1,48}$/.test(event?.channelId || "")
      && (event?.status === "online" || event?.status === "offline")
      && typeof event?.label === "string" && event.label.length > 0 && event.label.length <= 120
      && typeof event?.changedAt === "string"
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(event.changedAt)
      && Number.isFinite(Date.parse(event.changedAt))).map(event => ({
        id: event.id,
        channelId: event.channelId,
        status: event.status,
        label: event.label,
        changedAt: event.changedAt,
      }));
    if (events.length !== result.events.length) throw new Error("O serviço retornou uma mudança de câmera inválida.");
    return { events, cursor: result.cursor, generation: result.generation };
  }

  function readCameraVisual(visual) {
    if (typeof visual?.id !== "string" || !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(visual.id)
        || typeof visual.name !== "string" || !visual.name.trim() || visual.name.length > 120
        || !Array.isArray(visual.cameraIds) || visual.cameraIds.length < 1 || visual.cameraIds.length > 8
        || visual.cameraIds.some(id => typeof id !== "string" || !/^[a-z0-9-]{1,48}$/.test(id))
        || new Set(visual.cameraIds).size !== visual.cameraIds.length) {
      throw new Error("O serviço retornou um visual inválido.");
    }
    return { id: visual.id, name: visual.name, cameraIds: visual.cameraIds };
  }

  async function listCameraVisuals({ signal } = {}) {
    const result = await cameraRequest({ action: "list-visuals" }, signal);
    if (!Array.isArray(result?.visuals)) throw new Error("Não foi possível carregar os visuais.");
    return result.visuals.map(readCameraVisual);
  }

  async function writeCameraVisual(action, visual, { signal } = {}) {
    const result = await cameraRequest({ action, ...visual }, signal);
    return readCameraVisual(result?.visual);
  }

  function cameraPlaylistUrl(path) {
    return typeof path === "string" && /^\/api\/portal-camera-media\/[A-Za-z0-9_-]{43}\/(?:index|h264|hevc)\.m3u8$/.test(path)
      ? new URL(path, baseUrl).href : null;
  }

  function cameraPlaylistPath(url) {
    if (typeof url !== "string" || !url.startsWith(baseUrl.origin + "/")) return null;
    const path = url.slice(baseUrl.origin.length);
    return cameraPlaylistUrl(path) ? path : null;
  }

  async function renewCameraPlayback(urls, { signal } = {}) {
    const paths = [...new Set(urls.map(cameraPlaylistPath).filter(Boolean))];
    if (paths.length) await cameraRequest({ action: "renew-live", paths }, signal);
  }

  function cameraReadiness(url, signal, readResponse) {
    return request(url + "?ready=1", {
      method: "GET", cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal,
    }, readResponse, true);
  }

  async function cameraPlaybackIsGone(url, { signal } = {}) {
    if (!cameraPlaylistPath(url)) return false;
    return cameraReadiness(url, signal, response => response.status === 404);
  }

  async function startCameraPlayback(channelId, { signal, codecs, previousUrl } = {}) {
    if (!/^[a-z0-9-]{1,48}$/.test(channelId ?? "")) throw new Error("Selecione uma câmera.");
    const replacePath = cameraPlaylistPath(previousUrl) ?? undefined;
    const result = await cameraRequest({ action: "play", channelId, codecs, replacePath }, signal);
    const url = cameraPlaylistUrl(result?.path);
    if (!url) throw new Error("Não foi possível abrir a transmissão.");
    return url;
  }

  function prepareCameraGrid(channelIds, { signal, codecs, previousUrl } = {}) {
    const payload = { action: "play-grid", channelIds, codecs };
    if (channelIds?.length === 1) {
      const previousPath = cameraPlaylistPath(previousUrl);
      if (previousPath) payload.replacePath = previousPath;
    }
    const open = () => cameraRequest(payload, signal);
    let retried;
    const retry = hint => {
      // The gateway can release an inactive preview from this same channel earlier.
      const delay = payload.replacePath && Number.isFinite(hint) ? Math.max(250, Math.min(5000, hint)) : 25000;
      retried ??= retryDelay(delay).then(open);
      return retried;
    };
    const opened = open().catch(error => {
      if (error.status === 429) return retry();
      if ([502, 503, 504].includes(error.status) || error.code === "NETWORK_UNAVAILABLE") {
        return retryDelay(2000).then(open);
      }
      throw error;
    });
    return async (channelId, { signal } = {}) => {
      let result = await opened;
      signal?.throwIfAborted();
      if (result?.busy?.includes(channelId)) {
        result = await retry(result.retryAfterMs);
        signal?.throwIfAborted();
      }
      if (result?.busy?.includes(channelId)) {
        throw Object.assign(new Error("O serviço de câmeras está ocupado. Tente novamente em instantes."), { status: 429 });
      }
      const url = cameraPlaylistUrl(result?.paths?.[channelId]);
      if (!url) throw new Error("Não foi possível abrir esta câmera.");
      for (let waited = 0; waited < 320_000;) {
        const ready = await cameraReadiness(url, signal, response => {
          if (response.status === 204) return true;
          if (response.status === 202) return false;
          throw Object.assign(new Error("Não foi possível abrir esta câmera."), { status: response.status });
        });
        if (ready) return url;
        // Check promptly while a warm source or the first queued preview can become ready.
        const delay = waited < 4_000 ? 500 : 2_000;
        await retryDelay(delay);
        waited += delay;
      }
      throw Object.assign(new Error("A câmera demorou para responder. Tente novamente."), { status: 504 });
    };
  }

  async function moveCamera(channelId, direction, { signal } = {}) {
    if (!/^[a-z0-9-]{1,48}$/.test(channelId ?? "") || !["up", "down", "left", "right"].includes(direction))
      throw new Error("Comando de câmera inválido.");
    await cameraRequest({ action: "move", channelId, direction }, signal);
  }

  async function listCameraRecordings(channelId, day, { signal, hour } = {}) {
    if (!/^[a-z0-9-]{1,48}$/.test(channelId ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? ""))
      throw new Error("Selecione uma data válida.");
    if (hour !== undefined && !/^(0[0-9]|1[0-9]|2[0-3])$/.test(hour))
      throw new Error("Selecione uma hora válida.");
    const result = await cameraRequest({ action: "recordings", channelId, day, hour }, signal);
    if (!Array.isArray(result?.recordings)) throw new Error("Não foi possível consultar as gravações.");
    return result.recordings.filter(item => /^[A-Za-z0-9_-]{22}$/.test(item?.id)
      && typeof item.start === "string" && typeof item.end === "string");
  }

  async function playCameraRecording(channelId, recordingId, { signal } = {}) {
    if (!/^[a-z0-9-]{1,48}$/.test(channelId ?? "") || !/^[A-Za-z0-9_-]{22}$/.test(recordingId ?? ""))
      throw new Error("Selecione uma gravação.");
    const result = await cameraRequest({ action: "play-recording", channelId, recordingId }, signal);
    const url = cameraPlaylistUrl(result?.path);
    if (!url) throw new Error("Não foi possível abrir a gravação.");
    return url;
  }

  async function fetchMedia(message = {}, { signal, maxBytes, onProgress } = {}) {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) throw new TypeError('Limite de prévia inválido.');
    let mediaUrl;
    try {
      mediaUrl = new URL(String(message.mediaUrl || ""), baseUrl);
    } catch {
      throw new Error("Endereço de mídia inválido.");
    }
    if (mediaUrl.origin !== baseUrl.origin || !mediaUrl.pathname.startsWith(`${apiPrefix}/portal-media/`)) {
      throw new Error("Endereço de mídia inválido.");
    }

    const token = await cancellableToken(tokenProvider, signal);
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
      return readMediaBlob(response, maxBytes, { signal, onProgress });
    }, true);
  }

  return Object.freeze({
    listCameraVisuals,
    createCameraVisual: writeCameraVisual.bind(null, "create-visual"),
    importCameraVisual: writeCameraVisual.bind(null, "import-visual"),
    renameCameraVisual: writeCameraVisual.bind(null, "rename-visual"),
    listCameraChannels, listCameraStatusEvents, startCameraPlayback, prepareCameraGrid, renewCameraPlayback, cameraPlaybackIsGone, moveCamera, listCameraRecordings, playCameraRecording, swileRequest, trancidRechargeRequest, getSicoobBalance, getSicoobLatestAttempt, refreshSicoob, getSicoobRefreshStatus, getSicoobRefreshPending, acknowledgeSicoobRefresh, waitForDiaryEvidence, refreshSefaz, getSefazRefreshStatus, getSefazRefreshPending, acknowledgeSefazRefresh, sendText, sendFile, replaceAttachment, transcribeAudio, fetchMedia, getAttachments, launchGalleryRequest, uploadLaunchGalleryFile, getPendingProvisionSnapshot, getPendingNotesSnapshot, getRhidAttendanceReport, startRhidPendingValidation, startRhidDayValidation, getRhidAttendanceMonth, saveRhidAttendanceAdjustment, deleteRhidAttendanceAdjustment, refreshRhidAttendance, getRhidRefreshStatus, refreshRecurringProvisions, getRecurringProvisionRefreshStatus, refreshDda, getDdaRefreshStatus, getDdaRefreshPending, acknowledgeDdaRefresh, confirmDdaPayment, scheduleDdaPayment, deleteAttachment, deleteAllAttachments, compressAttachment, chooseAttachmentCompression, getCompletionMenu, prepareSignatureEvidence, confirmSignatureEvidence, verifySignatureEvidence, captureSignatureEvidence,
  });
}
