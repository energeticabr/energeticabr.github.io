import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFSignature, decodePDFRawStream } from "pdf-lib";
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildRhidMonthlyReport } from "../src/chat/rhid-monthly-model.js";

function report(month = "2026-10", name = "MAURÍCIO HONORATO DE SOUZA") {
  return buildRhidMonthlyReport({ month, supplier: { id: "4", name }, snapshot: {
    month, presentDates: [], rows: month === "2026-10" ? [
      { ID_PESSOA_RHID: "101", NOME_COLABORADOR: name, DATA_REFERENCIA: "2026-10-01", BATIDAS_RHID: "07:00;12:00;13:00;17:00" },
      { ID_PESSOA_RHID: "101", NOME_COLABORADOR: name, DATA_REFERENCIA: "2026-10-02", BATIDAS_RHID: "07:00;12:00;13:00", ADMIN_AJUSTES: { exit2: { time: "16:00", reason: "Conferido" } } },
      { ID_PESSOA_RHID: "101", NOME_COLABORADOR: name, DATA_REFERENCIA: "2026-10-03", BATIDAS_RHID: "07:00" },
    ] : [],
  } });
}

function recordedMonth() {
  const name = "ALEXANDRA MARIA APARECIDA DE OLIVEIRA FERREIRA SILVA DOS SANTOS";
  return buildRhidMonthlyReport({ month: "2026-10", supplier: { id: "4", name }, snapshot: {
    month: "2026-10", presentDates: [], rows: Array.from({ length: 31 }, (_, index) => ({
      ID_PESSOA_RHID: "101", NOME_COLABORADOR: name,
      DATA_REFERENCIA: `2026-10-${String(index + 1).padStart(2, "0")}`,
      BATIDAS_RHID: "07:00;12:00;13:00;17:00",
    })),
  } });
}

