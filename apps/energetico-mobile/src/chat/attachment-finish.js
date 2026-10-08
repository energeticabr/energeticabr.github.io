function optionReplyId(option) {
  return String(option?.reply || option?.replyId || option?.id || "").trim();
}

export function attachmentFinishOption(message) {
  return (message?.options || []).find(option => {
    const label = String(option?.label || option?.title || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^[^a-zA-Z]+/, "").trim();
    return Boolean(optionReplyId(option))
      && /^finalizar(?:\s+(?:os\s+)?anexos)?$/i.test(label);
  }) || null;
}

export function isDiaryAttachmentPrompt(message, activeFlow) {
  if (!/^construction_diary_(?:create|fill)$/.test(String(activeFlow?.id || ""))) return false;
  return (message?.options || []).some(option => optionReplyId(option) === "attachment_upload_continue")
    || /envie\s+uma\s+foto\s+ou\s+um\s+pdf/i.test(String(message?.question || message?.prompt || message?.text || ""));
}

export function isDocumentAttachmentPrompt(message, activeFlow) {
  if (String(activeFlow?.id || "") !== "document") return false;
  return (message?.options || []).some(option => ["attachment_upload_continue", "local_attachment_finish"].includes(optionReplyId(option)))
    || /envie\s+o\s+primeiro\s+anexo\s+do\s+documento/i.test(String(message?.question || message?.prompt || message?.text || ""));
}

export function withDocumentAttachmentPrompt(messages, activeFlow, attachments = []) {
  const index = messages.findLastIndex(message => message?.role !== "user"
    && ["poll", "text"].includes(message?.type));
  const message = messages[index];
  if (!isDocumentAttachmentPrompt(message, activeFlow)) return messages;
  // Shared uploads can confirm the tray without returning a replacement poll.
  // Use only confirmed new files, never the pending queue or read-only originals.
  const count = new Set((Array.isArray(attachments) ? attachments : [])
    .filter(item => item?.id && item?.mediaUrl && item.existing !== true
      && item.readOnly !== true && item.origin !== "existing")
    .map(item => String(item.id))).size;
  if (!count) return messages;
  const finish = attachmentFinishOption(message)
    || { id: "local_attachment_finish", label: "✅ FINALIZAR" };
  const options = (message.options || []).filter(option => optionReplyId(option) !== "attachment_upload_continue"
    && option !== finish);
  const suffix = count === 1 ? "DO 1 JÁ ADICIONADO" : `DOS ${count} JÁ ADICIONADOS`;
  const next = [...messages];
  next[index] = { ...message, type: "poll",
    question: `📎 ENVIE OS ANEXOS DESEJADOS ALÉM ${suffix} OU CLIQUE EM FINALIZAR PARA SEGUIR.`,
    options: [...options, finish],
  };
  return next;
}
