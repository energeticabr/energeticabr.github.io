import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFSignature } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
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

async function build(input) {
  const module = await import("../src/chat/rhid-monthly-pdf.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.buildRhidMonthlyPdf, "function", "deve exportar buildRhidMonthlyPdf");
  return module.buildRhidMonthlyPdf(input);
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
