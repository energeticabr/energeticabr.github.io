import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('Gantt alinha SUPRIMIR à esquerda de INICIAR e abre os formulários no celular e PC', { timeout: 90000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  try {
    await server.listen();
    for (const [width, height] of [[320,740], [390,844], [844,390], [1365,900]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/gantt-finish.html` });
      const dom = new JSDOM(stdout);
      try {
        const result = JSON.parse(dom.window.document.documentElement.dataset.layout);
        assert.equal(result.rows.length, 3);
        assert.ok(result.rows.every(row => row.below && row.inside && row.touch), JSON.stringify({ width, result }));
        assert.ok(result.rows.every(row => row.cardColor === 'rgb(13, 77, 97)'));
        assert.deepEqual(result.rows.map(row => row.disabled), [true, false, true]);
        assert.deepEqual(result.completed, [
          { color: 'rgb(36, 114, 58)', button: false },
          { color: 'rgb(36, 114, 58)', button: false },
        ]);
        assert.equal(result.date, '2026-11-17');
        assert.ok(result.visible && result.formFits, JSON.stringify({ width, result }));
        assert.deepEqual(result.startDialog, { startFits: true, touch: true, date: '', visible: true }, JSON.stringify({ width, result }));
        assert.deepEqual(result.visibility, { nextToStart: true, inside: true, touch: true, filterFits: true,
          filterOptions: ['EXIBIR', 'NÃO EXIBIR'] }, JSON.stringify({ width, result }));
        assert.deepEqual(result.confirmationLayout, { fits: true, touch: true, focus: true }, JSON.stringify({ width, result }));
        assert.deepEqual(result.colors, { suppress: 'rgb(170, 40, 57)', suppressDisabled: 'rgb(219, 226, 232)',
          restore: 'rgb(234, 243, 246)', start: 'rgb(230, 133, 36)', finish: 'rgb(36, 114, 58)', disabled: 'rgb(219, 226, 232)' });
        const { before, after, expanded, notice, focused } = result.submission;
        assert.equal(notice, 'Atividade finalizada.');
        assert.equal(expanded, 'true');
        assert.equal(focused, true);
        assert.ok(before.top > 0 && before.left > 0, JSON.stringify({ width, before }));
        assert.deepEqual(after, before, `A posição do Gantt mudou após submeter em ${width}×${height}`);
      } finally { dom.window.close(); }
    }
  } finally { await server.close(); }
});
