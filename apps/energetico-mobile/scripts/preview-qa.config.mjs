import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(app, 'dist/preview-qa');
export default defineConfig({
  root: app,
  base: '/energetico/',
  build: { outDir: output, emptyOutDir: true, rollupOptions: { input: resolve(app, 'tests/fixtures/attachment-preview.html') } },
  plugins: [{ name: 'local-preview-pdf-assets', async closeBundle() {
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      await cp(resolve(app, 'node_modules/pdfjs-dist', folder), resolve(output, 'pdfjs', folder), { recursive: true });
    }
  } }],
});
