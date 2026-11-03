import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { withAttachmentBrowser } from './helpers/attachment-browser-driver.mjs';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(path => path && existsSync(path));

test('order date stays left of the pencil and below an intact supplier line on phone, tablet and Windows', { timeout: 120000 }, async t => {
  if (!browser) return t.skip('Chrome unavailable');
  const server = await createServer({ root: appRoot, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve(appRoot, '../..')] } } });
  await server.listen();
  t.after(() => server.close());
  await withAttachmentBrowser(browser, { width: 390, height: 950 }, async api => {
    for (const width of [320, 390, 768, 1024, 1365]) {
      await api.command('Emulation.setDeviceMetricsOverride', { width, height: 950, deviceScaleFactor: 1, mobile: width < 600 });
      await api.navigate(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/orders-gallery-responsive.html?date-width=${width}`);
      await api.wait('document.documentElement.dataset.ready === "true"');
      await api.evaluate(`document.querySelector('.og-card[data-item-id="353"] h2').textContent = 'FORNECEDOR FICTÍCIO DE MATERIAIS'; document.querySelector('.og-card[data-item-id="351"] h2').textContent = 'FORNECEDOR EXEMPLO'`);
      for (const longName of [false, true]) {
        if (longName) await api.evaluate(`document.querySelector('.og-card[data-item-id="353"] h2').textContent = 'FORNECEDOR FICTÍCIO DE MATERIAIS E SERVIÇOS COM NOME EXTENSO PARA CONFERIR A QUEBRA DE LINHAS DO CARTÃO'`);
        const layout = await api.evaluate(`(() => {
          const cards = [...document.querySelectorAll('.og-order-card')];
          const rect = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
          return { documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
            cards:cards.map(card => {
              const date=card.querySelector('.og-order-date'), title=card.querySelector('h2');
              const pencil=card.querySelector('[data-gallery-action="edit"]');
              return { title:rect(title),date:date&&rect(date),pencil:rect(pencil),status:rect(card.querySelector('.og-status')),
                cardOverflow:card.scrollWidth>card.clientWidth+1,titleOverflow:title.scrollWidth>title.clientWidth+1,
                dateText:date?.querySelector('.og-order-date-value')?.textContent,
                dateStyle:date&&{background:getComputedStyle(date).backgroundColor,radius:getComputedStyle(date).borderRadius} };
            }) };
        })()`);
        assert.equal(layout.documentOverflow, false, JSON.stringify({width,longName,layout}));
        for (const [i, card] of layout.cards.entries()) {
          assert.ok(card.date, 'date cluster rendered');
          assert.equal(card.dateText, i === 0 ? '25/10/2026' : '—');
          assert.ok(card.date.right <= card.pencil.left - 1, JSON.stringify({width,longName,card}));
          assert.ok(card.date.top >= card.title.bottom + 1, JSON.stringify({width,longName,card}));
          assert.equal(card.cardOverflow || card.titleOverflow, false, JSON.stringify({width,longName,card}));
          assert.ok(card.status.height <= 32, `status words must remain readable: ${JSON.stringify({width,longName,card})}`);
          assert.notEqual(card.dateStyle.background, 'rgba(0, 0, 0, 0)');
          assert.notEqual(card.dateStyle.radius, '0px');
        }
        t.diagnostic(`${width}px ${longName?'long':'short'} supplier: date left of pencil, below supplier, no overflow`);
        if (process.env.ORDERS_DATE_SCREENSHOTS && !longName) {
          await mkdir(process.env.ORDERS_DATE_SCREENSHOTS, { recursive: true });
          const shot = await api.command('Page.captureScreenshot', { format: 'png' });
          await writeFile(resolve(process.env.ORDERS_DATE_SCREENSHOTS, `orders-date-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
      }
    }
  });
});
