import test from "node:test";
import assert from "node:assert/strict";

import { PDFArray, PDFDocument, decodePDFRawStream } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildRhidAttendanceTable } from "../src/chat/rhid-attendance-table.js";

async function buildPdf(table, options) {
  const module = await import("../src/chat/rhid-attendance-pdf.js").catch(error => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.buildRhidAttendancePdf, "function", "o módulo deve exportar o gerador de PDF");
  return module.buildRhidAttendancePdf(table, options);
}

async function inspect(blob) {
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "application/pdf");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), "%PDF-1.7");
  const pdf = await PDFDocument.load(bytes);
  const loadingTask = getDocument({ data: bytes.slice(), useSystemFonts: true });
  const viewer = await loadingTask.promise;
  const pages = [];
  for (let index = 1; index <= viewer.numPages; index += 1) {
    const page = await viewer.getPage(index);
    const content = await page.getTextContent();
    pages.push({ page, items: content.items.filter(item => item.str.trim()) });
  }
  return { pdf, loadingTask, pages };
}

test("gera PDF vertical com metadados literais e todos os horários da tabela RHID", async () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "JOÃO DA SILVA", BATIDAS_RHID: "07:02; 12:11; 13:09; 17:42; 18:01; 19:05" },
  ]);
  const updateLabel = "Sincronização RHID em 27/09, referência 18:42";
  const { pdf, loadingTask, pages } = await inspect(await buildPdf(table, { dateLabel: "27/09/2026", updateLabel }));
  try {
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getPage(0).getWidth(), 360);
    assert.ok(pdf.getPage(0).getHeight() > 360);
    const items = pages[0].items;
    const text = items.map(item => item.str).join(" ");
    assert.ok(text.includes("27/09/2026"));
    assert.ok(items.some(item => item.str === updateLabel), "updateLabel deve aparecer literalmente, sem prefixo ou horário inventado");
    for (const value of ["JOÃO DA SILVA", "07:02", "12:11", "13:09", "17:42", "18:01", "19:05", "10:46"]) {
      assert.ok(text.includes(value), `PDF sem ${value}`);
    }
    for (const item of items) {
      assert.ok(item.transform[4] >= 12, `${item.str} sai pela margem esquerda`);
      assert.ok(item.transform[4] + item.width <= 348.5, `${item.str} sai pela margem direita`);
    }
  } finally {
    await loadingTask.destroy();
  }
});

test("quebra nomes extensos e pagina colaboradores sem cortar horários", async () => {
  const longName = "ALEXANDRA MARIA APARECIDA DE OLIVEIRA FERREIRA SILVA DOS SANTOS";
  const table = {
    kind: "rhid_attendance",
    headers: ["Nome", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2", "Total de horas/dia"],
    rows: [
      [longName, "06:59", "12:01", "13:02", "18:03", "10:03"],
      ...Array.from({ length: 36 }, (_, index) => [
        `COLABORADOR ${String(index + 1).padStart(2, "0")}`, "07:00", "12:00", "13:00", "17:00", "09:00",
      ]),
    ],
  };
  const { pdf, loadingTask, pages } = await inspect(await buildPdf(table));
  try {
    assert.ok(pdf.getPageCount() > 1);
    assert.equal(pdf.getPageCount(), pages.length);
    const allItems = pages.flatMap(({ items }) => items);
    const text = allItems.map(item => item.str).join(" ");
    assert.ok(text.includes("ALEXANDRA"));
    assert.ok(text.includes("DOS SANTOS"));
    assert.ok(text.includes("COLABORADOR 36"));
    for (const value of ["06:59", "12:01", "13:02", "18:03", "10:03"]) assert.ok(text.includes(value));
    const first = allItems.find(item => item.str.includes("ALEXANDRA"));
    const last = allItems.find(item => item.str.includes("DOS SANTOS"));
    assert.notEqual(first.transform[5], last.transform[5], "nome longo deve ocupar mais de uma linha");
    for (const { page, items } of pages) {
      const [width, height] = page.view.slice(2);
      for (const item of items) {
        assert.ok(item.transform[4] >= 12 && item.transform[4] + item.width <= width - 11.5, `${item.str} cortado horizontalmente`);
        assert.ok(item.transform[5] >= 12 && item.transform[5] <= height - 12, `${item.str} cortado verticalmente`);
      }
    }
  } finally {
    await loadingTask.destroy();
  }
});

test("gera PDF válido com aviso quando não há presenças", async () => {
  const table = buildRhidAttendanceTable([]);
  const { pdf, loadingTask, pages } = await inspect(await buildPdf(table, { dateLabel: "27/09/2026", updateLabel: "RHID sem registros" }));
  try {
    assert.equal(pdf.getPageCount(), 1);
    const text = pages[0].items.map(item => item.str).join(" ");
    assert.ok(text.includes("Nenhuma presença encontrada"));
    assert.ok(text.includes("RHID sem registros"));
  } finally {
    await loadingTask.destroy();
  }
});

test("mantém travessão e total parcial da tabela RHID", async () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00; 13:00" },
  ]);
  const { loadingTask, pages } = await inspect(await buildPdf(table));
  try {
    const text = pages[0].items.map(item => item.str).join(" ");
    assert.ok(text.includes("—"));
    assert.ok(text.includes("05:00 (parcial)"));
  } finally {
    await loadingTask.destroy();
  }
});

