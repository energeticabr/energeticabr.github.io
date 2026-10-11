import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFRef, PDFName } from "pdf-lib";

import { signPdfAttachment } from "../src/web/pdf-signing.js";
import { signatureLayoutGeometry } from "../src/web/signature-document-layout.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("PDF com objetos de geração não zero usa tabela xref compatível com auditoria estrita", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.context.assign(PDFRef.of(58, 1), source.context.obj({ Diagnostic: "generation-one" }));
  source.context.assign(PDFRef.of(58, 0), source.context.obj({ Diagnostic: "generation-zero" }));
  source.catalog.set(PDFName.of("DiagnosticZero"), PDFRef.of(58, 0));
  source.catalog.set(PDFName.of("DiagnosticOne"), PDFRef.of(58, 1));
  const original = await source.save({ useObjectStreams: false });
  const result = await signPdfAttachment({
    documentBlob: new Blob([original]), signatureBlob: new Blob([PNG_1X1]),
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.5 },
    integrityId: "0123456789abcdef0123456789abcdef",
    verificationUrl: "https://example.com/assinaturas/0123456789abcdef0123456789abcdef/" + "a".repeat(64),
  });
  const bytes = Buffer.from(await result.arrayBuffer());
  assert.match(bytes.toString("latin1"), /\nxref\n/);
  assert.doesNotMatch(bytes.toString("latin1"), /\/Type \/ObjStm/);
  const text = bytes.toString("latin1");
  const xref = text.slice(text.lastIndexOf("\nxref\n") + 6).split("\n");
  for (let index = 0; index < xref.length && xref[index] !== "trailer";) {
    const [first, count] = xref[index++].split(" ").map(Number);
    for (let row = 0; row < count; row++) {
      const [offset, generation, kind] = xref[index++].trim().split(/\s+/);
      if (kind === "n") assert.ok(text.slice(Number(offset)).startsWith(`${first + row} ${Number(generation)} obj`), "cada entrada xref deve apontar para seu próprio objeto");
    }
  }
  const signed = await PDFDocument.load(bytes);
  assert.equal(signed.getPageCount(), 1);
  assert.equal(signed.getPage(0).node.Annots().size(), 1);
  assert.equal(signed.catalog.lookup(PDFName.of("DiagnosticZero")).get(PDFName.of("Diagnostic")).toString(), "/generation-zero");
  assert.equal(signed.catalog.lookup(PDFName.of("DiagnosticOne")).get(PDFName.of("Diagnostic")).toString(), "/generation-one");
});

test("PDF de ponto imprime retângulo externo envolvendo assinatura e registro", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const result = await signPdfAttachment({
    documentBlob: new Blob([await source.save()], { type: "application/pdf" }),
    documentFileName: "PONTO-RHID-17-2026-09.pdf",
    signatureBlob: new Blob([PNG_1X1], { type: "image/png" }),
    point: { page: 1, x: 0.7, y: 0.2, scale: 0.5 },
    signerName: "CLEITON CESAR NONATO", signedAt: "2026-10-03T23:00:00Z",
    integrityId: "0123456789abcdef0123456789abcdef",
  });
  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  assert.match(content, /0\.08 0\.18 0\.34 RG[\s\S]*h\nS/, 'borda azul fechada envolve o cartão arredondado');
  assert.ok(boldTextPlacement(content, "CLEITON CESAR NONATO"));
  assert.ok(boldTextPlacement(content, "REGISTRO: 0123456789abcdef"));
  assert.ok(boldTextPlacement(content, "0123456789abcdef"));
});

