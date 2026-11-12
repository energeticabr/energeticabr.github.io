import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('NF-e with XML pending uses the matching DANFE to classify and filter CNO', { timeout:90000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, cacheDir:'node_modules/.vite-nfe-report-cno-pdf',
    optimizeDeps:{ noDiscovery:true, force:true, include:['decimal.js', 'pdf-lib', 'pdfjs-dist'] },
    server:{ host:'127.0.0.1', port:0, hmr:false, watch:null, fs:{allow:[resolve(root, '../..')]} }, logLevel:'silent' });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-report-cno-pdf.html`;
    const { stdout } = await runBrowserLayout(browser, { width:390, height:844, url });
    const dom = new JSDOM(stdout);
    try {
      const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
      assert.equal(state.error, undefined);
      assert.deepEqual(state.notes, {
        '1':'CNO consta90.025.44060/72',
        '2':'CNO não consta',
        '3':'CNO divergente90.025.44069/72',
        '4':'CNO inválido90.025.4406/72 · CNO correto da obra: 90.025.44060/72',
        '5':null, '6':null, '7':null, '8':null,
        '9':null, '10':'CNO não consta', '11':'CNO consta90.025.44060/72', '12':null,
      });
      assert.equal(state.xmlPending, true);
      assert.deepEqual(state.filters, { missing:['10','2'], valid:['1','11'], conflict:['3','4'] });
    } finally { dom.window.close(); }
  } finally { await server.close(); }
});

test('NF-e PDFs use the compact DDA viewport and navigate between the DANFE and correction', { timeout:120000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, cacheDir:'node_modules/.vite-nfe-report-pdf',
    optimizeDeps:{ noDiscovery:true, force:true, include:['decimal.js', 'pdf-lib', 'pdfjs-dist'] },
    server:{ host:'127.0.0.1', port:0, hmr:false, watch:null, fs:{allow:[resolve(root, '../..')]} }, logLevel:'silent' });
  const capture = process.env.NFE_PDF_CAPTURE_DIR;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-report-pdf.html`;
    for (const [width,height] of [[844,390],[320,568],[390,844],[1365,900]]) {
      const { stdout, screenshot } = await runBrowserLayout(browser, { width, height, url, captureScreenshot:Boolean(capture) });
      const dom = new JSDOM(stdout);
      const state = JSON.parse(dom.window.document.documentElement.dataset.layout);
      dom.window.close();
      const details = JSON.stringify({ width, height, state });
      assert.equal(state.error, undefined, details);
      assert.ok(state.widthRatio >= .95, details);
      assert.ok(state.heightRatio >= .60, details);
      for (const field of ['compact', 'fits', 'danfe', 'correction', 'backToDanfe', 'reportPreserved', 'singleNoArrows', 'exportErrorVisible']) {
        assert.equal(state[field], true, `${field} ${details}`);
      }
      assert.equal(state.count, '1 de 2', details);
      if (screenshot) {
        mkdirSync(capture, {recursive:true});
        writeFileSync(join(capture, `nfe-pdf-${width}.png`), screenshot);
      }
    }
  } finally { await server.close(); }
});

