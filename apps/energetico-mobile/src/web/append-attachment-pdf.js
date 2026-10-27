import {
  PDFDocument, PDFArray, PDFDict, PDFName, PDFNull, PDFSignature,
  pushGraphicsState, concatTransformationMatrix, popGraphicsState,
} from 'pdf-lib';
import { jpegOrientation } from '../native/jpeg-orientation.js';

const MAX_BYTES = 60_000_000;
const MAX_PAGES = 200;
// Bound raster allocations before asking either pdf-lib or a browser to decode.
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_IMAGE_SIDE = 16_384;
const IMAGE_TYPES = new Set(['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif']);
const nameOf = value => PDFName.of(value);
const textAt = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Geração do PDF cancelada.', 'AbortError');
}

function attachmentKind(blob, name) {
  if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isSafeInteger(blob.size) || blob.size <= 0) return null;
  const type = String(blob.type || '').split(';')[0].trim().toLowerCase();
  const extension = String(name || blob.name || '').split('.').at(-1).toLowerCase();
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (type === 'image/svg+xml' || type === 'image/tiff') return null;
  if (IMAGE_TYPES.has(type.replace(/^image\//, '')) || IMAGE_TYPES.has(extension)) return 'image';
  return null;
}

/** Metadata eligibility only; composition validates the actual file contents. */
export function isAppendableAttachment(blob, name) {
  return attachmentKind(blob, name) !== null;
}

function imageSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('Imagem inválida: dimensões ausentes ou corrompidas.');
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('A imagem excede a resolução segura: 20 milhões de pixels e 16.384 pixels por lado. Reduza suas dimensões.');
  }
  return { width, height };
}

function animatedImage() {
  throw new Error('Imagens animadas não são suportadas. Selecione uma imagem estática ou um PDF.');
}

function invalidImage() {
  throw new Error('Imagem inválida, corrompida ou em formato não suportado.');
}

function jpegSize(bytes, view, signal) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    checkAbort(signal);
    if (bytes[offset++] !== 0xff) return invalidImage();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) break;
      return imageSize(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    offset += length;
  }
  return invalidImage();
}

function pngSize(bytes, view, signal) {
  if (bytes.length < 33 || textAt(bytes, 12, 4) !== 'IHDR') return invalidImage();
  const size = imageSize(view.getUint32(16), view.getUint32(20));
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    checkAbort(signal);
    const length = view.getUint32(offset), type = textAt(bytes, offset + 4, 4);
    if (offset + 12 + length > bytes.length) return invalidImage();
    if (type === 'acTL' && length >= 8 && view.getUint32(offset + 8) > 1) animatedImage();
    if (type === 'IEND') return size;
    offset += length + 12;
  }
  return invalidImage();
}

function gifSize(bytes, view, signal) {
  if (bytes.length < 13) return invalidImage();
  const size = imageSize(view.getUint16(6, true), view.getUint16(8, true));
  let offset = 13 + ((bytes[10] & 128) ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      checkAbort(signal);
      const length = bytes[offset++];
      if (!length) return;
      offset += length;
    }
    invalidImage();
  };
  while (offset < bytes.length) {
    checkAbort(signal);
    const block = bytes[offset++];
    if (block === 0x3b) return frames === 1 ? size : invalidImage();
    if (block === 0x21) { offset++; skipBlocks(); }
    else if (block === 0x2c) {
      if (++frames > 1) animatedImage();
      if (offset + 9 > bytes.length) return invalidImage();
      imageSize(view.getUint16(offset + 4, true), view.getUint16(offset + 6, true));
      const packed = bytes[offset + 8];
      offset += 9 + ((packed & 128) ? 3 * 2 ** ((packed & 7) + 1) : 0);
      offset++; // LZW minimum code size.
      skipBlocks();
    } else return invalidImage();
  }
  return invalidImage();
}