test("identificação do ponto mantém letras legíveis no tamanho padrão de 50%", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const id = "0123456789abcdeffedcba9876543210";
  const result = await signPdfAttachment({
    documentBlob: new Blob([await source.save()], { type: "application/pdf" }),
    documentFileName: "PONTO-RHID-17-2026-09.pdf",
    signatureBlob: new Blob([PNG_1X1], { type: "image/png" }),
    point: { page: 1, x: 0.7, y: 0.2, scale: 0.5 },
    signerName: "CLEITON CESAR NONATO", signedAt: "2026-10-04T02:58:00Z", integrityId: id,
  });
  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  for (const label of ["CLEITON CESAR NONATO", "DATA/HORA: 03/10/2026 às 23:58",
    "REGISTRO: 0123456789abcdef", "fedcba9876543210"]) {
    assert.ok(boldTextPlacement(content, label).size >= 8, `${label} precisa ser legível`);
  }
  assert.match(signed.getKeywords(), new RegExp(id));
  const geometry = signatureLayoutGeometry("", { pageWidth: 595, pageHeight: 842, scale: 0.5, integrity: true });
  assert.ok(geometry.height * (1 - geometry.captionRatio) >= 45, "não comprimir o traço para acomodar as letras");
});

function pageContent(pdf, pageNumber = 1) {
  const page = pdf.getPages()[pageNumber - 1];
  const streams = page.node.Contents();
  return Array.from({ length: streams.size() }, (_, index) => {
    const stream = page.node.context.lookup(streams.get(index));
    return inflateSync(Buffer.from(stream.getContents())).toString("latin1");
  }).join("\n");
}

