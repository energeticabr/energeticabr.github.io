import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {captureFilteredReport} from '../src/ui/report-print.js';

const {createGeneralSummaryReportView} = await import('../src/ui/general-summary-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('general-summary-report-view.js')) return {};
  throw error;
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const snapshot = () => ({metrics:{dueToday:3, overdue:4, auditOrders:5, quotes:6, documents:7,
  pendingTasks:8, delegatedTasks:9, activeContracts:10, pendingPayments:12345.67,
  pendingDiaries:11, commercialDocuments:12, activePathologies:13},
today:'2026-10-08', updatedAt:'2026-10-08T13:45:00.000Z', warnings:[]});
function setup(t, {loadReport = async () => snapshot(), onClose = () => {}, onHome = () => {}} = {}) {
  assert.equal(typeof createGeneralSummaryReportView, 'function', 'standalone summary view must be exported');
  const dom = new JSDOM('<main id="app"><button id="trigger" data-action="open-general-summary-report">Abrir</button></main><button id="outside">Fora</button>');
  const doc = dom.window.document;
  const view = createGeneralSummaryReportView({document:doc, data:{loadReport}, onClose, onHome});
  t.after(() => {view.destroy(); dom.window.close();});
  return {view, root:view.element, doc, dom};
}
const metric = (root, name) => root.querySelector(`[data-metric="${name}"]`);
const refresh = root => root.querySelector('[aria-label="Atualizar resumo geral"]');
const capturedText = root => JSON.stringify(captureFilteredReport(root, {title:'Resumo geral'}));

// Break: valid Decimal transport strings are rejected or nondecimal strings are silently coerced to zero.
test('decimal payment strings print as BRL while malformed payment strings fail closed', async t => {
  for (const [amount, expected] of [['7303.00', 'R$ 7.303,00'], ['0.00', 'R$ 0,00']]) {
    const value = snapshot(); value.metrics.pendingPayments = amount;
    const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
    assert.equal(metric(root, 'pendingPayments').textContent.replace(/\u00a0/g, ' '), expected);
    (await view.preparePrint())();
  }
  for (const amount of ['', ' ', 'Infinity', '7.303,00', '0x10', 'garbage']) {
    const value = snapshot(); value.metrics.pendingPayments = amount;
    const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
    await assert.rejects(view.preparePrint()); assert.equal(metric(root, 'pendingPayments').textContent, '—');
  }
});

// Break: legitimate credits in the raw SUM invalidate every indicator instead of displaying signed BRL.
test('negative payment totals remain signed in both the report and printable content', async t => {
  for (const amount of [-123.45, '-123.45']) {
    const value = snapshot(); value.metrics.pendingPayments = amount;
    const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
    assert.equal(metric(root, 'pendingPayments').textContent.replace(/\u00a0/g, ' '), '-R$ 123,45');
    assert.equal(metric(root, 'dueToday').textContent, '3');
    const restore = await view.preparePrint(); assert.ok(capturedText(root).includes('123,45')); restore();
  }
});

// Break: a source metric is swapped, omitted, formatted as USD, or turned into a navigation button.
test('renders twelve source metrics in their groups with Brazilian counts and currency', async t => {
  const {view, root} = setup(t);
  await view.open();
  assert.equal(root.querySelector('h1').textContent, 'Resumo geral');
  assert.deepEqual([...root.querySelectorAll('h2')].map(n => n.textContent),
    ['FINANCEIRO / COMPRAS', 'DOCUMENTOS', 'TAREFAS', 'OBRAS / RH', 'COMERCIAL']);
  assert.deepEqual([...root.querySelectorAll('dt')].map(n => n.textContent),
    ['VENCIMENTOS HOJE', 'PGTOS VENCIDOS', 'PEDIDOS PEND. AUDITORIA', 'ORÇAMENTOS PENDENTES',
      'DOCUMENTOS PENDENTES', 'TAREFAS PENDENTES', 'DELEGADAS PENDENTES', 'CONTRATOS ATIVOS',
      'VALOR TOTAL PEND. PGTO', 'DIÁRIOS DE OBRA PENDENTES', 'DOCUMENTOS PENDENTES', 'PATOLOGIAS ATIVAS']);
  assert.deepEqual([...root.querySelectorAll('dd')].map(n => n.textContent.replace(/\u00a0/g, ' ')),
    ['3', '4', '5', '6', '7', '8', '9', '10', 'R$ 12.345,67', '11', '12', '13']);
  assert.equal(root.querySelectorAll('.gsr-group button,.gsr-group a').length, 0);
  assert.equal(root.querySelectorAll('img').length, 1);
  assert.match(root.querySelector('img').src, /assets\/logo-energetica-oficial\.png$/);
  assert.match(root.querySelector('.gsr-meta').textContent, /08\/10\/2026/);
  assert.equal(root.querySelector('time').dateTime, '2026-10-08T13:45:00.000Z');
  const capture = capturedText(root);
  for (const label of ['VENCIMENTOS HOJE', 'VALOR TOTAL PEND. PGTO', 'PATOLOGIAS ATIVAS']) assert.ok(capture.includes(label));
  assert.ok(capture.includes('12.345,67'));
});

// Break: opening in portrait defers the query or substitutes fake zeroes before it finishes.
test('portrait loads immediately and shows dashes until the actual snapshot arrives', async t => {
  const pending = deferred();
  const {view, root, dom} = setup(t, {loadReport:() => pending.promise});
  dom.window.matchMedia = () => ({matches:true});
  const opening = view.open();
  await tick();
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute('aria-busy'), 'true');
  assert.deepEqual([...root.querySelectorAll('dd')].map(n => n.textContent), Array(12).fill('—'));
  assert.equal(root.querySelector('[class*="orientation"]'), null);
  assert.throws(() => captureFilteredReport(root));
  pending.resolve(snapshot()); await opening;
  assert.equal(metric(root, 'dueToday').textContent, '3');
  assert.equal(root.getAttribute('aria-busy'), 'false');
});

