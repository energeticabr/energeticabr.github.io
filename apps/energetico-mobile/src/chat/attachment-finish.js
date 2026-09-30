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
