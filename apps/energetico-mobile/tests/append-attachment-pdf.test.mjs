import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  PDFDocument, PDFDict, PDFName, PDFHexString, PDFString, PDFRawStream,
  StandardFonts, degrees, rgb,
} from 'pdf-lib';
import { getDocument, OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { appendAttachmentPdf, isAppendableAttachment } from '../src/web/append-attachment-pdf.js';

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

async function pdfFile(pages, name = 'original.pdf', configure) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [width, height, text] of pages) {
    const page = pdf.addPage([width, height]);
    if (text) page.drawText(text, { x: 8, y: 24, size: 10, font });
  }
  await configure?.(pdf);
  return new File([await pdf.save({ updateFieldAppearances: false })], name, { type: 'application/pdf' });
}

async function imageFile(width, height, format = 'jpeg', orientation) {
  let image = sharp({ create: { width, height, channels: 4, background: '#ff000080' } });
  if (orientation) image = image.withMetadata({ orientation });
  return new File([await image[format]().toBuffer()], `image.${format}`, { type: `image/${format}` });
}

async function inspect(file, action) {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 });
  try { return await action(await task.promise); }
  finally { await task.destroy(); }
}

async function pageTexts(file) {
  return inspect(file, async pdf => {
    const result = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      result.push((await (await pdf.getPage(page)).getTextContent()).items.map(item => item.str).join(' '));
    }
    return result;
  });
}

function images(pdf, page = 0) {
  const resources = pdf.getPage(page).node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  return resources.entries().map(([, ref]) => pdf.context.lookup(ref))
    .filter(value => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
}

// Dropping/reordering a PDF page, rasterizing it, or changing its boxes must fail.
test('appends all PDF pages after the original with selectable text and vector geometry', async () => {
  const original = await pdfFile([[210, 310, 'ORIGINAL ONE'], [220, 320, 'ORIGINAL TWO']], 'invoice.original.pdf', pdf => {
    pdf.getPage(0).drawRectangle({ x: 30, y: 50, width: 80, height: 40, color: rgb(1, 0, 0) });
    pdf.getPage(1).setCropBox(5, 6, 200, 300);
    pdf.getPage(1).setRotation(degrees(90));
  });
  const a = await pdfFile([[230, 330, 'ADDITION ONE'], [240, 340, 'ADDITION TWO']], 'scan.pdf');
  const b = await pdfFile([[250, 350, 'LAST PAGE']], 'last.pdf');
  const before = new Uint8Array(await original.arrayBuffer());
  const result = await appendAttachmentPdf(original, original.name, [a, b]);
  assert.ok(result instanceof File);
  assert.equal(result.name, 'invoice.original.pdf');
  assert.equal(result.type, 'application/pdf');
  const pdf = await PDFDocument.load(await result.arrayBuffer());
  assert.deepEqual(pdf.getPages().map(page => [page.getWidth(), page.getHeight()]),
    [[210, 310], [220, 320], [230, 330], [240, 340], [250, 350]]);
  assert.equal(pdf.getPage(1).getRotation().angle, 90);
  assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 5, y: 6, width: 200, height: 300 });
  assert.deepEqual(await pageTexts(result), ['ORIGINAL ONE', 'ORIGINAL TWO', 'ADDITION ONE', 'ADDITION TWO', 'LAST PAGE']);
  await inspect(result, async viewer => {
    const ops = await (await viewer.getPage(1)).getOperatorList();
    assert.ok(ops.fnArray.includes(OPS.constructPath), 'the original rectangle remains a vector');
    assert.ok(!ops.fnArray.includes(OPS.paintImageXObject), 'PDF pages must not be rasterized');
  });
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
});