async function build(input, options) {
  const module = await import("../src/chat/rhid-monthly-pdf.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.buildRhidMonthlyPdf, "function", "deve exportar buildRhidMonthlyPdf");
  return module.buildRhidMonthlyPdf(input, options);
}

async function inspect(t, blob) {
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  t.after(() => task.destroy());
  const viewer = await task.promise;
  const pages = [];
  for (let number = 1; number <= viewer.numPages; number++) {
    const page = await viewer.getPage(number);
    pages.push({ page, items: (await page.getTextContent()).items.filter(item => item.str.trim()) });
  }
  return { pdf, pages, text: pages.flatMap(p => p.items.map(item => item.str)).join(" ") };
}

function assertInside(pages) {
  for (const { page, items } of pages) {
    assert.ok(page.view[2] < page.view[3], "A4 deve ser vertical");
    assert.ok(Math.abs(page.view[2] - 595) < 1 && Math.abs(page.view[3] - 842) < 1);
    for (const item of items) {
      assert.ok(item.transform[4] >= 31 && item.transform[4] + item.width <= page.view[2] - 31, `${item.str} cortado horizontalmente`);
      assert.ok(item.transform[5] >= 31 && item.transform[5] + item.height <= page.view[3] - 31, `${item.str} cortado verticalmente`);
      assert.ok(item.height >= 8, `${item.str} ilegível`);
    }
  }
}

// Compare the actual RGB/alpha image streams with the checked-in official PNG,
// then inspect PDF.js drawing operators to prove the raster is painted at left.
async function assertOfficialHeader({ pdf, pages }) {
  const source = await readFile(new URL("../../../assets/logo-energetica-oficial.png", import.meta.url));
  const { width, height } = await sharp(source).metadata();
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const officialRgb = digest(await sharp(source).removeAlpha().raw().toBuffer());
  const officialAlpha = digest(await sharp(source).extractChannel(3).raw().toBuffer());
  for (const [index, { page, items }] of pages.entries()) {
    const resources = pdf.getPage(index).node.Resources().lookupMaybe(PDFName.of("XObject"), PDFDict);
    const images = resources ? resources.entries().map(([, ref]) => pdf.context.lookup(ref))
      .filter(object => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") : [];
    assert.equal(images.length, 1, `página ${index + 1} deve conter a imagem oficial incorporada`);
    const [image] = images;
    assert.equal(image.dict.lookup(PDFName.of("Width")).asNumber(), width);
    assert.equal(image.dict.lookup(PDFName.of("Height")).asNumber(), height);
    assert.equal(digest(decodePDFRawStream(image).decode()), officialRgb, "pixels RGB devem ser os do logo oficial");
    const alpha = image.dict.lookup(PDFName.of("SMask"), PDFRawStream);
    assert.equal(digest(decodePDFRawStream(alpha).decode()), officialAlpha, "preservar a transparência oficial");

    const operators = await page.getOperatorList();
    const stack = [], placements = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    for (let operator = 0; operator < operators.fnArray.length; operator++) {
      const fn = operators.fnArray[operator], args = operators.argsArray[operator];
      if (fn === OPS.save) stack.push(matrix.slice());
      else if (fn === OPS.restore) matrix = stack.pop();
      else if (fn === OPS.transform) matrix = Util.transform(matrix, args);
      else if (fn === OPS.paintImageXObject) placements.push(matrix.slice());
    }
    assert.equal(placements.length, 1, "logo deve ser desenhado, não apenas armazenado no PDF");
    const [imageWidth, skewY, skewX, imageHeight, x, y] = placements[0];
    assert.equal(skewX, 0);
    assert.equal(skewY, 0);
    assert.equal(x, 32, "logo alinhado à margem esquerda existente");
    assert.ok(imageWidth >= 90 && imageWidth <= 120 && imageHeight >= 30 && imageHeight <= 40, "logo legível na faixa atual do cabeçalho");
    assert.ok(Math.abs(imageWidth / imageHeight - width / height) < 0.001, "sem deformar a proporção oficial");
    assert.ok(y >= 772 && y + imageHeight <= 810.01, "logo não deve invadir nome, tabela ou margem superior");
    const heading = items.find(item => item.str === "RELATÓRIO MENSAL RHID");
    const period = items.find(item => item.str.startsWith("Período:"));
    assert.ok(heading.transform[4] >= x + imageWidth + 12, "título à direita do logo com respiro");
    assert.equal(heading.transform[5], 793);
    assert.equal(heading.height, 17);
    assert.ok(period.transform[4] >= x + imageWidth + 12, "período à direita do logo, sem sobreposição");
    assert.equal(period.transform[5], 773);
  }
}

// Missing/replaced/right-aligned logos and taller headers break the PDF contract.
test("monthly PDF embeds supplied official raster offline at left on every employee page without moving report bounds", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("PDF mensal deve funcionar offline"); });
  const logoBytes = new Uint8Array(await readFile(new URL("../../../assets/logo-energetica-oficial.png", import.meta.url)));
  const first = recordedMonth(), second = { ...report(), supplier: { id: "7", name: "HELISON ROSA LUIS" } };
  const output = await inspect(t, await build([first, second], { logoBytes }));
  assert.equal(output.pages.length, 2, "um mês comum de 31 dias deve ocupar uma página por colaborador");
  await assertOfficialHeader(output);
  assertInside(output.pages);
  for (const [index, selected] of [first, second].entries()) {
    const { items } = output.pages[index], text = items.map(item => item.str).join(" ");
    for (let day = 1; day <= 31; day++) assert.ok(text.includes(`${String(day).padStart(2, "0")}/10/2026`));
    assert.ok(text.includes(selected.supplier.name));
    assert.ok(text.includes(`Total do mês: ${selected.total}`));
    for (const kind of ["employee", "representative"]) {
      const field = output.pdf.getForm().getField(`rhid_${kind}_${selected.supplier.id}`);
      assert.ok(field instanceof PDFSignature);
      assert.equal(field.acroField.dict.has(PDFName.of("V")), false);
      const [widget] = field.acroField.getWidgets();
      assert.equal(widget.P().toString(), output.pdf.getPage(index).ref.toString());
      assert.ok(output.pdf.getPage(index).node.Annots().asArray().some(ref => ref.toString() === field.ref.toString()), "assinatura registrada na página e no AcroForm");
      assert.ok(widget.dict.has(PDFName.of("AP")));
      if (index === 0) assert.deepEqual(widget.getRectangle(), { x: kind === "employee" ? 32 : 309.5, y: 93, width: 253.5, height: 64 });
    }
  }
  const positions = output.pages[0].items;
  for (const [label, x, y] of [["01/10/2026", 34, 697], ["31/10/2026", 34, 277], ["Total do mês: 279:00", 32, 252]]) {
    const item = positions.find(item => item.str === label);
    assert.deepEqual([item.transform[4], item.transform[5]], [x, y], `${label} deve manter os limites existentes`);
  }
});

