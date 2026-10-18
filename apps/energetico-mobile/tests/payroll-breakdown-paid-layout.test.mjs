import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

test('PREVISTO, PAGO e TOTAL ficam visíveis sem rolagem horizontal no celular e no desktop', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN,'/usr/bin/chromium','/usr/bin/google-chrome'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel:'silent', server:{host:'127.0.0.1',port:0} });
  await server.listen(); t.after(() => server.close());
  for (const width of [320,589,1024]) {
    const { stdout } = await runBrowserLayout(browser, { width, height:960, mobile:width<700,
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-breakdown.html?measure=1` });
    const dom = new JSDOM(stdout); const layout = JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    assert.deepEqual(layout.headings,['Rubrica','PREVISTO','PAGO','TOTAL']);
    assert.ok(layout.left >= 0 && layout.right <= width + 1, JSON.stringify(layout));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
    assert.match(layout.salary[1], /500,00/); assert.match(layout.salary[2], /1\.234,56/); assert.match(layout.total[2], /1\.434,56/);
    assert.match(layout.salary[3], /1\.734,56/); assert.match(layout.total[3], /1\.934,56/);
  }
});
