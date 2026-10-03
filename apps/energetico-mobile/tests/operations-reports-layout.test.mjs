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
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("relatórios 6–8 cabem em telefones horizontais sem rolagem lateral", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chromium/Chrome indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0, fs: { allow: [repositoryRoot] } }, logLevel: "silent" });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    for (const [width, height] of [[844, 390], [740, 360], [568, 320]]) {
      const { stdout } = await run(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--disable-dev-shm-usage",
        `--window-size=${width + (process.platform === "win32" ? 26 : 0)},${height}`, "--virtual-time-budget=3000", "--dump-dom",
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
        assert.match(report.font, /Arial|sans-serif/i, `${report.report} herdou tipografia serifada`);
        assert.equal(report.logoLoaded, true, `${report.report} não carregou o logo oficial: ${JSON.stringify(report)}`);
        assert.equal(report.brandBackground, 'rgb(230, 240, 255)');
      }
      assert.equal(layout.reportWidths[0].filterBackground, 'rgb(153, 0, 0)', 'filtro do relatório 6 sem faixa rubra');
      assert.equal(layout.reportWidths[0].stageBorder, 'rgb(0, 0, 0)', 'etapa sem contorno preto do Power Apps');
      assert.equal(layout.reportWidths[0].stageSummaryDisplay, 'flex', 'resumo da etapa perdeu o painel dedicado');
      assert.equal(layout.reportWidths[1].pendingColor, 'rgb(176, 0, 32)', 'PENDENTE não está vermelho');
      assert.equal(layout.reportWidths[1].footerBackground, 'rgb(230, 240, 255)', 'rodapé não está azul-claro');
      assert.deepEqual(layout.reportWidths[2].metricBackgrounds, ['rgb(255, 225, 179)', 'rgb(200, 230, 201)', 'rgb(187, 222, 251)']);
      assert.equal(layout.reportWidths[2].dueSummaryDisplay, 'flex', 'data fatal perdeu o painel dedicado');
    }
  } finally { await server.close(); }
});
