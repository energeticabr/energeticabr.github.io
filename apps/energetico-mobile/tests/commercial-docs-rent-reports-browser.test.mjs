import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(path => path && existsSync(path));
const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("relatórios 16 e 17 abrem no hub e cabem em 844×390 e 740×360", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chrome/Edge indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    for (const [width, height] of [[844, 390], [740, 360]]) for (const scenario of ["report=16", "report=16&detail=1", "report=17"]) {
      const { stdout } = await run(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-dev-shm-usage",
        `--window-size=${width + (process.platform === "win32" ? 26 : 0)},${height}`, "--virtual-time-budget=3000", "--dump-dom",
        `http://127.0.0.1:${port}/tests/fixtures/commercial-docs-rent-reports-responsive.html?${scenario}`,
      ], { timeout: 30_000, maxBuffer: 3_000_000 });
      const match = /data-layout="([^"]+)"/.exec(stdout);
      assert.ok(match, `Medição não concluída em ${width}px`);
      const layout = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
      assert.equal(layout.viewport, width);
      assert.equal(layout.report.visible, true, `Relatório não abriu no hub em ${width}px (${scenario})`);
      assert.ok(layout.report.width > 0, `Relatório sem largura em ${width}px (${scenario})`);
      if (scenario === "report=16") assert.equal(layout.report.branchCards, 1);
      if (scenario === "report=16&detail=1") assert.equal(layout.report.propertyCards, 1);
      if (scenario === "report=17") assert.equal(layout.report.rentCards, 1);
      assert.ok(layout.document <= width + 1, `Documento transborda em ${width}px (${scenario}): ${JSON.stringify(layout)}`);
      assert.ok(layout.shell.scrollWidth <= layout.shell.width + 1, `Tela integrada exige rolagem lateral em ${width}px (${scenario})`);
      assert.ok(layout.report.width <= width + 1, `Relatório ultrapassa ${width}px (${scenario})`);
      assert.ok(layout.report.scrollWidth <= layout.report.width + 1, `Relatório exige rolagem lateral em ${width}px (${scenario})`);
      assert.equal(layout.report.childOverflow, false, `Conteúdo fora da viewport em ${width}px (${scenario})`);
    }
  } finally { await server.close(); }
});
