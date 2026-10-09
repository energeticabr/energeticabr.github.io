import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { runBrowserLayout } from "./helpers/browser-layout-runner.mjs";

test("quatro totais legíveis em duas colunas no celular e alinhados no tablet e PC, com cores por rubrica", { timeout: 180_000 }, async t => {
  const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(path => path && existsSync(path));
  if (!browser) return t.skip("Chrome unavailable");
  const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const pwa = await build({ configFile: false, root: join(appRoot, "pwa"), base: "/energetico/", logLevel: "silent", build: { write: false } });
  const css = pwa.output.filter(asset => asset.type === "asset" && asset.fileName.endsWith(".css")).map(asset => asset.source).join("\n");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent",
    plugins: [{ name: "payroll-summary-test-css", configureServer(server) {
      server.middlewares.use("/__payroll-summary.css", (_request, response) => { response.setHeader("Content-Type", "text/css"); response.end(css); });
    } }] });
  try {
    await server.listen();
    for (const pwaStyles of [false, true]) {
      for (const width of [320, 390, 768, 1024, 1365]) {
        const query = new URLSearchParams({ ...(pwaStyles ? { pwa: "1" } : {}), large: "1" });
        const { stdout } = await runBrowserLayout(browser, { width, height: 900, url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/payroll-summary-colors.html?${query}` });
        const layout = JSON.parse(stdout.match(/data-layout="([^"]+)"/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
        assert.equal(layout.columns, width < 760 ? 2 : 4, JSON.stringify({ width, pwaStyles, layout }));
        assert.equal(layout.totals.length, 4);
        assert.ok(layout.totals.every(card => card.fits));
        assert.ok(layout.valuesFit && layout.contentFits, JSON.stringify({ width, pwaStyles, layout }));
        if (width >= 760) assert.ok(layout.totals.every(card => Math.abs(card.y - layout.totals[0].y) < 1));
        assert.equal(new Set(layout.colors).size, 7);
        assert.equal(layout.colors[0], layout.colors[1]);
        assert.equal(layout.matchingColors, true);
      }
    }
  } finally {
    await server.close();
  }
});