// Break: unavailable and genuine zero are conflated, or warning text never reaches the PDF collector.
test('explicit unavailable metrics keep dashes and warnings inside printable content', async t => {
  const value = snapshot(); value.metrics.documents = null; value.metrics.dueToday = 0;
  value.warnings = ['DOCUMENTOS indisponíveis: consulta incompleta.'];
  const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
  assert.equal(metric(root, 'documents').textContent, '—');
  assert.match(metric(root, 'documents').getAttribute('aria-label'), /indisponível/i);
  assert.match(metric(root, 'documents').parentElement.textContent, /Indisponível/);
  assert.equal(metric(root, 'dueToday').textContent, '0');
  const restore = await view.preparePrint();
  assert.ok(root.querySelector('.gsr-content').contains(root.querySelector('.gsr-warnings')));
  assert.equal(root.querySelector('.gsr-warnings').hidden, false);
  assert.ok(capturedText(root).includes('DOCUMENTOS indisponíveis: consulta incompleta.'));
  restore();
});

// Break: malformed metrics or absent warnings are accepted as a complete printable report.
test('invalid snapshots fail closed with no old metric values available for capture', async t => {
  const invalid = [
    value => {delete value.metrics.documents;},
    value => {value.metrics.documents = undefined;},
    value => {value.metrics.documents = null;},
    value => {value.metrics.dueToday = '3';},
    value => {value.metrics.quotes = NaN;},
    value => {value.metrics.pendingPayments = Infinity;},
    value => {value.metrics.overdue = -1;},
    value => {value.metrics.activeContracts = 1.5;},
    value => {value.metrics.pendingTasks = Number.MAX_SAFE_INTEGER + 1;},
    value => {value.warnings = null;},
    value => {value.warnings = [{}];},
    value => {value.metrics.documents = null; value.warnings = ['   '];},
    value => {value.today = '2026-02-30';},
    value => {value.updatedAt = 'yesterday';},
  ];
  for (const mutate of invalid) {
    const value = snapshot(); mutate(value);
    const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
    await assert.rejects(view.preparePrint());
    assert.throws(() => captureFilteredReport(root));
    assert.ok([...root.querySelectorAll('dd')].every(n => n.textContent === '—'));
    assert.match(root.querySelector('[role="alert"]').textContent, /Não foi possível/);
  }
});

// Break: repeating open or clicking refresh during a load aborts it or starts redundant requests.
test('open and refresh coalesce while a single current request is running', async t => {
  const pending = deferred(); let calls = 0, signal;
  const {view, root} = setup(t, {loadReport:options => {calls++; signal = options.signal; return pending.promise;}});
  const first = view.open(), second = view.open(); await tick();
  refresh(root).click(); refresh(root).click(); await tick();
  assert.equal(calls, 1); assert.equal(signal.aborted, false);
  let secondSettled = false; void second.then(() => {secondSettled = true;}); await tick();
  assert.equal(secondSettled, false);
  pending.resolve(snapshot()); await Promise.all([first, second]);
  assert.equal(metric(root, 'quotes').textContent, '6');
});

// Break: preparePrint returns the previous snapshot or refuses rather than waiting for the current load.
test('preparePrint waits for the current successful load and captures its warnings', async t => {
  const pending = deferred(); const {view, root} = setup(t, {loadReport:() => pending.promise});
  const opening = view.open(); let settled = false;
  const printing = view.preparePrint().then(restore => {settled = true; return restore;});
  await tick(); assert.equal(settled, false);
  const value = snapshot(); value.warnings = ['Conferir resumo atualizado.']; pending.resolve(value);
  await opening; const restore = await printing;
  assert.ok(capturedText(root).includes('Conferir resumo atualizado.')); restore(); restore();
});

