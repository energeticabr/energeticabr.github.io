const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const TOP = PAGE_HEIGHT - 66;
const BOTTOM = 40;
const TABLE_SIZE = 8;
const TABLE_LEADING = 11;
const CELL_PADDING = 5;

function validateSnapshot(snapshot) {
  const invalid = () => { throw new TypeError("Relatório filtrado inválido ou vazio"); };
  if (!snapshot || typeof snapshot.title !== "string" || !Array.isArray(snapshot.filters)
    || !Array.isArray(snapshot.pages) || !snapshot.pages.length) invalid();
  for (const filter of snapshot.filters) {
    if (typeof filter?.label !== "string" || typeof filter?.value !== "string") invalid();
  }
  let hasContent = false;
  function validateRuns(runs) {
    if (!Array.isArray(runs) || runs.some(run => typeof run?.text !== "string")) invalid();
    if (runs.some(run => run.text.trim())) hasContent = true;
  }
  for (const page of snapshot.pages) {
    if (!Array.isArray(page?.blocks)) invalid();
    for (const block of page.blocks) {
      if (block?.type === "text") validateRuns(block.runs);
      else if (block?.type === "table") {
        if (!Array.isArray(block.widths) || !block.widths.length
          || block.widths.some(width => !Number.isFinite(width) || width <= 0)
          || !Number.isFinite(block.widths.reduce((sum, width) => sum + width, 0))
          || !Array.isArray(block.rows)) invalid();
        for (const row of block.rows) {
          if (!Array.isArray(row?.cells)) invalid();
          for (const cell of row.cells) {
            if (!Number.isInteger(cell?.column) || cell.column < 0
              || !Number.isInteger(cell.colSpan) || cell.colSpan < 1
              || cell.column + cell.colSpan > block.widths.length) invalid();
            validateRuns(cell.runs);
          }
        }
      } else invalid();
    }
  }
  if (!hasContent) invalid();
}