// Each pagination path must use the branded heading, including signature pages.
test("monthly PDF repeats the official logo on oversized-note and signature-only continuation pages", async t => {
  const logoBytes = new Uint8Array(await readFile(new URL("../../../assets/logo-energetica-oficial.png", import.meta.url)));
  const notes = report();
  notes.days[0].issues = ["W".repeat(8500)];
  const signatures = recordedMonth();
  signatures.days[30].issues = Array.from({ length: 14 }, (_, index) => `Conferência documental ${index + 1}.`);
  for (const input of [notes, signatures]) {
    const output = await inspect(t, await build(input, { logoBytes }));
    assert.ok(output.pages.length > 1);
    await assertOfficialHeader(output);
    assertInside(output.pages);
  }
});

// Invalid explicitly supplied bytes must fail rather than silently lose branding.
test("monthly PDF rejects invalid explicitly supplied logo bytes", async () => {
  await assert.rejects(() => build(report(), { logoBytes: new Uint8Array([0, 1, 2]) }));
});

// Dropping dates, effective slots, flags or totals loses employee report data.
test("monthly PDF preserves the full calendar, effective hours, adjustment and incomplete days", async t => {
  const { pages, text } = await inspect(t, await build(report()));
  for (let day = 1; day <= 31; day++) assert.match(text, new RegExp(`${String(day).padStart(2, "0")}/10/2026`));
  for (const value of ["MAURÍCIO HONORATO DE SOUZA", "07:00", "12:00", "13:00", "17:00", "16:00", "09:00", "08:00", "17:00"]) assert.ok(text.includes(value), `PDF sem ${value}`);
  assert.match(text, /Ajustado/i);
  assert.match(text, /Incompleto/i);
  assert.match(text, /Sem registros/i);
  assert.match(text, /Dias com registros: 3/);
  assert.match(text, /Dias incompletos: 1/);
  assert.match(text, /Total do mês: 17:00/);
  assertInside(pages);
});

// Cutting a tall row, shrinking it or failing to repeat headers breaks reading.
test("monthly PDF continues oversized issues without losing characters or following dates", { timeout: 15000 }, async t => {
  const input = report();
  input.days[0].issues = ["INÍCIO " + "W".repeat(8500) + " FIM_NOTA", "SEGUNDA_NOTA\nULTIMA_LINHA"];
  const { pages, text } = await inspect(t, await build(input));
  assert.ok(pages.length >= 3);
  assert.equal(text.replace(/[^W]/g, "").length, 8500);
  assert.equal(text.match(/FIM_NOTA/g)?.length, 1);
  assert.equal(text.match(/SEGUNDA_NOTA/g)?.length, 1);
  assert.equal(text.match(/ULTIMA_LINHA/g)?.length, 1);
  assert.match(text, /31\/10\/2026/);
  for (const { items } of pages.filter(({ items }) => items.some(item => /\d{2}\/\d{2}\/\d{4}/.test(item.str)))) {
    for (const heading of ["Data", "E", "S", "E2", "S2", "Total", "Observações"]) assert.ok(items.some(item => item.str === heading), `falta cabeçalho ${heading}`);
  }
  assertInside(pages);
});