// Recompressing a JPEG or dropping PNG transparency must fail on embedded data.
test('turns an image original into the first PDF page and keeps mixed additions in order', async () => {
  const jpeg = await imageFile(80, 120);
  const png = await imageFile(64, 32, 'png');
  const scan = await pdfFile([[300, 400, 'SCAN ONE'], [301, 401, 'SCAN TWO']]);
  const result = await appendAttachmentPdf(jpeg, 'receipt.jpg', [scan, png]);
  assert.equal(result.name, 'receipt.pdf');
  const pdf = await PDFDocument.load(await result.arrayBuffer());
  assert.deepEqual(pdf.getPages().map(page => [page.getWidth(), page.getHeight()]), [[80, 120], [300, 400], [301, 401], [64, 32]]);
  assert.deepEqual(await pageTexts(result), ['', 'SCAN ONE', 'SCAN TWO', '']);
  assert.deepEqual(images(pdf)[0].contents, new Uint8Array(await jpeg.arrayBuffer()));
  assert.equal(images(pdf, 3)[0].dict.get(PDFName.of('SMask'))?.constructor.name, 'PDFRef');
});

test('preserves shared PDF resources instead of multiplying the size by the number of pages', async () => {
  const photo = await imageFile(8, 8);
  const imageBytes = new Uint8Array(await new Blob([photo, new Uint8Array(250_000)]).arrayBuffer());
  const original = await pdfFile(Array.from({ length: 20 }, (_, index) => [100, 200, `PAGE ${index + 1}`]), 'shared.pdf', async pdf => {
    const image = await pdf.embedJpg(imageBytes);
    for (const page of pdf.getPages()) page.drawImage(image, { x: 10, y: 80, width: 8, height: 8 });
  });
  const result = await appendAttachmentPdf(original, original.name, [await pdfFile([[50, 60, 'END']])]);
  assert.ok(result.size < original.size * 2, 'a shared image must not be duplicated for every page');
  assert.deepEqual((await pageTexts(result)).slice(-2), ['PAGE 20', 'END']);
});

// These literal PDF-space transforms independently describe all eight EXIF cases.
for (const [orientation, size, expected] of [
  [1, [80, 120], [80, 0, 0, 120, 0, 0]],
  [2, [80, 120], [-80, 0, 0, 120, 80, 0]],
  [3, [80, 120], [-80, 0, 0, -120, 80, 120]],
  [4, [80, 120], [80, 0, 0, -120, 0, 120]],
  [5, [120, 80], [0, -80, -120, 0, 120, 80]],
  [6, [120, 80], [0, -80, 120, 0, 0, 80]],
  [7, [120, 80], [0, 80, 120, 0, 0, 0]],
  [8, [120, 80], [0, 80, -120, 0, 120, 0]],
]) test(`preserves EXIF orientation ${orientation} without recompressing JPEG bytes`, async () => {
  const photo = await imageFile(80, 120, 'jpeg', orientation);
  const result = await appendAttachmentPdf(photo, 'photo.jpg', [await pdfFile([[40, 50, 'END']])]);
  const pdf = await PDFDocument.load(await result.arrayBuffer());
  assert.deepEqual([pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()], size);
  assert.deepEqual(images(pdf)[0].contents, new Uint8Array(await photo.arrayBuffer()));
  await inspect(result, async viewer => {
    const ops = await (await viewer.getPage(1)).getOperatorList();
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [], painted = [];
    ops.fnArray.forEach((op, index) => {
      if (op === OPS.save) stack.push(matrix.slice());
      else if (op === OPS.restore) matrix = stack.pop();
      else if (op === OPS.transform) matrix = Util.transform(matrix, ops.argsArray[index]);
      else if (op === OPS.paintImageXObject) painted.push(matrix.slice());
    });
    assert.deepEqual(painted, [expected]);
  });
});

test('offers append only for nonempty PDF or supported image candidates', async () => {
  assert.equal(typeof isAppendableAttachment, 'function');
  for (const [file, name, expected] of [
    [new Blob(['x'], { type: 'application/pdf' }), 'download', true],
    [new Blob(['x']), 'SCAN.PDF', true],
    [new Blob(['x'], { type: 'image/png' }), 'download', true],
    [new Blob(['x']), 'photo.JPEG', true],
    [new Blob(['x'], { type: 'image/webp' }), 'download', true],
    [new Blob(['x'], { type: 'image/heic' }), 'download', true],
    [new Blob(['x'], { type: 'image/svg+xml' }), 'drawing.svg', false],
    [new Blob(['x'], { type: 'application/vnd.ms-excel' }), 'data.xls', false],
    [new Blob([]), 'empty.pdf', false],
    [null, 'missing.pdf', false],
  ]) assert.equal(isAppendableAttachment(file, name), expected, name);
});

