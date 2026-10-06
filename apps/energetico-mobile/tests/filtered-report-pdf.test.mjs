import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

async function build(snapshot, options) {
  const module = await import("../src/chat/filtered-report-pdf.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.buildFilteredReportPdf, "function", "missing buildFilteredReportPdf export");
  return module.buildFilteredReportPdf(snapshot, options);
}

const runs = text => [{ text, bold: false, color: [0, 0, 0] }];
const cell = (text, column = 0, extra = {}) => ({ column, colSpan: 1, runs: runs(text), background: null, align: "left", ...extra });
const snapshot = blocks => ({ title: "Relatório filtrado", filters: [], pages: [{ blocks }] });

async function inspect(t, blob) {
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
  t.after(() => task.destroy());
  const viewer = await task.promise;
  const pages = [];
  for (let index = 1; index <= viewer.numPages; index++) {
    const page = await viewer.getPage(index);
    const { items } = await page.getTextContent();
    pages.push({ page, items: items.filter(item => item.str.trim()) });
  }
  assert.equal(pdf.getPageCount(), pages.length);
  return { pdf, pages, text: pages.flatMap(p => p.items.map(i => i.str)).join(" ") };
}

function assertInsidePages(pages) {
  for (const { page, items } of pages) {
    const [, , width, height] = page.view;
    for (const item of items) {
      assert.ok(item.transform[4] >= 20 && item.transform[4] + item.width <= width - 19, `${item.str} overflows horizontally`);
      assert.ok(item.transform[5] >= 20 && item.transform[5] + item.height <= height - 19, `${item.str} overflows vertically`);
    }
  }
}

async function paintEvents(page) {
  const operators = await page.getOperatorList();
  const stack = [];
  const events = [];
  let fill;
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let index = 0; index < operators.fnArray.length; index++) {
    const op = operators.fnArray[index];
    const args = operators.argsArray[index];
    if (op === OPS.save) stack.push({ fill, matrix });
    else if (op === OPS.restore) ({ fill, matrix } = stack.pop());
    else if (op === OPS.transform) {
      const [a, b, c, d, e, f] = matrix;
      const [g, h, i, j, k, l] = args;
      matrix = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
    }
    else if (op === OPS.setFillRGBColor) fill = args[0];
    else if (op === OPS.showText) events.push({ type: "text", fill, text: args[0].map(glyph => glyph?.unicode ?? "").join("") });
    // PDF.js packs path + paint into constructPath in this version.
    else if (op === OPS.constructPath && [OPS.fill, OPS.fillStroke].includes(args[0])) {
      const [x0, y0, x1, y1] = args[2];
      const [a, b, c, d, e, f] = matrix;
      const points = [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
      events.push({ type: "fill", fill, bounds: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] });
    }
  }
  return events;
}

// Missing background paint leaves otherwise preserved white titles invisible.
test("paints solid text-block backgrounds behind every white line across pages", async t => {
  const input = snapshot([
    { type: "text", heading: true, background: [0, 0, 0.5], runs: [{ text: "ASSOCIAÇÃO DE TAREFAS", bold: true, color: [1, 1, 1] }] },
    { type: "text", heading: false, background: [0, 0, 0.5], runs: [{ text: "COTAÇÃO BRANCA\n".repeat(90) + "FIM_BRANCO", bold: false, color: [1, 1, 1] }] },
  ]);
  const before = structuredClone(input);
  const { pages, text } = await inspect(t, await build(input));
  assert.ok(pages.length >= 2);
  assert.equal(text.match(/COTAÇÃO BRANCA/g)?.length, 90);
  assert.match(text, /FIM_BRANCO/);
  assert.deepEqual(input, before);
  for (const { page, items } of pages) {
    const events = await paintEvents(page);
    const whiteLines = events.filter(event => event.type === "text" && /ASSOCIAÇÃO|COTAÇÃO|FIM_BRANCO/.test(event.text));
    assert.ok(whiteLines.length > 0);
    for (const [index, event] of whiteLines.entries()) {
      assert.equal(event.fill, "#ffffff", "white foreground must survive on navy");
      const item = items.filter(item => /ASSOCIAÇÃO|COTAÇÃO|FIM_BRANCO/.test(item.str))[index];
      const [x, y] = item.transform.slice(4);
      assert.ok(events.slice(0, events.indexOf(event)).some(paint => {
        if (paint.type !== "fill" || paint.fill !== "#000080") return false;
        const [left, bottom, right, top] = paint.bounds;
        return left <= x + 0.1 && right >= x + item.width - 0.1 && bottom <= y && top >= y + item.height - 0.1;
      }), "painted navy must cover each white line before it is drawn, including continuations");
    }
  }
  assertInsidePages(pages);
});

