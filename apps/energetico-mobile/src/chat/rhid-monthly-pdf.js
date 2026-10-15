import { isRhidReportMonth, isRhidReportDateRange, rhidMonthDateBounds } from "./rhid-monthly-model.js";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 32;
const BOTTOM = 48;
const INNER_WIDTH = PAGE_WIDTH - MARGIN * 2;
const SIZE = 9;
const LEADING = 10;
const PADDING = 1.5;
const COLUMNS = [70, 92, 92, 92, 92, 93];

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

/** Pure renderer; the app supplies its local official PNG through logoBytes. */
export async function buildRhidMonthlyPdf(input, { logoBytes } = {}) {
  const reports = Array.isArray(input) ? input : [input];
  if (!reports.length || reports.some(report => !report || !isRhidReportMonth(report.month) || !report.supplier?.id
    || !String(report.supplier.name ?? "").trim() || !Array.isArray(report.days) || !report.days.length
    || report.days.some(day => !/^\d{4}-\d{2}-\d{2}$/.test(day?.date) || !Array.isArray(day.slots) || !Array.isArray(day.issues)))
    || new Set(reports.map(report => String(report.supplier.id))).size !== reports.length
    || reports.some(report => report.month !== reports[0].month)) {
    throw new TypeError("Relatório mensal RHID inválido");
  }
  const periods = reports.map(report => {
    const bounds = rhidMonthDateBounds(report.month);
    if ((report.startDate == null) !== (report.endDate == null)) throw new TypeError("Período mensal RHID inválido");
    return { startDate: report.startDate ?? bounds.startDate, endDate: report.endDate ?? bounds.endDate, bounds };
  });
  if (periods.some(({ startDate, endDate }, index) => !isRhidReportDateRange(reports[index].month, startDate, endDate)
    || reports[index].days.some(day => day.date < startDate || day.date > endDate))
    || periods.some(({ startDate, endDate }) => startDate !== periods[0].startDate || endDate !== periods[0].endDate)) {
    throw new TypeError("Período mensal RHID inválido");
  }

  const { PDFDocument, StandardFonts, PDFHexString, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await pdf.embedPng(logoBytes) : null;
  const logoSize = logo?.scaleToFit(110, 38);
  const headingX = logo ? MARGIN + logoSize.width + 14 : MARGIN;
  const ink = rgb(0.07, 0.13, 0.22);
  const navy = rgb(0.08, 0.24, 0.43);
  const rule = rgb(0.82, 0.85, 0.89);
  for (const [reportIndex, report] of reports.entries()) {
  const { startDate, endDate, bounds } = periods[reportIndex];
  const customPeriod = startDate !== bounds.startDate || endDate !== bounds.endDate;
  const firstPage = pdf.getPageCount();
  const supplierName = String(report.supplier.name).trim().normalize("NFC");
  let page;
  let y;

  function text(value, x, baseline, font = regular, size = SIZE, color = ink) {
    page.drawText(String(value), { x, y: baseline, font, size, color });
  }

  function addPage(includeAttendanceHeader = true) {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (logo) page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - logoSize.height, ...logoSize });
    text("RELATÓRIO MENSAL RHID", headingX, PAGE_HEIGHT - 49, bold, 17, navy);
    text(customPeriod ? `Período: ${dateLabel(startDate)} a ${dateLabel(endDate)}` : `Período: ${report.month.slice(5, 7)}/${report.month.slice(0, 4)}`, headingX, PAGE_HEIGHT - 69, bold, 10);
    y = PAGE_HEIGHT - 89;
    for (const line of wrapText(supplierName, bold, 10, INNER_WIDTH)) {
      text(line, MARGIN, y, bold, 10);
      y -= 13;
    }
    y -= 7;
    if (!includeAttendanceHeader) return;
    page.drawRectangle({ x: MARGIN, y: y - 25, width: INNER_WIDTH, height: 25, color: navy });
    let x = MARGIN;
    ["Data", "ENTRADA 1", "SAÍDA 1", "ENTRADA 2", "SAÍDA 2", "Total"].forEach((label, index) => {
      text(label, x + PADDING, y - 16, bold, SIZE, rgb(1, 1, 1));
      x += COLUMNS[index];
    });
    y -= 25;
  }

  function drawDay(day) {
    const notes = [];
    if (day.adjusted) notes.push("Ajustado");
    if (day.recorded && day.total === null) notes.push("Incompleto");
    notes.push(...day.issues);
    const slots = Array.from({ length: 4 }, (_, index) => day.slots[index] || "-");
    if (day.slots.length > 4) notes.push(`Outras marcações: ${day.slots.slice(4).join(" / ")}`);
    const cells = [dateLabel(day.date), ...slots, day.total ?? "-"]
      .map((value, index) => wrapText(value, index === 5 ? bold : regular, SIZE, COLUMNS[index] - PADDING * 2));
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
        chunk.forEach((line, index) => text(line, x + PADDING, y - PADDING - SIZE - index * LEADING, column === 5 ? bold : regular));
        x += COLUMNS[column];
        if (column < COLUMNS.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: 0.5, color: rule });
      });
      y -= height;
      offset += count;
    }
    if (!notes.length) return;
    const remark = wrapText(`Ocorrência em ${dateLabel(day.date)}: ${notes.join(" · ")}`, regular, SIZE, INNER_WIDTH - PADDING * 2);
    let remarkOffset = 0;
    while (remarkOffset < remark.length) {
      const remainingHeight = (remark.length - remarkOffset) * LEADING + PADDING * 2;
      const freshHeight = PAGE_HEIGHT - 89 - wrapText(supplierName, bold, 10, INNER_WIDTH).length * 13 - 32 - BOTTOM;
      if (y - remainingHeight < BOTTOM && remainingHeight <= freshHeight) addPage();
      let capacity = Math.floor((y - BOTTOM - PADDING * 2) / LEADING);
      if (capacity < 1) { addPage(); capacity = Math.floor((y - BOTTOM - PADDING * 2) / LEADING); }
      const count = Math.min(remark.length - remarkOffset, capacity);
      const height = count * LEADING + PADDING * 2;
      page.drawRectangle({ x: MARGIN, y: y - height, width: INNER_WIDTH, height,
        color: rgb(0.96, 0.98, 1), borderColor: rule, borderWidth: 0.5 });
      remark.slice(remarkOffset, remarkOffset + count).forEach((line, index) =>
        text(line, MARGIN + PADDING, y - PADDING - SIZE - index * LEADING));
      y -= height;
      remarkOffset += count;
    }
  }

  function signatureGroup() {
    const gap = 24;
    const width = (INNER_WIDTH - gap) / 2;
    const signatures = [
      [supplierName, reports.length > 1 ? `rhid_employee_${report.supplier.id}` : "rhid_employee", "Assinatura do colaborador"],
      ["Representante da Energética", reports.length > 1 ? `rhid_representative_${report.supplier.id}` : "rhid_representative", "Assinatura do representante da empresa"],
    ].map(([name, fieldName, label]) => ({
      name, fieldName, nameLines: wrapText(name, bold, 10, width), labelLines: wrapText(label, regular, 9, width),
    }));
    const nameHeight = Math.max(...signatures.map(signature => signature.nameLines.length)) * 13;
    const labelHeight = (Math.max(...signatures.map(signature => signature.labelLines.length)) - 1) * 12;
    const declaration = "Declaração: o colaborador usufrui diariamente de 15 minutos de descanso para o lanche da manhã. De segunda a quinta-feira, usufrui mais 15 minutos de descanso para o lanche da tarde. Esses períodos foram descontados dos totais líquidos de horas trabalhadas neste relatório.";
    const declarationLines = wrapText(declaration, regular, 8.5, INNER_WIDTH);
    const declarationHeight = declarationLines.length * 11 + 8;
    const signatureGap = 6;
    const groupHeight = declarationHeight + signatureGap + 64 + 13 + nameHeight + labelHeight + 8;
    // Reserve both signatures at once; a continuation has report context only.
    if (y - groupHeight < BOTTOM) addPage(false);
    declarationLines.forEach((line, index) => text(line, MARGIN, y - index * 11, regular, 8.5));
    y -= declarationHeight;
    const signatureBottom = y - signatureGap - 64;
    const nameTop = signatureBottom - 13;
    const labelTop = nameTop - nameHeight;
    const bottom = labelTop - labelHeight - 8;
    signatures.forEach(({ name, fieldName, nameLines, labelLines }, index) => {
      const x = MARGIN + index * (width + gap);
      nameLines.forEach((line, lineIndex) => text(line, x, nameTop - lineIndex * 13, bold, 10));
      labelLines.forEach((line, lineIndex) => text(line, x, labelTop - lineIndex * 12, regular, 9));
      page.drawLine({ start: { x, y: signatureBottom }, end: { x: x + width, y: signatureBottom }, thickness: 0.7, color: navy });
      // A merged /Sig field + /Widget is registered in both canonical trees.
      // No /V is set: this is an empty signature field, not a signed document.
      const appearance = pdf.context.register(pdf.context.flateStream("", {
        Type: "XObject", Subtype: "Form", BBox: [0, 0, width, 64], Resources: {},
      }));
      const field = pdf.context.register(pdf.context.obj({
        Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText(fieldName),
        TU: PDFHexString.fromText(name), Rect: [x, signatureBottom, x + width, signatureBottom + 64],
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
  text(`${customPeriod ? 'Total do período' : 'Total do mês'}: ${report.total}`, MARGIN, y, bold, 12, navy);
  y -= 17;
  text(`Dias com registros: ${report.recordedDays}`, MARGIN, y);
  y -= 14;
  text(`Dias incompletos: ${report.incompleteDays}`, MARGIN, y);
  y -= 14;
  signatureGroup();
  if (reports.length > 1 && pdf.getPageCount() - firstPage !== 1) {
    throw new RangeError(`O relatório de ${supplierName} precisa de mais de uma página. Gere-o individualmente para preservar todas as ocorrências.`);
  }
  }
  pdf.getPages().forEach((sheet, index, pages) => sheet.drawText(`Página ${index + 1} de ${pages.length}`, {
    x: MARGIN, y: 32, font: regular, size: 8, color: ink,
  }));
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