function webpSize(bytes, view, signal) {
  let offset = 12, size;
  const uint24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  while (offset + 8 <= bytes.length) {
    checkAbort(signal);
    const type = textAt(bytes, offset, 4), length = view.getUint32(offset + 4, true), data = offset + 8;
    if (data + length > bytes.length) return invalidImage();
    if (type === 'ANIM' || type === 'ANMF') animatedImage();
    if (type === 'VP8X' && length >= 10) {
      if (bytes[data] & 2) animatedImage();
      size = imageSize(uint24(data + 4) + 1, uint24(data + 7) + 1);
    } else if (type === 'VP8 ' && length >= 10) {
      const frame = imageSize(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
      size ||= frame;
    } else if (type === 'VP8L' && length >= 5) {
      const bits = view.getUint32(data + 1, true);
      const frame = imageSize((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      size ||= frame;
    }
    offset = data + length + (length % 2);
  }
  return size || invalidImage();
}

function isoImageSize(bytes, view, signal) {
  // HEIF/AVIF dimensions live in meta/iprp/ipco/ispe. Never decode without them.
  let size;
  const walk = (start, end, depth) => {
    if (depth > 8) return invalidImage();
    for (let offset = start; offset + 8 <= end;) {
      checkAbort(signal);
      let length = view.getUint32(offset), header = 8;
      const type = textAt(bytes, offset + 4, 4);
      if (length === 1) {
        if (offset + 16 > end) return invalidImage();
        length = view.getUint32(offset + 8) * 4294967296 + view.getUint32(offset + 12);
        header = 16;
      } else if (length === 0) length = end - offset;
      if (!Number.isSafeInteger(length) || length < header || offset + length > end) return invalidImage();
      const data = offset + header;
      if (type === 'ftyp') {
        for (let brand = data; brand + 4 <= offset + length; brand += 4) {
          if (['avis', 'msf1', 'hevs', 'hevm'].includes(textAt(bytes, brand, 4))) animatedImage();
        }
      } else if (type === 'ispe' && length >= header + 12) {
        const candidate = imageSize(view.getUint32(data + 4), view.getUint32(data + 8));
        if (!size || candidate.width * candidate.height > size.width * size.height) size = candidate;
      } else if (['meta', 'iprp', 'ipco'].includes(type)) {
        walk(data + (type === 'meta' ? 4 : 0), offset + length, depth + 1);
      }
      offset += length;
    }
  };
  walk(0, bytes.length, 0);
  if (!size) throw new Error('Não foi possível verificar as dimensões desta imagem HEIF/AVIF com segurança. Converta-a para JPEG ou PNG.');
  return size;
}

function inspectImage(bytes, signal) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) return { type: 'jpeg', ...jpegSize(bytes, view, signal) };
  if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) return { type: 'png', ...pngSize(bytes, view, signal) };
  if (['GIF87a', 'GIF89a'].includes(textAt(bytes, 0, 6))) return { type: 'gif', ...gifSize(bytes, view, signal) };
  if (textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') return { type: 'webp', ...webpSize(bytes, view, signal) };
  if (bytes.length >= 26 && textAt(bytes, 0, 2) === 'BM') {
    const core = view.getUint32(14, true) === 12;
    return { type: 'bmp', ...imageSize(core ? view.getUint16(18, true) : view.getInt32(18, true), core ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true))) };
  }
  if (bytes.length >= 16 && textAt(bytes, 4, 4) === 'ftyp') return { type: 'heif', ...isoImageSize(bytes, view, signal) };
  return invalidImage();
}

async function decodeBrowserImage(blob, signal) {
  checkAbort(signal);
  let bitmapError;
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const image = await globalThis.createImageBitmap(blob);
      return { image, release: () => image.close() };
    } catch (error) { checkAbort(signal); bitmapError = error; }
  }
  if (typeof globalThis.Image !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new Error('O navegador não suporta decodificar esta imagem. Converta-a para JPEG ou PNG.', { cause: bitmapError });
  }
  const image = new globalThis.Image(), url = globalThis.URL.createObjectURL(blob);
  const release = () => { image.onload = image.onerror = null; image.src = ''; globalThis.URL.revokeObjectURL(url); };
  try {
    await new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException('Conversão cancelada.', 'AbortError'));
      const finish = callback => () => { signal?.removeEventListener('abort', aborted); callback(); };
      image.onload = finish(resolve);
      image.onerror = finish(() => reject(new Error('O navegador não conseguiu decodificar a imagem. Converta-a para JPEG ou PNG.')));
      signal?.addEventListener('abort', aborted, { once: true });
      image.src = url;
    });
    checkAbort(signal);
    return { image, release };
  } catch (error) { release(); throw error; }
}

async function convertImage(blob, signal) {
  let decoded, canvas;
  try {
    decoded = await decodeBrowserImage(blob, signal);
    checkAbort(signal);
    const { width, height } = imageSize(decoded.image.naturalWidth || decoded.image.width, decoded.image.naturalHeight || decoded.image.height);
    canvas = globalThis.document?.createElement('canvas');
    if (!canvas && typeof globalThis.OffscreenCanvas === 'function') canvas = new globalThis.OffscreenCanvas(width, height);
    if (!canvas) throw new Error('O navegador não suporta converter esta imagem em PDF. Use JPEG ou PNG.');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível converter a imagem no navegador. Use JPEG ou PNG.');
    context.drawImage(decoded.image, 0, 0, width, height);
    checkAbort(signal);
    const png = typeof canvas.convertToBlob === 'function'
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    checkAbort(signal);
    if (!png || png.size > MAX_BYTES) throw new Error('Não foi possível converter a imagem com segurança dentro do limite de 60 MB.');
    const bytes = new Uint8Array(await png.arrayBuffer());
    checkAbort(signal);
    if (inspectImage(bytes, signal).type !== 'png') return invalidImage();
    return bytes;
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    decoded?.release();
  }
}

