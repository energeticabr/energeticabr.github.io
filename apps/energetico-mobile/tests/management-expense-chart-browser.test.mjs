import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('gráfico de despesas preenche a largura e conserva os valores legíveis ao girar a tela', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');

  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent',
  });
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/management-expense-chart.html`;
    for (const [width, height] of [[1280, 589], [844, 390], [390, 844], [568, 320], [320, 568]]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, url });
      const dom = new JSDOM(stdout);
      try {
        const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
        const details = `${width}×${height}: ${JSON.stringify(layout)}`;
        assert.ok(layout.coverage > (Math.max(width, height) <= 568 ? 0.75 : 0.80), details);
        assert.ok(layout.valueHeight >= 14 && layout.monthHeight >= 14 && layout.rankSize >= 13, details);
        assert.ok(layout.noOverlap && layout.detailVisible && layout.months === 12 && layout.resized > 65, details);
        assert.match(layout.lastLabel, /137,2\s+mil/);
        assert.match(layout.detail.replace(/\u00a0/g, ' '), /dez\/26.*R\$ 137\.200,00/);
        assert.ok(layout.yearFits && layout.yearRetainedFocus, details);
        assert.equal(layout.switchedYear, 'jan/24', details);
        assert.deepEqual(layout.equalMonthLabels, ['paid'], details);
        assert.equal(layout.sharedColor, 'rgb(0, 0, 0)', details);
        assert.deepEqual(layout.differentMonthColors, ['rgb(48, 84, 150)', 'rgb(20, 108, 67)'], details);
        assert.deepEqual([layout.totalOnlyColor, layout.paidOnlyColor], layout.differentMonthColors, details);
        assert.equal(layout.selectedRankVisible, true, details);
      } finally {
        dom.window.close();
      }
    }
  } finally {
    await server.close();
  }
});
