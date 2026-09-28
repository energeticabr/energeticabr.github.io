import {
  isRhidAttendanceRowDiscrepant,
  isRhidAttendanceRowWithoutPunches,
  summarizeRhidAttendance,
} from "./rhid-attendance-table.js";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 32;
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

function dateLabelFromValue(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
  return raw;
}

function timeFromUpdateLabel(value) {
  return String(value ?? "").match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/)?.[0] || "—";
}

function updateHeading(value) {
  return /DADOS ATUALIZADOS NO RELÓGIO DE PONTO/i.test(String(value ?? ""))
    ? "ÚLTIMA COLETA DO RELÓGIO"
    : "ÚLTIMA COLETA DO RHID";
}

export async function buildRhidAttendancePdf(table, { dateLabel, updateLabel } = {}) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    throw new TypeError("Tabela RHID inválida");
  }

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.13, 0.22);
  const muted = rgb(0.39, 0.44, 0.52);
  const navy = rgb(0.08, 0.24, 0.43);
  const navyText = rgb(1, 1, 1);
  const green = rgb(0.05, 0.44, 0.25);
  const red = rgb(0.67, 0.10, 0.16);
  const blueFill = rgb(0.93, 0.96, 0.99);
  const panelFill = rgb(0.93, 0.95, 0.98);
  const summaryRule = rgb(0.84, 0.87, 0.91);
  const cardRule = rgb(0.82, 0.85, 0.89);
  const discrepancyFill = rgb(1, 0.91, 0.90);
  const noPunchFill = rgb(1, 235 / 255, 204 / 255);
  const badgeFill = rgb(0.98, 0.88, 0.67);
  const badgeText = rgb(0.55, 0.35, 0.08);
  const pageLabel = dateLabelFromValue(dateLabel);
  const updateText = String(updateLabel ?? "").trim();
  const summary = summarizeRhidAttendance(table);
  const pairCount = Math.max(0, Math.floor((table.headers.length - 2) / 2));
  let page;
  let y;

  function drawText(text, x, yValue, font, size, color = ink) {
    page.drawText(String(text ?? ""), { x, y: yValue, font, size, color });
  }

  function drawCentered(text, centerX, yValue, font, size, color = ink) {
    const width = font.widthOfTextAtSize(String(text ?? ""), size);
    drawText(text, centerX - width / 2, yValue, font, size, color);
  }

  function addHeader() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - 2, width: 32, height: 3, color: navy });
    drawText("RELATÓRIO DIÁRIO", MARGIN, y - 21, bold, 8, muted);
    drawText("Presenças RHID", MARGIN, y - 55, bold, 25, ink);

    const updateX = 270;
    const updateWidth = 178;
    const dateX = 460;
    const dateWidth = PAGE_WIDTH - MARGIN - dateX;
    page.drawRectangle({ x: updateX, y: y - 56, width: updateWidth, height: 56, color: navy, borderRadius: 8 });
    drawCentered(updateHeading(updateText), updateX + updateWidth / 2, y - 20, bold, 7, navyText);
    drawCentered(timeFromUpdateLabel(updateText), updateX + updateWidth / 2, y - 43, bold, 21, navyText);
    page.drawRectangle({ x: dateX, y: y - 56, width: dateWidth, height: 56, color: panelFill, borderRadius: 8 });
    drawText("DATA DO RELATÓRIO", dateX + 14, y - 20, bold, 7, muted);
    drawText(pageLabel || "—", dateX + 14, y - 43, bold, 16, navy);

    y -= 88;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.8, color: summaryRule });
    y -= 33;
    const summaryItems = [
      [String(summary.collaborators).padStart(2, "0"), "COLABORADORES", ink],
      [String(summary.withPunches).padStart(2, "0"), "COM MARCAÇÃO", ink],
      [String(summary.withoutPunches).padStart(2, "0"), "SEM MARCAÇÃO", badgeText],
    ];
    const summaryWidth = INNER_WIDTH / summaryItems.length;
    summaryItems.forEach(([value, label], index) => {
      const x = MARGIN + index * summaryWidth;
      if (index > 0) page.drawLine({ start: { x, y: y - 2 }, end: { x, y: y + 28 }, thickness: 0.6, color: summaryRule });
      drawText(value, x, y, bold, 18, index === 2 ? badgeText : navy);
      drawText(label, x + 37, y + 2, bold, 7, muted);
    });
    y -= 28;
    if (updateText) {
      for (const line of wrapLiteralText(updateText, regular, 7, INNER_WIDTH)) {
        drawText(line, MARGIN, y, regular, 7, muted);
        y -= 10;
      }
    }
    y -= 8;
  }

  function ensureSpace(height) {
    if (y - height < MARGIN) {
      addHeader();
      return true;
    }
    return false;
  }

  function drawBadge(text, x, yValue, width) {
    page.drawRectangle({ x, y: yValue - 3, width, height: 15, color: badgeFill, borderRadius: 5 });
    drawCentered(text, x + width / 2, yValue + 1, bold, 6.5, badgeText);
  }

  function drawCard(row, name, rowFill, slots, total, isPartial) {
    const nameLines = wrapText(name, bold, 10.5, INNER_WIDTH - 32);
    const nameLineHeight = 12;
    const slotRows = Math.max(1, Math.ceil(slots.length / 4));
    const detailsHeight = Math.max(45, slotRows * 17 + 8);
    const cardHeight = Math.max(78, 28 + nameLines.length * nameLineHeight + (rowFill === noPunchFill ? 17 : 0) + detailsHeight);
    ensureSpace(cardHeight + 4);
    const cardTop = y;
    page.drawRectangle({
      x: MARGIN,
      y: cardTop - cardHeight,
      width: INNER_WIDTH,
      height: cardHeight,
      color: rowFill || rgb(1, 1, 1),
      borderColor: cardRule,
      borderWidth: 0.8,
      borderRadius: 9,
    });
    nameLines.forEach((line, index) => drawText(line, MARGIN + 16, cardTop - 19 - index * nameLineHeight, bold, 10.5, ink));
    const detailsTop = cardTop - 19 - nameLines.length * nameLineHeight - (rowFill === noPunchFill ? 17 : 7);
    if (rowFill === noPunchFill) drawBadge("SEM MARCAÇÃO", MARGIN + 16, detailsTop + 8, 72);
    const contentX = MARGIN + 16;
    const totalX = PAGE_WIDTH - MARGIN - 106;
    const slotStartY = detailsTop - 4;
    const slotWidth = 56;
    for (let index = 0; index < slots.length; index += 1) {
      const rowIndex = Math.floor(index / 4);
      const colIndex = index % 4;
      const x = contentX + colIndex * slotWidth;
      const slot = slots[index];
      const isTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(slot.value).trim());
      const slotColor = !isTime ? muted : slot.kind === "entry" ? green : red;
      drawText(slot.label, x, slotStartY - rowIndex * 17, regular, 6.5, muted);
      drawText(slot.value, x, slotStartY - 10 - rowIndex * 17, bold, 9.5, slotColor);
    }
    page.drawRectangle({ x: totalX, y: detailsTop - detailsHeight, width: 90, height: detailsHeight, color: rowFill === noPunchFill ? rgb(0.98, 0.90, 0.72) : blueFill, borderRadius: 7 });
    drawCentered("TOTAL DE HORAS/DIA", totalX + 45, detailsTop - 8, bold, 6.5, muted);
    const displayTotal = total.replace(/\s*\(parcial\)/i, "").trim() || "—";
    drawCentered(displayTotal, totalX + 45, detailsTop - 23, bold, 15, navy);
    if (isPartial) drawBadge("PARCIAL", totalX + 22, detailsTop - 39, 46);
    y = cardTop - cardHeight - 4;
  }

  addHeader();
  if (table.rows.length === 0) {
    drawText("Nenhuma presença encontrada", MARGIN, y, bold, 12, ink);
  } else {
    const orderedRows = [...table.rows].sort((left, right) => Number(isRhidAttendanceRowWithoutPunches(left)) - Number(isRhidAttendanceRowWithoutPunches(right)));
    for (const row of orderedRows) {
      const name = String(row[0] ?? "");
      const isMissing = isRhidAttendanceRowWithoutPunches(row);
      const discrepant = isRhidAttendanceRowDiscrepant(row, table.reportDate);
      const rowFill = isMissing ? noPunchFill : discrepant ? discrepancyFill : null;
      const slots = [];
      for (let index = 0; index < pairCount; index += 1) {
        slots.push({ label: String(table.headers[1 + index * 2] ?? `Entrada ${index + 1}`), value: String(row[1 + index * 2] ?? "—"), kind: "entry" });
        slots.push({ label: String(table.headers[2 + index * 2] ?? `Saída ${index + 1}`), value: String(row[2 + index * 2] ?? "—"), kind: "exit" });
      }
      const total = String(row[row.length - 1] ?? "—");
      const slotsPerCard = 12;
      for (let offset = 0; offset < slots.length || offset === 0; offset += slotsPerCard) {
        const slotChunk = slots.slice(offset, offset + slotsPerCard);
        const isLastChunk = offset + slotsPerCard >= slots.length;
        const cardName = offset === 0 ? name : `${name} (continuação)`;
        drawCard(row, cardName, rowFill, slotChunk, isLastChunk ? total : "—",
          isLastChunk && (total.includes("parcial") || isMissing));
      }
    }
  }

  return new Blob([await pdf.save()], { type: "application/pdf" });
}
