import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';

const browser = [process.env.CHROME_BIN, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
let server, baseUrl;
before(async () => {
  if (!browser) return;
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/flow-summary-layout.html`;
});
after(async () => { await server?.close(); });
async function measure(width, height, query) {
  const { stdout } = await runBrowserLayout(browser, { width, height, url: `${baseUrl}?${query}` });
  return JSON.parse(/data-layout="([^"]+)"/.exec(stdout)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

for (const [width,height] of [[768,1024],[1024,768],[1365,900]]) {
  for (const mode of ['explicit','fallback']) test(`resumo alto ${mode} ocupa largura e rola no tablet ${width}`, { skip: !browser, timeout: 45000 }, async () => {
    const layout = await measure(width,height,`mode=${mode}`);
    assert.ok(Math.abs(layout.base.imageWidth-layout.base.availableWidth)<=2, `resumo comprimido no centro: ${JSON.stringify(layout.base)}`);
    assert.ok(layout.base.imageHeight>layout.base.availableHeight*2, 'altura mantém texto legível');
    assert.ok(layout.scrolled.scrollTop>0, 'resumo permite alcançar linhas abaixo da área visível');
    assert.ok(layout.base.scrollWidth<=layout.base.clientWidth+1, 'sem rolagem horizontal na escala base');
    assert.ok(layout.zoomed.imageWidth>layout.base.imageWidth*1.5 && layout.zoomed.imageWidth<layout.base.imageWidth*1.6, 'pinça parte da largura legível');
    assert.equal(layout.originalShared,true,'compartilha os bytes e o Blob originais');
    assert.equal(layout.sharedName,layout.fileName);
    assert.equal(layout.closed,true);
    assert.equal(layout.focusReturned,true);
    assert.equal(layout.draft,'Rascunho preservado');
  });
  test(`foto comum continua ajustada à altura no tablet ${width}`, { skip: !browser, timeout: 45000 }, async () => {
    const { base } = await measure(width,height,'mode=photo');
    assert.ok(base.imageHeight<=base.availableHeight+1);
    assert.ok(base.imageWidth<base.availableWidth*.5);
  });
}

for (const width of [320,390]) test(`resumo mantém ajuste e pinça do celular ${width}`, { skip: !browser, timeout: 45000 }, async () => {
  const { base, zoomed, originalShared } = await measure(width,844,'mode=explicit');
  assert.ok(base.imageHeight<=base.availableHeight+1);
  assert.ok(zoomed.imageWidth>base.imageWidth*1.5 && zoomed.imageWidth<base.imageWidth*1.6, JSON.stringify({base,zoomed}));
  assert.equal(originalShared,true);
});

test('resumo recalcula base legível ao girar tablet e preserva zoom inclusive ao passar pelo celular', { skip: !browser, timeout: 45000 }, async () => {
  const { stages: [base, zoomed, landscape, phone, portrait] } = await measure(1365,1100,'orientation=1');
  assert.ok(Math.abs(base.imageWidth-base.availableWidth)<=2);
  for (const stage of [zoomed,landscape,portrait]) {
    assert.ok(stage.imageWidth/stage.availableWidth>1.5 && stage.imageWidth/stage.availableWidth<1.6, `zoom sobre base atual: ${JSON.stringify(stage)}`);
  }
  assert.ok(phone.imageHeight/phone.availableHeight>1.5 && phone.imageHeight/phone.availableHeight<1.6, 'telefone mantém base ajustada e zoom atual');
});
