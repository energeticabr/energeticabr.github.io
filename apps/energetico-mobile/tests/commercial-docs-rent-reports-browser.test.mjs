import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { runBrowserLayout } from "./helpers/browser-layout-runner.mjs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(path => path && existsSync(path));
const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("relatórios 16 e 17 usam tabelas no desktop e cartões sem corte em telefone horizontal", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chrome/Edge indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    for (const [width, height] of [[1280, 720], [844, 390], [740, 360]]) for (const scenario of ["report=16", "report=16&detail=1", "report=17"]) {
      const { stdout } = await runBrowserLayout(browser, { width, height, maxBuffer: 3_000_000,
        url: `http://127.0.0.1:${port}/tests/fixtures/commercial-docs-rent-reports-responsive.html?${scenario}` });
      const match = /data-layout="([^"]+)"/.exec(stdout);
      assert.ok(match, `Medição não concluída em ${width}px`);
      const layout = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
      assert.equal(layout.viewport, width);
      assert.equal(layout.report.visible, true, `Relatório não abriu no hub em ${width}px (${scenario})`);
      assert.ok(layout.report.width > 0, `Relatório sem largura em ${width}px (${scenario})`);
      if (scenario === "report=16") assert.equal(layout.report.branchCards, 1);
      if (scenario === "report=16&detail=1") assert.equal(layout.report.propertyCards, 1);
      if (scenario === "report=16&detail=1" && width > 900)
        assert.notEqual(layout.report.mobileCardsDisplay, "none", "detalhe completo do imóvel precisa ficar visível no desktop");
      if (scenario === "report=17") assert.equal(layout.report.rentCards, 1);
      if (width <= 900) {
        assert.equal(layout.report.tableDisplay, "none", "tabela extensa deve virar cartões no telefone");
        assert.notEqual(layout.report.mobileCardsDisplay, "none");
      } else {
        assert.equal(layout.report.tableDisplay, "table", "tabela deve aparecer no desktop");
        if (scenario !== "report=16&detail=1") assert.equal(layout.report.mobileCardsDisplay, "none");
      }
      if (scenario.startsWith("report=16")) {
        assert.notEqual(layout.report.pendingColor, layout.report.clearColor, "pendência e campo preenchido precisam de cores distintas");
        assert.equal(layout.report.metricTitleVisible, true, "painel de IDs deve permanecer visível");
      } else {
        assert.equal(layout.report.metricTitleVisible, false, "aluguel não deve exibir painel de IDs");
        assert.equal(layout.report.rentHeaderColor, "rgb(253, 236, 234)", "faixa de aluguéis em aberto deve preservar rosa suave do Power Apps");
        if (width <= 900) assert.equal(layout.report.mobileRowDisplay, "grid", "linhas móveis devem manter estrutura tabular compacta");
      }
      assert.equal(layout.report.brandColor, "rgb(230, 240, 255)");
      assert.equal(layout.report.logoLoaded, true);
      assert.match(layout.report.filterColor, /^rgb\((?:153|176|183|198), 0, (?:0|20|28)\)$/, "filtros devem manter faixa vermelha");
      assert.ok(layout.document <= width + 1, `Documento transborda em ${width}px (${scenario}): ${JSON.stringify(layout)}`);
      assert.ok(layout.shell.scrollWidth <= layout.shell.width + 1, `Tela integrada exige rolagem lateral em ${width}px (${scenario})`);
      assert.ok(layout.report.width <= width + 1, `Relatório ultrapassa ${width}px (${scenario})`);
      assert.ok(layout.report.scrollWidth <= layout.report.width + 1, `Relatório exige rolagem lateral em ${width}px (${scenario})`);
      assert.equal(layout.report.childOverflow, false, `Conteúdo fora da viewport em ${width}px (${scenario})`);
    }
  } finally { await server.close(); }
});
