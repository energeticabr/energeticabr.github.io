import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {runBrowserLayout} from './helpers/browser-layout-runner.mjs';
import {createChatView, renderChatMarkup} from '../src/ui/chat-view.js';
import {decorateReportPrint} from '../src/ui/report-print.js';

const {createDelegatedDeadlineReportView} = await import('../src/ui/delegated-deadline-report-view.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const row = (id, extra = {}) => ({id, createdDate:'2026-10-04', dueDate:'2026-10-05',
  description:'Conferir documentação', association:'ESTRUTURA', responsible:'ANA',
  status:'ATIVIDADE CRIADA', priority:'ATIVIDADE EMERGENCIAL', difficulty:'ALTA DIFICULDADE', ...extra});
const snapshot = {tasks:[
  row(1),
  row(2, {createdDate:'2026-10-03', status:'EM ATENDIMENTO', priority:'ATIVIDADE PRIORITÁRIA'}),
  row(3, {createdDate:'2026-10-02', responsible:'BRUNO', status:'CONCLUÍDO'}),
  row(4, {createdDate:'2026-10-06', dueDate:'2026-10-06', responsible:'', association:'DOCUMENTAL', priority:''}),
  row(5, {createdDate:'2026-10-05', dueDate:'2026-10-08', responsible:'CARLA', association:'ELÉTRICA', description:'Instalar quadro', difficulty:'BAIXA DIFICULDADE', priority:'ATIVIDADE PRIORITÁRIA'}),
  row(6, {createdDate:'2026-10-01', dueDate:null, responsible:'DIEGO', association:'DOCUMENTAL', status:'CANCELADO', priority:'NÃO PRIORITÁRIA', difficulty:'MÉDIA DIFICULDADE'}),
]};
const tick = () => new Promise(resolve => setImmediate(resolve));
const home = {sessionStatus:'authenticated', account:{name:'Bernardo'}, draft:'', pendingFiles:[], messages:[{
  id:'home', role:'assistant', type:'poll', question:'QUAL ÁREA VOCÊ DESEJA ACESSAR?',
  options:[{id:'group_pending', label:'PENDÊNCIAS'}, {id:'group_supplies', label:'SUPRIMENTOS'}],
}]};
function setup(t, load = async () => snapshot, vertical = false) {
  assert.equal(typeof createDelegatedDeadlineReportView, 'function', 'delegated deadline report factory must exist');
  const dom = new JSDOM('<main id="app"><button data-action="open-delegated-deadline-report">Abrir relatório</button></main>');
  let portrait = vertical;
  dom.window.matchMedia = () => ({get matches() { return portrait; }});
  const css = dom.window.document.createElement('style');
  css.textContent = readFileSync(new URL('../src/ui/delegated-deadline-report.css', import.meta.url), 'utf8');
  dom.window.document.head.append(css);
  const view = createDelegatedDeadlineReportView({document:dom.window.document, data:{loadSnapshot:load}, now:() => new Date('2026-10-06T12:00:00Z')});
  t.after(() => {view.destroy(); dom.window.close();});
  return {view, root:view.element, dom, rotate(value) {portrait = value; dom.window.dispatchEvent(new dom.window.Event('resize'));}};
}
function select(root, dom, name, values) {
  const control = root.querySelector(`select[name="${name}"]`);
  if (control.multiple) for (const option of control.options) option.selected = values.includes(option.value);
  else control.value = values;
  control.dispatchEvent(new dom.window.Event('change', {bubbles:true}));
}
function describe(root, dom, value) {
  const input = root.querySelector('[name="description"]');
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
}
const ids = root => [...root.querySelectorAll('tbody tr[data-task-id]')].map(node => Number(node.dataset.taskId));
const metrics = root => Object.fromEntries([...root.querySelectorAll('[data-metric]')].map(node => [node.dataset.metric, Number(node.querySelector('strong').textContent)]));

