import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createExtraReports } from "../src/ui/extra-reports-factory.js";
import { createContractorReportsView } from "../src/ui/contractor-reports-view.js";

test("instancia relatórios integrados apenas com sessão Microsoft, sem consultar dados antecipadamente", async () => {
  const dom = new JSDOM("<main></main>");
  const groups = await createExtraReports({ tokenProvider: async () => "token", document: dom.window.document });
  assert.deepEqual(groups.flatMap(group => group.ids), Array.from({ length: 15 }, (_, i) => i + 3));
  for (const group of groups) {
    assert.ok(group.view.element);
    assert.equal(group.view.element.hidden, true);
    group.view.destroy();
  }
  dom.window.close();
});

test("menu integrado habilita os 17 relatórios sem consultar o SharePoint antes da escolha", async () => {
  const dom = new JSDOM("<main></main>");
  const groups = await createExtraReports({ tokenProvider: async () => "token", document: dom.window.document });
  const view = createContractorReportsView({
    document: dom.window.document,
    data: { loadOverview: async () => ({ rows: [] }), loadDetails: async () => ({}) },
    presenceData: { loadSnapshot: async () => ({}) },
    extraReports: groups,
  });
  try {
    await view.open();
    const tiles = [...dom.window.document.querySelectorAll(".cr-report-tile")];
    assert.deepEqual(tiles.map(tile => Number(tile.dataset.reportId)), Array.from({ length: 17 }, (_, i) => i + 1));
    assert.ok(tiles.every(tile => !tile.disabled));
  } finally {
    view.destroy();
    dom.window.close();
  }
});