// Break: failed refresh leaves the last successful snapshot printable or leaks provider errors.
test('refresh failure clears cached values and retry recovers without leaking error details', async t => {
  let calls = 0;
  const {view, root} = setup(t, {loadReport:async () => {
    if (++calls === 2) throw Error('Bearer secret https://private.invalid');
    const value = snapshot(); value.metrics.dueToday = calls === 1 ? 3 : 21; return value;
  }});
  await view.open(); refresh(root).click(); await tick();
  assert.equal(metric(root, 'dueToday').textContent, '—');
  assert.doesNotMatch(root.textContent, /Bearer|secret|private/);
  await assert.rejects(view.preparePrint()); assert.throws(() => captureFilteredReport(root));
  root.querySelector('.gsr-retry').click(); await tick();
  assert.equal(metric(root, 'dueToday').textContent, '21');
  (await view.preparePrint())();
});

// Break: current-load wait on a failed response resolves using previously rendered values.
test('printing during a refresh waits for fresh metrics and rejects a failed current request', async t => {
  const requests = []; const {view, root} = setup(t, {loadReport:() => {
    const pending = deferred(); requests.push(pending); return pending.promise;
  }});
  const opening = view.open(); await tick(); requests[0].resolve(snapshot()); await opening;
  refresh(root).click(); const printing = view.preparePrint(); let settled = false;
  void printing.then(() => {settled = true;}); await tick(); assert.equal(settled, false);
  const fresh = snapshot(); fresh.metrics.quotes = 42; requests[1].resolve(fresh);
  (await printing)(); assert.equal(metric(root, 'quotes').textContent, '42');
  refresh(root).click(); const failed = assert.rejects(view.preparePrint()); await tick();
  requests[2].reject(Error('offline')); await failed;
  assert.equal(metric(root, 'quotes').textContent, '—');
});

// Break: close waits indefinitely for a provider ignoring AbortSignal, then a late result repaints a new session.
test('close settles waits and late responses cannot replace a reopened session', async t => {
  const requests = []; const {view, root} = setup(t, {loadReport:({signal}) => {
    const pending = deferred(); requests.push({...pending, signal}); return pending.promise;
  }});
  const first = view.open(); const printing = assert.rejects(view.preparePrint()); await tick();
  view.close(); assert.equal(requests[0].signal.aborted, true);
  let settled = false; void Promise.all([first, printing]).then(() => {settled = true;});
  await tick(); assert.equal(settled, true);
  const second = view.open(); await tick();
  const newer = snapshot(); newer.metrics.auditOrders = 54; requests[1].resolve(newer); await second;
  requests[0].resolve(snapshot()); await tick(); assert.equal(metric(root, 'auditOrders').textContent, '54');
});

// Break: a completed print wait is used after close/reopen changes the session in the same microtask turn.
test('preparePrint rejects if its successful load is superseded before capture', async t => {
  const pending = deferred(); const {view} = setup(t, {loadReport:() => pending.promise});
  const opening = view.open(); await tick();
  const replaced = opening.then(() => {view.close(); void view.open();});
  const refused = assert.rejects(view.preparePrint());
  pending.resolve(snapshot()); await Promise.all([replaced, refused]);
});

// Break: provider mutation turns a captured partial snapshot into an apparently complete snapshot.
test('view owns its captured metrics and warnings independently of provider mutations', async t => {
  const value = snapshot(); value.metrics.documents = null; value.warnings = ['DOCUMENTOS indisponíveis.'];
  const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
  value.metrics.documents = 999; value.warnings.length = 0;
  (await view.preparePrint())();
  assert.equal(metric(root, 'documents').textContent, '—');
  assert.ok(capturedText(root).includes('DOCUMENTOS indisponíveis.'));
});

// Break: SharePoint warning text is parsed as markup and creates injected DOM elements.
test('warnings use literal text and remain readable by the shared PDF collector', async t => {
  const value = snapshot(); value.warnings = ['<img src=x onerror=alert(1)>', '<script>unsafe()</script>'];
  const {view, root} = setup(t, {loadReport:async () => value}); await view.open();
  assert.equal(root.querySelectorAll('script,[onerror]').length, 0);
  assert.equal(root.querySelectorAll('img').length, 1);
  assert.equal(root.querySelector('.gsr-warnings p').textContent, '<img src=x onerror=alert(1)>');
  assert.ok(capturedText(root).includes('<script>unsafe()</script>'));
});