test('tenth left HOME mascot follows the old green report and emits the delegated action only when available', t => {
  const dom = new JSDOM('<main id="app"></main>');
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const chat = createChatView(dom.window.document.getElementById('app'));
  t.after(() => {chat.destroy(); dom.window.close();});
  let calls = 0;
  chat.on('open-delegated-deadline-report', () => {calls++;});
  chat.render(home);
  const mascot = dom.window.document.querySelector('[data-action="open-delegated-deadline-report"]');
  assert.ok(mascot);
  assert.equal(mascot.previousElementSibling.dataset.action, 'open-task-association-report');
  assert.equal(mascot.nextElementSibling.className, 'chat-bubble');
  const left = [...mascot.parentElement.children].filter(node => node.matches('button.chat-main-provisions-shortcut,button.chat-main-payment-ledger-shortcut'));
  assert.equal(left.length, 10);
  assert.equal(left[9], mascot);
  assert.match(mascot.querySelector('img').src, /delegated-deadline\.png$/);
  mascot.querySelector('img').click();
  assert.equal(calls, 1);
  chat.render({...home, activeText:{id:'busy'}});
  const busy = dom.window.document.querySelector('[data-action="open-delegated-deadline-report"]');
  assert.equal(busy.disabled, true);
  busy.click();
  assert.equal(calls, 1);
  assert.doesNotMatch(renderChatMarkup({...home, activeFlow:'busy'}), /data-action="open-delegated-deadline-report"/);
});

test('closing after a HOME rerender focuses the current tenth mascot', async t => {
  const {view, root, dom} = setup(t);
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  const chat = createChatView(dom.window.document.getElementById('app'));
  t.after(() => chat.destroy());
  chat.render(home);
  const original = dom.window.document.querySelector('[data-action="open-delegated-deadline-report"]');
  original.focus();
  await view.open();
  chat.render({...home, messages:[{...home.messages[0], options:[{id:'group_pending', label:'PENDÊNCIAS (1)'}, {id:'group_supplies', label:'SUPRIMENTOS'}]}]});
  const current = dom.window.document.querySelector('[data-action="open-delegated-deadline-report"]');
  assert.notEqual(current, original);
  assert.equal(original.isConnected, false);
  view.close();
  assert.equal(dom.window.document.activeElement, current);
  assert.equal(root.hidden, true);
});

test('date groups show default pending tasks, global metrics, nested responsible cells and six columns', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  assert.match(root.querySelector('img').src, /logo-energetica-oficial\.png$/);
  assert.deepEqual(metrics(root), {pending:4, completed:1, total:6});
  assert.deepEqual(ids(root), [1, 2, 4, 5]);
  assert.equal(root.querySelectorAll('.tdr-filter').length, 5);
  assert.deepEqual([...root.querySelectorAll('.tdr-filter-label')].map(node => node.textContent), ['DESCRIÇÃO', 'ETAPA OBRA', 'DIFICULDADE', 'PRIORITÁRIA', 'STATUS']);
  assert.equal(root.querySelectorAll('.tdr-group').length, 3);
  const first = root.querySelector('.tdr-group');
  assert.match(first.querySelector('.tdr-deadline').textContent, /05\/10\/2026.*1 DIA EM ATRASO.*TOTAL: 2.*PENDENTES: 2/s);
  assert.equal(first.querySelector('.tdr-responsible').rowSpan, 2);
  assert.equal(first.querySelectorAll('.tdr-responsible').length, 1);
  assert.equal(root.querySelector('[data-task-id="4"] .tdr-responsible').textContent, 'SEM RESPONSÁVEL');
  assert.equal(root.querySelector('[data-task-id="4"] .tdr-priority').textContent, '—');
  assert.deepEqual([...first.querySelectorAll('thead th')].map(node => node.textContent), ['👤 RESPONSÁVEL', '🆔 ID', '📅 DATA', '🏢 ASSOCIAÇÃO', '📝 TAREFA', '🚨 PRIORIDADE']);
  assert.match(first.querySelector('tfoot').textContent, /TOTAL DE ATIVIDADES NESTA DATA: 2/);
  assert.equal(dom.window.getComputedStyle(first.querySelector('.tdr-deadline')).backgroundColor, 'rgb(255, 205, 210)');
  assert.equal(dom.window.getComputedStyle(first.querySelector('.tdr-responsible')).backgroundColor, 'rgb(255, 205, 210)');
  assert.equal(dom.window.getComputedStyle(root.querySelector('[data-task-id="2"]')).backgroundColor, 'rgb(255, 224, 178)');
  assert.match(root.querySelectorAll('.tdr-deadline')[1].textContent, /VENCE HOJE/);
  assert.match(root.querySelectorAll('.tdr-deadline')[2].textContent, /2 DIAS PARA O PRAZO/);
});