function boldTextPlacement(content, label, occurrence = 0) {
  const hex = Buffer.from(label, "latin1").toString("hex").toUpperCase();
  const matches = [...content.matchAll(new RegExp(`/Helvetica-Bold-[^\\n]+ ([\\d.]+) Tf\\n24 TL\\n1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\\n<${hex}> Tj`, "g"))];
  const match = matches[occurrence];
  assert.ok(match, `Texto não encontrado no PDF: ${label}`);
  return { size: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

for (const documentFileName of ['PONTO-RHID.pdf', 'comprovante-pagamento.pdf', 'comprovante-entrega-epi.pdf']) {
  test(`cartão ${documentFileName} mantém traço no topo, identificação à esquerda e selo no rodapé`, async () => {
    const source = await PDFDocument.create(); source.addPage([595, 842]);
    const id = '0123456789abcdef0123456789abcdef';
    const result = await signPdfAttachment({
      documentBlob: new Blob([await source.save()]), documentFileName,
      signatureBlob: new Blob([PNG_1X1], {type: 'image/png'}),
      point: {page: 1, x: .5, y: .3, scale: 1}, signerName: 'JANAINA APARECIDA DA SILVA GONÇALVES',
      signedAt: '2026-10-11T04:01:00Z', integrityId: id,
      verificationUrl: `https://example.com/assinaturas/${id}/${'a'.repeat(64)}`,
    });
    const pdf = await PDFDocument.load(await result.arrayBuffer());
    const content = pageContent(pdf);
    const annotation = pdf.context.lookup(pdf.getPage(0).node.Annots().get(0));
    const rect = annotation.lookup(PDFName.of('Rect')).asArray().map(n => n.asNumber());
    assert.ok(rect[3] <= 842 * .3, 'selo não invade a área do traço');
    for (const label of ['Documento', 'assinado', 'eletronicamente']) {
      const hex = Buffer.from(label, 'latin1').toString('hex').toUpperCase();
      assert.match(content, new RegExp(`<${hex}> Tj`), 'selo completo e legível');
    }
    const name = boldTextPlacement(content, 'JANAINA APARECIDA DA SILVA GONÇALVES');
    const date = boldTextPlacement(content, 'DATA/HORA: 11/10/2026 às 01:01');
    const record = boldTextPlacement(content, 'REGISTRO: 0123456789abcdef');
    assert.ok(name.y > date.y && date.y > record.y);
    assert.equal(name.x, date.x, 'informações alinhadas à esquerda');
    assert.equal(date.x, record.x);
    assert.ok(record.x < rect[0]);
    assert.match(pdf.getKeywords(), new RegExp(id), 'identificador completo preservado');
  });
}

test('cartão auditado EPI cobre a linha antiga do modelo sem pintar o traço de um PDF genérico', async () => {
  const source=await PDFDocument.create();source.addPage([595,842]);
  const documentBlob=new Blob([await source.save()]);
  const options={documentBlob,signatureBlob:new Blob([PNG_1X1]),point:{page:1,x:.5,y:.3,scale:.5},integrityId:'a'.repeat(32)};
  const epi=await PDFDocument.load(await (await signPdfAttachment({...options,documentFileName:'comprovante-entrega-epi.pdf'})).arrayBuffer());
  const fills=content=>[...content.matchAll(/0 0 m\n0 ([\d.]+) l\n([\d.]+) [\d.]+ l\n[\d.]+ 0 l\nh\nf/g)].map(match=>({height:Number(match[1]),width:Number(match[2])}));
  assert.ok(fills(pageContent(epi)).some(rect=>Math.abs(rect.height-89.25)<.001&&Math.abs(rect.width-124.95)<.001));
  const generic=await PDFDocument.load(await (await signPdfAttachment({...options,documentFileName:'documento.pdf'})).arrayBuffer());
  assert.ok(fills(pageContent(generic)).every(rect=>rect.height<113.04));
});

test('PDF preserva ícones maiores e cores distintas no cartão de assinatura', async () => {
  const source=await PDFDocument.create(); source.addPage([595,842]);
  const id='0123456789abcdef0123456789abcdef';
  const signed=await PDFDocument.load(await (await signPdfAttachment({
    documentBlob:new Blob([await source.save()]),signatureBlob:new Blob([PNG_1X1]),
    point:{page:1,x:.5,y:.3,scale:1},signerName:'ASSINANTE',signedAt:'2026-10-11T04:01:00Z',
    integrityId:id,verificationUrl:`https://example.com/assinaturas/${id}/${'a'.repeat(64)}`,
  })).arrayBuffer());
  const content=pageContent(signed);
  const icons=[...content.matchAll(/q\n([\s\S]*?)\nQ/g)].filter(match=>match[1].includes('1.8 w')).map(match=>({
    color:/([\d.]+) ([\d.]+) ([\d.]+) RG/.exec(match[1]).slice(1).map(Number),
    size:Number(/([\d.]+) 0 0 -[\d.]+ 0 0 cm/.exec(match[1])[1])*24,
  }));
  assert.equal(icons.length,3);
  const name=boldTextPlacement(content,'ASSINANTE');
  for(const icon of icons) assert.ok(icon.size>=name.size*1.6,'ícone não pode ficar menor que a identificação');
  const [person,calendar,document]=icons.map(icon=>icon.color);
  assert.ok(person[2]>person[1]&&person[1]>person[0],'pessoa em azul');
  assert.ok(calendar[0]>calendar[1]&&calendar[1]>calendar[2],'calendário em cor quente');
  assert.ok(document[2]>document[0]&&document[0]>document[1],'registro em roxo');
});

test('PDF sem link público também amplia os ícones sem omitir o registro completo', async () => {
  const source=await PDFDocument.create(); source.addPage([595,842]);
  const id='0123456789abcdeffedcba9876543210';
  const signed=await PDFDocument.load(await (await signPdfAttachment({
    documentBlob:new Blob([await source.save()]),signatureBlob:new Blob([PNG_1X1]),
    point:{page:1,x:.5,y:.3,scale:.5},signerName:'ASSINANTE',signedAt:'2026-10-11T04:01:00Z',integrityId:id,
  })).arrayBuffer());
  const content=pageContent(signed),name=boldTextPlacement(content,'ASSINANTE');
  const icons=[...content.matchAll(/q\n([\s\S]*?)\nQ/g)].filter(match=>match[1].includes('1.8 w'));
  assert.equal(icons.length,3);
  for(const icon of icons) {
    const size=Number(/([\d.]+) 0 0 -[\d.]+ 0 0 cm/.exec(icon[1])[1])*24;
    assert.ok(size>=name.size*1.4,'registro completo mantém ícones maiores que o texto');
  }
  assert.ok(boldTextPlacement(content,'REGISTRO: 0123456789abcdef'));
  assert.ok(boldTextPlacement(content,'fedcba9876543210'));
});

test("protocolo de integridade fica dentro do quadro EPI e na identificação do PDF", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const id = "0123456789abcdef0123456789abcdef";
  const result = await signPdfAttachment({
    documentBlob: new Blob([await source.save()], { type: "application/pdf" }),
    documentFileName: "comprovante-entrega-epi.pdf",
    signatureBlob: new Blob([PNG_1X1], { type: "image/png" }),
    point: { page: 1, x: 0.5, y: 0.3, scale: 0.5 },
    signerName: "RAFAEL GONTIJO", signedAt: "2026-10-03T23:00:00Z", integrityId: id,
  });
  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  const protocol = boldTextPlacement(content, `REGISTRO: ${id.slice(0,16)}`);
  const geometry = signatureLayoutGeometry("epi", { pageWidth: 595, pageHeight: 842, scale: 0.5, integrity: true });
  const bottom = 842 * 0.3 - geometry.height / 2;
  assert.ok(protocol.y > bottom && protocol.y < bottom + geometry.height * geometry.captionRatio);
  assert.ok(protocol.x >= 595 * 0.5 - geometry.width / 2);
  assert.match(signed.getKeywords(), new RegExp(id));
});

test("reserva a maior parte do cartão de comprovante para o traço", () => {
  const epi = signatureLayoutGeometry("epi", { pageWidth: 595, pageHeight: 842, scale: 1 });
  const payment = signatureLayoutGeometry("payment", { pageWidth: 595, pageHeight: 842, scale: 1 });

  assert.equal(epi.widthRatio, 0.42);
  assert.equal(epi.aspectRatio, 2.1);
  assert.equal(epi.captionRatio, 0.32);
  assert.ok(epi.height * (1 - epi.captionRatio) > 80);
  assert.equal(payment.widthRatio, 0.54);
  assert.equal(payment.captionRatio, 0.28);
});

test("gera um PDF assinado válido na página e posição escolhidas", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 2, x: 0.75, y: 0.2, scale: 0.8 },
    signerName: "Bernardo Notini",
    signedAt: "2026-09-18T20:20:00-03:00",
  });

  assert.equal(result.type, "application/pdf");
  assert.ok(result.size > documentBlob.size);
  const signed = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(signed.getPageCount(), 2);
  const content = pageContent(signed, 2);
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
});