// A text field cannot sign a PDF; names and blank areas must survive pagination.
test("monthly PDF ties two blank true signature widgets to full employee and representative names", async t => {
  const name = "ALEXANDRA MARIA APARECIDA " + "DE OLIVEIRA FERREIRA DOS SANTOS ".repeat(5);
  const { pdf, pages, text } = await inspect(t, await build(report("2024-02", name)));
  assert.match(text, /29\/02\/2024/);
  assert.doesNotMatch(text, /30\/02\/2024/);
  assert.match(text, /Total do mês: 00:00/);
  const fields = pdf.getForm().getFields();
  assert.equal(fields.length, 2);
  for (const field of fields) {
    assert.ok(field instanceof PDFSignature, "assinatura deve ser /Sig, nunca /Tx");
    assert.equal(field.acroField.dict.has(PDFName.of("V")), false, "assinatura deve estar em branco");
    const [widget] = field.acroField.getWidgets();
    const box = widget.getRectangle();
    assert.ok(box.width >= 200 && box.height >= 64, "espaço amplo para assinatura em duas colunas");
    const index = pdf.getPages().findIndex(page => page.ref.toString() === widget.P().toString());
    assert.ok(index >= 0);
    assert.ok(box.x >= 32 && box.x + box.width <= 563 && box.y >= 32);
    const above = pages[index].items.filter(item => item.transform[4] >= box.x && item.transform[4] + item.width <= box.x + box.width + 0.5
      && item.transform[5] > box.y + box.height && item.transform[5] < box.y + box.height + 110).map(item => item.str).join(" ");
    assert.match(above, field.getName().includes("employee") ? /ALEXANDRA MARIA APARECIDA/ : /Representante da Energética/);
  }
  const employee = fields.find(field => field.getName().includes("employee"));
  assert.equal(employee.acroField.dict.lookup(PDFName.of("TU")).decodeText(), name.trim());
  assertInside(pages);
});

// Splitting acknowledgements makes a third page with only the representative.
test("monthly PDF keeps employee and representative signatures together on the same page", async t => {
  const { pdf } = await inspect(t, await build(report()));
  const widgets = pdf.getForm().getFields().map(field => field.acroField.getWidgets()[0]);
  assert.equal(widgets.length, 2);
  assert.equal(widgets[0].P().toString(), widgets[1].P().toString(), "ambas as assinaturas na mesma página");
  const boxes = widgets.map(widget => widget.getRectangle()).sort((left, right) => left.x - right.x);
  assert.equal(boxes[0].y, boxes[1].y, "áreas lado a lado, alinhadas");
  assert.ok(boxes[0].x + boxes[0].width < boxes[1].x, "colunas separadas");
});

// Ordinary complete months must not waste an entire third signature page.
test("monthly PDF fits 31 recorded days, total and ample signatures on exactly one page", async t => {
  const input = recordedMonth();
  const { pdf, pages, text } = await inspect(t, await build(input));
  assert.equal(pages.length, 1, "mês completo, totais e ambas as assinaturas na mesma página");
  const headers = pages[0].items.filter(item => ["Data", "E", "S", "E2", "S2", "Total", "Observações"].includes(item.str));
  assert.deepEqual(headers.map(item => item.str), ["Data", "E", "S", "E2", "S2", "Total", "Observações"]);
  const firstDay = pages[0].items.find(item => item.str === "01/10/2026");
  const firstRow = pages[0].items.filter(item => Math.abs(item.transform[5] - firstDay.transform[5]) < .1);
  assert.deepEqual(firstRow.slice(1, 5).map(item => item.str), ["07:00", "12:00", "13:00", "17:00"]);
  assert.ok(firstRow.slice(1, 5).every((item,index) => item.transform[4] === headers[index + 1].transform[4]), "quatro horários em colunas próprias, na mesma linha");
  for (let day = 1; day <= 31; day++) assert.match(text, new RegExp(`${String(day).padStart(2, "0")}/10/2026`));
  assert.match(text, /Total do mês: 279:00/);
  assert.match(text, /Dias com registros: 31/);
  assert.match(text, /Dias incompletos: 0/);
  const [employee, representative] = pdf.getForm().getFields();
  const employeeWidget = employee.acroField.getWidgets()[0], companyWidget = representative.acroField.getWidgets()[0];
  assert.equal(employeeWidget.P().toString(), companyWidget.P().toString());
  const box = employeeWidget.getRectangle();
  assert.ok(box.width >= 200 && box.height >= 64);
  const index = pdf.getPages().findIndex(page => page.ref.toString() === employeeWidget.P().toString());
  const nameItems = pages[index].items.filter(item => item.transform[4] >= box.x && item.transform[4] + item.width <= box.x + box.width + 0.5
    && item.transform[5] > box.y + box.height && item.transform[5] < box.y + box.height + 70
    && item.height >= 10 && !item.str.includes("Assinatura"));
  assert.equal(nameItems.map(item => item.str).join(" "), input.supplier.name, "nome completo deve quebrar na própria coluna");
  assert.ok(nameItems.length > 1 && nameItems.every(item => item.height >= 10), "sem reduzir a fonte do nome");
  assertInside(pages);
});

