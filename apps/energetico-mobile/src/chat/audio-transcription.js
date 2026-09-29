const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "webm"]);

export function isAudioFile(file) {
  const type = String(file?.type || "").trim().toLocaleLowerCase();
  if (type.startsWith("audio/")) return true;
  const name = String(file?.name || file?.fileName || "").trim().toLocaleLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return AUDIO_EXTENSIONS.has(extension);
}

export function isConstructionDiaryFlow(flow) {
  const id = String(flow?.id || "").trim().toLocaleLowerCase();
  const title = String(flow?.title || "").trim().toLocaleLowerCase();
  return /construction|diary|di[aá]rio|obra/.test(id) || /di[aá]rio\s+de\s+obras?/.test(title);
}

export function audioTranscriptionText(result) {
  const text = result && typeof result === "object"
    ? result.text ?? result.transcript ?? result.transcription
    : result;
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("A VM não devolveu texto transcrito para o áudio.");
  return normalized;
}