// The inline badge background is absent from the snapshot; white/pale runs
// must become visible against the effective block/cell fill, preserving ink.
test("corrects white and pale inline text against white while retaining legible red and green", async t => {
  const styled = [
    { text: "NORMAL ", bold: false, color: [0, 0, 0] },
    { text: "ID_BRANCO ", bold: true, color: [1, 1, 1] },
    { text: "ID_CLARO ", bold: false, color: [0.9, 0.9, 0.9] },
    { text: "VERMELHO ", bold: false, color: [1, 0, 0] },
    { text: "VERDE", bold: false, color: [0, 0.5, 0] },
  ];
  const { pages } = await inspect(t, await build(snapshot([
    { type: "text", heading: false, background: null, runs: styled },
    { type: "text", heading: false, background: [1, 1, 1], runs: styled },
    { type: "table", widths: [1], rows: [
      { header: false, cells: [cell("", 0, { runs: styled })] },
      { header: false, cells: [cell("", 0, { runs: styled, background: [1, 1, 1] })] },
      { header: false, cells: [cell("ID_ESCURO", 0, { runs: [{ text: "ID_ESCURO", bold: true, color: [1, 1, 1] }], background: [0, 0, 0.5] })] },
    ] },
  ])));
  const events = (await paintEvents(pages[0].page)).filter(event => event.type === "text");
  for (const marker of ["ID_BRANCO", "ID_CLARO"]) {
    const matches = events.filter(event => event.text.includes(marker));
    assert.equal(matches.length, 4);
    for (const event of matches) assert.equal(event.fill, "#000000", `${marker} must use darkest fallback on white`);
  }
  for (const [marker, expected] of [["VERMELHO", "#ff0000"], ["VERDE", "#008000"], ["ID_ESCURO", "#ffffff"]]) {
    const matches = events.filter(event => event.text.includes(marker));
    assert.equal(matches.length, marker === "ID_ESCURO" ? 1 : 4);
    for (const event of matches) assert.equal(event.fill, expected);
  }
  const items = pages[0].items;
  assert.equal(items.find(item => item.str.trim() === "ID_BRANCO").fontName, items.find(item => item.str === "ID_ESCURO").fontName);
  assertInsidePages(pages);
});

