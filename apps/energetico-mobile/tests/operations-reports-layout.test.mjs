import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("relatórios 6–8 cabem em 844×390 e 740×360 sem rolagem horizontal", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chromium/Chrome indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    for (const [width, height] of [[844, 390], [740, 360]]) {
      const { stdout } = await run(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-dev-shm-usage",
        `--window-size=${width + 26},${height}`, "--virtual-time-budget=3000", "--dump-dom",
        `http://127.0.0.1:${port}/tests/fixtures/operations-reports-layout.html`,
      ], { timeout: 30_000, maxBuffer: 2_000_000 });
      const match = /data-layout="([^"]+)"/.exec(stdout);
      assert.ok(match, `Medição não concluída em ${width}px`);
      const layout = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
      assert.equal(layout.viewport, width, `largura efetiva inesperada em ${width}px`);
      assert.ok(layout.document <= width + 1, `documento transborda em ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.reportWidths.length, 3);
      for (const report of layout.reportWidths) {
        assert.ok(report.width <= width + 1, `${report.report} ocupa mais de ${width}px`);
        assert.ok(report.scrollWidth <= report.width + 1, `${report.report} exige rolagem lateral`);
        assert.equal(report.childOverflow, false, `${report.report} tem conteúdo cortado fora da largura`);
      }
    }
  } finally { await server.close(); }
});