// Errors must reject the entire merge rather than return a partial PDF.
for (const [name, type, content] of [
  ['broken.pdf', 'application/pdf', '%PDF-1.7\nnot a document'],
  ['broken.jpg', 'image/jpeg', 'not a jpeg'],
  ['broken.png', 'image/png', 'not a png'],
  ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unsupported'],
]) test(`rejects ${name} without changing the original`, async () => {
  const original = await pdfFile([[100, 200, 'UNCHANGED']]);
  const before = new Uint8Array(await original.arrayBuffer());
  await assert.rejects(appendAttachmentPdf(original, original.name, [new File([content], name, { type })]),
    /PDF|imagem|formato|suportad|corrompid|inválid/i);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
});

test('rejects encrypted PDFs rather than loading them with ignored encryption', async () => {
  const encrypted = await pdfFile([[100, 200, 'CONFIDENTIAL']], 'encrypted.pdf', pdf => {
    pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: 'Standard', V: 1, R: 2, P: -4 }));
  });
  await assert.rejects(appendAttachmentPdf(encrypted, encrypted.name, [await pdfFile([[50, 60, 'END']])]),
    /criptograf|senha|encrypted/i);
});

async function signatureFile({ signed = true, direct = false } = {}) {
  return pdfFile([[300, 200, '/Sig /ByteRange in ordinary text']], 'signed.pdf', pdf => {
    const field = pdf.context.obj({ FT: 'Sig', T: PDFString.of('signature'), Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 0, 0], P: pdf.getPage(0).ref });
    if (signed) {
      const signature = pdf.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', ByteRange: [0, 100, 200, 100], Contents: PDFHexString.of('30820100010203') });
      field.set(PDFName.of('V'), direct ? signature : pdf.context.register(signature));
    }
    const ref = pdf.context.register(field);
    pdf.getForm().acroForm.addField(ref);
    pdf.getPage(0).node.addAnnot(ref);
  });
}

for (const position of ['original', 'addition', 'direct']) test(`rejects actual digital signatures in the ${position} PDF`, async () => {
  const signed = await signatureFile({ direct: position === 'direct' });
  const plain = await pdfFile([[50, 60, 'END']]);
  await assert.rejects(position === 'addition'
    ? appendAttachmentPdf(plain, plain.name, [signed])
    : appendAttachmentPdf(signed, signed.name, [plain]), /assinad|assinatura digital|digitally signed/i);
});

test('does not confuse an empty signature field or signature-like text with an actual signature', async () => {
  const original = await signatureFile({ signed: false });
  const result = await appendAttachmentPdf(original, original.name, [await pdfFile([[50, 60, 'END']])]);
  assert.deepEqual(await pageTexts(result), ['/Sig /ByteRange in ordinary text', 'END']);
});

test('flattens the existing filled form appearance without regenerating it from its value', async () => {
  const original = await pdfFile([[300, 400, 'HEADER']], 'filled.pdf', pdf => {
    const form = pdf.getForm(), field = form.createTextField('entry');
    field.setText('VISIBLE APPEARANCE');
    field.addToPage(pdf.getPage(0), { x: 20, y: 80, width: 240, height: 30 });
    form.updateFieldAppearances();
    field.setText('VALUE MUST NOT REPLACE APPEARANCE');
  });
  const before = new Uint8Array(await original.arrayBuffer());
  const result = await appendAttachmentPdf(await pdfFile([[100, 200, 'FIRST']]), 'first.pdf', [original]);
  assert.deepEqual(await pageTexts(result), ['FIRST', 'HEADER VISIBLE APPEARANCE']);
  assert.equal((await PDFDocument.load(await result.arrayBuffer())).getForm().getFields().length, 0);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
});