test('description, stage, difficulty and priority compose while global metrics stay unchanged', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  describe(root, dom, 'conferir');
  select(root, dom, 'association', 'ESTRUTURA');
  select(root, dom, 'difficulty', 'ALTA DIFICULDADE');
  assert.deepEqual(ids(root), [1, 2]);
  select(root, dom, 'priority', 'ATIVIDADE EMERGENCIAL');
  assert.deepEqual(ids(root), [1]);
  select(root, dom, 'statuses', ['CONCLUÍDO']);
  assert.deepEqual(ids(root), [3]);
  assert.equal(dom.window.getComputedStyle(root.querySelector('[data-task-id="3"]')).backgroundColor, 'rgb(200, 230, 201)');
  assert.equal(dom.window.getComputedStyle(root.querySelector('.tdr-responsible')).backgroundColor, 'rgb(200, 230, 201)');
  assert.match(root.querySelector('.tdr-deadline').textContent, /TODAS AS ATIVIDADES CONCLUÍDAS/);
  assert.deepEqual(metrics(root), {pending:4, completed:1, total:6});
  describe(root, dom, 'inexistente');
  assert.deepEqual(ids(root), []);
  assert.match(root.textContent, /Nenhuma atividade/);
  assert.deepEqual(metrics(root), {pending:4, completed:1, total:6});
});

test('multi-status selection allows combined statuses and Todos includes missing deadlines', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  const native = root.querySelector('select[name="statuses"]');
  assert.deepEqual([...native.selectedOptions].map(node => node.value), ['ATIVIDADE CRIADA', 'EM ATENDIMENTO']);
  select(root, dom, 'statuses', ['CONCLUÍDO', 'ATIVIDADE CRIADA']);
  assert.deepEqual(ids(root), [1, 3, 4, 5]);
  select(root, dom, 'statuses', []);
  assert.deepEqual(ids(root), [1, 2, 3, 4, 5, 6]);
  const last = [...root.querySelectorAll('.tdr-deadline')].at(-1);
  assert.match(last.textContent, /SEM PRAZO DEFINIDO/);
  assert.equal(dom.window.getComputedStyle(last).backgroundColor, 'rgb(236, 239, 241)');
  root.querySelector('[aria-label="Abrir opções de STATUS"]').click();
  assert.equal(root.querySelector('[role="listbox"][aria-label="STATUS"]').getAttribute('aria-multiselectable'), 'true');
  const all = [...root.querySelectorAll('[role="listbox"][aria-label="STATUS"] [role="option"]')].find(node => node.textContent === 'Todos');
  all.click();
  assert.deepEqual(ids(root), [1, 2, 3, 4, 5, 6]);
});

test('missing deadlines retain the source gray label and border rather than losing the deadline badge', async t => {
  const {view, root, dom} = setup(t, async () => ({tasks:[row(1, {dueDate:null})]}));
  await view.open();
  const badge = root.querySelector('.tdr-due-label');
  assert.ok(badge, 'every date cluster must include its deadline label');
  assert.equal(badge.textContent, 'SEM PRAZO DEFINIDO');
  assert.equal(dom.window.getComputedStyle(badge).color, 'rgb(96, 125, 139)');
  assert.equal(dom.window.getComputedStyle(badge).borderColor, 'rgb(96, 125, 139)');
  assert.equal(root.querySelector('.tdr-deadline h2').textContent, 'SEM DATA');
});

