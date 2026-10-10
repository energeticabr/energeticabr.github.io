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
