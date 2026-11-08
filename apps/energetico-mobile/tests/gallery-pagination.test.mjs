import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDdaReportView } from '../src/ui/dda-report-view.js';
import { galleryCases, galleryOptions } from './helpers/gallery-create-cases.mjs';
import { refreshRow } from './helpers/gallery-refresh-cases.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

async function setup(t, entry, options) {
  const dom = new JSDOM('<main>Conversa</main>', { url: 'https://example.test' });
  const { document } = dom.window;
  const gallery = entry.factory(galleryOptions(entry, document, options));
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  return document.querySelector(entry.root);
}

async function assertPagination(pager, scroll) {
  const buttons = () => [...pager().querySelectorAll('button')];
  for (const [index, target] of [[1, 2], [0, 1]]) {
    scroll.scrollTop = 250;
    assert.equal(buttons()[index].disabled, false);
    buttons()[index].click();
    await settle();
    assert.match(pager().querySelector('span').textContent, new RegExp(`^Página ${target}\\b`));
    assert.equal(scroll.scrollTop, 0);
  }
}

for (const name of ['tasks', 'orders', 'payments', 'recurring', 'group']) {
  test(`${name}: previous and next show the beginning of the rendered page`, async t => {
    const entry = galleryCases.find(candidate => candidate.name === name);
    const rows = Array.from({ length: 25 }, (_, index) => refreshRow(entry, String(100 + index)));
    const root = await setup(t, entry, { snapshot: { rows, count: rows.length } });
    await assertPagination(() => root.querySelector('.og-pagination, .rg-pagination'), root.querySelector('.og-content') || root);
  });
}

for (const name of ['launch', 'IDFOLHA', 'FOLHAPGTO']) {
  test(`${name}: successful requested pages scroll to the beginning, including a retry`, async t => {
    const entry = galleryCases.find(candidate => candidate.name === name);
    let failNext = false, release;
    const request = async (kind, payload) => {
      const page = name === 'launch' ? payload.page : payload;
      if (failNext && page === 2) {
        failNext = false;
        await new Promise(resolve => { release = resolve; });
        throw new Error('Falha de teste ao trocar de página');
      }
      return { gallery: kind, page, rows: [refreshRow(entry, String(page))], pages: 2, count: 2,
        hasMore: page === 1, nextCursor: page === 1 ? 'page-2' : null };
    };
    const root = await setup(t, entry, { request });
    const pager = () => root.querySelector('.lg-pagination, .hr-gallery-pagination');
    const scroll = root.querySelector('.lg-content, .hr-gallery-content');
    await assertPagination(pager, scroll);
    scroll.scrollTop = 250;
    failNext = true;
    pager().querySelector('button:last-child').click();
    assert.equal(scroll.scrollTop, 250, 'a página ainda não foi recebida');
    release();
    await settle();
    assert.equal(scroll.scrollTop, 250);
    const retry = [...root.querySelectorAll('button')].find(button => button.textContent === 'Tentar novamente');
    assert.ok(retry);
    retry.click();
    await settle();
    assert.match(pager().querySelector('span').textContent, /^Página 2\b/);
    assert.equal(scroll.scrollTop, 0);
  });
}

test('DDA report pagination resets the vertical position and keeps the horizontal position', async t => {
  const entry = { factory: createDdaReportView, root: '.ddr-overlay' };
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: String(index + 1), fields: { Title: 'Fornecedor fictício', SITUACAO: 'Em aberto', VENCIMENTO: '2026-12-01', VALOR: 5 },
  }));
  const root = await setup(t, entry, { snapshot: { rows } });
  const scroll = root.querySelector('.ddr-content');
  scroll.scrollLeft = 90;
  await assertPagination(() => root.querySelector('.ddr-pager'), scroll);
  assert.equal(scroll.scrollLeft, 90);
});