test('rejects a filled field with missing appearance instead of silently losing its contents', async () => {
  const original = await pdfFile([[300, 400, 'HEADER']], 'no-appearance.pdf', pdf => {
    const field = pdf.getForm().createTextField('entry');
    field.setText('FILLED');
    field.addToPage(pdf.getPage(0), { x: 20, y: 80, width: 240, height: 30 });
    field.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  });
  await assert.rejects(appendAttachmentPdf(original, original.name, [await pdfFile([[50, 60, 'END']])]),
    /aparência|aparencia|formulário|formulario/i);
});

test('rejects a checked box whose selected appearance is missing instead of substituting Off', async () => {
  const original = await pdfFile([[300, 400, 'HEADER']], 'checked.pdf', pdf => {
    const field = pdf.getForm().createCheckBox('checked');
    field.addToPage(pdf.getPage(0), { x: 30, y: 80, width: 20, height: 20 });
    field.check();
    const widget = field.acroField.getWidgets()[0];
    widget.AP().lookup(PDFName.of('N'), PDFDict).delete(PDFName.of('Yes'));
  });
  await assert.rejects(appendAttachmentPdf(original, original.name, [await pdfFile([[50, 60, 'END']])]),
    /aparência|aparencia|formulário|formulario/i);
});

test('rejects XFA forms whose appearance cannot safely be flattened', async () => {
  const original = await pdfFile([[100, 200, 'HEADER']], 'xfa.pdf', pdf => {
    pdf.getForm().acroForm.dict.set(PDFName.of('XFA'), PDFString.of('<xfa/>'));
  });
  await assert.rejects(appendAttachmentPdf(original, original.name, [await pdfFile([[50, 60, 'END']])]), /XFA|formulário|formulario/i);
});

test('rejects aggregate input above 60 MB before reading any bytes', async () => {
  let reads = 0;
  class UnreadFile extends File { async arrayBuffer() { reads++; throw new Error('must not read oversized input'); } }
  const original = new UnreadFile([new Uint8Array(60_000_000)], 'large.jpg', { type: 'image/jpeg' });
  await assert.rejects(appendAttachmentPdf(original, original.name, [new File(['x'], 'extra.pdf', { type: 'application/pdf' })]), /60\s*MB/i);
  assert.equal(reads, 0);
});

test('also rejects a serialized output above 60 MB even when aggregate input meets the limit', async () => {
  const jpeg = await imageFile(8, 8), extra = await imageFile(9, 9);
  // JPEG permits trailing bytes; preserving it creates a PDF envelope beyond 60 MB.
  const original = new File([jpeg, new Uint8Array(60_000_000 - jpeg.size - extra.size)], 'large.jpg', { type: 'image/jpeg' });
  assert.equal(original.size + extra.size, 60_000_000);
  await assert.rejects(appendAttachmentPdf(original, original.name, [extra]), /60\s*MB/i);
});

test('accepts exactly 200 pages and rejects 201 across PDFs and images', async () => {
  const original = await pdfFile(Array.from({ length: 199 }, (_, index) => [100, 200, `PAGE ${index + 1}`]));
  const photo = await imageFile(8, 8);
  const result = await appendAttachmentPdf(original, original.name, [photo]);
  assert.equal((await PDFDocument.load(await result.arrayBuffer())).getPageCount(), 200);
  await assert.rejects(appendAttachmentPdf(original, original.name, [photo, photo]), /200\s*páginas|200\s*paginas/i);
});

test('requires nonempty originals and additions', async () => {
  const original = await pdfFile([[100, 200, 'FIRST']]);
  await assert.rejects(appendAttachmentPdf(new Blob([]), 'empty.pdf', [original]), /vazi|inválid|arquivo|anexo/i);
  await assert.rejects(appendAttachmentPdf(original, original.name, []), /selecion|adicione|arquivo|anexo/i);
});

