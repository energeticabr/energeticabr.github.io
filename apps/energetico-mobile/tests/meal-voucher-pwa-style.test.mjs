import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('PWA entrega o preenchimento verde das linhas selecionadas do vale-alimentação', async () => {
  const built = await build({
    configFile: false,
    root: fileURLToPath(new URL('../pwa/', import.meta.url)),
    base: '/energetico/',
    logLevel: 'silent',
    build: { write: false },
  });
  const css = built.output.filter(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'))
    .map(asset => asset.source).join('\n');
  assert.ok(/\.meal-voucher-selected-row\{[^}]*background:#d7f1de/i.test(css), 'o CSS compilado da PWA deve pintar a linha selecionada de verde');
});