async function rejectDigitalSignatures(pdf, signal) {
  const stack = pdf.context.enumerateIndirectObjects().map(([, object]) => object), visited = new Set();
  let count = 0;
  while (stack.length) {
    checkAbort(signal);
    const object = stack.pop();
    if (!object || visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFDict) {
      const value = pdf.context.lookup(object.get(nameOf('V')));
      const signatureField = object.get(nameOf('FT')) === nameOf('Sig') && value && value !== PDFNull;
      const contents = pdf.context.lookup(object.get(nameOf('Contents')));
      const range = pdf.context.lookup(object.get(nameOf('ByteRange')));
      const signedValue = (object.get(nameOf('Type')) === nameOf('Sig') || range instanceof PDFArray)
        && ((contents?.asBytes?.().some(byte => byte !== 0))
          || (range instanceof PDFArray && range.asArray().some(item => pdf.context.lookup(item)?.asNumber?.() > 0)));
      if (signatureField || signedValue) throw new Error('Este PDF contém assinatura digital e não pode receber páginas sem invalidá-la.');
      for (const [, entry] of object.entries()) stack.push(pdf.context.lookup(entry));
    } else if (object instanceof PDFArray) {
      for (const entry of object.asArray()) stack.push(pdf.context.lookup(entry));
    } else if (object.dict instanceof PDFDict) stack.push(object.dict);
    if (++count % 512 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); checkAbort(signal); }
  }
}

function flattenExistingAppearances(pdf, signal) {
  const acroForm = pdf.catalog.lookupMaybe(nameOf('AcroForm'), PDFDict);
  if (!acroForm) return;
  if (acroForm.has(nameOf('XFA'))) throw new Error('Formulários XFA não podem ser acrescentados sem perder sua aparência. Converta o formulário para PDF estático.');
  try {
    const form = pdf.getForm();
    for (const field of form.getFields()) {
      checkAbort(signal);
      // A blank, unsigned signature placeholder has no appearance to preserve.
      if (field instanceof PDFSignature) {
        for (const widget of field.acroField.getWidgets()) {
          const rectangle = widget.getRectangle();
          if (!widget.AP()?.get(nameOf('N')) && (!rectangle.width || !rectangle.height)) {
            widget.setNormalAppearance(pdf.context.register(pdf.context.flateStream('', {
              Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: {},
            })));
          }
        }
      }
      for (const widget of field.acroField.getWidgets()) {
        checkAbort(signal);
        // Flattening ignores annotation visibility and could expose internal
        // values. A static export is required when view/print visibility differs.
        if (widget.getFlags() & (1 | 2 | 32)) {
          throw new Error('O formulário contém campos ocultos cuja aparência não pode ser preservada.');
        }
        const normal = widget.AP()?.lookup(nameOf('N'));
        if (normal instanceof PDFDict) {
          // Freeze the state actually displayed by the widget. pdf-lib otherwise
          // falls back to Off when the selected checkbox/radio appearance is absent.
          const state = widget.getAppearanceState() || field.acroField.getValue?.() || nameOf('Off');
          const appearance = normal.get(state);
          if (!appearance) throw new Error('A aparência selecionada do formulário está ausente.');
          widget.setNormalAppearance(appearance);
        }
      }
    }
    form.flatten({ updateFieldAppearances: false });
    checkAbort(signal);
  } catch (cause) {
    checkAbort(signal);
    throw new Error('Não foi possível preservar a aparência do formulário preenchido. Salve-o como PDF estático antes de acrescentar páginas.', { cause });
  }
}

function addImagePage(pdf, image, orientation) {
  const { width, height } = image;
  const page = pdf.addPage(orientation >= 5 ? [height, width] : [width, height]);
  const matrix = {
    2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height],
    5: [0, -1, -1, 0, height, width], 6: [0, -1, 1, 0, 0, width],
    7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, height, 0],
  }[orientation];
  if (matrix) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  page.drawImage(image, { x: 0, y: 0, width, height });
  if (matrix) page.pushOperators(popGraphicsState());
}

