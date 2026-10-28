const ACTION = 'EnergeticoDdaCopyBarcode';
function mod10(value) {
  const sum = [...value].reverse().reduce((total, digit, index) => {
    const n = Number(digit) * (index % 2 ? 1 : 2); return total + Math.floor(n / 10) + n % 10;
  }, 0);
  return String((10 - sum % 10) % 10);
}
function validCodes(barcode, line) {
  if (!/^\d{44}$/.test(barcode) || !/^\d{47}$/.test(line)) return false;
  if (line.slice(0,4)+line[32]+line.slice(33)+line.slice(4,9)+line.slice(10,20)+line.slice(21,31) !== barcode) return false;
  for (const [start,end,dv] of [[0,9,9],[10,20,20],[21,31,31]]) if (mod10(line.slice(start,end)) !== line[dv]) return false;
  const raw = barcode.slice(0,4)+barcode.slice(5);
  let dv = 11 - [...raw].reverse().reduce((sum,n,i) => sum + Number(n)*(2+i%8),0)%11;
  if ([0,10,11].includes(dv)) dv = 1;
  return String(dv) === barcode[4];
}
/** Recognizes only our inert named action; never runs PDF scripts or opens links. */
export async function readDdaCopyAction(page) {
  try {
    if (!page.getAnnotations) return null;
    const matches = (await page.getAnnotations()).filter(a => a.subtype === 'Link' && a.action === ACTION);
    if (matches.length !== 1) return null;
    const annotation = matches[0], raw = annotation.contentsObj?.str;
    if (typeof raw !== 'string' || raw.length > 250 || annotation.url || annotation.unsafeUrl || annotation.actions) return null;
    const {version,barcode,line} = JSON.parse(raw);
    if (version !== 2 || typeof barcode !== 'string' || typeof line !== 'string' || !validCodes(barcode,line)) return null;
    const text = (await page.getTextContent()).items.map(item => item.str || '').join(' ').replace(/\D/g,'');
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
