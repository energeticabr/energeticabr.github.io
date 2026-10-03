import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  server: {
    watch: { ignored: ["**/dist/**", "**/dist-pwa/**"] },
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../../assets", import.meta.url)),
      ],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
