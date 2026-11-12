import { invoiceConstructionCno } from '../chat/sefaz-cno.js';
import { readPdfTextContent } from './pdf-text-content.js';

const MAX_PDF_BYTES = 60_000_000;
const ADDITIONAL_DATA = /\bDADOS\s+ADICIONAIS\b/i;
const ACCESS_KEY_LABEL = /\bCHAVE\s+DE\s+ACESSO\b/i;
const ACCESS_KEY = /(?:^|[^0-9A-Z])((?:[0-9][ \t]*){6}(?:[0-9A-Z][ \t]*){12}(?:[0-9][ \t]*){25}[0-9])(?![0-9A-Z]|[ \t]+[0-9])/gi;

function accessKeyLabel(items) {
  for (const [index, item] of items.entries()) {
    if (!/\bCHAVE\b/i.test(item.str)) continue;
    let text = item.str;
    let last = item;
    for (let next = index + 1; next < items.length && !ACCESS_KEY_LABEL.test(text); next++) {
      const fragment = items[next];
      const gap = fragment.transform[4] - last.transform[4] - last.width;
      if (last.hasEOL || Math.abs(fragment.transform[5] - item.transform[5]) > 2 ||
          gap < -2 || gap > Math.max(5, item.height)) break;
      text += fragment.str;
      last = fragment;
    }
    if (ACCESS_KEY_LABEL.test(text)) return item;
  }
  return null;
}

function danfeAccessKey(items) {
  const label = accessKeyLabel(items);
  if (!label) return '';
  const [, , , , labelX, labelY] = label.transform;
  if (!items.some(item => /^\s*DANFE\b/i.test(item.str) && item.transform[5] >= labelY)) return '';
  const lineHeight = Math.max(5, label.height);
  // Read the printed field by position. PDF text order can place its value
  // after unrelated fields, and referenced invoice keys can appear farther down.
  const nearby = items.filter(item => {
    const [, , , , x, y] = item.transform;
    return item.str.trim() && y >= labelY - 3 * lineHeight && y <= labelY + 2 &&
      x + item.width >= labelX - 8 * lineHeight && x <= labelX + label.width + 220;
  }).sort((a, b) => a.transform[4] - b.transform[4]);
  const lines = [];
  for (const item of nearby) {
    const [, , , , x, y] = item.transform;
    const line = lines.find(candidate => Math.abs(candidate.y - y) <= 2 && x - candidate.endX <= 2 * lineHeight);
    if (line) {
      line.text += item.str;
      line.endX = x + item.width;
    } else lines.push({ y, endX:x + item.width, text:item.str });
  }
  const keys = new Set(lines.flatMap(({ text }) =>
    [...text.matchAll(ACCESS_KEY)].map(match => match[1].replace(/[ \t]/g, '').toUpperCase())));
  return keys.size === 1 ? [...keys][0] : '';
}

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
      // Some issuers place a blank inline image over the fiscal footer.
      const pixels = op === OPS.paintInlineImageXObject ? argsArray[index][0]?.data : null;
      if (pixels?.length && pixels.every(value => value === 255)) continue;
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
      if (number === 1 && danfeAccessKey(items) !== key) return null;
      const heading = items.find(item => ADDITIONAL_DATA.test(item.str));
      const fromY = heading && !page.rotate ? heading.transform[5] + heading.height : Infinity;
      pages.push({ page, text, fromY });
    }
    const text = pages.map(page => page.text).join('\n');
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