test("mantém a largura proporcional em páginas grandes", async () => {
  const source = await PDFDocument.create();
  source.addPage([1000, 1400]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.5, scale: 1 },
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  assert.match(content, /0 0 m\n0 26 l\n640 26 l\n640 0 l/);
});

test("comprovante EPI usa cartão centralizado com assinatura, nome e data", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-entrega-epi.pdf",
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.3, scale: 1 },
    signerName: "RAFAEL GONTIJO",
    signedAt: "2026-09-20T00:32:00-03:00",
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  const signerHex = Buffer.from("RAFAEL GONTIJO", "latin1").toString("hex").toUpperCase();
  const dateHex = Buffer.from("DATA/HORA: 20/09/2026 às 00:32", "latin1").toString("hex").toUpperCase();

  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
  assert.match(content, new RegExp(`<${signerHex}> Tj`));
  assert.match(content, new RegExp(`<${dateHex}> Tj`));
  assert.match(content, /\/Helvetica-Bold-/);
  assert.match(content, /0\.05 0\.18 0\.36 rg/);
  assert.match(content, /0\.08 0\.18 0\.34 RG/);
  assert.match(content, /0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nB/);
  assert.match(content, /175\.5488 231\.18 m\n175\.5488 231\.18 m\n419\.4512 231\.18 l\nS/);
});

