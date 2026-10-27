import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadingIndicatorMarkup, createLoadingIndicator, updateLoadingIndicator } from '../src/ui/loading-indicator.js';
import { renderChatMarkup } from '../src/ui/chat-view.js';

function assertBadge(root, text, value) {
  const spinner = root.querySelector('.app-loading__spinner');
  const badges = root.querySelectorAll('[role="progressbar"]');
  assert.equal(badges.length, 1, 'every mascot loader has exactly one percentage cluster');
  assert.equal(spinner.nextElementSibling, badges[0], 'percentage follows the spinner in the same row');
  assert.equal(badges[0].textContent, text);
  assert.equal(badges[0].getAttribute('aria-valuenow'), value);
  return badges[0];
}

for (const factory of ['markup', 'dom']) for (const compact of [false, true]) {
  test(`${factory}, compact=${compact}: omitted progress starts with a visible 0% cluster`, t => {
    const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
    const root = dom.window.document.querySelector('main');
    if (factory === 'markup') root.innerHTML = loadingIndicatorMarkup('Processando sua resposta…', { compact });
    else root.append(createLoadingIndicator(dom.window.document, 'Carregando informações…', { compact }));
    const badge = assertBadge(root, '0%', '0');
    assert.equal(badge.getAttribute('aria-label'), 'Progresso do carregamento');
  });
}

for (const [progress, text, value] of [[37.9, '37%', '37'], [100, '100%', '100'],
    [null, '—%', null], [NaN, '—%', null], [Infinity, '—%', null],
    [-1, '—%', null], [101, '—%', null], ['<img src=x>', '—%', null]]) {
  test(`markup and DOM retain the same measured/unknown state: ${String(progress)}`, t => {
    const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
    const document = dom.window.document, markup = document.querySelector('main');
    markup.innerHTML = loadingIndicatorMarkup('Carregando…', { progress, progressLabel: 'Download do anexo' });
    const created = createLoadingIndicator(document, 'Carregando…', { progress, progressLabel: 'Download do anexo' });
    for (const root of [markup, created]) {
      const badge = assertBadge(root, text, value);
      assert.equal(badge.getAttribute('aria-label'), 'Download do anexo');
      if (value === null) assert.match(badge.getAttribute('aria-valuetext'), /não informado/);
      assert.equal(root.querySelectorAll('img').length, 1, 'untrusted progress cannot inject markup');
    }
  });
}

test('label changes retain measured progress and updating a value reuses its nodes', t => {
  const dom = new JSDOM(); t.after(() => dom.window.close());
  const root = createLoadingIndicator(dom.window.document, 'Carregando…');
  const spinner = root.querySelector('.app-loading__spinner'), badge = assertBadge(root, '0%', '0');
  updateLoadingIndicator(root, { progress: 37, progressLabel: 'Download' });
  updateLoadingIndicator(root, { label: 'Abrindo documento…' });
  assert.equal(root.querySelector('.app-loading__text').textContent, 'Abrindo documento…');
  assert.equal(assertBadge(root, '37%', '37'), badge);
  assert.equal(badge.getAttribute('aria-label'), 'Download');
  updateLoadingIndicator(root, { progress: null });
  assertBadge(root, '—%', null);
  updateLoadingIndicator(root, { progress: 99 });
  assert.equal(assertBadge(root, '99%', '99'), badge);
  assert.equal(root.querySelector('.app-loading__spinner'), spinner);
});

for (const [stage, state] of [['response', { activeText: { id: 'qa-response' } }],
    ['next question', { responseTransitionPending: true }], ['resume', { resuming: true }],
    ['provision opening', { pendingProvisionOpening: true }]]) {
  test(`actual chat ${stage} includes the cluster without attachment progress`, t => {
    const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'QA' },
      messages: [], pendingFiles: [], ...state }));
    t.after(() => dom.window.close());
    const badge = assertBadge(dom.window.document.querySelector('.chat-progress'), '0%', '0');
    assert.equal(badge.getAttribute('aria-label'), 'Progresso do carregamento', 'generic steps describe their own loading rather than an attachment transfer');
  });
}
