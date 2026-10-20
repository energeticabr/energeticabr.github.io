/** Preserve the server-rendered pages losslessly, in their original order. */
export async function buildProvisionImageReportPdf(blobs) {
  if (!Array.isArray(blobs) || !blobs.length) throw new TypeError('O relatório não contém páginas.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const blob of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = bytes[0] === 0xff && bytes[1] === 0xd8
      ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const width = 841.89, height = width * image.height / image.width;
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
