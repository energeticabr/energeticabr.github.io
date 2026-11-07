import { readPdfTextContent } from './pdf-text-content.js';
import { ddaLineFromBarcode } from '../chat/dda-payment-line.js';

const ACTION = 'EnergeticoDdaCopyBarcode';
/** Recognizes only our inert named action; never runs PDF scripts or opens links. */
export async function readDdaCopyAction(page) {
  try {
    if (!page.getAnnotations) return null;
    const matches = (await page.getAnnotations()).filter(a => a.subtype === 'Link' && a.action === ACTION);
    if (matches.length !== 1) return null;
    const annotation = matches[0], raw = annotation.contentsObj?.str;
    if (typeof raw !== 'string' || raw.length > 250 || annotation.url || annotation.unsafeUrl || annotation.actions) return null;
    const {version,barcode,line} = JSON.parse(raw);
    if (version !== 2 || typeof barcode !== 'string' || typeof line !== 'string' || !line || ddaLineFromBarcode(barcode) !== line) return null;
    const text = (await readPdfTextContent(page)).items.map(item => item.str || '').join(' ').replace(/\D/g,'');
    if (!text.includes(barcode) || !text.includes(line)) return null;
    const viewport = page.getViewport({scale:1});
    if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) return null;
    const r = [...viewport.convertToViewportPoint(annotation.rect[0],annotation.rect[1]), ...viewport.convertToViewportPoint(annotation.rect[2],annotation.rect[3])];
    const rect = [Math.min(r[0],r[2])/viewport.width,Math.min(r[1],r[3])/viewport.height,Math.max(r[0],r[2])/viewport.width,Math.max(r[1],r[3])/viewport.height];
    if (!rect.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || rect[2] <= rect[0] || rect[3] <= rect[1]) return null;
    return {barcode,line,rect};
  } catch { return null; }
}
export function positionDdaCopyButton(button, canvas, rect) {
  const width = parseFloat(canvas.style.width), height = parseFloat(canvas.style.height);
  button.style.left = `calc(50% + ${((rect[0]+rect[2])/2-.5)*width}px)`;
  button.style.top = `${rect[1]*height}px`;
  button.style.width = `${(rect[2]-rect[0])*width}px`;
  button.style.height = `${(rect[3]-rect[1])*height}px`;
}
