import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path));

const card = id => `.og-card[data-item-id="${id}"]`;
const trigger = id => `${card(id)} [data-order-linked-open]`;
const close = '.og-detail-heading button';
const fixture = 'window.ordersLinkedFixture';

async function serve() {
  // Read-only RED replay while the parent edits production in the shared tree.
  const baseline = process.env.ORDERS_LINKED_CARD_BASELINE;
  const replacements = new Map();
  if (baseline) {
    assert.match(baseline, /^[a-f0-9]{7,40}$/, 'Baseline must be a commit hash');
    for (const name of ['orders-gallery-view.js', 'orders-gallery.css']) {
      replacements.set(`/src/ui/${name}`, execFileSync('git', ['show',
        `${baseline}:apps/energetico-mobile/src/ui/${name}`], { cwd: appRoot, encoding: 'utf8' }));
    }
  }
  const cacheDir = await mkdtemp(join(tmpdir(), 'orders-linked-vite-'));
  let server;
  const cleanup = async () => { try { await server?.close(); } finally { await rm(cacheDir, { recursive: true, force: true }); } };
  try {
    server = await createServer({ root: appRoot, cacheDir, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..'), cacheDir] } },
    plugins: [{ name: 'orders-linked-card-read-only-baseline', enforce: 'pre',
      transform(_code, id) {
        for (const [suffix, source] of replacements) if (id.replaceAll('\\', '/').endsWith(suffix)) return source;
      } }],
  });
  await server.listen();
  return { cleanup, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/orders-linked-card.html` };
  } catch (error) { await cleanup(); throw error; }
}

async function state(api) { return api.evaluate(`${fixture}.snapshot()`); }
async function context(api) { return api.evaluate(`${fixture}.context()`); }
async function settle(api) {
  await api.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}
async function reveal(api, selector) {
  await api.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
  await settle(api);
}

// Unlike element.click(), CDP input uses Chrome's actual layout hit testing.
// Supplier/summary text is intentionally under the stretched ::after target,
// so the helper's element.contains(hit) check would reject those selectors.
async function touchContent(api, id, selector) {
  await reveal(api, selector);
  const hit = await api.evaluate(`(() => {
    const text = document.querySelector(${JSON.stringify(selector)}), r = text.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const target = document.elementFromPoint(x,y);
    return { x,y, tag:target?.tagName, linked:target?.closest('[data-order-linked-open]')?.closest('.og-card')?.dataset.itemId,
      text:text.textContent, hit:target?.outerHTML.slice(0,250) };
  })()`);
  assert.equal(hit.linked, id, `Real hit at ${selector} must be the selected native button: ${JSON.stringify(hit)}`);
  assert.equal(hit.tag, 'BUTTON');
  await api.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hit.x, y: hit.y }] });
  await api.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(api);
  const { hit: _markup, ...evidence } = hit;
  return evidence;
}

async function key(api, name) {
  const values = { Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 } };
  const params = values[name];
  await api.command('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await api.command('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  await settle(api);
}

async function assertReport(api, id) {
  await api.wait(`document.querySelector('.og-detail .olr-report')`);
  const result = await api.evaluate(`(() => {
    const panel = document.querySelector('.og-detail');
    return { hidden:panel.hidden, heading:panel.querySelector('h2').textContent,
      id:panel.querySelector('[data-report-field="ID"] dd').textContent,
      launches:[...panel.querySelectorAll('.olr-launch-row')].map(node=>node.dataset.launchId),
      text:panel.textContent, editor:!!document.querySelector('[data-gallery-record-dialog]'),
      overflow:panel.scrollWidth>panel.clientWidth+1,
      tableContained:panel.querySelector('.olr-table-scroll').getBoundingClientRect().right<=innerWidth,
      documentOverflow:document.documentElement.scrollWidth>innerWidth+1 };
  })()`);
  assert.equal(result.hidden, false);
  assert.equal(result.heading, `Pedido #${id}`);
  assert.equal(result.id, id);
  assert.deepEqual(result.launches, [`${id}1`, `${id}2`]);
  assert.ok(result.text.includes(`Lançamentos vinculados ao pedido ${id}`));
  assert.ok(result.text.includes(`Produto ${id}`));
  assert.ok(!result.text.includes('NÃO VINCULADO'));
  assert.equal(result.editor, false, 'Selecting a card must bypass the editor');
  assert.equal(result.overflow, false, 'Wide report table must stay inside its own scroll region');
  assert.equal(result.documentOverflow, false);
  assert.equal(result.tableContained, true);
}

async function assertRestored(api, before, id) {
  await api.wait(`document.querySelector('.og-detail').hidden`);
  assert.deepEqual(await context(api), before, 'Close must preserve scroll, page, filter, sort and visible cards');
  assert.equal(await api.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(trigger(id))})`), true,
    'Focus returns to the same selected order button');
  assert.equal((await state(api)).loads, 1, 'Opening/closing a linked report must not reread loadSnapshot');
}

async function screenshot(api, name) {
  if (!process.env.ORDERS_LINKED_CARD_ARTIFACT_DIR) return;
  const directory = resolve(process.env.ORDERS_LINKED_CARD_ARTIFACT_DIR);
  await mkdir(directory, { recursive: true });
  const { data } = await api.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}

async function assertCueLayout(api, id) {
  const layout = await api.evaluate(`(() => {
    const card = document.querySelector(${JSON.stringify(card(id))});
    const heading = card.querySelector('.og-card-heading'), cue = heading.querySelector('.og-open-cue');
    if (!cue) return { cuePresent: false };
    const svg = cue.querySelector('svg'), label = cue.querySelector('span');
    const rect = node => node.getBoundingClientRect();
    const inside = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const textFits = node => {
      const range = document.createRange(); range.selectNodeContents(node);
      return [...range.getClientRects()].every(r => inside(rect(node), r));
    };
    const children = [...heading.children, ...heading.querySelector('.og-heading-copy').children];
    const actions = [...card.querySelectorAll('[data-action="edit"],[data-action="delete"]')];
    const style = getComputedStyle(cue), headingStyle = getComputedStyle(heading), svgStyle = svg && getComputedStyle(svg);
    const button = heading.querySelector('[data-order-linked-open]');
    return { cuePresent: true, cueVisible: cue.checkVisibility(), text: cue.textContent,
      cueDisplay: style.display, background: headingStyle.backgroundColor,
      border: parseFloat(headingStyle.borderTopWidth), borderStyle: headingStyle.borderTopStyle,
      labelFits: !!label && textFits(label), idFits: textFits(button),
      childrenFit: children.every(node => inside(rect(heading), rect(node))),
      actionsIndependent: children.every(node => actions.every(action => !intersects(rect(node), rect(action)))),
      chevronVisible: !!svg && svg.checkVisibility() && rect(svg).width >= 12 && rect(svg).height >= 12
        && svgStyle.visibility === 'visible' && inside(rect(cue), rect(svg))
        && getComputedStyle(svg.querySelector('path')).stroke !== 'none',
      contentOverflow: document.querySelector('.og-content').scrollWidth > document.querySelector('.og-content').clientWidth + 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cueWidth: rect(cue).width, headingWidth: rect(heading).width };
  })()`);
  assert.equal(layout.cuePresent, true, 'The real header must render the visible open cue');
  assert.equal(layout.text, 'Ver lançamentos');
  assert.equal(layout.cueVisible, true);
  assert.match(layout.cueDisplay, /^(inline-)?flex$/, 'Grid items compute inline-flex as flex');
  assert.ok(!['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(layout.background), 'Header has a soft blue background');
  assert.ok(layout.border >= 1 && layout.borderStyle !== 'none', 'Header has a visible outline');
  for (const name of ['labelFits', 'idFits', 'childrenFit', 'actionsIndependent', 'chevronVisible']) {
    assert.equal(layout[name], true, `${name}: ${JSON.stringify(layout)}`);
  }
  assert.equal(layout.contentOverflow, false);
  assert.equal(layout.documentOverflow, false);
  return layout;
}

for (const [width, height] of [[320, 740], [390, 844], [1200, 900]]) {
  test(`order card real touch/keyboard, independent controls and context restoration at ${width}px`,
    { timeout: 120_000, skip: !browser && 'Chrome unavailable' }, async t => {
      const { cleanup, url } = await serve();
      try {
        await withAttachmentBrowser(browser, { width, height }, async api => {
          await api.command('Network.enable');
          await api.navigate(url);
          await api.wait(`document.documentElement.dataset.ready === 'true'`);
          const native = await api.evaluate(`(() => {
            const button=document.querySelector(${JSON.stringify(trigger('400'))});
            return { tag:button?.tagName,type:button?.type,disabled:button?.disabled };
          })()`);
          assert.equal(native.tag, 'BUTTON', 'ID must be a native [data-order-linked-open] button');
          assert.equal(native.type, 'button');
          assert.equal(native.disabled, false);
          await assertCueLayout(api, '400');

          // Non-default query + status filter + sort and page two, with actual
          // real pagination input. Context must survive every report opening.
          await api.evaluate(`(() => {
            const root=document.querySelector('.og-overlay');
            root.querySelector('[name="search"]').value='sintético';
            root.querySelector('[name="status"]').value='PENDENTE AUDITORIA';
            root.querySelector('[name="sort"]').value='created-asc';
            root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          })()`);
          await api.wait(`document.querySelector('[name="search"]').value === 'sintético'`);
          await reveal(api, '.og-pagination button:last-child');
          await api.tap('.og-pagination button:last-child');
          await api.wait(`document.querySelector('.og-page-label').textContent === 'Página 2 de 3'`);
          const id = '388';
          assert.equal(await api.evaluate(`document.querySelector('.og-card').dataset.itemId`), '390');
          const hits = [];
          for (const [target, dismissal] of [
            [trigger(id), 'close'], [`${card(id)} h2`, 'Escape'],
            [`${card(id)} .og-open-cue span`, 'close'], [`${card(id)} .og-open-cue svg`, 'Escape'],
            [`${card(id)} .og-card-fields dd`, 'close'],
            [`${card(id)} .og-value-cluster--total`, 'Escape'],
          ]) {
            await reveal(api, target);
            const before = await context(api);
            assert.ok(before.scrollTop > 0, 'Exercise a real nonzero gallery scroll position');
            const count = (await state(api)).reports.length;
            hits.push(await touchContent(api, id, target));
            await assertReport(api, id);
            assert.equal((await state(api)).reports.length, count + 1, 'One touch must open exactly one report');
            if (target.endsWith('h2')) await screenshot(api, `orders-linked-report-${width}`);
            if (dismissal === 'Escape') await key(api, 'Escape');
            else await api.tap(close);
            await assertRestored(api, before, id);
          }

          // Native Tab navigation is tested before native Enter/Space activation.
          await reveal(api, trigger(id));
          await api.evaluate(`document.querySelector(${JSON.stringify(`${card(id)} [data-action="attachments"]`)}).focus()`);
          await key(api, 'Tab');
          assert.equal(await api.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(trigger(id))})`), true);
          for (const name of ['Enter', 'Space']) {
            const before = await context(api);
            const count = (await state(api)).reports.length;
            await key(api, name);
            await assertReport(api, id);
            assert.equal((await state(api)).reports.length, count + 1, `${name} must open exactly one report`);
            await key(api, 'Escape');
            await assertRestored(api, before, id);
          }

          const linkedCount = (await state(api)).reports.length;
          for (const action of ['attachments', 'edit', 'delete']) {
            const selector = `${card(id)} [data-action="${action}"]`;
            await reveal(api, selector);
            await api.tap(selector); // Helper asserts the sibling really wins hit testing.
            if (action === 'attachments') await api.wait(`${fixture}.snapshot().media.length === 1`);
            else {
              await api.wait(`document.querySelector('[data-gallery-record-dialog]')`);
              if (action === 'edit') {
                await api.wait(`${fixture}.snapshot().editors.length === 1`);
                await api.wait(`document.querySelector('[data-form-cancel],[data-gallery-editor-cancel]')`);
                await key(api, 'Escape');
              } else await api.tap('[data-gallery-confirm="no"]');
              await api.wait(`!document.querySelector('[data-gallery-record-dialog]')`);
            }
            assert.equal((await state(api)).reports.length, linkedCount, `${action} must not open linked report`);
            assert.equal(await api.evaluate(`document.querySelector('.og-detail').hidden`), true);
          }
          const final = await state(api);
          assert.deepEqual(final.editors, [id]);
          assert.deepEqual(final.media, [[`pedido-${id}.pdf`]]);
          assert.deepEqual(final.reports.map(request => request.id), Array(8).fill(id));
          assert.equal(final.writes, 0);
          assert.equal(final.loads, 1);
          assert.deepEqual(final.errors, []);

          await reveal(api, trigger(id));
          const layout = await api.evaluate(`(() => {
            const root=document.querySelector('.og-overlay'),content=root.querySelector('.og-content');
            const button=document.querySelector(${JSON.stringify(trigger(id))}),r=button.getBoundingClientRect();
            return { width:r.width,height:r.height,viewport:innerWidth,
              scrollTop:content.scrollTop,scrollbarGutter:content.offsetWidth-content.clientWidth,
              documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
              contentOverflow:content.scrollWidth>content.clientWidth+1,
              cardsFit:[...root.querySelectorAll('.og-card')].every(node=>{
                const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}) };
          })()`);
          assert.ok(layout.width >= 44 && layout.height >= 44, `ID target must be at least 44px: ${JSON.stringify(layout)}`);
          assert.equal(layout.documentOverflow, false);
          assert.equal(layout.contentOverflow, false);
          assert.equal(layout.cardsFit, true);
          if (width === 1200) assert.ok(layout.scrollbarGutter > 0, 'Desktop hit tests must include the standard scrollbar gutter');
          await screenshot(api, `orders-linked-card-${width}`);
          const cueLayout = await assertCueLayout(api, id);
          await api.evaluate(`(() => {
            const card = document.querySelector(${JSON.stringify(card(id))});
            card.querySelector('h2').textContent = 'FORNECEDOR SINTÉTICO COM NOME EXTENSO ' + 'ARMAÇÕES'.repeat(12);
            card.querySelector('[data-order-linked-open]').textContent = '999999999999999';
          })()`);
          await reveal(api, trigger(id));
          const longHeaderLayout = await assertCueLayout(api, id);
          await screenshot(api, `orders-linked-card-long-${width}`);
          const requests = api.events.filter(event => event.method === 'Network.requestWillBeSent')
            .map(event => event.params.request).filter(request => /^https?:/.test(request.url));
          assert.ok(requests.every(request => new URL(request.url).origin === new URL(url).origin), 'No live network requests');
          assert.ok(requests.every(request => request.method === 'GET'), 'No network data writes');
          t.diagnostic(JSON.stringify({ width, layout, cueLayout, longHeaderLayout, hits, final }));
        });
      } finally { await cleanup(); }
    });
}