test('report selectors search only when explicitly focused and do not automatically summon the keyboard', async t => {
  const {view, root, dom} = setup(t);
  await view.open();
  assert.equal(dom.window.document.activeElement, root.querySelector('.tdr-dialog'));
  const native = root.querySelector('select[name="association"]');
  const trigger = native.nextElementSibling.querySelector('.sfs-trigger');
  trigger.click();
  const popup = native.nextElementSibling.querySelector('.sfs-popup');
  const search = popup.querySelector('.sfs-report-search');
  assert.equal(trigger.readOnly, true);
  assert.equal(dom.window.document.activeElement, trigger);
  assert.equal(popup.dataset.placement, 'expanded');
  assert.equal(search.hasAttribute('autofocus'), false);
  search.focus();
  search.value = 'eletrica';
  search.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  assert.deepEqual([...popup.querySelectorAll('[role="option"]')].map(node => node.textContent), ['ELÉTRICA']);
  popup.querySelector('[role="option"]').click();
  assert.deepEqual(ids(root), [5]);
  assert.equal(dom.window.document.activeElement, trigger);
  assert.equal(popup.hidden, true);
});

test('task descriptions and grouping text remain literal even with HTML and long unbroken content', async t => {
  const text = '<img src=x onerror=alert(1)><script>alert(1)</script>' + 'x'.repeat(300);
  const {view, root} = setup(t, async () => ({tasks:[row(1, {description:text, association:'<svg onload=alert(1)>', responsible:'<img src=x>'})]}));
  await view.open();
  assert.equal(root.querySelector('.tdr-task').textContent, text);
  assert.match(root.querySelector('.tdr-association').textContent, /<svg onload=alert\(1\)>/);
  assert.equal(root.querySelectorAll('img, script, svg').length, 1);
});

test('detail limit warns after filtering while full-base metrics retain all tasks', async t => {
  const {view, root, dom} = setup(t, async () => ({tasks:Array.from({length:2001}, (_, i) => row(i + 1))}));
  await view.open();
  assert.equal(ids(root).length, 2000);
  assert.deepEqual(metrics(root), {pending:2001, completed:0, total:2001});
  assert.match(root.querySelector('.tdr-limit').textContent, /2[.,]?000.*2[.,]?001/s);
  describe(root, dom, 'nenhuma');
  assert.equal(root.querySelector('.tdr-limit'), null);
  assert.deepEqual(metrics(root), {pending:2001, completed:0, total:2001});
});

test('portrait avoids data reads and rotation, Escape and backdrop restore app state and focus', async t => {
  let reads = 0;
  const {view, root, dom, rotate} = setup(t, async () => {reads++; return snapshot;}, true);
  const app = dom.window.document.getElementById('app');
  const original = app.querySelector('button');
  dom.window.document.body.style.overflow = 'auto';
  original.focus();
  await view.open();
  assert.equal(reads, 0);
  assert.equal(app.inert, true);
  assert.equal(root.querySelector('.tdr-orientation').hidden, false);
  rotate(false);
  await tick();
  assert.equal(reads, 1);
  root.querySelector('table').click();
  assert.equal(root.hidden, false);
  root.click();
  assert.equal(root.hidden, true);
  assert.equal(app.inert, false);
  assert.equal(dom.window.document.activeElement, original);
  assert.equal(dom.window.document.body.style.overflow, 'auto');
  await view.open();
  root.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(root.hidden, true);
});