test('NFE opens the horizontal fiscal table from the blue mascot in portrait and landscape', { timeout:90000 }, async t => {
  const browser = [process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const server = await createServer({ root, cacheDir:'node_modules/.vite-nfe-report',
    optimizeDeps:{ noDiscovery:true, force:true, include:['decimal.js'] },
    server:{ host:'127.0.0.1', port:0, hmr:false, watch:null, fs:{allow:[resolve(root, '../..')]} }, logLevel:'silent' });
  const capture = process.env.NFE_CAPTURE_DIR;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/nfe-report.html`;
    for (const [width,height] of [[320,568],[390,844],[844,390],[1365,900]]) {
      const result = await runBrowserLayout(browser, { width, height, url, captureScreenshot:Boolean(capture) });
      const dom = new JSDOM(result.stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(layout.error, undefined);
        const { provisions, orange, sicoob, nfe, dda, open, rowIds, overflow, tableScrolls, rotated, mei, pdfOnLeft, metricsAbove,
          headerControls, amountFits, pdfIconWidth, pdfTargetHeight, reportBodyWidth, availableReportWidth, overlayArrows,
          filterNames, filtersFit, taxHeading, taxStacked, invalidCno, pencilHeight
        } = layout;
        assert.equal(provisions.y, orange.y);
        assert.equal(orange.x - provisions.x, 56);
        assert.equal(nfe.x, provisions.x);
        assert.equal(sicoob.y - provisions.y, 68);
        assert.equal(nfe.y - sicoob.y, 56);
        assert.equal(dda.y - nfe.y, 56);
        assert.deepEqual({ open, rowIds, overflow, mei }, { open:true, rowIds:['2','3'], overflow:false, mei:true });
        assert.equal(rotated, height > width);
        assert.equal(reportBodyWidth, availableReportWidth, 'the report uses the width behind the navigation arrows');
        assert.equal(overlayArrows, 2);
        assert.equal(tableScrolls, width === 320);
        assert.equal(pdfOnLeft, true);
        assert.equal(metricsAbove, true);
        assert.equal(headerControls, true);
        assert.deepEqual(layout.overflowingHeadings, [], `table headings fit their columns at ${width}px`);
        assert.equal(amountFits, true, 'a long amount stays inside its column');
        assert.equal(layout.regularAmountSingleLine, true, `a typical amount fits on one line at ${width}px`);
        for (const highlight of layout.highlights) {
          assert.ok(highlight?.visible && highlight.textFits && highlight.cellFits, `card at ${width}px: ${JSON.stringify(highlight)}`);
        }
        const { red, otherRetentionRed, regimeRed, text } = layout.retentionHighlight;
        assert.deepEqual({ red, otherRetentionRed, regimeRed }, { red:true, otherRetentionRed:false, regimeRed:false });
        assert.match(text, /Retenção informada.*Pelo comprador.*R\$\s*15,00/);
        assert.equal(pdfIconWidth, 34);
        assert.ok(pdfTargetHeight >= 44);
        assert.deepEqual(filterNames, ['document', 'retention', 'cno', 'regime']);
        assert.equal(filtersFit, true);
        assert.equal(taxHeading, 'TIPO FORNECEDOR/ RETENÇÃO');
        assert.equal(taxStacked, true);
        assert.match(invalidCno ?? '', /CNO inválido.*90\.025\.4406\/72/);
        assert.ok(pencilHeight >= 44);
        assert.equal(layout.directProposalBelow, true, 'proposal shortcut sits below the pencil');
        assert.ok(layout.directProposalHeight >= 44, 'proposal shortcut has a touch target');
        assert.equal(layout.proposalLabelFits, true, `proposal label fits at ${width}px`);
        const { orangeTargetHeight, ...orderLink } = JSON.parse(dom.window.document.documentElement.dataset.orderLink);
        assert.ok(orangeTargetHeight >= 44);
        assert.deepEqual(orderLink, {
          orangePencilBelow:true, orangeColor:'rgb(164, 75, 5)',
          pickerFits:true, reviewFits:true, linked:'ID 32', remainingPencils:1,
          proposePosition:true, proposalFits:true, proposalSubmitFits:true,
          proposalScroll:width !== 1365, changedStage:'26', pickerRestored:true,
          insideKeepsPicker:true, dragKeepsPicker:true, capturedDragKeepsPicker:true,
          pickerBackdropCloses:true, proposalBackdropCloses:true,
          insideKeepsReview:true, reviewBackdropCloses:true,
          pickerResults:{ supplierId:true, branchId:true, accountId:true, productId:true, stageId:true },
        });
        assert.deepEqual(JSON.parse(dom.window.document.documentElement.dataset.meiRows), ['3']);
        if (capture) {
          mkdirSync(capture, {recursive:true});
          writeFileSync(join(capture, `nfe-${width}.png`), result.screenshot);
        }
      } finally { dom.window.close(); }
    }
    const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15';
    for (const [width,height,safeAreaInsets,safeTop,safeLeft,safeRight] of [
      [390,844,{top:72,bottom:34},80,10,10],
      [320,568,{top:0,bottom:0},68,10,10],
      [393,852,{top:0,bottom:0},68,10,10],
      [844,390,{left:74,right:74,bottom:21},10,82,82],
      [852,393,{left:0,right:0},10,68,68],
    ]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, url, mobile:true, safeAreaInsets, userAgent });
      const dom = new JSDOM(stdout);
      try {
        const { proposalBackdropCloses, pickerResults } = JSON.parse(dom.window.document.documentElement.dataset.orderLink);
        const bounds = JSON.parse(dom.window.document.documentElement.dataset.proposalBounds);
        assert.equal(bounds.length, 7, 'proposal, submit and all five dropdowns');
        for (const rect of bounds) {
          const info = JSON.stringify({width,height,safeAreaInsets,rect});
          assert.ok(rect.width > 0 && rect.height > 0, info);
          assert.ok(rect.y >= safeTop - 1 && rect.x >= safeLeft - 1, info);
          assert.ok(rect.bottom <= height - Math.max(10, (safeAreaInsets.bottom || 0) + 8) + 1, info);
          assert.ok(rect.right <= width - safeRight + 1, info);
        }
        assert.equal(proposalBackdropCloses, true);
        assert.deepEqual(pickerResults, { supplierId:true, branchId:true, accountId:true, productId:true, stageId:true });
      } finally { dom.window.close(); }
    }
    if (capture) {
      const { screenshot } = await runBrowserLayout(browser, {width:390,height:844,url:`${url}?home`,captureScreenshot:true});
      writeFileSync(join(capture,'home-390.png'), screenshot);
    }
  } finally { await server.close(); }
});