/** Pure snapshot renderer: no DOM, asset fetching, filtering or locale conversion. */
export async function buildFilteredReportPdf(snapshot, { logoBytes } = {}) {
  validateSnapshot(snapshot);
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await pdf.embedPng(logoBytes) : null;
  const ink = [0.08, 0.13, 0.2];
  const supported = new Map();
  let page;
  let y;

  function safeText(value) {
    let result = "";
    for (const char of String(value).normalize("NFC").replace(/\r\n?/g, "\n")) {
      if (char === "\n" || char === "\t") { result += char === "\t" ? " " : char; continue; }
      if (!supported.has(char)) {
        try { regular.encodeText(char); supported.set(char, char.charCodeAt(0) >= 32); }
        catch { supported.set(char, false); }
      }
      if (supported.get(char)) result += char;
    }
    return result;
  }

  function color(value, fallback = ink) {
    return Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && n >= 0 && n <= 1)
      ? value : fallback;
  }

  function luminance(fill) {
    const linear = fill.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }

  function visibleColor(foreground, background) {
    const front = luminance(foreground);
    const back = luminance(background);
    const contrast = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (contrast >= 3) return foreground;
    // Inline badge fills are not captured: compare against the actual PDF
    // block/cell fill and choose the highest-contrast ink when necessary.
    return (back + 0.05) / 0.05 >= 1.05 / (back + 0.05) ? [0, 0, 0] : [1, 1, 1];
  }

  // Measure each glyph once; wrap words across run boundaries and split long
  // tokens by glyph. Every iteration consumes input, even at very narrow widths.
  function wrapRuns(runs, size, width, forceBold = false) {
    const tokens = [];
    let token = [];
    let whitespace;
    for (const run of runs) {
      const font = forceBold || run.bold ? bold : regular;
      const fill = color(run.color);
      for (const char of safeText(run.text)) {
        const space = /\s/.test(char);
        if (char === "\n") {
          if (token.length) tokens.push(token);
          tokens.push(null);
          token = [];
          whitespace = undefined;
          continue;
        }
        if (token.length && space !== whitespace) { tokens.push(token); token = []; }
        whitespace = space;
        token.push({ text: char, font, color: fill, width: font.widthOfTextAtSize(char, size) });
      }
    }
    if (token.length) tokens.push(token);
    const lines = [];
    let line = [];
    let used = 0;
    const finish = () => {
      while (line.length && /\s/.test(line.at(-1).text)) line.pop();
      lines.push(line);
      line = [];
      used = 0;
    };
    for (const word of tokens) {
      if (word === null) { finish(); continue; }
      if (/\s/.test(word[0].text)) {
        if (line.length) {
          const glyph = { ...word[0], text: " ", width: word[0].font.widthOfTextAtSize(" ", size) };
          line.push(glyph);
          used += glyph.width;
        }
        continue;
      }
      const wordWidth = word.reduce((sum, glyph) => sum + glyph.width, 0);
      if (line.length && used + wordWidth > width) finish();
      for (const glyph of word) {
        if (glyph.width > width) throw new RangeError("Coluna estreita demais para texto legível");
        if (line.length && used + glyph.width > width) finish();
        line.push(glyph);
        used += glyph.width;
      }
    }
    if (line.length || !lines.length) finish();
    return lines;
  }

  function drawLine(line, x, baseline, size, background = [1, 1, 1]) {
    let segment = "";
    let font;
    let fill;
    let width = 0;
    const flush = () => {
      if (!segment) return;
      page.drawText(segment, { x, y: baseline, size, font, color: rgb(...visibleColor(fill, background)) });
      x += width;
      segment = "";
      width = 0;
    };
    for (const glyph of line) {
      if (font !== glyph.font || fill !== glyph.color) flush();
      font = glyph.font;
      fill = glyph.color;
      segment += glyph.text;
      width += glyph.width;
    }
    flush();
  }

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = TOP;
    if (logo) {
      const scale = Math.min(100 / logo.width, 28 / logo.height);
      page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 28, width: logo.width * scale, height: logo.height * scale });
    } else {
      page.drawText("Energética", { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 16, size: 14, font: bold, color: rgb(...ink) });
    }
    page.drawLine({ start: { x: MARGIN, y: TOP + 9 }, end: { x: PAGE_WIDTH - MARGIN, y: TOP + 9 }, thickness: 0.5, color: rgb(0.8, 0.83, 0.86) });
  }

  function renderText(runs, size, heading = false, background = null) {
    const leading = size * 1.35;
    const lines = wrapRuns(runs, size, CONTENT_WIDTH, heading);
    const fill = color(background, [1, 1, 1]);
    for (const line of lines) {
      if (y - leading < BOTTOM) addPage();
      if (background) page.drawRectangle({ x: MARGIN, y: y - leading, width: CONTENT_WIDTH, height: leading, color: rgb(...fill) });
      drawLine(line, MARGIN, y - size, size, fill);
      y -= leading;
    }
    y -= heading ? 8 : 5;
  }

  function layoutTable(block) {
    const total = block.widths.reduce((sum, width) => sum + width, 0);
    const edges = [MARGIN];
    for (const fraction of block.widths) edges.push(edges.at(-1) + CONTENT_WIDTH * fraction / total);
    return block.rows.map(row => {
      const cells = row.cells.map(cell => {
        const x = edges[cell.column];
        const width = edges[cell.column + cell.colSpan] - x;
        const padding = Math.min(CELL_PADDING, width / 8);
        return { ...cell, x, width, padding, lines: wrapRuns(cell.runs, TABLE_SIZE, width - 2 * padding, row.header) };
      });
      const length = Math.max(1, ...cells.map(cell => cell.lines.length));
      return { header: row.header, cells, length, height: length * TABLE_LEADING + 2 * CELL_PADDING };
    });
  }

  function drawRowSlice(row, offset, length) {
    const height = length * TABLE_LEADING + 2 * CELL_PADDING;
    for (const cell of row.cells) {
      const background = color(cell.background || (row.header ? [0.92, 0.95, 0.97] : [1, 1, 1]), [1, 1, 1]);
      page.drawRectangle({ x: cell.x, y: y - height, width: cell.width, height,
        color: rgb(...background), borderColor: rgb(0.78, 0.81, 0.85), borderWidth: 0.4 });
      for (let index = 0; index < length; index++) {
        const line = cell.lines[offset + index];
        if (!line) continue;
        const lineWidth = line.reduce((sum, glyph) => sum + glyph.width, 0);
        let x = cell.x + cell.padding;
        if (cell.align === "right") x = cell.x + cell.width - cell.padding - lineWidth;
        else if (cell.align === "center") x = cell.x + (cell.width - lineWidth) / 2;
        drawLine(line, x, y - CELL_PADDING - TABLE_SIZE - index * TABLE_LEADING, TABLE_SIZE, background);
      }
    }
    y -= height;
  }

  function renderTable(block) {
    const rows = layoutTable(block);
    const headers = [];
    for (const row of rows) { if (!row.header) break; headers.push(row); }
    const capacity = TOP - BOTTOM;
    const headerHeight = headers.reduce((sum, row) => sum + row.height, 0);
    // Replay complete headers when they leave room for a body line. Oversized
    // header groups are themselves streamed in full, without recursive replay.
    // This keeps pagination finite even for a header taller than a whole page.
    const replayHeaders = () => {
      for (const row of headers) renderRow(row, false);
      if (y - BOTTOM < TABLE_LEADING + 2 * CELL_PADDING) addPage();
    };
    const nextPage = repeat => { addPage(); if (repeat) replayHeaders(); };
    function renderRow(row, repeat) {
      const freshSpace = capacity - (repeat && headerHeight < capacity ? headerHeight : 0);
      if (row.height <= freshSpace && row.height > y - BOTTOM) nextPage(repeat);
      let offset = 0;
      while (offset < row.length) {
        let available = Math.floor((y - BOTTOM - 2 * CELL_PADDING) / TABLE_LEADING);
        if (available < 1) {
          nextPage(repeat);
          available = Math.floor((y - BOTTOM - 2 * CELL_PADDING) / TABLE_LEADING);
        }
        const count = Math.min(available, row.length - offset);
        drawRowSlice(row, offset, count);
        offset += count;
      }
    }
    for (let index = 0; index < rows.length; index++) renderRow(rows[index], index >= headers.length && headers.length > 0);
    y -= 8;
  }

  pdf.setTitle(safeText(snapshot.title).replace(/\n/g, " "));
  pdf.setCreator("Energética");
  addPage();
  renderText([{ text: snapshot.title, bold: true, color: ink }], 18, true);
  for (const filter of snapshot.filters) renderText([{ text: `${filter.label}: ${filter.value}`, color: ink }], 9);
  for (let index = 0; index < snapshot.pages.length; index++) {
    const blocks = snapshot.pages[index].blocks;
    if (index > 0 && blocks.length) addPage();
    for (const block of blocks) {
      if (block.type === "text") renderText(block.runs, block.heading ? 13 : 10, block.heading, block.background);
      else renderTable(block);
    }
  }
  const pages = pdf.getPages();
  for (let index = 0; index < pages.length; index++) {
    const label = `Página ${index + 1} / ${pages.length}`;
    pages[index].drawText(label, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(label, 8), y: 22, font: regular, size: 8, color: rgb(...ink) });
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