// Dropping/duplicating rows or formatting already-localized values breaks this.
test("exports exactly the supplied filtered rows with Portuguese, dates and BRL", async t => {
  const input = snapshot([{ type: "table", widths: [70, 30], rows: [
    { header: true, cells: [cell("Colaborador"), cell("Valor", 1)] },
    ...Array.from({ length: 65 }, (_, index) => ({ header: false, cells: [cell(`FILTRADO_${String(index + 1).padStart(3, "0")}`), cell("R$ 1.234,56", 1)] })),
  ] }]);
  input.title = "Medição e manutenção";
  input.filters = [{ label: "Período", value: "01/09/2026 a 30/09/2026" }, { label: "Pessoa", value: "João, ação, ç, ã, À, € 😀 漢" }];
  const before = structuredClone(input);
  const { pdf, pages, text } = await inspect(t, await build(input));
  assert.equal(pdf.getTitle(), "Medição e manutenção");
  assert.deepEqual(input, before, "renderer must not mutate its snapshot");
  assert.equal(text.match(/FILTRADO_\d{3}/g)?.length, 65);
  for (let index = 1; index <= 65; index++) assert.equal(text.match(new RegExp(`FILTRADO_${String(index).padStart(3, "0")}\\b`, "g"))?.length, 1);
  assert.doesNotMatch(text, /NÃO_FILTRADO|😀|漢/);
  assert.match(text, /João, ação, ç, ã, À, €/);
  assert.match(text, /Período: 01\/09\/2026 a 30\/09\/2026/);
  assert.equal(text.match(/R\$ 1\.234,56/g)?.length, 65);
  assert.ok(pages.length >= 2);
  for (const [index, { items }] of pages.entries()) {
    assert.ok(items.some(item => item.str === "Energética"));
    assert.ok(items.some(item => item.str === `Página ${index + 1} / ${pages.length}`));
    assert.ok(items.some(item => item.str === "Colaborador"));
    assert.ok(Math.abs(pdf.getPage(index).getWidth() - 841.89) < 1, "A4 landscape width");
    assert.ok(Math.abs(pdf.getPage(index).getHeight() - 595.28) < 1, "A4 landscape height");
  }
  assertInsidePages(pages);
});

// A one-page row clamp or failure to break long tokens loses the end marker.
test("splits an oversized row without losing any token or later rows, repeating headers", async t => {
  const { pages, text } = await inspect(t, await build(snapshot([{ type: "table", widths: [0.3, 0.7], rows: [
    { header: true, cells: [cell("DESCRIÇÃO"), cell("TOTAL", 1)] },
    { header: false, cells: [cell(`INÍCIO ${"Z".repeat(6000)} MARCADOR_FINAL_UNICO`), cell("R$ 9,99", 1)] },
    { header: false, cells: [cell("LINHA_POSTERIOR"), cell("R$ 2,00", 1)] },
  ] }])));
  assert.ok(pages.length >= 2);
  assert.equal(text.replace(/[^Z]/g, "").length, 6000);
  assert.equal(text.match(/MARCADOR_FINAL_UNICO/g)?.length, 1);
  assert.equal(text.match(/LINHA_POSTERIOR/g)?.length, 1);
  for (const { items } of pages) {
    assert.ok(items.some(item => item.str === "DESCRIÇÃO"));
    assert.ok(items.some(item => item.str === "TOTAL"));
    for (const item of items.filter(item => /Z|INÍCIO|MARCADOR|LINHA_POSTERIOR/.test(item.str))) assert.ok(item.height >= 7.5);
  }
  assertInsidePages(pages);
});

// Ignoring spans/widths makes a merged heading wrap like a narrow cell;
// ignoring runs loses bold/red text or the green cell background.
test("honors colspan geometry, proportional widths, alignment and rich text", async t => {
  for (const widths of [[10, 30, 60], [0.1, 0.3, 0.6]]) {
    const { pages } = await inspect(t, await build(snapshot([
      { type: "text", heading: true, runs: runs("Cabeçalho") },
      { type: "text", heading: false, runs: [
        { text: "Destaque", bold: true, color: [1, 0, 0] },
        { text: " normal", bold: false, color: [0, 0, 0] },
      ] },
      { type: "table", widths, rows: [
        { header: true, cells: [cell("AGRUPAMENTO EM DUAS COLUNAS", 0, { colSpan: 2, align: "center" }), cell("TERCEIRA", 2)] },
        { header: false, cells: [cell("ESTREITA ".repeat(18)), cell("CENTRO", 1, { align: "center", background: [0, 1, 0] }), cell("DIREITA", 2, { align: "right" })] },
      ] },
    ])));
    const items = pages[0].items;
    const merged = items.find(item => item.str === "AGRUPAMENTO EM DUAS COLUNAS");
    assert.ok(merged, "colspan heading must fit on one line");
    assert.ok(items.filter(item => item.str.includes("ESTREITA")).length > 2, "narrow column must wrap");
    assert.ok(items.find(item => item.str === "CENTRO").transform[4] > 170);
    assert.ok(items.find(item => item.str === "DIREITA").transform[4] > 730);
    assert.equal(items.find(item => item.str === "Destaque").fontName, items.find(item => item.str === "Cabeçalho").fontName);
    assert.notEqual(items.find(item => item.str === "Destaque").fontName, items.find(item => item.str === "normal").fontName);
    assert.ok(items.find(item => item.str === "Cabeçalho").height > items.find(item => item.str === "normal").height);
    const operators = await pages[0].page.getOperatorList();
    let fill;
    const textColors = new Map();
    const fills = [];
    for (let index = 0; index < operators.fnArray.length; index++) {
      if (operators.fnArray[index] === OPS.setFillRGBColor) { fill = operators.argsArray[index][0]; fills.push(fill); }
      if (operators.fnArray[index] === OPS.showText) textColors.set(operators.argsArray[index][0].map(glyph => glyph?.unicode ?? "").join(""), fill);
    }
    assert.equal(textColors.get("Destaque"), "#ff0000");
    assert.ok(fills.includes("#00ff00"));
    assertInsidePages(pages);
  }
});

