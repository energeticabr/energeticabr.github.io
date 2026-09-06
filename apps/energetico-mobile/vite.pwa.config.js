import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectDir = dirname(fileURLToPath(import.meta.url));
const pwaDir = resolve(projectDir, "pwa");
const outputDir = resolve(projectDir, "dist-pwa");

function copyPwaStatics() {
  return {
    name: "copy-pwa-statics",
    async closeBundle() {
      await mkdir(resolve(outputDir, "icons"), { recursive: true });
      await cp(resolve(pwaDir, "manifest.webmanifest"), resolve(outputDir, "manifest.webmanifest"));
      await cp(resolve(pwaDir, "service-worker.js"), resolve(outputDir, "service-worker.js"));
      await cp(resolve(pwaDir, "icons"), resolve(outputDir, "icons"), { recursive: true });
      await cp(resolve(pwaDir, "downloads"), outputDir, { recursive: true });
      // PDF.js reads these resources by name; keep them on the app's own origin.
      for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        await cp(resolve(projectDir, "node_modules/pdfjs-dist", directory), resolve(outputDir, "pdfjs", directory), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: pwaDir,
  base: "/energetico/",
  build: { outDir: outputDir, emptyOutDir: true, sourcemap: true },
  plugins: [copyPwaStatics()],
});
