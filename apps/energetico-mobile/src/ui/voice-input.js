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
  onStateChange = () => {},
  onError = () => {},
  language = "pt-BR",
} = {}) {
  let recognition = null;
  let active = false;
  let destroyed = false;
  let baseText = "";
  let finalResults = new Map();
  let interimText = "";

  function notify(nextActive = active) {
    onStateChange({ active: Boolean(nextActive) });
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

  function bindRecognition(instance) {
    instance.lang = language;
    instance.continuous = true;
    instance.interimResults = true;
    instance.onstart = () => {
      if (destroyed) return;
      active = true;
      notify(true);
    };
    instance.onresult = event => {
      if (destroyed) return;
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
      if (destroyed) return;
      finishSession({ reportError: speechErrorMessage(event?.error) });
    };
    instance.onend = () => {
      if (destroyed) return;
      finishSession();
    };
  }

  function start() {
    if (destroyed || active) return active;
    const Recognition = getRecognition?.();
    if (typeof Recognition !== "function") {
      onError("O reconhecimento de voz não está disponível neste navegador ou aplicativo.");
      notify(false);
      return false;
    }
    baseText = cleanText(getDraft?.());
    finalResults = new Map();
    interimText = "";
    try {
      recognition = new Recognition();
      bindRecognition(recognition);
      active = true;
      recognition.start();
      notify(true);
      return true;
    } catch {
      recognition = null;
      finishSession({ reportError: "Não foi possível iniciar o microfone. Digite a resposta manualmente." });
      return false;
    }
  }

  function stop() {
    if (!recognition) return false;
    const current = recognition;
    active = false;
    interimText = "";
    updateDraft(false);
    notify(false);
    try { current.stop?.(); } catch { /* o navegador pode já ter encerrado a sessão */ }
    return true;
  }

  function cancel() {
    if (!recognition) return false;
    const current = recognition;
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
    recognition = null;
    active = false;
    interimText = "";
  }

  return Object.freeze({
    start,
    stop,
    cancel,
    destroy,
    isActive: () => active,
  });
}
