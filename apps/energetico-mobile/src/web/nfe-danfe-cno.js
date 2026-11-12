import { invoiceConstructionCno } from '../chat/sefaz-cno.js';
import { readPdfTextContent } from './pdf-text-content.js';

const MAX_PDF_BYTES = 60_000_000;
const ADDITIONAL_DATA = /\bDADOS\s+ADICIONAIS\b/i;

async function hasRasterizedContent(page, fromY, { OPS, Util }) {
  const { fnArray, argsArray } = await page.getOperatorList();
  const images = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject];
  const groupedImages = [OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat];
  const transforms = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  for (const [index, op] of fnArray.entries()) {
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      transforms.push(matrix);
      if (op === OPS.paintFormXObjectBegin && argsArray[index][0]) matrix = Util.transform(matrix, argsArray[index][0]);
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) {
      matrix = transforms.pop() ?? matrix;
    } else if (op === OPS.transform) {
      matrix = Util.transform(matrix, argsArray[index]);
    } else if (images.includes(op)) {
      const [, b, , d, , y] = matrix;
      // PDF coordinates start at the bottom. The matrix maps the unit image rectangle.
      if (y + Math.min(0, b) + Math.min(0, d) <= fromY) return true;
    } else if (groupedImages.includes(op)) {
      return true;
    }
  }
  return false;
}

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
      const page = await pdf.getPage(number);
      const content = await readPdfTextContent(page);
      const items = content.items.filter(item => typeof item.str === 'string');
      const text = items.map(item => item.str + (item.hasEOL ? '\n' : '')).join('').trim();
      if (!text) return null;
      const heading = items.find(item => ADDITIONAL_DATA.test(item.str));
      const fromY = heading && !page.rotate ? heading.transform[5] + heading.height : Infinity;
      pages.push({ page, text, fromY });
    }
    const text = pages.map(page => page.text).join('\n');
    const printedKey = new RegExp(`(?:^|[^0-9A-Z])${[...key].join('\\s*')}(?![0-9A-Z])`, 'i');
    if (!/^[ \t]*DANFE\b/im.test(text) || !/\bCHAVE\s+DE\s+ACESSO\b/i.test(text) || !printedKey.test(text)) return null;
    const cno = invoiceConstructionCno({ OBSERVACOES_NOTA:text });
    if (cno.status !== 'missing') return cno;
    // Confirm absence only when the additional-data area is readable, including on hybrid PDFs.
    if (!ADDITIONAL_DATA.test(text) || text.includes('\uFFFD')) return null;
    for (const { page, fromY } of pages) {
      signal.throwIfAborted();
      if (await hasRasterizedContent(page, fromY, pdfjs)) return null;
    }
    return cno;
  } finally {
    signal.removeEventListener('abort', destroy);
    await destroy();
  }
}
