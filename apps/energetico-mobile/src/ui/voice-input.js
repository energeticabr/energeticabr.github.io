function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export { normalizeConstructionDiaryText } from "./construction-diary-text.js";

function joinText(...parts) {
  return parts.map(cleanText).filter(Boolean).join(" ").trim();
}

export function resolveSpeechRecognition(globalObject = globalThis) {
  return globalObject?.SpeechRecognition || globalObject?.webkitSpeechRecognition || null;
}

function speechErrorMessage(error) {
  switch (String(error || "").toLowerCase()) {
    case "not-allowed":
    case "service-not-allowed":
      return "O acesso ao microfone foi bloqueado. Autorize o microfone para usar a transcrição.";
    case "audio-capture":
      return "Não foi possível acessar o microfone neste dispositivo.";
    case "no-speech":
      return "Nenhuma fala foi identificada. Segure o microfone e tente novamente.";
    default:
      return "O reconhecimento de voz não está disponível agora. Digite a resposta manualmente.";
  }
}

export function createVoiceInputController({
  getDraft = () => "",
  setDraft = () => {},
  getRecognition = () => resolveSpeechRecognition(globalThis),
  getRecorder = () => globalThis?.MediaRecorder || null,
  getAudioStream = () => globalThis?.navigator?.mediaDevices?.getUserMedia?.call(globalThis.navigator.mediaDevices, { audio: true }),
  transcribeAudio,
  ensureAudioPermission,
  onStateChange = () => {},
  onError = () => {},
  language = "pt-BR",
} = {}) {
  let recognition = null;
  let recorder = null;
  let mediaStream = null;
  let recordingSession = null;
  let active = false;
  let permissionPending = false;
  let capturePending = false;
  let transcriptionPending = false;
  let destroyed = false;
  let sessionId = 0;
  let baseText = "";
  let finalResults = new Map();
  let interimText = "";

  function notify(nextActive = active) {
    onStateChange({
      active: Boolean(nextActive),
      pending: Boolean(permissionPending || capturePending || transcriptionPending),
    });
  }

  function currentFinalText() {
    return [...finalResults.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value)
      .join(" ");
  }

  function updateDraft(includeInterim = true) {
    setDraft(joinText(baseText, currentFinalText(), includeInterim ? interimText : ""));
  }

  function finishSession({ reportError = "" } = {}) {
    active = false;
    interimText = "";
    updateDraft(false);
    notify(false);
    if (reportError) onError(reportError);
  }

  function bindRecognition(instance, currentSessionId) {
    instance.lang = language;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onstart = () => {
      if (destroyed || sessionId !== currentSessionId) return;
      active = true;
      notify(true);
    };
    instance.onresult = event => {
      if (destroyed || sessionId !== currentSessionId) return;
      const results = Array.from(event?.results || []);
      for (let index = Number(event?.resultIndex) || 0; index < results.length; index += 1) {
        const result = results[index];
        const transcript = cleanText(result?.[0]?.transcript || result?.transcript || "");
        if (!transcript) continue;
        if (result?.isFinal) finalResults.set(index, transcript);
        else interimText = transcript;
      }
      const hasInterim = results.some(result => !result?.isFinal);
      if (!hasInterim) interimText = "";
      updateDraft(true);
    };
    instance.onerror = event => {
      if (destroyed || sessionId !== currentSessionId) return;
      finishSession({ reportError: speechErrorMessage(event?.error) });
    };
    instance.onend = () => {
      if (destroyed || sessionId !== currentSessionId) return;
      finishSession();
    };
  }

  function recorderMimeType(Recorder) {
    const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    if (typeof Recorder?.isTypeSupported !== "function") return "";
    return candidates.find(type => Recorder.isTypeSupported(type)) || "";
  }

  function audioFileFromChunks(chunks, mimeType) {
    const type = mimeType || "audio/webm";
    const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const blob = new Blob(chunks, { type });
    const FileConstructor = globalThis?.File;
    if (typeof FileConstructor === "function") {
      return new FileConstructor([blob], `energetico-voice-input.${extension}`, { type });
    }
    try {
      Object.defineProperty(blob, "name", { value: `energetico-voice-input.${extension}` });
    } catch { /* Blob é suficiente para ambientes sem File */ }
    return blob;
  }

  function stopStream(stream) {
    for (const track of stream?.getTracks?.() || []) {
      try { track.stop?.(); } catch { /* o dispositivo pode já ter liberado a faixa */ }
    }
  }

  function completeRecording() {
    const current = recordingSession;
    if (!current || current.completed) return current?.completion || Promise.resolve(false);
    current.completed = true;
    transcriptionPending = true;
    notify(false);
    const complete = async () => {
      const file = audioFileFromChunks(current.chunks, current.mimeType || current.recorder?.mimeType);
      stopStream(current.stream);
      mediaStream = null;
      recorder = null;
      recordingSession = null;
      if (typeof transcribeAudio !== "function") {
        transcriptionPending = false;
        notify(false);
        onError("A transcrição de áudio ainda não está disponível neste aplicativo. Digite a resposta manualmente.");
        return false;
      }
      try {
        const transcript = cleanText(await transcribeAudio(file));
        if (transcript) {
          setDraft(joinText(baseText, transcript));
        }
        transcriptionPending = false;
        notify(false);
        return Boolean(transcript);
      } catch (error) {
        transcriptionPending = false;
        notify(false);
        onError(error?.message || "Não foi possível transcrever o áudio. Digite a resposta manualmente.");
        return false;
      }
    };
    current.completion = complete();
    current.completion.then(result => current.resolve?.(result)).catch(() => current.resolve?.(false));
    return current.completion;
  }

  function beginRecording(Recorder, currentSessionId) {
    capturePending = true;
    notify(false);
    Promise.resolve(typeof getAudioStream === "function" ? getAudioStream() : null).then(stream => {
      if (destroyed || sessionId !== currentSessionId || !capturePending) {
        stopStream(stream);
        return;
      }
      if (!stream) throw new Error("Não foi possível acessar o microfone neste dispositivo.");
      const mimeType = recorderMimeType(Recorder);
      const currentRecorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
      const current = {
        recorder: currentRecorder,
        stream,
        mimeType,
        chunks: [],
        completed: false,
        completion: null,
        resolve: null,
      };
      recordingSession = current;
      recorder = currentRecorder;
      mediaStream = stream;
      currentRecorder.ondataavailable = event => {
        if (event?.data && (event.data.size === undefined || event.data.size > 0)) current.chunks.push(event.data);
      };
      currentRecorder.onerror = event => {
        if (destroyed || current.completed) return;
        capturePending = false;
        sessionId += 1;
        stopStream(stream);
        recorder = null;
        mediaStream = null;
        recordingSession = null;
        finishSession({ reportError: speechErrorMessage(event?.error) });
      };
      currentRecorder.onstop = () => {
        capturePending = false;
        void completeRecording();
      };
      currentRecorder.start();
      capturePending = false;
      active = true;
      notify(true);
    }).catch(error => {
      if (destroyed || sessionId !== currentSessionId) return;
      capturePending = false;
      finishSession({ reportError: error?.message || "Não foi possível iniciar o microfone. Digite a resposta manualmente." });
    });
  }

  function start() {
    if (destroyed || active || permissionPending || capturePending || transcriptionPending) return active;
    const Recognition = getRecognition?.();
    const Recorder = typeof getRecorder === "function" ? getRecorder() : null;
    const useRecognition = typeof Recognition === "function";
    const useRecorder = !useRecognition && typeof Recorder === "function";
    if (!useRecognition && !useRecorder) {
      onError("O reconhecimento de voz não está disponível neste navegador ou aplicativo.");
      notify(false);
      return false;
    }
    baseText = cleanText(getDraft?.());
    finalResults = new Map();
    interimText = "";
    const currentSessionId = ++sessionId;
    const beginRecognition = () => {
      try {
        recognition = new Recognition();
        bindRecognition(recognition, currentSessionId);
        active = true;
        recognition.start();
        notify(true);
        return true;
      } catch {
        recognition = null;
        finishSession({ reportError: "Não foi possível iniciar o microfone. Digite a resposta manualmente." });
        return false;
      }
    };
    const beginCapture = () => {
      beginRecording(Recorder, currentSessionId);
      return true;
    };
    const begin = useRecognition ? beginRecognition : beginCapture;
    let permissionResult = true;
    if (useRecognition && typeof ensureAudioPermission === "function") {
      try {
        permissionResult = ensureAudioPermission();
      } catch (error) {
        finishSession({ reportError: error?.message || "O acesso ao microfone foi bloqueado. Autorize o microfone para usar a transcrição." });
        return false;
      }
    }
    if (!permissionResult || typeof permissionResult.then !== "function") {
      if (permissionResult === false) {
        finishSession({ reportError: "O acesso ao microfone foi bloqueado. Autorize o microfone para usar a transcrição." });
        return false;
      }
      return begin();
    }
    permissionPending = true;
    notify(false);
    Promise.resolve(permissionResult).then(granted => {
      if (!permissionPending || destroyed || sessionId !== currentSessionId) return;
      permissionPending = false;
      if (granted === false) {
        finishSession({ reportError: "O acesso ao microfone foi bloqueado. Autorize o microfone para usar a transcrição." });
        return;
      }
      begin();
    }).catch(error => {
      if (!permissionPending || destroyed || sessionId !== currentSessionId) return;
      permissionPending = false;
      finishSession({ reportError: error?.message || "O acesso ao microfone foi bloqueado. Autorize o microfone para usar a transcrição." });
    });
    return true;
  }

  function stop() {
    if (permissionPending) {
      permissionPending = false;
      sessionId += 1;
      notify(false);
      return false;
    }
    if (capturePending) {
      capturePending = false;
      sessionId += 1;
      notify(false);
      return false;
    }
    if (recordingSession?.recorder && active) {
      const current = recordingSession;
      current.completion = new Promise(resolve => { current.resolve = resolve; });
      sessionId += 1;
      active = false;
      try { current.recorder.stop?.(); } catch { completeRecording(); }
      return current.completion;
    }
    if (!recognition) return false;
    const current = recognition;
    sessionId += 1;
    active = false;
    interimText = "";
    updateDraft(false);
    notify(false);
    try { current.stop?.(); } catch { /* o navegador pode já ter encerrado a sessão */ }
    return true;
  }

  function cancel() {
    if (permissionPending) {
      permissionPending = false;
      sessionId += 1;
      notify(false);
      return false;
    }
    if (capturePending) {
      capturePending = false;
      sessionId += 1;
      notify(false);
      return true;
    }
    if (recordingSession?.recorder) {
      const current = recordingSession;
      sessionId += 1;
      active = false;
      capturePending = false;
      current.completed = true;
      stopStream(current.stream);
      recorder = null;
      mediaStream = null;
      recordingSession = null;
      notify(false);
      try { current.recorder.stop?.(); } catch { /* noop */ }
      return true;
    }
    if (!recognition) return false;
    const current = recognition;
    sessionId += 1;
    active = false;
    interimText = "";
    updateDraft(false);
    notify(false);
    try { current.abort?.(); } catch { /* o navegador pode já ter encerrado a sessão */ }
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { recognition?.abort?.(); } catch { /* noop */ }
    try { recorder?.stop?.(); } catch { /* noop */ }
    stopStream(mediaStream);
    recognition = null;
    recorder = null;
    mediaStream = null;
    recordingSession = null;
    active = false;
    permissionPending = false;
    capturePending = false;
    transcriptionPending = false;
    sessionId = 0;
    interimText = "";
  }

  return Object.freeze({
    start,
    stop,
    cancel,
    destroy,
    isActive: () => active,
    isPending: () => permissionPending || capturePending || transcriptionPending,
  });
}