// A signature-only continuation must not advertise an empty attendance table.
test("monthly PDF omits attendance headers when only the signature group needs a continuation", async t => {
  const input = recordedMonth();
  input.days[30].issues = Array.from({ length: 14 }, (_, index) => `Conferência documental ${index + 1}.`);
  const { pdf, pages } = await inspect(t, await build(input));
  const last = pages.at(-1).items;
  assert.ok(!last.some(item => /\d{2}\/\d{2}\/\d{4}/.test(item.str)), "última página deve ser de assinaturas nesta prévia");
  for (const heading of ["Data", "E", "S", "E2", "S2", "Total", "Observações"]) assert.ok(!last.some(item => item.str === heading), `cabeçalho vazio ${heading}`);
  const lastRef = pdf.getPages().at(-1).ref.toString();
  for (const field of pdf.getForm().getFields()) assert.equal(field.acroField.getWidgets()[0].P().toString(), lastRef);
  assertInside(pages);
});

// An invalid model must not become a misleading signed-looking empty report.
test("monthly PDF rejects invalid reports", async () => {
  for (const input of [null, {}, { ...report(), month: "2026-13" }, { ...report(), supplier: { id: "4", name: "" } }, { ...report(), days: [] }]) {
    await assert.rejects(() => build(input), { name: "TypeError" });
  }
});

test('monthly batch has exactly one isolated page and two canonical signature fields per employee',async t=>{
 const first=report(),second={...report('2026-10','HELISON ROSA LUIS'),supplier:{id:'7',name:'HELISON ROSA LUIS'}};
 second.total='08:00';
 const {pdf,pages}=await inspect(t,await build([first,second]));
 assert.equal(pages.length,2);assertInside(pages);
 for(let i=0;i<2;i++){
  const selected=[first,second][i],other=[second,first][i],text=pages[i].items.map(item=>item.str).join(' ');
  assert.ok(text.includes(selected.supplier.name));assert.ok(!text.includes(other.supplier.name));
  assert.ok(text.includes(`Total do mês: ${selected.total}`));assert.ok(text.includes(`Página ${i+1} de 2`));
  for(const kind of ['employee','representative']){
   const field=pdf.getForm().getField(`rhid_${kind}_${selected.supplier.id}`);assert.ok(field instanceof PDFSignature);
   const widget=field.acroField.getWidgets()[0];assert.equal(widget.P().toString(),pdf.getPage(i).ref.toString());
   assert.equal(field.acroField.dict.has(PDFName.of('V')),false);assert.ok(widget.dict.has(PDFName.of('AP')));
  }
 }
 assert.equal(pdf.getForm().getFields().length,4);
});

test('monthly batch rejects empty, duplicate, mixed-period or overflowing reports without silently omitting notes',async()=>{
 const first=report(),second={...report('2026-10','HELISON ROSA LUIS'),supplier:{id:'7',name:'HELISON ROSA LUIS'}};
 for(const value of [[],[first,first],[first,{...second,month:'2026-09'}]])await assert.rejects(()=>build(value),TypeError);
 first.days[0].issues=['W'.repeat(8500)];
 await assert.rejects(()=>build([first,second]),/MAURÍCIO.*página|página.*MAURÍCIO/);
});