// Break: the report traps a shared PDF dialog or leaks focus to the inert app.
test('modal owns focus and Tab while allowing both shared and native PDF dialogs', async t => {
  const {view, root, doc, dom} = setup(t); await view.open();
  const panel = root.querySelector('[role="dialog"]');
  doc.getElementById('outside').focus(); assert.equal(doc.activeElement, panel);
  const controls = [...panel.querySelectorAll('button,[tabindex="0"]')].filter(n => !n.disabled);
  controls.at(-1).focus(); controls.at(-1).dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
  assert.equal(doc.activeElement, controls[0]);
  controls[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true, cancelable:true}));
  assert.equal(doc.activeElement, controls.at(-1));
  for (const native of [false, true]) {
    const pdf = doc.createElement(native ? 'dialog' : 'section');
    if (native) pdf.setAttribute('open', '');
    else {pdf.setAttribute('role', 'dialog'); pdf.setAttribute('aria-modal', 'true');}
    const button = doc.createElement('button'); pdf.append(button); doc.body.append(pdf);
    button.focus(); assert.equal(doc.activeElement, button);
    button.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.equal(root.hidden, false); pdf.remove();
  }
});

// Break: HOME fails to notify its parent, dismissals call HOME, or repeated close corrupts inert/scroll state.
test('home close Escape and backdrop restore prior app state and call the correct callbacks once', async t => {
  for (const dismissal of ['home', 'close', 'escape', 'outside']) {
    let closes = 0, homes = 0; const {view, root, doc, dom} = setup(t, {onClose:() => closes++, onHome:() => homes++});
    const trigger = doc.getElementById('trigger'); trigger.focus(); doc.body.style.overflow = 'auto';
    doc.getElementById('app').inert = dismissal === 'outside'; await view.open();
    assert.equal(doc.getElementById('app').inert, true); assert.equal(doc.body.style.overflow, 'hidden');
    if (dismissal === 'escape') root.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
    else if (dismissal === 'outside') root.click(); else root.querySelector(`.gsr-${dismissal}`).click();
    view.close();
    assert.equal(root.hidden, true); assert.equal(doc.activeElement, trigger);
    assert.equal(doc.body.style.overflow, 'auto'); assert.equal(doc.getElementById('app').inert, dismissal === 'outside');
    assert.equal(closes, 1); assert.equal(homes, dismissal === 'home' ? 1 : 0);
  }
});

// Break: destroyed views keep querying/listening or pending replies reinsert their content.
test('destroy aborts pending loads removes focus ownership and refuses later open and print', async t => {
  const pending = deferred(); let signal;
  const {view, root, doc} = setup(t, {loadReport:options => {signal = options.signal; return pending.promise;}});
  const opening = view.open(); await tick(); view.destroy(); view.destroy();
  assert.equal(signal.aborted, true); await opening;
  pending.resolve(snapshot()); await tick(); assert.equal(root.isConnected, false);
  doc.getElementById('outside').focus(); assert.equal(doc.activeElement.id, 'outside');
  await assert.rejects(view.open(), /encerrado/); await assert.rejects(view.preparePrint());
});

// Break: print restore resets a new session or loses the current content's scroll and focus.
test('print restore preserves scroll and focus but an obsolete restore cannot affect a new session', async t => {
  const {view, root, doc} = setup(t); await view.open();
  const content = root.querySelector('.gsr-content'); content.scrollTop = 73; content.scrollLeft = 4; refresh(root).focus();
  const restore = await view.preparePrint(); content.scrollTop = 0; root.querySelector('.gsr-close').focus(); restore(); restore();
  assert.equal(content.scrollTop, 73); assert.equal(content.scrollLeft, 4); assert.equal(doc.activeElement, refresh(root));
  const oldRestore = await view.preparePrint(); view.close(); await view.open(); content.scrollTop = 22; oldRestore();
  assert.equal(content.scrollTop, 22);
});

// Break: group styles inherit a single palette and erase the source's color hierarchy.
test('rendered groups retain source colors and numerical emphasis without sharing the label color', async t => {
  const {view, root, doc, dom} = setup(t);
  const style = doc.createElement('style'); style.textContent = await readFile(new URL('../src/ui/general-summary-report.css', import.meta.url), 'utf8'); doc.head.append(style);
  await view.open();
  assert.deepEqual([...root.querySelectorAll('.gsr-group')].map(n => dom.window.getComputedStyle(n).backgroundColor),
    ['rgb(0, 16, 96)', 'rgb(136, 160, 209)', 'rgb(99, 139, 44)', 'rgb(203, 102, 102)', 'rgb(172, 62, 11)']);
  assert.equal(dom.window.getComputedStyle(metric(root, 'overdue')).color, 'rgb(176, 0, 32)');
  assert.notEqual(dom.window.getComputedStyle(metric(root, 'pendingTasks')).color,
    dom.window.getComputedStyle(metric(root, 'pendingTasks').parentElement.querySelector('dt')).color);
  assert.ok(root.classList.contains('pl-overlay')); assert.ok(root.classList.contains('gsr-overlay'));
  assert.ok(refresh(root).closest('.gsr-toolbar'));
});