test('loading, refresh failure and retry clear old rows and metrics without resetting filters', async t => {
  let reads = 0, finish;
  const {view, root, dom} = setup(t, () => {
    if (reads++ === 0) return new Promise(resolve => {finish = resolve;});
    if (reads === 2) return Promise.reject(new Error('offline'));
    return Promise.resolve(snapshot);
  });
  const opening = view.open();
  assert.match(root.querySelector('.tdr-content').textContent, /Carregando/);
  assert.equal(root.querySelector('.tdr-report').getAttribute('aria-busy'), 'true');
  assert.equal(root.querySelector('.tdr-refresh').disabled, true);
  finish(snapshot);
  await opening;
  select(root, dom, 'association', 'ELÉTRICA');
  root.querySelector('.tdr-refresh').click();
  assert.equal(root.querySelectorAll('.tdr-card').length, 0);
  assert.deepEqual(ids(root), []);
  await tick();
  assert.match(root.textContent, /Não foi possível/);
  assert.equal(root.querySelector('.tdr-report').getAttribute('aria-busy'), 'false');
  root.querySelector('.tdr-retry').click();
  await tick();
  assert.deepEqual(ids(root), [5]);
  assert.deepEqual(metrics(root), {pending:4, completed:1, total:6});
});

test('the real PDF decorator can replace the toolbar refresh with a pair without breaking filtering or refresh', async t => {
  let reads = 0;
  const {view, root, dom} = setup(t, async () => {reads++; return snapshot;});
  const decorated = decorateReportPrint(view, {action:'open-delegated-deadline-report'});
  t.after(() => decorated.destroy());
  await decorated.open();
  const pair = root.querySelector('.tdr-toolbar .report-print-actions');
  assert.ok(pair);
  assert.equal(pair.querySelectorAll('button').length, 2);
  assert.equal(pair.querySelector('.report-print-button').disabled, false);
  select(root, dom, 'association', 'ELÉTRICA');
  assert.deepEqual(ids(root), [5]);
  pair.querySelector('.tdr-refresh').click();
  await tick();
  assert.equal(reads, 2);
  assert.equal(pair.querySelector('.report-print-button').disabled, false);
  assert.deepEqual(ids(root), [5]);
  assert.deepEqual(metrics(root), {pending:4, completed:1, total:6});
});

test('closed and superseded reads are aborted and cannot overwrite a newer opening', async t => {
  const requests = [];
  const {view, root, dom} = setup(t, ({signal}) => new Promise(resolve => requests.push({signal, resolve})));
  const first = view.open();
  assert.equal(requests.length, 1);
  view.close();
  assert.equal(requests[0].signal.aborted, true);
  const second = view.open();
  requests[1].resolve({tasks:[row(9)]});
  await second;
  requests[0].resolve(snapshot);
  await first;
  assert.deepEqual(ids(root), [9]);
  describe(root, dom, 'inexistente');
  view.close();
  const third = view.open();
  requests[2].resolve({tasks:[row(10)]});
  await third;
  assert.deepEqual(ids(root), [10]);
  view.destroy();
  assert.equal(root.isConnected, false);
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(requests.length, 3);
  await assert.rejects(view.open(), /encerrado/);
});

test('rotation during loading aborts the read and returning to landscape starts a fresh snapshot', async t => {
  const requests = [];
  const {view, root, rotate} = setup(t, ({signal}) => new Promise(resolve => requests.push({signal, resolve})));
  const opening = view.open();
  rotate(true);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(snapshot);
  await opening;
  assert.deepEqual(ids(root), []);
  rotate(false);
  requests[1].resolve({tasks:[row(8)]});
  await tick();
  assert.deepEqual(ids(root), [8]);
});