test('already aborted composition never reads the original', async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  const original = await pdfFile([[100, 200, 'FIRST']]);
  original.arrayBuffer = async () => { reads++; throw new Error('unexpected read'); };
  await assert.rejects(appendAttachmentPdf(original, original.name, [original], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 0);
});

test('abort during an awaited read prevents parsing or returning a replacement', async () => {
  const controller = new AbortController();
  const fixture = await pdfFile([[100, 200, 'FIRST']]);
  class AbortingFile extends File {
    async arrayBuffer() { const bytes = await super.arrayBuffer(); controller.abort(); return bytes; }
  }
  const original = new AbortingFile([fixture], fixture.name, { type: fixture.type });
  await assert.rejects(appendAttachmentPdf(original, original.name, [fixture], { signal: controller.signal }), { name: 'AbortError' });
});

test('progress remains finite and below server confirmation throughout composition', async () => {
  const original = await pdfFile([[100, 200, 'FIRST']]);
  const values = [];
  await appendAttachmentPdf(original, original.name, [await imageFile(8, 8)], { onProgress: value => values.push(value) });
  assert.ok(values.length >= 3);
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 99);
  values.forEach((value, index) => {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 99);
    if (index) assert.ok(value >= values[index - 1]);
  });
});

test('abort from progress during composition or its final callback never returns a replacement', async () => {
  const original = await pdfFile(Array.from({ length: 20 }, () => [100, 200, 'PAGE']));
  for (const threshold of [20, 99]) {
    const controller = new AbortController();
    await assert.rejects(appendAttachmentPdf(original, original.name, [original], {
      signal: controller.signal,
      onProgress: value => { if (value >= threshold) controller.abort(); },
    }), { name: 'AbortError' });
  }
});

test('rejects animated GIF and WebP inputs rather than keeping just the first frame', async () => {
  const raw = Buffer.alloc(8 * 16 * 4, 255);
  raw.fill(0, 8 * 8 * 4);
  const source = sharp(raw, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } });
  const original = await pdfFile([[100, 200, 'FIRST']]);
  for (const format of ['gif', 'webp']) {
    const animated = await source.clone()[format]({ loop: 0, delay: [100, 100] }).toBuffer();
    assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2, 'fixture really contains two frames');
    await assert.rejects(appendAttachmentPdf(original, original.name, [new File([animated], `animated.${format}`, { type: `image/${format}` })]), /animad|animação|animation/i);
  }
});

test('reports unavailable browser decoding explicitly for other static image formats', async () => {
  const original = await pdfFile([[100, 200, 'FIRST']]);
  const webp = await imageFile(17, 23, 'webp');
  await assert.rejects(appendAttachmentPdf(original, original.name, [webp]), /navegador|suportad|decodific|converter/i);
});

for (const format of ['png', 'webp']) test(`rejects excessive ${format} pixel dimensions before decoding`, async t => {
  const original = await pdfFile([[100, 200, 'FIRST']]);
  const large = await imageFile(5000, 5000, format);
  let decodes = 0;
  replaceGlobal(t, 'createImageBitmap', async () => { decodes++; throw new Error('must not decode excessive dimensions'); });
  await assert.rejects(appendAttachmentPdf(original, original.name, [large]), /dimens|pixels|resolução|resolucao/i);
  assert.equal(decodes, 0);
});

test('checks GIF frame dimensions as well as the logical screen before decoding', async t => {
  const gif = Buffer.from(await (await imageFile(8, 8, 'gif')).arrayBuffer());
  const frame = gif.indexOf(0x2c, 13);
  assert.ok(frame > 0);
  gif.writeUInt16LE(10_000, frame + 5);
  gif.writeUInt16LE(10_000, frame + 7);
  let decodes = 0;
  replaceGlobal(t, 'createImageBitmap', async () => { decodes++; throw new Error('must not decode excessive frame'); });
  const original = await pdfFile([[100, 200, 'FIRST']]);
  await assert.rejects(appendAttachmentPdf(original, original.name, [new File([gif], 'oversized-frame.gif', { type: 'image/gif' })]), /dimens|pixels|resolução|resolucao/i);
  assert.equal(decodes, 0);
});

