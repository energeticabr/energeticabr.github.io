import { invoiceConstructionCno } from '../chat/sefaz-cno.js';
import { readPdfTextContent } from './pdf-text-content.js';

const MAX_PDF_BYTES = 60_000_000;

export async function readDanfeCno(blob, key, { document, signal }) {
  signal.throwIfAborted();
  if (blob.size > MAX_PDF_BYTES) return null;
  const [pdfjs, worker, bytes] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    blob.arrayBuffer(),
  ]);
  signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const assetBase = new URL('pdfjs/', new URL(import.meta.env?.BASE_URL || './', document.baseURI));
  const task = pdfjs.getDocument({
    data:new Uint8Array(bytes),
    ownerDocument:document,
    cMapUrl:new URL('cmaps/', assetBase).href,
    standardFontDataUrl:new URL('standard_fonts/', assetBase).href,
    cMapPacked:true,
    enableXfa:false,
    stopAtErrors:true,
  });
  let destroyed;
  const destroy = () => destroyed ??= task.destroy().catch(() => {});
  signal.addEventListener('abort', destroy, { once:true });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted();
      const content = await readPdfTextContent(await pdf.getPage(number));
      const text = content.items.filter(item => typeof item.str === 'string')
        .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      if (!text) return null;
      pages.push(text);
    }
    const text = pages.join('\n');
    const printedKey = new RegExp(`(?:^|[^0-9A-Z])${[...key].join('\\s*')}(?![0-9A-Z])`, 'i');
    if (!printedKey.test(text) || !/\bDANFE\b/i.test(text)) return null;
    const cno = invoiceConstructionCno({ OBSERVACOES_NOTA:text });
    // A partial extract without the additional-data block cannot prove absence.
    return cno.status !== 'missing' || /\bDADOS\s+ADICIONAIS\b/i.test(text) ? cno : null;
  } finally {
    signal.removeEventListener('abort', destroy);
    await destroy();
  }
}