/** Compose a new PDF in memory. Persisting/replacing the original is the caller's job. */
export async function appendAttachmentPdf(originalBlob, originalName, additions, { signal, onProgress } = {}) {
  checkAbort(signal);
  if (!Array.isArray(additions) || !additions.length) throw new Error('Selecione ao menos um arquivo para acrescentar ao anexo.');
  const entries = [{ blob: originalBlob, name: originalName || originalBlob?.name }, ...additions.map(blob => ({ blob, name: blob?.name }))];
  let inputBytes = 0;
  for (const entry of entries) {
    checkAbort(signal);
    entry.kind = attachmentKind(entry.blob, entry.name);
    if (!entry.kind) throw new Error('Arquivo vazio, inválido ou em formato não suportado. Selecione PDF ou uma imagem estática.');
    inputBytes += entry.blob.size;
    if (inputBytes > MAX_BYTES) throw new Error('O tamanho total dos arquivos excede o limite de 60 MB.');
  }
  if (entries.length > MAX_PAGES) throw new Error('O PDF final não pode exceder 200 páginas.');
  // Each source completes its read, inspection/parse, and appended pages;
  // creating the output and serializing it are two additional real units.
  const totalUnits = entries.length * 3 + 2;
  const progress = (completed, detail) => {
    checkAbort(signal);
    const percent = Math.min(99, Math.floor(completed * 100 / totalUnits));
    try { onProgress?.(percent, { ...detail, percent, completed, total: totalUnits, totalSources: entries.length }); }
    catch { /* An optional observer must not fail PDF composition. */ }
    checkAbort(signal);
  };
  progress(0, { phase: 'prepared', completedSources: 0 });
  const output = await PDFDocument.create();
  checkAbort(signal);
  progress(1, { phase: 'created', completedSources: 0 });
  for (const [index, entry] of entries.entries()) {
    checkAbort(signal);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    checkAbort(signal);
    progress(2 + index * 3, { phase: 'read', completedSources: index });
    if (entry.kind === 'pdf') {
      let source, count;
      try {
        source = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
        checkAbort(signal);
        count = source.getPageCount();
      } catch (cause) {
        checkAbort(signal);
        if (/encrypt/i.test(String(cause?.message))) throw new Error('PDF criptografado ou protegido por senha não pode receber páginas.', { cause });
        throw new Error('Não foi possível abrir o PDF: arquivo inválido ou corrompido.', { cause });
      }
      if (!count) throw new Error('O PDF selecionado está vazio, sem páginas.');
      if (output.getPageCount() + count > MAX_PAGES) throw new Error('O PDF final não pode exceder 200 páginas.');
      progress(3 + index * 3, { phase: 'parsed', completedSources: index, totalPages: count });
      await rejectDigitalSignatures(source, signal);
      checkAbort(signal);
      flattenExistingAppearances(source, signal);
      // One copier per source preserves shared fonts/images instead of multiplying
      // their byte size for every page. The source is already bounded to 200 pages.
      const copied = await output.copyPages(source, source.getPageIndices());
      checkAbort(signal);
      for (let page = 0; page < count; page++) {
        checkAbort(signal);
        output.addPage(copied[page]);
        progress(3 + index * 3 + (page + 1) / count, {
          phase: 'append', completedSources: index + (page + 1 === count ? 1 : 0), appendedPages: page + 1, totalPages: count,
        });
        if (page % 10 === 9) { await new Promise(resolve => setTimeout(resolve, 0)); checkAbort(signal); }
      }
    } else {
      if (output.getPageCount() >= MAX_PAGES) throw new Error('O PDF final não pode exceder 200 páginas.');
      const metadata = inspectImage(bytes, signal);
      progress(3 + index * 3, { phase: 'inspected', completedSources: index, totalPages: 1 });
      let image;
      try {
        if (metadata.type === 'jpeg') image = await output.embedJpg(bytes);
        else if (metadata.type === 'png') image = await output.embedPng(bytes);
        else {
          const converted = await convertImage(entry.blob, signal);
          checkAbort(signal);
          image = await output.embedPng(converted);
        }
        checkAbort(signal);
        // Compress/flush this image now so decoded pixel buffers can be released
        // before decoding the next photo, rather than retaining an entire batch.
        await image.embed();
        checkAbort(signal);
      } catch (cause) {
        checkAbort(signal);
        throw new Error(`Não foi possível converter a imagem em PDF. ${cause?.message || 'Imagem inválida ou não suportada.'}`, { cause });
      }
      addImagePage(output, image, metadata.type === 'jpeg' ? jpegOrientation(bytes) : 1);
      progress(4 + index * 3, { phase: 'append', completedSources: index + 1, appendedPages: 1, totalPages: 1 });
    }
  }
  progress(totalUnits - 1, { phase: 'serialize', completedSources: entries.length });
  const bytes = await output.save({ updateFieldAppearances: false });
  checkAbort(signal);
  if (bytes.byteLength > MAX_BYTES) throw new Error('O PDF gerado excede o limite de 60 MB.');
  const name = String(originalName || originalBlob.name || 'anexo').split(/[\\/]/).at(-1).replace(/\.[^.]+$/, '') || 'anexo';
  const result = new File([bytes], `${name}.pdf`, { type: 'application/pdf' });
  progress(totalUnits, { phase: 'ready', completedSources: entries.length });
  return result;
}
