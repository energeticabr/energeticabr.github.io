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
      else if (block?.type === "cards") {
        if (!Array.isArray(block.rows) || block.rows.some(row => !Array.isArray(row) || !row.length)) invalid();
        for (const row of block.rows) for (const card of row) {
          if (!Number.isFinite(card?.width) || card.width <= 0 || !Number.isFinite(card.left) || card.left < 0
            || !Array.isArray(card.lines)) invalid();
          for (const line of card.lines) validateRuns(line.runs);
        }
      }
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
            if (cell.parts) {
              if (!Array.isArray(cell.parts)) invalid();
              for (const part of cell.parts) validateRuns(part.runs);
            }
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
    // Choose the highest-contrast ink against the rendered surface.
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

  function lineWidth(line) {
    return line.reduce((sum, glyph) => sum + glyph.width, 0);
  }

  function drawAligned(line, x, width, baseline, size, fill, align) {
    if (align === "center") x += (width - lineWidth(line)) / 2;
    else if (align === "right" || align === "end") x += width - lineWidth(line);
    drawLine(line, x, baseline, size, fill);
  }

  function drawBox(box, x, top, width, height, fill) {
    const border = box.border ? { borderColor: rgb(...color(box.border)), borderWidth: 0.6 } : {};
    const r = Math.max(0, Math.min(box.radius * 0.65 || 0, width / 2, height / 2));
    if (r) {
      const path = `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r}
        Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r}
        V ${r} Q 0 0 ${r} 0 Z`;
      page.drawSvgPath(path, { x, y: top, color: rgb(...fill), ...border });
    } else {
      page.drawRectangle({ x, y: top - height, width, height, color: rgb(...fill), ...border });
    }
    if (box.accent && height > 2 * r) {
      page.drawLine({ start: { x: x + 1.4, y: top - r }, end: { x: x + 1.4, y: top - height + r },
        thickness: 2.2, color: rgb(...color(box.accent)) });
    }
    if (box.topAccent && width > 2 * r) {
      page.drawLine({ start: { x: x + r, y: top - 1.4 }, end: { x: x + width - r, y: top - 1.4 },
        thickness: 2.2, color: rgb(...color(box.topAccent)) });
    }
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

  function renderCards(block) {
    const gap = 7, padding = 8;
    for (const row of block.rows) {
      if (row.some(card => CONTENT_WIDTH * Math.min(card.width, 1 - card.left) < 36)) {
        for (const card of row) for (const line of card.lines) renderText(line.runs, 10, false, card.box?.fill);
        continue;
      }
      const cards = row.map(card => {
        const width = CONTENT_WIDTH * Math.min(card.width, 1 - card.left);
        const lines = card.lines.flatMap(({ runs, size }) => {
          const points = Math.max(8, Math.min(15, Number(size) * 0.85 || 10));
          return wrapRuns(runs, points, width - 2 * padding).map(line => ({ line, points, leading: points * 1.3 }));
        });
        return { ...card, width, lines, height: lines.reduce((sum, line) => sum + line.leading, 2 * padding) };
      });
      const height = Math.max(...cards.map(card => card.height));
      if (height > TOP - BOTTOM) {
        for (const card of row) for (const line of card.lines) renderText(line.runs, 10, false, card.box?.fill);
        continue;
      }
      if (y - height < BOTTOM) addPage();
      for (const card of cards) {
        const x = MARGIN + card.left * CONTENT_WIDTH;
        const fill = color(card.box?.fill, [1, 1, 1]);
        if (card.box) drawBox(card.box, x, y, card.width, height, fill);
        let top = y - padding;
        for (const { line, points, leading } of card.lines) {
          drawAligned(line, x + padding, card.width - 2 * padding, top - points, points, fill, card.align);
          top -= leading;
        }
      }
      y -= height + gap;
    }
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
        const innerWidth = width - 2 * padding;
        let length = 0;
        const parts = (cell.parts || [{ runs: cell.runs }]).map(part => {
          const inset = part.box ? Math.max(0, Math.min(part.box.accent ? 5 : 4, (innerWidth - 12) / 2, innerWidth / 8)) : 0;
          const lines = wrapRuns(part.runs, TABLE_SIZE, innerWidth - 2 * inset, row.header);
          const partWidth = part.compact ? Math.min(innerWidth, Math.max(...lines.map(lineWidth)) + 2 * inset + 2) : innerWidth;
          const start = length;
          length += lines.length + (part.box ? 1 : 0);
          return { ...part, start, end: length, x: x + padding + (part.compact && part.centered ? (innerWidth - partWidth) / 2 : 0),
            width: partWidth, inset, lines };
        });
        return { ...cell, x, width, parts, length };
      });
      const length = Math.max(1, ...cells.map(cell => cell.length));
      return { header: row.header, cells, length, height: length * TABLE_LEADING + 2 * CELL_PADDING };
    });
  }

  function drawRowSlice(row, offset, length) {
    const height = length * TABLE_LEADING + 2 * CELL_PADDING;
    for (const cell of row.cells) {
      const background = color(cell.background || (row.header ? [0.92, 0.95, 0.97] : [1, 1, 1]), [1, 1, 1]);
      page.drawRectangle({ x: cell.x, y: y - height, width: cell.width, height,
        color: rgb(...background), borderColor: rgb(0.78, 0.81, 0.85), borderWidth: 0.4 });
      const middle = cell.verticalAlign === "middle" && length === row.length ? (row.length - cell.length) * TABLE_LEADING / 2 : 0;
      const top = y - CELL_PADDING - middle;
      for (const part of cell.parts) {
        const first = Math.max(part.start, offset);
        const last = Math.min(part.end, offset + length);
        if (first >= last || first >= part.start + part.lines.length) continue;
        const fill = color(part.box?.fill, background);
        const partTop = top - (first - offset) * TABLE_LEADING;
        const continued = last < part.end;
        if (part.box) drawBox(part.box, part.x, partTop, part.width, (last - first) * TABLE_LEADING - (continued ? 0 : 2), fill);
        const insetTop = part.box ? (continued ? 2 : 4) : 0;
        for (let index = first; index < last; index++) {
          const line = part.lines[index - part.start];
          if (!line) continue;
          const baseline = top - TABLE_SIZE - (index - offset) * TABLE_LEADING - insetTop;
          drawAligned(line, part.x + part.inset, part.width - 2 * part.inset, baseline, TABLE_SIZE, fill, part.centered ? "center" : cell.align);
        }
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
      else if (block.type === "cards") renderCards(block);
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
