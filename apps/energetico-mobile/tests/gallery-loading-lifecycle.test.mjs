import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGalleryLoadingScreen } from '../src/ui/gallery-loading-screen.js';

function setup(t) {
  const dom = new JSDOM('<section><header><button>Voltar</button></header><main aria-hidden="false">Dados</main><aside aria-hidden="true">Ferramenta oculta</aside></section>');
  const root = dom.window.document.querySelector('section'), header = root.querySelector('header');
  const content = root.querySelector('main'), aside = root.querySelector('aside');
  aside.inert = true;
  const dimensions = { bottom: 80 };
  header.getBoundingClientRect = () => ({ bottom: dimensions.bottom });
  const screen = createGalleryLoadingScreen({ root, header, label: 'Carregando dados…' });
  t.after(() => { screen.destroy(); dom.window.close(); });
  return { dom, root, header, content, aside, dimensions, screen };
}

test('loader restores pre-existing accessibility state after repeated busy updates', t => {
  const { root, header, content, aside, screen } = setup(t);
  screen.sync(true); screen.sync(true);
  assert.equal(content.inert, true);
  assert.equal(content.getAttribute('aria-hidden'), 'true');
  assert.notEqual(header.inert, true);
  screen.sync(false);
  assert.equal(content.inert, false);
  assert.equal(content.getAttribute('aria-hidden'), 'false');
  assert.equal(aside.inert, true);
  assert.equal(aside.getAttribute('aria-hidden'), 'true');
  assert.equal(root.dataset.galleryLoading, 'false');
  assert.equal(screen.element.hidden, true);
});

test('loader moves below the new header height on orientation resize and detaches on destroy', t => {
  const { dom, dimensions, screen, content } = setup(t);
  screen.sync(true);
  assert.equal(screen.element.style.top, '80px');
  dimensions.bottom = 124;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(screen.element.style.top, '124px');
  screen.destroy();
  dimensions.bottom = 45;
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  screen.sync(true);
  assert.equal(screen.element.style.top, '124px');
  assert.equal(screen.element.isConnected, false);
  assert.equal(content.inert, false);
});

test('new content created during loading is covered and released by subsequent busy updates', t => {
  const { dom, root, screen } = setup(t);
  screen.sync(true);
  const notice = dom.window.document.createElement('div');
  notice.textContent = 'Novo total parcial'; root.append(notice);
  screen.sync(true);
  assert.equal(notice.inert, true);
  assert.equal(notice.getAttribute('aria-hidden'), 'true');
  screen.sync(false);
  assert.equal(notice.inert, false);
  assert.equal(notice.hasAttribute('aria-hidden'), false);
});

test('scoped loader clips to results and scroll viewport without masking the toolbar', t => {
  const dom = new JSDOM('<section><header></header><main><input><div class="results"><article>Old result</article></div></main></section>');
  const doc = dom.window.document, header = doc.querySelector('header'), viewport = doc.querySelector('main');
  const root = doc.querySelector('.results'), input = doc.querySelector('input'), card = root.firstElementChild;
  const rect = { top: 210, bottom: 1000, left: 12, right: 378 };
  header.getBoundingClientRect = () => ({ bottom: 80 });
  viewport.getBoundingClientRect = () => ({ top: 80, bottom: 844, left: 0, right: 390 });
  root.getBoundingClientRect = () => rect;
  const screen = createGalleryLoadingScreen({ root, header, viewport, label: 'Recalculando' });
  t.after(() => { screen.destroy(); dom.window.close(); });
  input.focus(); screen.sync(true);
  assert.equal(screen.element.style.top, '210px');
  assert.equal(screen.element.style.height, '558px');
  assert.equal(screen.element.style.left, '12px');
  assert.equal(screen.element.style.width, '366px');
  assert.equal(input.closest('[inert], [aria-hidden="true"]'), null);
  assert.equal(doc.activeElement, input); assert.equal(card.inert, true);
  rect.top = 90; viewport.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(screen.element.style.top, '90px');
  rect.top = -100; dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(screen.element.style.top, '80px');
  screen.destroy(); rect.top = 200; viewport.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(screen.element.style.top, '80px'); assert.equal(card.inert, false);
});