test('rebuilt selectors keep focus and Tab stays inside the report', async t => {
  let finish;
  const {view, root, dom} = setup(t, () => new Promise(resolve => {finish = resolve;}));
  const opening = view.open();
  const oldTrigger = root.querySelector('select[name="association"]').nextElementSibling.querySelector('.sfs-trigger');
  oldTrigger.focus();
  finish(snapshot);
  await opening;
  const trigger = root.querySelector('select[name="association"]').nextElementSibling.querySelector('.sfs-trigger');
  assert.equal(dom.window.document.activeElement, trigger);
  assert.equal(oldTrigger.isConnected, false);
  const content = root.querySelector('.tdr-content');
  content.focus();
  content.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
  assert.equal(dom.window.document.activeElement, root.querySelector('.tdr-refresh'));
  root.querySelector('.tdr-refresh').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', shiftKey:true, bubbles:true, cancelable:true}));
  assert.equal(dom.window.document.activeElement, content);
  trigger.focus();
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(root.hidden, true);
});

test('empty snapshots show zero cards and incomplete snapshots show failure rather than partial totals', async t => {
  const empty = setup(t, async () => ({tasks:[]}));
  await empty.view.open();
  assert.deepEqual(metrics(empty.root), {pending:0, completed:0, total:0});
  assert.match(empty.root.textContent, /Nenhuma atividade/);
  const partial = setup(t, async () => ({tasks:snapshot.tasks, complete:false}));
  await partial.view.open();
  assert.equal(partial.root.querySelector('.tdr-card'), null);
  assert.match(partial.root.textContent, /Não foi possível/);
});

test('closing restores a replaced HOME trigger and retains a previously inert app', async t => {
  const {view, root, dom} = setup(t);
  const app = dom.window.document.getElementById('app');
  app.inert = true;
  const old = app.querySelector('button');
  old.focus();
  await view.open();
  const replacement = dom.window.document.createElement('button');
  replacement.dataset.action = 'open-delegated-deadline-report';
  old.replaceWith(replacement);
  view.close();
  assert.equal(app.inert, true);
  assert.equal(dom.window.document.activeElement, replacement);
  assert.equal(root.hidden, true);
});

test('mock report fits desktop and landscape phone with a horizontal printer-refresh pair', {timeout:120000}, async t => {
  assert.equal(typeof createDelegatedDeadlineReportView, 'function', 'delegated deadline report factory must exist');
  const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && existsSync(value));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({root:resolve(fileURLToPath(new URL('..', import.meta.url))), server:{host:'127.0.0.1', port:0}, logLevel:'silent'});
  try {
    await server.listen();
    for (const [width, height] of [[1280,800], [844,390]]) {
      const {stdout} = await runBrowserLayout(browser, {width, height, url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/delegated-deadline-report-browser.html`});
      const dom = new JSDOM(stdout);
      try {
        const result = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(result.error, undefined, JSON.stringify(result));
        assert.equal(result.rows, 4, JSON.stringify(result));
        assert.equal(result.columns, 6);
        assert.equal(result.rowSpan, 2);
        assert.deepEqual(result.metrics, ['4', '0', '4']);
        assert.ok(result.documentOverflow <= 1, JSON.stringify(result));
        assert.ok(result.contentOverflow <= 1, JSON.stringify(result));
        assert.ok(result.toolbarOverflow <= 1, JSON.stringify(result));
        assert.ok(result.contentHeight > 100, JSON.stringify(result));
        assert.ok(result.contentScrollHeight > result.contentHeight, 'long content should scroll vertically');
        assert.ok(result.logoLoaded, 'official logo must load');
        assert.ok(result.labelRows.every(top => Math.abs(top - result.labelRows[0]) <= 1), JSON.stringify(result));
        const [printer, refresh] = result.buttons;
        assert.ok(printer.width >= 40 && refresh.width >= 40 && printer.height >= 44 && refresh.height >= 44, JSON.stringify(result));
        assert.ok(refresh.left >= printer.right && Math.abs(refresh.top - printer.top) <= 1, JSON.stringify(result));
        assert.equal(result.searchFocused, false);
        assert.equal(result.popupPlacement, 'expanded');
        assert.ok(result.popupInsideViewport, JSON.stringify(result));
      } finally {dom.window.close();}
    }
  } finally {await server.close();}
});
