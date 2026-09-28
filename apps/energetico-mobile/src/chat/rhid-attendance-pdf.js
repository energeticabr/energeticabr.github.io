import { isRhidAttendanceRowDiscrepant, isRhidAttendanceRowWithoutPunches } from "./rhid-attendance-table.js";

const PAGE_WIDTH = 360;
const PAGE_HEIGHT = 640;
const MARGIN = 16;
const INNER_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(value, font, size, width) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      const next = line + character;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapLiteralText(value, font, size, width) {
  const lines = [];
  let line = "";
  for (const character of String(value)) {
    if (character === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    if (line && font.widthOfTextAtSize(line + character, size) > width) {
      lines.push(line);
      line = character;
    } else {
      line += character;
    }
  }
  lines.push(line);
  return lines;
}

export async function buildRhidAttendancePdf(table, { dateLabel, updateLabel } = {}) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    throw new TypeError("Tabela RHID inválida");
  }

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.17, 0.23);
  const muted = rgb(0.39, 0.44, 0.5);
  const green = rgb(0.06, 0.43, 0.24);
  const red = rgb(0.72, 0.13, 0.17);
  const highlight = rgb(0.91, 0.95, 0.99);
  const discrepancyFill = rgb(253 / 255, 232 / 255, 230 / 255);
  const noPunchFill = rgb(1, 235 / 255, 204 / 255);
  const rule = rgb(0.83, 0.87, 0.91);
  let page;
  let y;

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - 25;
    page.drawText("Presenças RHID", { x: MARGIN, y, font: bold, size: 15, color: ink });
    y -= 22;
    for (const [label, size] of [[dateLabel, 9], [updateLabel, 8]]) {
      if (label == null || label === "") continue;
      for (const line of wrapLiteralText(label, regular, size, INNER_WIDTH)) {
        page.drawText(line, { x: MARGIN, y, font: regular, size, color: muted });
        y -= size + 4;
      }
    }
    page.drawLine({ start: { x: MARGIN, y: y - 2 }, end: { x: PAGE_WIDTH - MARGIN, y: y - 2 }, thickness: 0.7, color: rule });
    y -= 22;
  }

  function ensureSpace(height) {
    if (y - height < MARGIN) addPage();
  }

  function drawContinuation(name, rowFill = null) {
    for (const line of wrapText(`${name} (continuação)`, bold, 9, INNER_WIDTH - 12)) {
      ensureSpace(15);
      if (rowFill) page.drawRectangle({ x: MARGIN + 4, y: y - 3, width: INNER_WIDTH - 8, height: 16, color: rowFill });
      page.drawText(line, { x: MARGIN + 8, y, font: bold, size: 9, color: ink });
      y -= 13;
    }
    y -= 5;
  }

  addPage();
  if (table.rows.length === 0) {
    page.drawText("Nenhuma presença encontrada", { x: MARGIN + 8, y: y - 28, font: bold, size: 12, color: ink });
  } else {
    const pairCount = Math.max(0, Math.floor((table.headers.length - 2) / 2));
    for (const row of table.rows) {
      const name = String(row[0] ?? "");
      const discrepant = isRhidAttendanceRowDiscrepant(row, table.reportDate);
      const rowFill = isRhidAttendanceRowWithoutPunches(row) ? noPunchFill : discrepant ? discrepancyFill : null;
      const nameLines = wrapText(name, bold, 10, INNER_WIDTH - 16);
      ensureSpace(nameLines.length * 13 + 25);
      for (const line of nameLines) {
        ensureSpace(15);
        if (rowFill) page.drawRectangle({ x: MARGIN + 4, y: y - 3, width: INNER_WIDTH - 8, height: 16, color: rowFill });
        page.drawText(line, { x: MARGIN + 8, y, font: bold, size: 10, color: ink });
        y -= 13;
      }
      y -= 5;

      for (let index = 0; index < pairCount; index += 1) {
        if (y - 19 < MARGIN) {
          addPage();
          drawContinuation(name, rowFill);
        }
        if (rowFill) page.drawRectangle({ x: MARGIN + 4, y: y - 5, width: INNER_WIDTH - 8, height: 21, color: rowFill });
        const entryLabel = String(table.headers[1 + index * 2] ?? `Entrada ${index + 1}`);
        const exitLabel = String(table.headers[2 + index * 2] ?? `Saída ${index + 1}`);
        const entry = String(row[1 + index * 2] ?? "—");
        const exit = String(row[2 + index * 2] ?? "—");
        page.drawText(entryLabel, { x: MARGIN + 8, y, font: regular, size: 8, color: muted });
        page.drawText(entry, { x: 95, y: y - 1, font: bold, size: 10, color: green });
        page.drawText(exitLabel, { x: 181, y, font: regular, size: 8, color: muted });
        page.drawText(exit, { x: 246, y: y - 1, font: bold, size: 10, color: red });
        y -= 19;
      }

      if (y - 36 < MARGIN) {
        addPage();
        drawContinuation(name, rowFill);
      }
      page.drawRectangle({ x: MARGIN + 4, y: y - 25, width: INNER_WIDTH - 8, height: 27, color: rowFill || highlight });
      page.drawText("Total de horas/dia", { x: MARGIN + 11, y: y - 15, font: bold, size: 9, color: ink });
      page.drawText(String(row[row.length - 1] ?? "—"), { x: 226, y: y - 16, font: bold, size: 10, color: ink });
      y -= 37;
      if (y - 9 >= MARGIN) {
        page.drawLine({ start: { x: MARGIN + 4, y }, end: { x: PAGE_WIDTH - MARGIN - 4, y }, thickness: 0.5, color: rule });
        y -= 12;
      }
    }
  }

  return new Blob([await pdf.save()], { type: "application/pdf" });
}