test('linked card error/retry, wrong-order response and cancelled stale reads use the real report panel',
  { timeout: 90_000, skip: !browser && 'Chrome unavailable' }, async t => {
    const { cleanup, url } = await serve();
    try {
      await withAttachmentBrowser(browser, { width: 390, height: 844 }, async api => {
        await api.navigate(url);
        await api.wait(`document.documentElement.dataset.ready === 'true'`);
        assert.equal(await api.evaluate(`document.querySelector(${JSON.stringify(trigger('400'))})?.tagName`), 'BUTTON');
        await reveal(api, trigger('400'));
        const retryContext = await context(api);
        await api.evaluate(`${fixture}.mode('error')`);
        await touchContent(api, '400', trigger('400'));
        await api.wait(`document.querySelector('.olr-failure')`);
        assert.match(await api.evaluate(`document.querySelector('.olr-failure').textContent`), /Falha sintética/);
        assert.equal(await api.evaluate(`!!document.querySelector('.olr-report,.olr-summary')`), false);
        await api.tap('.olr-failure button');
        await assertReport(api, '400');
        assert.deepEqual((await state(api)).reports.map(request => request.id), ['400', '400']);
        await api.tap(close);
        await assertRestored(api, retryContext, '400');

        await api.evaluate(`${fixture}.mode('wrong')`);
        await touchContent(api, '400', trigger('400'));
        await api.wait(`document.querySelector('.olr-failure')`);
        assert.match(await api.evaluate(`document.querySelector('.olr-failure').textContent`), /pedido selecionado/);
        assert.equal(await api.evaluate(`!!document.querySelector('.olr-report')`), false, 'Wrong order must not render');
        await key(api, 'Escape');

        await api.evaluate(`${fixture}.mode('hold')`);
        await touchContent(api, '400', trigger('400'));
        await api.wait(`document.querySelector('.og-detail').getAttribute('aria-busy') === 'true'`);
        assert.equal(await api.evaluate(`!!document.querySelector('.olr-loading')`), true);
        await key(api, 'Escape');
        assert.equal((await state(api)).reports[3].aborted, true);
        await touchContent(api, '399', `${card('399')} h2`);
        await assertReport(api, '399');
        await api.evaluate(`${fixture}.release(3)`);
        await settle(api);
        await assertReport(api, '399');
        await api.tap(close);

        await api.evaluate(`${fixture}.mode('hold')`);
        await touchContent(api, '399', trigger('399'));
        await api.tap(close);
        assert.equal((await state(api)).reports[5].aborted, true);
        await api.evaluate(`${fixture}.release(5)`);
        await settle(api);
        assert.equal(await api.evaluate(`document.querySelector('.og-detail').hidden && !document.querySelector('.og-detail').children.length`), true);
        const final = await state(api);
        assert.deepEqual(final.reports.map(request => request.id), ['400', '400', '400', '400', '399', '399']);
        assert.equal(final.loads, 1);
        assert.equal(final.writes, 0);
        assert.deepEqual(final.editors, []);
        assert.deepEqual(final.errors, []);
        t.diagnostic(JSON.stringify(final));
      });
    } finally { await cleanup(); }
  });
