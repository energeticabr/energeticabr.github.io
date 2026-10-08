import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
import {decorateReportPrint, captureFilteredReport, REPORT_PDF_TITLES} from '../src/ui/report-print.js';
import {decorateReportNavigation} from '../src/ui/report-navigation.js';
import {createAttachmentPreview} from '../src/web/attachment-preview.js';

const {createPendingWorkDiariesReportView} = await import('../src/ui/pending-work-diaries-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const action = 'open-pending-work-diaries-report';
const row = (id, extra = {}) => ({id:String(id), date:'2026-10-07T12:00:00Z', branch:'XAVANTE', status:'PENDENTE', ...extra});
const snapshot = {rows:[row(2), row(10), row(1)], count:3};
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, load = async () => snapshot, vertical = false, options = {}) {
  assert.equal(typeof createPendingWorkDiariesReportView, 'function', 'pending diaries report factory must exist');
  const dom = new JSDOM(`<main id="app"><button data-action="${action}">Abrir</button></main>`);
  let portrait = vertical;
  dom.window.matchMedia = () => ({get matches() {return portrait;}});
  const style = dom.window.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/ui/pending-work-diaries-report.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const view = createPendingWorkDiariesReportView({document:dom.window.document, data:{loadSnapshot:load}, ...options});
  t.after(() => {view.destroy(); dom.window.close();});
  return {view, root:view.element, dom, rotate(value) {portrait = value; dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
const ids = root => [...root.querySelectorAll('tbody tr')].map(node => node.cells[0].textContent);
const count = root => root.querySelector('tfoot tr').cells[1].textContent;

// Break caught: controller disposal must observe the hidden modal once, even if disposal destroys it.
test('onClose runs once after hiding and allows reentrant destruction', async t => {
  let closes = 0, view;
  const fixture = setup(t, undefined, false, {onClose() {
    closes++;
    assert.equal(view.element.hidden, true);
    view.destroy();
  }});
  view = fixture.view;
  await view.open();
  view.element.querySelector('.pwdr-close').click();
  view.close(); view.destroy();
  assert.equal(closes, 1);
  assert.equal(view.element.isConnected, false);
});

// Break caught: rendering source order or omitting the footer changes the visible report.
test('renders four centered columns, newest numeric ID first, official logo and merged pending footer', async t => {
  const {view, root, dom} = setup(t);
  assert.equal(root.hidden, true);
  await view.open();
  assert.deepEqual([...root.querySelectorAll('thead th')].map(node => node.textContent), ['ID','DATA','FILIAL','STATUS']);
  assert.deepEqual(ids(root), ['10','2','1']);
  assert.equal(root.querySelector('tbody tr').cells[1].textContent, '07/10/2026');
  const footer = root.querySelector('tfoot tr');
  assert.equal(footer.cells[0].colSpan, 3);
  assert.equal(footer.cells[0].textContent, 'CONTAGEM DE PENDENTES:');
  assert.equal(count(root), '3');
  assert.match(root.querySelector('.pwdr-brand img').src, /logo-energetica-oficial\.png$/);
  assert.equal(root.querySelectorAll('input,select,.pwdr-card').length, 0);
  const cellStyle = dom.window.getComputedStyle(root.querySelector('tbody td'));
  assert.equal(cellStyle.textAlign, 'center');
  assert.equal(cellStyle.fontSize, '12px');
  assert.equal(cellStyle.borderTopWidth, '3px');
  assert.equal(dom.window.getComputedStyle(root.querySelector('.pwdr-status')).color, 'rgb(176, 0, 32)');
  assert.equal(dom.window.getComputedStyle(footer.cells[1]).fontSize, '18px');
});

// Break caught: default cell styling loses the PowerFx visual hierarchy and pending footer emphasis.
test('computed table styles match PowerFx header, semibold rows and red right-aligned pending footer', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  const style = selector => dom.window.getComputedStyle(root.querySelector(selector));
  assert.equal(style('thead th').backgroundColor, 'rgb(230, 240, 255)');
  assert.equal(style('tbody td').fontWeight, '600');
  assert.equal(style('.pwdr-status').fontWeight, '700');
  assert.equal(style('.pwdr-status').color, 'rgb(176, 0, 32)');
  const label = style('.pwdr-count-label');
  assert.equal(label.color, 'rgb(176, 0, 32)');
  assert.equal(label.fontWeight, '700');
  assert.equal(label.textAlign, 'right');
  assert.equal(label.paddingTop, '12px');
  assert.equal(label.paddingBottom, '12px');
  assert.equal(label.paddingLeft, '8px');
  assert.equal(label.paddingRight, '8px');
  assert.equal(label.fontSize, '13px');
  assert.equal(style('.pwdr-count').color, 'rgb(176, 0, 32)');
  assert.equal(style('.pwdr-count').fontSize, '18px');
  assert.equal(style('.pwdr-count').fontWeight, '700');
});

// Break caught: innerHTML would interpret source strings as executable markup.
test('renders branch text literally without creating injected elements', async t => {
  const {view, root} = setup(t, async () => ({rows:[row(1, {branch:'<img src=x onerror=alert(1)><script>bad()</script>'})], count:1}));
  await view.open();
  assert.equal(root.querySelector('tbody tr').cells[2].textContent, '<img src=x onerror=alert(1)><script>bad()</script>');
  assert.equal(root.querySelectorAll('img').length, 1);
  assert.equal(root.querySelector('script'), null);
});

// Break caught: an exact count at the source boundary would assert a false total.
test('shows the source boundary warning and caps the rendered table at 2000 newest rows', async t => {
  for (const size of [2000, 2001]) {
    const {view, root} = setup(t, async () => ({rows:Array.from({length:size}, (_, i) => row(i + 1)), count:size}));
    await view.open();
    assert.equal(ids(root).length, 2000);
    assert.equal(ids(root)[0], String(size));
    assert.equal(ids(root).at(-1), String(size - 1999));
    assert.equal(count(root), '⚠️ > 2.000');
  }
});

// Break caught: a failed refresh that leaves an old table or displays zero permits misleading PDFs.
test('refresh gates capture, clears stale rows on failure and retry restores the report', async t => {
  let reads = 0, rejectRefresh;
  const {view, root} = setup(t, () => {
    reads++;
    return reads === 2 ? new Promise((resolve, reject) => {rejectRefresh = reject;}) : Promise.resolve(snapshot);
  });
  await view.open();
  root.querySelector('.pwdr-refresh').click();
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('.pwdr-refresh').disabled, true);
  assert.deepEqual(ids(root), []);
  assert.throws(() => captureFilteredReport(root), /Aguarde/);
  rejectRefresh(new Error('offline'));
  await tick();
  assert.match(root.querySelector('[role="alert"]').textContent, /Não foi possível/);
  assert.equal(root.querySelector('tfoot'), null);
  assert.equal(root.getAttribute('aria-busy'), 'false');
  assert.throws(() => captureFilteredReport(root), /Não foi possível/);
  root.querySelector('.pwdr-retry').click();
  await tick();
  assert.deepEqual(ids(root), ['10','2','1']);
  assert.equal(count(root), '3');
});

// Break caught: malformed snapshots must not be treated as a successful empty response.
test('empty results show zero while incomplete or invalid results show an alert', async t => {
  const empty = setup(t, async () => ({rows:[], count:0}));
  await empty.view.open();
  assert.equal(count(empty.root), '0');
  assert.equal(empty.root.querySelector('tbody').rows.length, 0);
  for (const value of [null, {rows:snapshot.rows, count:3, complete:false}]) {
    const failed = setup(t, async () => value);
    await failed.view.open();
    assert.ok(failed.root.querySelector('[role="alert"]'));
    assert.equal(failed.root.querySelector('tfoot'), null);
  }
});

// Break caught: stale reads after close/reopen or destroy can leak an obsolete snapshot.
test('close and destroy abort requests and stale results cannot overwrite a newer opening', async t => {
  const requests = [];
  const {view, root, dom} = setup(t, ({signal}) => new Promise(resolve => requests.push({signal, resolve})));
  const first = view.open();
  view.close();
  assert.equal(requests[0].signal.aborted, true);
  const second = view.open();
  requests[1].resolve({rows:[row(99)], count:1});
  await second;
  requests[0].resolve(snapshot);
  await first;
  assert.deepEqual(ids(root), ['99']);
  root.querySelector('.pwdr-refresh').click();
  view.destroy();
  assert.equal(requests[2].signal.aborted, true);
  requests[2].resolve(snapshot);
  await tick();
  assert.equal(root.isConnected, false);
  assert.deepEqual(ids(root), []);
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(requests.length, 3);
  await assert.rejects(view.open(), /encerrado/);
});

// Break caught: portrait reads and late portrait writes violate the horizontal-only report flow.
test('portrait waits for landscape and rotation cancels unfinished loads', async t => {
  const requests = [];
  const {view, root, rotate} = setup(t, ({signal}) => new Promise(resolve => requests.push({signal, resolve})), true);
  await view.open();
  assert.equal(requests.length, 0);
  assert.equal(root.querySelector('.pwdr-orientation').hidden, false);
  assert.throws(() => captureFilteredReport(root), /Aguarde/);
  rotate(false);
  assert.equal(requests.length, 1);
  rotate(true);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(snapshot);
  await tick();
  assert.deepEqual(ids(root), []);
  rotate(false);
  requests[1].resolve({rows:[row(8)], count:1});
  await tick();
  assert.deepEqual(ids(root), ['8']);
});

// Break caught: clearing loaded rows on rotation would discard the PDF return state.
test('loaded landscape rows survive rotation without an unnecessary refetch', async t => {
  let reads = 0;
  const {view, root, rotate} = setup(t, async () => {reads++; return snapshot;});
  await view.open();
  const table = root.querySelector('table');
  root.querySelector('.pwdr-content').scrollTop = 123;
  rotate(true);
  assert.equal(root.querySelector('.pwdr-report').hidden, true);
  rotate(false);
  await tick();
  assert.equal(reads, 1);
  assert.equal(root.querySelector('table'), table);
  assert.equal(root.querySelector('.pwdr-content').scrollTop, 123);
});

// Break caught: losing old inert/overflow state or retaining a detached HOME target traps users.
test('close restores overflow, prior inert state and the current HOME trigger after rerender', async t => {
  const {view, root, dom} = setup(t);
  const doc = dom.window.document, app = doc.getElementById('app');
  app.inert = true;
  doc.body.style.overflow = 'auto';
  const old = app.querySelector('button');
  old.focus();
  await view.open();
  assert.equal(doc.body.style.overflow, 'hidden');
  const replacement = doc.createElement('button');
  replacement.dataset.action = action;
  old.replaceWith(replacement);
  root.querySelector('.pwdr-close').click();
  assert.equal(root.hidden, true);
  assert.equal(app.inert, true);
  assert.equal(doc.body.style.overflow, 'auto');
  assert.equal(doc.activeElement, replacement);
});

// Break caught: Tab escaping the modal or treating internal clicks as backdrop closes the report.
test('traps focus including decorator controls and closes only on Escape or backdrop', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  const doc = dom.window.document, panel = root.querySelector('[role="dialog"]'), content = root.querySelector('.pwdr-content');
  const decorated = decorateReportNavigation(view, {action});
  t.after(() => decorated.destroy());
  const navigation = root.querySelector('.report-navigation');
  assert.equal(navigation.parentElement, panel);
  assert.equal(content.contains(navigation), false);
  const nav = navigation.querySelector('button');
  nav.focus();
  nav.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
  assert.equal(doc.activeElement, root.querySelector('.pwdr-refresh'));
  doc.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true, cancelable:true}));
  assert.equal(doc.activeElement, nav);
  content.click();
  assert.equal(root.hidden, false);
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(root.hidden, true);
  await view.open();
  root.click();
  assert.equal(root.hidden, true);
  assert.equal(doc.getElementById('app').inert, false);
});

