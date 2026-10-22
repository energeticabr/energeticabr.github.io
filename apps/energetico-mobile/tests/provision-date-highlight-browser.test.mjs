import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { runBrowserLayout } from "./helpers/browser-layout-runner.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browser = [process.env.CHROME_BIN, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find(path => path && existsSync(path));

test("G28 pinta somente a data prevista com as quatro cores e preserva o layout", { timeout: 120_000 }, async t => {
  if (!browser) return t.skip("Chrome/Edge indisponível");
  const cache = mkdtempSync(join(tmpdir(), "provision-date-vite-"));
  const server = await createServer({ root: appRoot, cacheDir: cache, logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(appRoot, "../..")] } } });
  t.after(async () => {
    await server.close();
    assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
    assert.ok(basename(cache).startsWith("provision-date-vite-"));
    rmSync(cache, { recursive: true, force: true });
  });
  await server.listen();
  const expected = {
    601: { background: "rgb(229, 246, 233)", date: "28/10/2026", deadline: "VENCE EM 6 DIAS" },
    602: { background: "rgb(255, 235, 214)", date: "27/10/2026", deadline: "VENCE EM 5 DIAS" },
    603: { background: "rgb(255, 235, 214)", date: "26/10/2026", deadline: "VENCE EM 4 DIAS" },
    604: { background: "rgb(255, 235, 214)", date: "24/10/2026", deadline: "VENCE EM 2 DIAS" },
    605: { background: "rgb(255, 247, 199)", date: "23/10/2026", deadline: "VENCE EM 1 DIA" },
    606: { background: "rgb(253, 232, 233)", date: "22/10/2026", deadline: "VENCE HOJE" },
    607: { background: "rgb(253, 232, 233)", date: "21/10/2026", deadline: "VENCIDO HÁ 1 DIA" },
  };
  for (const width of [390, 320, 1365]) {
    const result = await runBrowserLayout(browser, { width, height: 844,
      url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/provision-date-highlight.html` });
    const dom = new JSDOM(result.stdout);
    try {
      const layout = JSON.parse(dom.window.document.documentElement.dataset.layout);
      assert.equal(layout.cards.length, 7);
      assert.ok(layout.documentWidth <= width, `página excede ${width}px`);
      for (const card of layout.cards) {
        assert.equal(card.background, expected[card.id].background, `${width}px, ID ${card.id}`);
        assert.equal(card.date, expected[card.id].date);
        assert.equal(card.deadline, expected[card.id].deadline, "o prazo por escrito não depende da cor");
        assert.equal(card.overflow, false, `${width}px, ID ${card.id}: overflow`);
        assert.equal(card.buttons.length, 2);
        assert.ok(card.buttons.every(button => button.width >= 44 && button.height >= 44));
      }
    } finally { dom.window.close(); }
  }
});