test('checks WebP frame dimensions even when its extended canvas declares a smaller image', async t => {
  const webp = Buffer.from(await (await imageFile(17, 23, 'webp')).arrayBuffer());
  assert.equal(webp.toString('ascii', 12, 16), 'VP8X');
  const frame = webp.indexOf('VP8 ');
  assert.ok(frame > 0);
  webp.writeUInt16LE(5000, frame + 14);
  webp.writeUInt16LE(5000, frame + 16);
  let decodes = 0;
  replaceGlobal(t, 'createImageBitmap', async () => { decodes++; throw new Error('must not decode excessive frame'); });
  const original = await pdfFile([[100, 200, 'FIRST']]);
  await assert.rejects(appendAttachmentPdf(original, original.name, [new File([webp], 'oversized-frame.webp', { type: 'image/webp' })]), /dimens|pixels|resolução|resolucao/i);
  assert.equal(decodes, 0);
});

// Only the browser's unavailable bitmap/canvas boundary is substituted in Node.
// PDF bytes, image data, dimensions, and all composition remain real.
test('converts a browser-decoded static WebP and releases bitmap and canvas resources', async t => {
  const webp = await imageFile(17, 23, 'webp');
  const converted = await sharp(Buffer.from(await webp.arrayBuffer())).png().toBuffer();
  let closed = 0, painted;
  const bitmap = { width: 17, height: 23, close() { closed++; } };
  const canvas = {
    width: 0, height: 0,
    getContext(kind) { assert.equal(kind, '2d'); return { drawImage(...args) { painted = args; } }; },
    toBlob(done, type) { assert.equal(type, 'image/png'); done(new Blob([converted], { type })); },
  };
  replaceGlobal(t, 'createImageBitmap', async file => {
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await webp.arrayBuffer()));
    return bitmap;
  });
  replaceGlobal(t, 'document', { createElement(name) { assert.equal(name, 'canvas'); return canvas; } });
  const result = await appendAttachmentPdf(webp, webp.name, [await pdfFile([[50, 60, 'END']])]);
  assert.deepEqual(painted, [bitmap, 0, 0, 17, 23]);
  assert.equal(closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  const pdf = await PDFDocument.load(await result.arrayBuffer());
  assert.deepEqual([pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()], [17, 23]);
  assert.equal(images(pdf)[0].dict.lookup(PDFName.of('Width')).asNumber(), 17);
});

for (const phase of ['bitmap', 'encoding', 'converted-read']) test(`aborts after awaited browser ${phase} and releases conversion resources`, async t => {
  const controller = new AbortController();
  const webp = await imageFile(17, 23, 'webp');
  const converted = await sharp(Buffer.from(await webp.arrayBuffer())).png().toBuffer();
  let closed = 0;
  const bitmap = { width: 17, height: 23, close() { closed++; } };
  class ConvertedBlob extends Blob {
    async arrayBuffer() {
      const bytes = await super.arrayBuffer();
      if (phase === 'converted-read') controller.abort();
      return bytes;
    }
  }
  const canvas = {
    width: 0, height: 0,
    getContext() { return { drawImage() {} }; },
    toBlob(done) {
      if (phase === 'encoding') controller.abort();
      done(new ConvertedBlob([converted], { type: 'image/png' }));
    },
  };
  replaceGlobal(t, 'createImageBitmap', async () => {
    if (phase === 'bitmap') controller.abort();
    return bitmap;
  });
  replaceGlobal(t, 'document', { createElement() { return canvas; } });
  await assert.rejects(appendAttachmentPdf(webp, webp.name, [await pdfFile([[50, 60, 'END']])], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test('abort during asynchronous serialization never returns a composed file', async () => {
  const controller = new AbortController();
  const original = await pdfFile([[100, 200, 'FIRST']]);
  await assert.rejects(appendAttachmentPdf(original, original.name, [original], {
    signal: controller.signal,
    onProgress: value => { if (value === 95) queueMicrotask(() => controller.abort()); },
  }), { name: 'AbortError' });
});