// Break caught: incorrect PDF DOM capture loses status color, merged count cells or includes toolbar text.
test('PDF capture preserves four columns, red status, literal branches and merged count footer', async t => {
  const {view, root} = setup(t);
  await view.open();
  const captured = captureFilteredReport(root, {title:'Diários de obras pendentes'});
  assert.deepEqual(captured.filters, []);
  const table = captured.pages[0].blocks.find(block => block.type === 'table');
  assert.equal(table.widths.length, 4);
  assert.deepEqual(table.rows[1].cells.map(cell => cell.runs.map(run => run.text).join('')), ['10','07/10/2026','XAVANTE','PENDENTE']);
  assert.deepEqual(table.rows[1].cells[3].runs[0].color, [176/255,0,32/255]);
  assert.equal(table.rows.at(-1).cells[0].colSpan, 3);
  assert.equal(table.rows.at(-1).cells[1].runs[0].text, '3');
  assert.equal(table.rows.at(-1).cells[1].runs[0].bold, true);
});

// Break caught: refresh/portrait state must disable PDF, and PDF return must retain the loaded report.
test('real print decorator gates busy/failure and PDF rotation returns to the same loaded rows', async t => {
  assert.ok(REPORT_PDF_TITLES[action], 'main must register the pending diaries PDF title');
  let reads = 0, captured;
  const {view, root, dom, rotate} = setup(t, async () => {reads++; if (reads === 2) throw new Error('offline'); return snapshot;});
  const preview = createAttachmentPreview({documentRef:dom.window.document, loadPdfPreview:async () => ({createPdfPreview:() => ({element:dom.window.document.createElement('canvas'), render:async () => {}, destroy(){}})})});
  const decorated = decorateReportPrint(view, {action, previewMedia:preview.open, closePreview:preview.close,
    loadLogo:async () => undefined, buildPdf:async value => {captured = value; return new Blob(['%PDF-test'], {type:'application/pdf'});}});
  t.after(() => {decorated.destroy(); preview.destroy();});
  await decorated.open();
  await tick();
  const pair = root.querySelector('.pwdr-toolbar .report-print-actions');
  assert.ok(pair);
  const print = pair.querySelector('.report-print-button');
  assert.equal(print.disabled, false);
  const table = root.querySelector('table');
  print.click();
  await tick(); await tick();
  assert.equal(dom.window.document.querySelector('.attachment-preview-dialog').open, true);
  assert.equal(captured.title, REPORT_PDF_TITLES[action]);
  rotate(true); rotate(false);
  await tick();
  dom.window.document.querySelector('.attachment-preview-close').click();
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector('table'), table);
  assert.equal(reads, 1);
  assert.equal(dom.window.document.activeElement, print);
  pair.querySelector('.pwdr-refresh').click();
  await tick();
  assert.equal(print.disabled, true);
  root.querySelector('.pwdr-retry').click();
  await tick();
  assert.equal(print.disabled, false);
});

