/** Read PDF.js text without requiring ReadableStream asynchronous iteration,
 * which is absent in some iOS WebKit versions supported by the app. */
export async function readPdfTextContent(page, params = {}) {
  if (page.isPureXfa || typeof page.streamTextContent !== 'function') {
    return page.getTextContent(params);
  }
  const reader = page.streamTextContent(params).getReader();
  const content = { items: [], styles: Object.create(null), lang: null };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return content;
      content.lang ??= value.lang;
      Object.assign(content.styles, value.styles);
      content.items.push(...value.items);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the extraction error. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
