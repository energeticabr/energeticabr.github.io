import { createServer } from 'vite';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fileURLToPath } from 'node:url';

// Local-only binary fixture. No user documents, Microsoft or VM calls.
export async function startAttachmentDownloadServer() {
  const document = await PDFDocument.create(), page = document.addPage([595, 842]);
  page.drawText('ENERGETICO - arquivo ficticio para teste', { x: 30, y: 760, size: 18, font: await document.embedFont(StandardFonts.Helvetica) });
  const binary = Buffer.concat([Buffer.from(await document.save()), Buffer.from('\n%' + ' '.repeat(65536))]);
  const bytes = binary.length % 2 ? Buffer.concat([binary, Buffer.from(' ')]) : binary;
  const requests = [];
  const server = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'local-attachment-download', configureServer(server) {
      server.middlewares.use('/qa/download', (req, res) => {
        const params = new URL(req.url, 'http://127.0.0.1').searchParams, mode = params.get('mode');
        requests.push({ authorization: req.headers.authorization });
        if (mode === 'denied') { res.writeHead(403); res.end('Acesso negado — teste'); return; }
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          ...(mode === 'unknown' ? {} : { 'Content-Length': bytes.length }) });
        res.write(bytes.subarray(0, bytes.length / 2));
        const timer = setTimeout(() => res.end(bytes.subarray(bytes.length / 2)), params.has('hold') ? 90000 : 700);
        res.on('close', () => clearTimeout(timer));
      });
    } }] });
  await server.listen();
  return { url: `http://127.0.0.1:${server.httpServer.address().port}`, requests, close: () => server.close() };
}

if (process.argv.includes('--serve')) {
  const server = await startAttachmentDownloadServer();
  console.log(server.url + '/tests/fixtures/attachment-open-progress.html?interactive&hold');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
}