// Break caught: oversized navigation gutters or duplicated safe areas waste report width.
test('report fills horizontal phone and tablet width with readable table and toolbar', {timeout:180000}, async t => {
  assert.equal(typeof createPendingWorkDiariesReportView, 'function');
  assert.ok(REPORT_PDF_TITLES[action], 'main must register the pending diaries PDF title');
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({root:resolve(fileURLToPath(new URL('..', import.meta.url))), server:{host:'127.0.0.1', port:0}, logLevel:'silent'});
  try {
    await server.listen();
    for (const [width,height,safeAreaInsets] of [[667,375],[844,390],[844,390,{left:47,right:47}],[844,390,{left:47,right:0}],[1024,768],[1280,800],[1920,1080]]) {
      const {stdout} = await runBrowserLayout(browser, {width, height, safeAreaInsets, url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/pending-work-diaries-report-browser.html`});
      const dom = new JSDOM(stdout);
      try {
        const result = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(result.error, undefined, JSON.stringify(result));
        assert.equal(result.rows, 30);
        assert.equal(result.columns, 4);
        assert.equal(result.footerSpan, 3);
        assert.ok(result.logoLoaded);
        assert.ok(result.documentOverflow <= 1, JSON.stringify(result));
        assert.ok(result.contentOverflow <= 1, JSON.stringify(result));
        assert.ok(result.toolbarOverflow <= 1, JSON.stringify(result));
        assert.ok(Math.abs(result.dialog.left - Math.max(8, safeAreaInsets?.left || 0)) <= 1, JSON.stringify(result));
        assert.ok(Math.abs(result.dialog.right - (width - Math.max(8, safeAreaInsets?.right || 0))) <= 1, JSON.stringify(result));
        assert.ok(result.tableWidth >= result.dialog.width - (height <= 500 ? 70 : 80), JSON.stringify(result));
        assert.ok(result.tableLeft >= result.arrowRight + 4, 'previous arrow must not obscure IDs: ' + JSON.stringify(result));
        assert.ok(result.tableLeft <= result.arrowRight + 8, 'previous arrow gutter must stay compact: ' + JSON.stringify(result));
        assert.ok(result.content.right - result.tableRight <= 16, 'no unused next-arrow gutter: ' + JSON.stringify(result));
        assert.ok(Math.abs(result.brand.left - result.tableLeft) <= 1 && Math.abs(result.brand.right - result.tableRight) <= 1, JSON.stringify(result));
        assert.equal(result.arrows.length, 1, 'last report retains only its previous arrow');
        assert.ok(Math.abs(result.arrows[0].top + result.arrows[0].height / 2 - height / 2) <= 1, 'arrow stays vertically centered');
        assert.ok(result.contentHeight > 100, JSON.stringify(result));
        assert.ok(result.contentScrollHeight > result.contentHeight);
        assert.equal(result.fontSize, '12px');
        assert.deepEqual(result.styles, {
          headerBackground:'rgb(230, 240, 255)', rowWeight:'600', statusWeight:'700', statusColor:'rgb(176, 0, 32)',
          labelColor:'rgb(176, 0, 32)', labelWeight:'700', labelAlign:'right', labelPadding:'12px 8px', labelSize:'13px',
          countColor:'rgb(176, 0, 32)', countSize:'18px', countWeight:'700',
        });
        const [printer,refresh] = result.buttons;
        assert.ok(printer.width >= 40 && printer.height >= 44);
        assert.ok(refresh.left >= printer.right && Math.abs(refresh.top - printer.top) <= 1);
      } finally {dom.window.close();}
    }
  } finally {await server.close();}
});
