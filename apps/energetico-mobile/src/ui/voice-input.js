function cleanText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").trim();
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
      return "O serviço de ditado do dispositivo não está disponível agora. Tente novamente ou digite a resposta.";
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
  getAudioContext = () => globalThis?.AudioContext || globalThis?.webkitAudioContext || null,
  transcribeAudio,
  ensureAudioPermission,
  preferRecorder = false,
  onStateChange = () => {},
  onError = () => {},
  onSessionEnd = () => {},
  scheduleStopFallback = (callback, delay) => setTimeout(callback, delay),
  clearStopFallback = handle => clearTimeout(handle),
  scheduleMeterPulse = (callback, delay) => setInterval(callback, delay),
  clearMeterPulse = handle => clearInterval(handle),
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
  let recognitionStopping = false;
  let stopFallbackHandle = null;
  let destroyed = false;
  let sessionId = 0;
  let baseText = "";
  let finalResults = new Map();
  let interimText = "";
  let audioCapture = false;
  let meterPulseHandle = null;
  let audioContext = null;
  let audioSource = null;
  let audioAnalyser = null;
  let audioSamples = null;
  let audioLevel = 0;

  function elapsedRecordingMs() {
    const current = recordingSession;
    if (!current) return 0;
    return current.elapsedMs + (active && !current.paused ? Math.max(0, Date.now() - current.segmentStartedAt) : 0);
  }

  function stateSnapshot(nextActive = active) {
    return {
      active: Boolean(nextActive),
      pending: Boolean(permissionPending || capturePending || transcriptionPending || recognitionStopping),
      audioCapture: Boolean(audioCapture),
      recording: Boolean(recordingSession && !recordingSession.completed && !recordingSession.paused),
      paused: Boolean(recordingSession?.paused),
      elapsedMs: elapsedRecordingMs(),
      level: audioLevel,
      meterAvailable: Boolean(audioAnalyser && audioSource && (!audioContext?.state || audioContext.state === "running")),
    };
  }

  function notify(nextActive = active) {
    onStateChange(stateSnapshot(nextActive));
  }

  function stopMeterPulse() {
    if (meterPulseHandle != null) clearMeterPulse(meterPulseHandle);
    meterPulseHandle = null;
  }

  function disposeAudioMeter() {
    stopMeterPulse();
    try { audioSource?.disconnect?.(); } catch { /* o stream pode já ter sido liberado */ }
    try { audioAnalyser?.disconnect?.(); } catch { /* noop */ }
    try { Promise.resolve(audioContext?.close?.()).catch(() => {}); } catch { /* fechamento é best effort */ }
    audioContext = null;
    audioSource = null;
    audioAnalyser = null;
    audioSamples = null;
    audioLevel = 0;
  }

  function measureAudioLevel() {
    if (!audioAnalyser || !audioSamples) return 0;
    try {
      audioAnalyser.getByteTimeDomainData(audioSamples);
      let sum = 0;
      for (const sample of audioSamples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      return Math.min(1, Math.sqrt(sum / audioSamples.length) * 3.5);
    } catch {
      return 0;
    }
  }

  function prepareAudioMeter() {
    if (audioContext || audioAnalyser) return;
    try {
      const AudioContextConstructor = getAudioContext?.();
      if (typeof AudioContextConstructor === "function") {
        audioContext = new AudioContextConstructor();
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        audioAnalyser.smoothingTimeConstant = 0.72;
        audioSamples = new Uint8Array(audioAnalyser.fftSize);
        Promise.resolve(audioContext.resume?.()).catch(() => {});
      }
    } catch {
      disposeAudioMeter();
    }
  }

  function startAudioMeter(stream) {
    stopMeterPulse();
    prepareAudioMeter();
    if (audioContext && audioAnalyser && !audioSource) {
      try {
        audioSource = audioContext.createMediaStreamSource(stream);
        audioSource.connect(audioAnalyser);
      } catch {
        disposeAudioMeter();
      }
    }
    if (audioContext?.state === "suspended") Promise.resolve(audioContext.resume?.()).catch(() => {});
    meterPulseHandle = scheduleMeterPulse(() => {
      if (!recordingSession || recordingSession.paused || !active) return;
      audioLevel = measureAudioLevel();
      notify(true);
    }, 120);
    meterPulseHandle?.unref?.();
  }

  function previewBlob(current) {
    return new Blob(current?.chunks || [], { type: current?.mimeType || current?.recorder?.mimeType || "audio/webm" });
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
    if (stopFallbackHandle != null) clearStopFallback(stopFallbackHandle);
    stopFallbackHandle = null;
    recognitionStopping = false;
    active = false;
    audioCapture = false;
    disposeAudioMeter();
    interimText = "";
    updateDraft(false);
    sessionId += 1;
    notify(false);
    onSessionEnd();
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
    stopMeterPulse();
    disposeAudioMeter();
    transcriptionPending = true;
    const currentSessionId = sessionId;
    notify(false);
    const complete = async () => {
      const file = audioFileFromChunks(current.chunks, current.mimeType || current.recorder?.mimeType);
      stopStream(current.stream);
      mediaStream = null;
      recorder = null;
      recordingSession = null;
      if (typeof transcribeAudio !== "function") {
        transcriptionPending = false;
        audioCapture = false;
        notify(false);
        onError("A transcrição de áudio ainda não está disponível neste aplicativo. Digite a resposta manualmente.");
        return false;
      }
      try {
        const transcript = cleanText(await transcribeAudio(file));
        if (destroyed || sessionId !== currentSessionId || !transcriptionPending) return false;
        if (transcript) {
          setDraft(joinText(baseText, transcript));
        }
        transcriptionPending = false;
        audioCapture = false;
        notify(false);
        return Boolean(transcript);
      } catch (error) {
        if (destroyed || sessionId !== currentSessionId || !transcriptionPending) return false;
        transcriptionPending = false;
        audioCapture = false;
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
    // Create/resume Web Audio synchronously in the original press gesture;
    // iOS can otherwise suspend the analyser after its native permission sheet.
    prepareAudioMeter();
    Promise.resolve(typeof getAudioStream === "function" ? getAudioStream() : null).then(stream => {
      if (destroyed || sessionId !== currentSessionId || !capturePending) {
        stopStream(stream);
        return;
      }
      if (!stream) throw new Error("Não foi possível acessar o microfone neste dispositivo.");
      const mimeType = recorderMimeType(Recorder);
      const currentRecorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
      const current = {
        sessionId: currentSessionId,
        recorder: currentRecorder,
        stream,
        mimeType,
        chunks: [],
        completed: false,
        paused: false,
        elapsedMs: 0,
        segmentStartedAt: 0,
        previewResolvers: [],
        completion: null,
        resolve: null,
      };
      recordingSession = current;
      recorder = currentRecorder;
      mediaStream = stream;
      currentRecorder.ondataavailable = event => {
        if (!current.completed && event?.data && (event.data.size === undefined || event.data.size > 0)) current.chunks.push(event.data);
        if (current.previewResolvers.length) {
          const resolvers = current.previewResolvers.splice(0);
          const settle = () => resolvers.forEach(resolve => resolve(previewBlob(current)));
          setTimeout(settle, 0);
        }
      };
      currentRecorder.onerror = event => {
        if (destroyed || current.completed) return;
        capturePending = false;
        sessionId += 1;
        stopStream(stream);
        disposeAudioMeter();
        recorder = null;
        mediaStream = null;
        recordingSession = null;
        audioCapture = false;
        finishSession({ reportError: speechErrorMessage(event?.error) });
      };
      currentRecorder.onstop = () => {
        capturePending = false;
        void completeRecording();
      };
      currentRecorder.start(1000);
      capturePending = false;
      active = true;
      current.segmentStartedAt = Date.now();
      startAudioMeter(stream);
      notify(true);
    }).catch(error => {
      if (destroyed || sessionId !== currentSessionId) return;
      const current = recordingSession;
      if (current?.sessionId === currentSessionId) {
        current.completed = true;
        try { current.recorder.stop?.(); } catch { /* stream será liberado abaixo */ }
        stopStream(current.stream);
        recorder = null;
        mediaStream = null;
        recordingSession = null;
      }
      disposeAudioMeter();
      capturePending = false;
      finishSession({ reportError: error?.message || "Não foi possível iniciar o microfone. Digite a resposta manualmente." });
    });
  }

  function start() {
    if (destroyed || active || recordingSession || permissionPending || capturePending || transcriptionPending || recognitionStopping) return active;
    const Recognition = getRecognition?.();
    const Recorder = typeof getRecorder === "function" ? getRecorder() : null;
    const useRecorder = typeof Recorder === "function" && (preferRecorder || typeof Recognition !== "function");
    const useRecognition = !useRecorder && typeof Recognition === "function";
    if (!useRecognition && !useRecorder) {
      onError("O reconhecimento de voz não está disponível neste navegador ou aplicativo.");
      notify(false);
      return false;
    }
    baseText = cleanText(getDraft?.());
    audioCapture = useRecorder;
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
      audioCapture = false;
      disposeAudioMeter();
      sessionId += 1;
      notify(false);
      return false;
    }
    if (capturePending) {
      capturePending = false;
      audioCapture = false;
      disposeAudioMeter();
      sessionId += 1;
      notify(false);
      return false;
    }
    if (recordingSession?.recorder && !recordingSession.completed) {
      const current = recordingSession;
      current.completion = new Promise(resolve => { current.resolve = resolve; });
      if (active && !current.paused) current.elapsedMs += Math.max(0, Date.now() - current.segmentStartedAt);
      sessionId += 1;
      active = false;
      audioLevel = 0;
      stopMeterPulse();
      try { current.recorder.stop?.(); } catch { completeRecording(); }
      return current.completion;
    }
    if (!recognition || recognitionStopping) return false;
    const current = recognition;
    const currentSessionId = sessionId;
    active = false;
    recognitionStopping = true;
    interimText = "";
    updateDraft(false);
    notify(false);
    stopFallbackHandle = scheduleStopFallback(() => {
      if (destroyed || sessionId !== currentSessionId || !recognitionStopping) return;
      finishSession();
    }, 2000);
    stopFallbackHandle?.unref?.();
    try { current.stop?.(); } catch { /* o navegador pode já ter encerrado a sessão */ }
    return true;
  }

  function cancel() {
    if (permissionPending) {
      permissionPending = false;
      disposeAudioMeter();
      sessionId += 1;
      notify(false);
      return false;
    }
    if (capturePending) {
      capturePending = false;
      disposeAudioMeter();
      sessionId += 1;
      notify(false);
      return true;
    }
    if (transcriptionPending) {
      transcriptionPending = false;
      audioCapture = false;
      sessionId += 1;
      notify(false);
      return true;
    }
    if (recordingSession?.recorder) {
      const current = recordingSession;
      sessionId += 1;
      active = false;
      audioCapture = false;
      capturePending = false;
      current.completed = true;
      current.previewResolvers.splice(0).forEach(resolve => resolve(new Blob([], { type: current.mimeType || "audio/webm" })));
      disposeAudioMeter();
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
    recognitionStopping = false;
    if (stopFallbackHandle != null) clearStopFallback(stopFallbackHandle);
    stopFallbackHandle = null;
    interimText = "";
    updateDraft(false);
    notify(false);
    try { current.abort?.(); } catch { /* o navegador pode já ter encerrado a sessão */ }
    return true;
  }

  function pause() {
    const current = recordingSession;
    if (!current?.recorder || typeof current.recorder.pause !== "function" || current.completed || current.paused || !active) return false;
    const elapsedThisSegment = Math.max(0, Date.now() - current.segmentStartedAt);
    current.elapsedMs += elapsedThisSegment;
    current.paused = true;
    active = false;
    audioLevel = 0;
    stopMeterPulse();
    try {
      current.recorder.pause();
      for (const track of current.stream?.getAudioTracks?.() || []) {
        try { track.enabled = false; } catch { /* a implementação pode não permitir silenciar */ }
      }
    } catch {
      current.paused = false;
      active = true;
      current.elapsedMs = Math.max(0, current.elapsedMs - elapsedThisSegment);
      return false;
    }
    notify(false);
    return true;
  }

  function resume() {
    const current = recordingSession;
    if (!current?.recorder || typeof current.recorder.resume !== "function" || current.completed || !current.paused) return false;
    try {
      current.recorder.resume();
      for (const track of current.stream?.getAudioTracks?.() || []) {
        try { track.enabled = true; } catch { /* a implementação pode não permitir reativar */ }
      }
    } catch {
      return false;
    }
    current.paused = false;
    current.segmentStartedAt = Date.now();
    active = true;
    startAudioMeter(current.stream);
    notify(true);
    return true;
  }

  function getPreviewBlob() {
    const current = recordingSession;
    if (!current || current.completed || !current.paused || typeof current.recorder?.requestData !== "function") {
      return Promise.resolve(previewBlob(current));
    }
    return new Promise(resolve => {
      let settled = false;
      let timeout = setTimeout(() => finish(previewBlob(current)), 500);
      timeout?.unref?.();
      const finish = blob => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        current.previewResolvers = current.previewResolvers.filter(candidate => candidate !== finish);
        resolve(blob);
      };
      current.previewResolvers.push(finish);
      try { current.recorder.requestData(); } catch { finish(previewBlob(current)); }
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (stopFallbackHandle != null) clearStopFallback(stopFallbackHandle);
    stopFallbackHandle = null;
    disposeAudioMeter();
    try { recognition?.abort?.(); } catch { /* noop */ }
    try { recorder?.stop?.(); } catch { /* noop */ }
    stopStream(mediaStream);
    recognition = null;
    recorder = null;
    mediaStream = null;
    recordingSession = null;
    active = false;
    audioCapture = false;
    permissionPending = false;
    capturePending = false;
    transcriptionPending = false;
    recognitionStopping = false;
    sessionId = 0;
    interimText = "";
  }

  return Object.freeze({
    start,
    stop,
    pause,
    resume,
    getPreviewBlob,
    cancel,
    destroy,
    isActive: () => active,
    isPaused: () => Boolean(recordingSession?.paused),
    isPending: () => permissionPending || capturePending || transcriptionPending || recognitionStopping,
    getState: () => stateSnapshot(),
  });
}
