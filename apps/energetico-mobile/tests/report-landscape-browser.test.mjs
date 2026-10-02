import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createServer } from "vite";

const exec = promisify(execFile);
const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browser = [
  process.env.CHROME_BIN,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(path => path && existsSync(path));

test("Relatórios 1 e 2 não exigem rolagem lateral em telefone horizontal, mesmo com texto longo", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chromium/Chrome indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "silent" });
  const profile = mkdtempSync(join(tmpdir(), "energetico-report-layout-"));
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    for (const width of [667, 844]) for (const report of ["1", "2"]) {
      const url = `http://127.0.0.1:${port}/tests/fixtures/report-responsive.html?report=${report}&long=1`;
      const { stdout } = await exec(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", `--window-size=${width},390`, "--virtual-time-budget=2500",
        `--user-data-dir=${profile}-${width}-${report}`, "--dump-dom", url,
      ], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
      const html = stdout.match(/<html[^>]+>/i)?.[0] || "";
      const value = name => Number(html.match(new RegExp(`data-${name}="(\\d+)"`))?.[1]);
      assert.ok(value("viewport-width") > 0, `Relatório ${report}, ${width}px: prévia não carregou`);
      assert.ok(value("scroll-width") <= value("viewport-width"), `Relatório ${report}, ${width}px: documento transborda ${html}`);
      assert.ok(value("report-width") <= value("content-width"), `Relatório ${report}, ${width}px: conteúdo pede rolagem lateral ${html}`);
      assert.match(stdout, report === "1" ? /class="cr-table cr-main-table"/ : /class="pp-order-card"/);
    }
  } finally {
    await server.close();
    rmSync(profile, { recursive: true, force: true });
    for (const width of [667, 844]) for (const report of ["1", "2"]) {
      rmSync(`${profile}-${width}-${report}`, { recursive: true, force: true });
    }
  }
});
