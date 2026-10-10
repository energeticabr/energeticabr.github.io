import { isRhidReportMonth } from "./rhid-monthly-model.js";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 32;
const BOTTOM = 48;
const INNER_WIDTH = PAGE_WIDTH - MARGIN * 2;
const SIZE = 9;
const LEADING = 12;
const PADDING = 6;
const COLUMNS = [72, 138, 50, 271];

// Wrap words, literal line breaks and long tokens without shortening the text.
function wrapText(value, font, size, width) {
  const lines = [];
  for (const paragraph of String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(line + token, size) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!line && /^\s+$/.test(token)) continue;
      for (const character of token) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += character;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function dateLabel(date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

export async function buildRhidMonthlyPdf(report) {
  if (!report || !isRhidReportMonth(report.month) || !report.supplier?.id
    || !String(report.supplier.name ?? "").trim() || !Array.isArray(report.days) || !report.days.length
    || report.days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day?.date) || !Array.isArray(day.slots) || !Array.isArray(day.issues))) {
    throw new TypeError("Relatório mensal RHID inválido");
  }

  const { PDFDocument, StandardFonts, PDFHexString, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.13, 0.22);
  const navy = rgb(0.08, 0.24, 0.43);
  const rule = rgb(0.82, 0.85, 0.89);
  const supplierName = String(report.supplier.name).trim().normalize("NFC");
  let page;
  let y;

  function text(value, x, baseline, font = regular, size = SIZE, color = ink) {
    page.drawText(String(value), { x, y: baseline, font, size, color });
  }

  function addPage(includeAttendanceHeader = true) {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    text("RELATÓRIO MENSAL RHID", MARGIN, PAGE_HEIGHT - 49, bold, 17, navy);
    text(`Período: ${report.month.slice(5, 7)}/${report.month.slice(0, 4)}`, MARGIN, PAGE_HEIGHT - 69, bold, 10);
    y = PAGE_HEIGHT - 89;
    for (const line of wrapText(supplierName, bold, 10, INNER_WIDTH)) {
      text(line, MARGIN, y, bold, 10);
      y -= 13;
    }
    y -= 7;
    if (!includeAttendanceHeader) return;
    page.drawRectangle({ x: MARGIN, y: y - 25, width: INNER_WIDTH, height: 25, color: navy });
    let x = MARGIN;
    ["Data", "Marcações", "Total", "Observações"].forEach((label, index) => {
      text(label, x + PADDING, y - 16, bold, SIZE, rgb(1, 1, 1));
      x += COLUMNS[index];
    });
    y -= 25;
  }

  function drawDay(day) {
    const marks = [];
    for (let index = 0; index < day.slots.length; index += 2) {
      marks.push(`E${index / 2 + 1} ${day.slots[index]}${index + 1 < day.slots.length ? `   S${index / 2 + 1} ${day.slots[index + 1]}` : ""}`);
    }
    const notes = [!day.recorded ? "Sem registros" : day.total === null ? "Incompleto" : "Registrado"];
    if (day.adjusted) notes.push("Ajustado");
    notes.push(...day.issues);
    const cells = [dateLabel(day.date), marks.join("\n"), day.total ?? "-", notes.join("\n")]
      .map((value, index) => wrapText(value, index === 2 ? bold : regular, SIZE, COLUMNS[index] - PADDING * 2));
    const length = Math.max(...cells.map(lines => lines.length));
    let offset = 0;
    while (offset < length) {
      const remainingHeight = (length - offset) * LEADING + PADDING * 2;
      const freshHeight = PAGE_HEIGHT - 89 - wrapText(supplierName, bold, 10, INNER_WIDTH).length * 13 - 32 - BOTTOM;
      // Keep ordinary rows together; oversized notes consume successive pages.
      if (y - remainingHeight < BOTTOM && remainingHeight <= freshHeight) addPage();
      let capacity = Math.floor((y - BOTTOM - PADDING * 2) / LEADING);
      if (capacity < 1) { addPage(); capacity = Math.floor((y - BOTTOM - PADDING * 2) / LEADING); }
      const count = Math.min(length - offset, capacity);
      const height = count * LEADING + PADDING * 2;
      page.drawRectangle({ x: MARGIN, y: y - height, width: INNER_WIDTH, height,
        color: day.adjusted ? rgb(0.93, 0.96, 0.99) : rgb(1, 1, 1), borderColor: rule, borderWidth: 0.5 });
      let x = MARGIN;
      cells.forEach((lines, column) => {
        const chunk = column === 0 && offset > 0 ? [dateLabel(day.date), "(cont.)"].slice(0, count) : lines.slice(offset, offset + count);
        chunk.forEach((line, index) => text(line, x + PADDING, y - PADDING - SIZE - index * LEADING, column === 2 ? bold : regular));
        x += COLUMNS[column];
        if (column < COLUMNS.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.5, color: rule });
      });
      y -= height;
      offset += count;
    }
  }

  function signatureGroup() {
    const gap = 24;
    const width = (INNER_WIDTH - gap) / 2;
    const signatures = [
      [supplierName, "rhid_employee", "Assinatura do colaborador"],
      ["Representante da Energética", "rhid_representative", "Assinatura do representante da empresa"],
    ].map(([name, fieldName, label]) => ({
      name, fieldName, nameLines: wrapText(name, bold, 10, width), labelLines: wrapText(label, regular, 9, width),
    }));
    const nameHeight = Math.max(...signatures.map(signature => signature.nameLines.length)) * 13;
    const labelHeight = (Math.max(...signatures.map(signature => signature.labelLines.length)) - 1) * 12;
    const groupHeight = 16 + nameHeight + labelHeight + 8 + 64;
    // Reserve both signatures at once; a continuation has report context only.
    if (y - groupHeight < BOTTOM) addPage(false);
    const nameTop = y - 16;
    const labelTop = nameTop - nameHeight;
    const bottom = labelTop - labelHeight - 8 - 64;
    signatures.forEach(({ name, fieldName, nameLines, labelLines }, index) => {
      const x = MARGIN + index * (width + gap);
      nameLines.forEach((line, lineIndex) => text(line, x, nameTop - lineIndex * 13, bold, 10));
      labelLines.forEach((line, lineIndex) => text(line, x, labelTop - lineIndex * 12, regular, 9));
      page.drawLine({ start: { x, y: bottom }, end: { x: x + width, y: bottom }, thickness: 0.7, color: rule });
      // A merged /Sig field + /Widget is registered in both canonical trees.
      // No /V is set: this is an empty signature field, not a signed document.
      const appearance = pdf.context.register(pdf.context.flateStream("", {
        Type: "XObject", Subtype: "Form", BBox: [0, 0, width, 64], Resources: {},
      }));
      const field = pdf.context.register(pdf.context.obj({
        Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText(fieldName),
        TU: PDFHexString.fromText(name), Rect: [x, bottom, x + width, bottom + 64],
        P: page.ref, F: 4, AP: { N: appearance },
      }));
      pdf.getForm().acroForm.addField(field);
      page.node.addAnnot(field);
    });
    y = bottom - 12;
  }

  addPage();
  for (const day of report.days) drawDay(day);
  if (y - 66 < BOTTOM) addPage(false);
  y -= 22;
  text(`Total do mês: ${report.total}`, MARGIN, y, bold, 12, navy);
  y -= 17;
  text(`Dias com registros: ${report.recordedDays}`, MARGIN, y);
  y -= 14;
  text(`Dias incompletos: ${report.incompleteDays}`, MARGIN, y);
  y -= 14;
  signatureGroup();
  pdf.getPages().forEach((sheet, index, pages) => sheet.drawText(`Página ${index + 1} de ${pages.length}`, {
    x: MARGIN, y: 32, font: regular, size: 8, color: ink,
  }));
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