// Omitting a source page, clipping a long paragraph or reembedding the logo
// per page breaks searchable content or shared image resources.
test("paginates text and source pages with one supplied PNG image per output page", async t => {
  const input = snapshot([{ type: "text", heading: false, runs: runs("PARÁGRAFO ".repeat(2200) + "FIM_DO_TEXTO") }]);
  input.pages.push({ blocks: [{ type: "text", heading: true, runs: runs("SEGUNDA_ORIGEM") }] });
  const logoBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const { pdf, pages, text } = await inspect(t, await build(input, { logoBytes }));
  assert.ok(pages.length >= 3);
  assert.equal(text.match(/PARÁGRAFO/g)?.length, 2200);
  assert.match(text, /FIM_DO_TEXTO/);
  assert.match(pages.at(-1).items.map(item => item.str).join(" "), /SEGUNDA_ORIGEM/);
  const refs = pdf.getPages().map(page => {
    const images = page.node.Resources().lookup(PDFName.of("XObject"), PDFDict).values();
    assert.equal(images.length, 1);
    return images[0].toString();
  });
  assert.equal(new Set(refs).size, 1, "PNG must be embedded only once and reused");
  for (const { page } of pages) {
    const operators = await page.getOperatorList();
    assert.equal(operators.fnArray.filter(op => op === OPS.paintImageXObject).length, 1);
  }
  assertInsidePages(pages);
});

// An empty snapshot must not silently produce a misleading blank report.
test("rejects invalid or empty snapshots", async () => {
  for (const input of [null, {}, snapshot([]), { title: "Vazio", filters: [], pages: [] }, snapshot([{ type: "text", runs: [], heading: false }])]) {
    await assert.rejects(() => build(input), { name: "TypeError" });
  }
});

// Replaying an oversized header recursively can loop forever. Both the
// original header and a single-cell body must still reach their last markers.
test("terminates with oversized colspan headers and a single-cell overflowing row", { timeout: 10000 }, async t => {
  const { pages, text } = await inspect(t, await build(snapshot([{ type: "table", widths: [1, 1], rows: [
    { header: true, cells: [cell(`${"CABECALHO ".repeat(1200)} FIM_CABECALHO`, 0, { colSpan: 2 })] },
    { header: false, cells: [cell(`${"CORPO ".repeat(3500)} FIM_CORPO`, 0, { colSpan: 2 })] },
    { header: false, cells: [cell("ULTIMA_LINHA", 0, { colSpan: 2 })] },
  ] }])));
  assert.ok(pages.length >= 2);
  assert.match(text, /FIM_CABECALHO/);
  assert.equal(text.match(/CORPO/g)?.length, 3501);
  assert.equal(text.match(/FIM_CORPO/g)?.length, 1);
  assert.equal(text.match(/ULTIMA_LINHA/g)?.length, 1);
  assertInsidePages(pages);
});