test("preserva o updateLabel recebido, inclusive espaços internos", async () => {
  const updateLabel = "RHID:  sincronizado  em  27/09/2026";
  const { pdf, loadingTask } = await inspect(await buildPdf(buildRhidAttendanceTable([]), { updateLabel }));
  try {
    const contents = pdf.getPage(0).node.Contents();
    const streams = pdf.context.lookup(contents);
    const refs = streams instanceof PDFArray ? streams.asArray() : [contents];
    const operators = refs.map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref)).decode())).join("\n");
    assert.ok(operators.includes(`<${Buffer.from(updateLabel, "latin1").toString("hex").toUpperCase()}> Tj`));
  } finally {
    await loadingTask.destroy();
  }
});

test("exibe por inteiro os dois rótulos reais do SharePoint no topo de 360 pt", async () => {
  for (const updateLabel of [
    "ÚLTIMA COLETA DO RHID ÀS 17:12",
    "DADOS ATUALIZADOS NO RELÓGIO DE PONTO ÀS 17:10",
  ]) {
    const { loadingTask, pages } = await inspect(await buildPdf(buildRhidAttendanceTable([]), { updateLabel }));
    try {
      const label = pages[0].items.find(item => item.str === updateLabel);
      assert.ok(label, `rótulo ausente ou alterado: ${updateLabel}`);
      assert.ok(label.transform[4] >= 16);
      assert.ok(label.transform[4] + label.width <= 344, `rótulo cortado: ${updateLabel}`);
      assert.ok(label.transform[5] > 540, `rótulo não está no topo: ${updateLabel}`);
    } finally {
      await loadingTask.destroy();
    }
  }
});

test("destaca entradas em verde, saídas em vermelho e total em negrito", async () => {
  const table = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00; 13:00; 17:00" },
  ]);
  const { loadingTask, pages } = await inspect(await buildPdf(table));
  try {
    const { page, items } = pages[0];
    const boldFont = items.find(item => item.str.includes("Presenças RHID")).fontName;
    for (const value of ["07:00", "12:00", "13:00", "17:00", "09:00"]) {
      assert.equal(items.find(item => item.str === value)?.fontName, boldFont, `${value} precisa estar em negrito`);
    }
    const operators = await page.getOperatorList();
    const colors = new Map();
    let fill = "";
    for (let index = 0; index < operators.fnArray.length; index += 1) {
      if (operators.fnArray[index] === OPS.setFillRGBColor) fill = operators.argsArray[index][0];
      if (operators.fnArray[index] !== OPS.showText) continue;
      const value = operators.argsArray[index][0].map(glyph => glyph?.unicode ?? "").join("");
      colors.set(value, fill);
    }
    for (const value of ["07:00", "13:00"]) {
      const [red, green, blue] = colors.get(value).match(/[\da-f]{2}/gi).map(hex => parseInt(hex, 16));
      assert.ok(green > red && green > blue, `${value} precisa estar em verde`);
    }
    for (const value of ["12:00", "17:00"]) {
      const [red, green, blue] = colors.get(value).match(/[\da-f]{2}/gi).map(hex => parseInt(hex, 16));
      assert.ok(red > green && red > blue, `${value} precisa estar em vermelho`);
    }
  } finally {
    await loadingTask.destroy();
  }
});

test("pinta de vermelho claro a linha divergente no PDF e mantém neutra a linha no mínimo", async () => {
  async function includesLightRedFill(table) {
    const { loadingTask, pages } = await inspect(await buildPdf(table));
    try {
      const operators = await pages[0].page.getOperatorList();
      return operators.argsArray.some((args, index) => {
        if (operators.fnArray[index] !== OPS.setFillRGBColor) return false;
        const components = String(args[0]).match(/[\da-f]{2}/gi)?.map(value => parseInt(value, 16)) || [];
        return components.length === 3 && components[0] >= 245 && components[1] >= 220 && components[2] >= 220
          && components[0] > components[1];
      });
    } finally {
      await loadingTask.destroy();
    }
  }

  const discrepant = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "1", NOME_COLABORADOR: "ANA SOUZA", BATIDAS_RHID: "07:00; 12:00; 13:00; 15:42" },
  ]);
  discrepant.reportDate = "2026-09-25";
  const complete = buildRhidAttendanceTable([
    { ID_PESSOA_RHID: "2", NOME_COLABORADOR: "BIA SOUZA", BATIDAS_RHID: "07:00; 12:00; 13:00; 15:45" },
  ]);
  complete.reportDate = "2026-09-25";

  assert.equal(await includesLightRedFill(discrepant), true);
  assert.equal(await includesLightRedFill(complete), false);
});

test("pagina também uma pessoa com muitos pares de horários", async () => {
  const pairs = 40;
  const headers = ["Nome"];
  const row = ["PESSOA COM MUITAS BATIDAS"];
  for (let index = 1; index <= pairs; index += 1) {
    headers.push(`Entrada ${index}`, `Saída ${index}`);
    row.push("07:00", "17:00");
  }
  headers.push("Total de horas/dia");
  row.push("400:00");
  const { pdf, loadingTask, pages } = await inspect(await buildPdf({ kind: "rhid_attendance", headers, rows: [row] }));
  try {
    assert.ok(pdf.getPageCount() > 1);
    const text = pages.flatMap(({ items }) => items.map(item => item.str)).join(" ");
    assert.ok(text.includes("Entrada 40"));
    assert.ok(text.includes("Saída 40"));
    assert.ok(text.includes("400:00"));
    for (const { page, items } of pages) {
      for (const item of items) assert.ok(item.transform[5] >= 12 && item.transform[5] <= page.view[3] - 12);
    }
  } finally {
    await loadingTask.destroy();
  }
});
