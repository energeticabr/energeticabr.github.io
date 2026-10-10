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

  const { PDFDocument, StandardFonts, PDFHexString, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.13, 0.22);
  const muted = rgb(0.39, 0.44, 0.52);
  const navy = rgb(0.08, 0.24, 0.43);
  const navyText = rgb(1, 1, 1);
  const entryClusterFill = rgb(0.09, 0.50, 0.29);
  const exitClusterFill = rgb(0.68, 0.19, 0.25);
  const emptyClusterFill = rgb(0.93, 0.95, 0.96);
  const clusterText = rgb(1, 1, 1);
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
  let signatureIndex = 0;

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

  function addSignature(name, x, bottom, width, fieldName) {
    const height = 64;
    page.drawLine({ start: { x, y: bottom }, end: { x: x + width, y: bottom }, thickness: 0.7, color: cardRule });
    const appearance = pdf.context.register(pdf.context.flateStream("", {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, width, height], Resources: {},
    }));
    // Real, unsigned /Sig widget; no text field or signature value is created.
    const field = pdf.context.register(pdf.context.obj({
      Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText(fieldName),
      TU: PDFHexString.fromText(name), Rect: [x, bottom, x + width, bottom + height],
      P: page.ref, F: 4, AP: { N: appearance },
    }));
    pdf.getForm().acroForm.addField(field);
    page.node.addAnnot(field);
  }

  function auditLines(detail, slots) {
    const lines = detail?.issues?.length
      ? wrapLiteralText(`Batidas RHID: ${(detail.rawPunches || []).join(", ")}`, regular, 7, INNER_WIDTH - 32)
      : [];
    if (slots.some(slot => slot.outOfRange)) lines.push(...wrapLiteralText("* Batida fora das faixas usada provisoriamente até correção.", regular, 7, INNER_WIDTH - 32));
    return lines;
  }

  function drawCard(row, name, rowFill, slots, total, isPartial, rawLines = [], signatureName = null) {
    const nameLines = wrapText(name, bold, 10.5, INNER_WIDTH - 32);
    const nameLineHeight = 12;
    const slotRows = Math.max(1, Math.ceil(slots.length / 4));
    const detailsHeight = Math.max(45, slotRows * 29 + 4);
    const auditHeight = rawLines.length ? 8 + rawLines.length * 10 : 0;
    const signatureHeight = signatureName === null ? 0 : 90;
    const cardHeight = Math.max(78, 28 + nameLines.length * nameLineHeight + signatureHeight + (rowFill === noPunchFill ? 17 : 0) + detailsHeight + auditHeight);
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
    if (signatureName !== null) {
      const bottom = cardTop - 19 - nameLines.length * nameLineHeight - 66;
      addSignature(signatureName, MARGIN + 16, bottom, INNER_WIDTH - 32, `rhid_employee_${signatureIndex++}`);
      drawText("Assinatura do colaborador", MARGIN + 16, bottom - 12, regular, 8, muted);
    }
    const detailsTop = cardTop - 19 - nameLines.length * nameLineHeight - signatureHeight - (rowFill === noPunchFill ? 17 : 7);
    if (rowFill === noPunchFill) drawBadge("SEM MARCAÇÃO", MARGIN + 16, detailsTop + 8, 72);
    const contentX = MARGIN + 16;
    const totalX = PAGE_WIDTH - MARGIN - 106;
    const slotStartY = detailsTop - 3;
    const slotGap = 6;
    const slotHeight = 22;
    const slotWidth = Math.max(64, (totalX - contentX - 14 - slotGap * 3) / 4);
    for (let index = 0; index < slots.length; index += 1) {
      const rowIndex = Math.floor(index / 4);
      const colIndex = index % 4;
      const x = contentX + colIndex * (slotWidth + slotGap);
      const slot = slots[index];
      const isTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(slot.value).trim());
      const clusterFill = !isTime ? emptyClusterFill : slot.kind === "entry" ? entryClusterFill : exitClusterFill;
      const textColor = isTime ? clusterText : muted;
      const clusterY = slotStartY - rowIndex * (slotHeight + 7) - slotHeight;
      page.drawRectangle({ x, y: clusterY, width: slotWidth, height: slotHeight, color: clusterFill, borderRadius: 5 });
      const valueText = String(slot.value ?? "") + (slot.outOfRange ? "*" : "");
      const valueWidth = bold.widthOfTextAtSize(valueText, 9.5);
      drawText(slot.label, x + 6, clusterY + 8, bold, 6.5, textColor);
      drawText(valueText, x + slotWidth - 6 - valueWidth, clusterY + 8, bold, 9.5, textColor);
    }
    page.drawRectangle({ x: totalX, y: detailsTop - detailsHeight, width: 90, height: detailsHeight, color: rowFill === noPunchFill ? rgb(0.98, 0.90, 0.72) : blueFill, borderRadius: 7 });
    drawCentered("TOTAL DE HORAS/DIA", totalX + 45, detailsTop - 8, bold, 6.5, muted);
    const displayTotal = total.replace(/\s*\(parcial\)/i, "").trim() || "—";
    drawCentered(displayTotal, totalX + 45, detailsTop - 23, bold, 15, navy);
    if (isPartial) drawBadge("PARCIAL", totalX + 22, detailsTop - 39, 46);
    rawLines.forEach((line, index) => drawText(line, contentX, detailsTop - detailsHeight - 10 - index * 10, regular, 7, muted));
    y = cardTop - cardHeight - 4;
  }

  addHeader();
  if (table.rows.length === 0) {
    drawText("Nenhuma presença encontrada", MARGIN, y, bold, 12, ink);
  } else {
    const orderedRows = table.rows.map((row, index) => ({ row, detail: table.people?.[index] || null }))
      .sort((left, right) => Number(isRhidAttendanceRowWithoutPunches(left.row)) - Number(isRhidAttendanceRowWithoutPunches(right.row)));
    for (const { row, detail } of orderedRows) {
      const name = String(row[0] ?? "");
      const isMissing = isRhidAttendanceRowWithoutPunches(row);
      const discrepant = isRhidAttendanceRowDiscrepant(row, table.reportDate);
      const rowFill = isMissing ? noPunchFill : discrepant || detail?.issues?.length ? discrepancyFill : null;
      const slots = [];
      const provisional = slot => detail?.slots?.[slot]?.outOfRange === true && !detail.slots[slot].adjustment
        && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(detail.slots[slot].effective || "");
      for (let index = 0; index < pairCount; index += 1) {
        slots.push({ label: String(table.headers[1 + index * 2] ?? `Entrada ${index + 1}`), value: String(row[1 + index * 2] ?? "—"), kind: "entry", outOfRange: provisional(`entry${index + 1}`) });
        slots.push({ label: String(table.headers[2 + index * 2] ?? `Saída ${index + 1}`), value: String(row[2 + index * 2] ?? "—"), kind: "exit", outOfRange: provisional(`exit${index + 1}`) });
      }
      const total = String(row[row.length - 1] ?? "—");
      const slotsPerCard = 12;
      for (let offset = 0; offset < slots.length || offset === 0; offset += slotsPerCard) {
        const slotChunk = slots.slice(offset, offset + slotsPerCard);
        const isLastChunk = offset + slotsPerCard >= slots.length;
        const rawLines = auditLines(isLastChunk ? detail : null, slotChunk);
        // Audit text may be taller than a page. Carry it through bounded cards,
        // reserving the full name, hours, total and signature for the last one.
        let auditOffset = 0;
        const finalName = offset === 0 ? name : `${name} (continuação)`;
        const nameHeight = wrapText(finalName, bold, 10.5, INNER_WIDTH - 32).length * 12;
        const detailsHeight = Math.max(45, Math.max(1, Math.ceil(slotChunk.length / 4)) * 29 + 4);
        const baseHeight = 28 + nameHeight + (rowFill === noPunchFill ? 17 : 0) + detailsHeight + (isLastChunk ? 90 : 0);
        while (rawLines.length - auditOffset > 0 && y - baseHeight - 8 - (rawLines.length - auditOffset) * 10 - 4 < MARGIN) {
          // Try a fresh page first when the complete final card can fit there.
          const freshCardHeight = PAGE_HEIGHT - MARGIN - 88 - 33 - 28
            - (updateText ? wrapLiteralText(updateText, regular, 7, INNER_WIDTH).length * 10 : 0) - 8 - MARGIN - 4;
          if (baseHeight + 8 + (rawLines.length - auditOffset) * 10 <= freshCardHeight) { addHeader(); break; }
          const continuationNameHeight = wrapText(`${name} (continuação)`, bold, 10.5, INNER_WIDTH - 32).length * 12;
          const continuationBase = 28 + continuationNameHeight + (rowFill === noPunchFill ? 17 : 0) + 45 + 8;
          let capacity = Math.floor((y - MARGIN - continuationBase - 4) / 10);
          if (capacity < 1) { addHeader(); capacity = Math.floor((y - MARGIN - continuationBase - 4) / 10); }
          const count = Math.min(capacity, rawLines.length - auditOffset);
          drawCard(row, `${name} (continuação)`, rowFill, [], "—", false, rawLines.slice(auditOffset, auditOffset + count));
          auditOffset += count;
        }
        drawCard(row, finalName, rowFill, slotChunk, isLastChunk ? total : "—",
          isLastChunk && (total.includes("parcial") || isMissing), rawLines.slice(auditOffset), isLastChunk ? name : null);
      }
    }
  }

  ensureSpace(116);
  y -= 18;
  drawText("Representante da Energética", MARGIN + 16, y, bold, 10.5);
  y -= 14;
  drawText("Assinatura do representante da empresa", MARGIN + 16, y, regular, 8, muted);
  y -= 72;
  addSignature("Representante da Energética", MARGIN + 16, y, INNER_WIDTH - 32, "rhid_representative");

  return new Blob([await pdf.save()], { type: "application/pdf" });
}