test("comprovante de pagamento coloca a linha dentro do retângulo da assinatura", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-pagamento-2026-09-20.pdf",
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.25, scale: 1 },
    signerName: "COPIADORA ALTERNATIVA",
    signedAt: "2026-09-20T12:17:00-03:00",
  });

  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  const labelHex = Buffer.from("ASSINADO DIGITALMENTE POR:", "latin1").toString("hex").toUpperCase();
  const signerHex = Buffer.from("COPIADORA ALTERNATIVA", "latin1").toString("hex").toUpperCase();

  assert.doesNotMatch(content, new RegExp(`<${labelHex}> Tj`));
  assert.match(content, new RegExp(`<${signerHex}> Tj`));
  assert.match(content, /0\.08 0\.18 0\.34 RG/);
  assert.match(content, /0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nB/);
  assert.match(content, /140\.7056 176\.84 m\n140\.7056 176\.84 m\n454\.2944 176\.84 l\nS/);
});

test("inclui o carimbo de Bernardo quando solicitado", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });
  const stampBlob = new Blob([PNG_1X1], { type: "image/png" });

  const withoutStamp = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
  });
  const withStamp = await signPdfAttachment({
    documentBlob,
    signatureBlob,
    point: { page: 1, x: 0.5, y: 0.2, scale: 0.8 },
    stampBlob,
    stampPoint: { page: 1, x: 0.5, y: 0.65, scale: 0.8 },
  });

  assert.ok(withStamp.size > withoutStamp.size);
  assert.equal((await PDFDocument.load(await withStamp.arrayBuffer())).getPageCount(), 1);
});

test("PDF final emoldura a assinatura de Bernardo e identifica nome, função e data/hora", async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });
  const stampBlob = new Blob([PNG_1X1], { type: "image/png" });
  const result = await signPdfAttachment({
    documentBlob,
    documentFileName: "comprovante-entrega-epi.pdf",
    signatureBlob,
    point: { page: 1, x: 0.7, y: 0.3, scale: 0.5 },
    stampBlob,
    stampPoint: { page: 1, x: 0.3, y: 0.3, scale: 0.5 },
    signerName: "RAFAEL GONTIJO",
    signedAt: "2026-09-24T13:16:00-03:00",
  });
  const signed = await PDFDocument.load(await result.arrayBuffer());
  const content = pageContent(signed);
  for (const label of ["BERNARDO NOTINI", "RESPONSÁVEL TÉCNICO", "DATA: 24/09/2026 às 13:16"]) {
    const hex = Buffer.from(label, "latin1").toString("hex").toUpperCase();
    assert.match(content, new RegExp(`<${hex}> Tj`));
  }
  const bernardo = boldTextPlacement(content, "BERNARDO NOTINI");
  const signer = boldTextPlacement(content, "RAFAEL GONTIJO");
  const date = boldTextPlacement(content, "DATA: 24/09/2026 às 13:16");
  assert.equal(signer.size, bernardo.size);
  assert.ok(date.y > 230, "A data de Bernardo deve ficar afastada da borda inferior do cartão");
  const signerDate = boldTextPlacement(content, "DATA/HORA: 24/09/2026 às 13:16");
  assert.ok(signerDate.y > 227.4, "A data do usuário também deve ter margem inferior");
  assert.ok((content.match(/0 0 m\n0 [\d.]+ l\n[\d.]+ [\d.]+ l\n[\d.]+ 0 l\nh\nS/g) || []).length >= 2);
  assert.ok((content.match(/0\.08 0\.18 0\.34 RG/g) || []).length >= 2);
});

test("rejeita uma página inexistente sem alterar o arquivo original", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  const documentBlob = new Blob([await source.save()], { type: "application/pdf" });
  const signatureBlob = new Blob([PNG_1X1], { type: "image/png" });

  await assert.rejects(
    signPdfAttachment({ documentBlob, signatureBlob, point: { page: 3, x: 0.5, y: 0.5, scale: 1 } }),
    /página escolhida/i,
  );
});
