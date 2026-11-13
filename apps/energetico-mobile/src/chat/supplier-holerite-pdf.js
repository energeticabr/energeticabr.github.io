import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 });
const money = amount => currency.format(amount).replace(/\s/g, " ");
const dateLabel = date => date.split("-").reverse().join("/");
const ink = rgb(0.08, 0.17, 0.22);
const brand = rgb(0.03, 0.32, 0.39);
const light = rgb(0.93, 0.96, 0.97);
const rule = rgb(0.67, 0.75, 0.78);

function displayText(value, font) {
  return [...String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim()].map(character => {
    try { font.encodeText(character); return character; }
    catch { return "?"; }
  }).join("");
}

export async function buildSupplierHoleritePdf({ supplier, date, week, lines, total }, { logoBytes }) {
  const document = await PDFDocument.create();
  document.setTitle("Holerite semanal");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await document.embedPng(logoBytes);
  const logoSize = logo.scaleToFit(88, 30);
  const page = document.addPage([595, 842]);
  const margin = 30;
  const right = 565;
  function text(value, x, y, { size = 10, width, font = regular, color = ink } = {}) {
    let label = displayText(value, font);
    while (width && font.widthOfTextAtSize(label, size) > width && size > 7) size -= 0.5;
    if (width && font.widthOfTextAtSize(label, size) > width) {
      while (label && font.widthOfTextAtSize(label + "…", size) > width) label = label.slice(0, -1);
      label += "…";
    }
    page.drawText(label, { x, y, size, font, color });
  }
  function line(x1, x2, y, color = rule) {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color });
  }
  function copy(top, caption) {
    page.drawImage(logo, { x: margin, y: top + 6 - logoSize.height / 2, ...logoSize });
    text("HOLERITE SEMANAL", margin + 101, top, { size: 18, font: bold, color: brand });
    text(caption, 382, top + 2, { width: 183, font: bold, size: 9 });
    text(supplier.label, margin, top - 23, { font: bold, size: 13, width: right - margin });
    text(supplier.branch, margin, top - 38, { width: right - margin, size: 9 });
    text("Semana " + dateLabel(week.start) + " a " + dateLabel(week.end), margin, top - 53, { size: 9 });
    text("Data da folha  " + dateLabel(date), 382, top - 53, { size: 9 });

    const columns = [37, 195, 245, 333, 421];
    const widths = [151, 44, 81, 81, 137];
    const head = top - 76;
    page.drawRectangle({ x: margin, y: head - 6, width: right - margin, height: 19, color: light });
    ["Rubrica", "Qtd.", "Valor unitário", "Subtotal", "Forma de pgto."].forEach((label, index) =>
      text(label, columns[index], head, { font: bold, size: 9 }));
    lines.forEach((entry, row) => {
      const y = head - 21 - row * 17;
      const cells = [entry.label, quantity.format(entry.quantity), money(entry.unitValue),
        money(entry.total), entry.formaPgto || "—"];
      cells.forEach((value, index) => text(value, columns[index], y, { size: 9, width: widths[index] }));
      line(margin, right, y - 5);
    });
    const totals = head - 22 - lines.length * 17;
    text("Total  " + money(total), margin, totals, { size: 11, font: bold, width: 174 });

    const signature = top - 348;
    line(margin, 271, signature, ink);
    line(323, right, signature, ink);
    text("Assinatura do responsável pela empresa", margin, signature - 14, { size: 9 });
    text("Assinatura do funcionário", 323, signature - 14, { size: 9 });
  }
  copy(802, "1ª VIA — EMPRESA");
  page.drawLine({ start: { x: margin, y: 421 }, end: { x: right, y: 421 }, thickness: 0.7, dashArray: [4, 4], color: rule });
  copy(396, "2ª VIA — FUNCIONÁRIO");
  return document.save();
}
