import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  POWERAPPS_HOME_ASSETS,
  POWERAPPS_HOME_QUICK_ACTIONS,
  POWERAPPS_HOME_SOURCE,
  POWERAPPS_HOME_TILES,
} from "../portal/catalog/powerapps-home-contract.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { homeAnalyticsDefinition } from "../portal/analytics/home-report-views.js";
import { analyticsDefinitionById } from "../portal/analytics/definitions/index.js";
import { powerAppsHomeMarkup } from "../portal/ui/powerapps-home-page.js";

const expectedTiles = Object.freeze([
  ["suprimentos", "SUPRIMENTOS", "#/module/suprimentos", "rgb(0, 13, 75)", 115, 133, 562, 135],
  ["demandas", "DEMANDAS", "#/module/demandas", "rgb(99, 139, 44)", 701, 133, 562, 135],
  ["financeiro", "FINANCEIRO", "#/module/financeiro", "rgb(77, 77, 77)", 116, 294, 562, 135],
  ["comercial", "COMERCIAL", "#/module/comercial", "rgb(172, 62, 11)", 701, 293, 562, 135],
  ["rh-obras", "RECURSOS HUMANOS E ACOMP. OBRA", "#/module/rh-obras", "rgb(203, 102, 102)", 115, 450, 562, 135],
  ["patrimonio-locacoes", "NOTINI MOREIRA", "#/module/patrimonio-locacoes", "rgb(251, 188, 159)", 701, 450, 562, 135],
  ["auditoria-compliance", "AUDITORIA E COMPLIANCE", "#/module/auditoria-compliance", "rgb(136, 160, 209)", 115, 611, 562, 135],
]);

function context(overrides = {}) {
  return {
    access: {},
    can: () => true,
    ...overrides,
  };
}

test("contrato preserva a tela inicial publicada, dimensões e sete blocos", () => {
  assert.deepEqual(POWERAPPS_HOME_SOURCE, {
    appId: "3501f99a-e612-44b6-8ce7-8c8caa74fad7",
    screen: "TELA INICIAL",
    artifact: "TELA INICIAL.pa.yaml",
    sha256: "CC91C0EDA65F0995D53A4A1359DA57E3A25DEA5AA613114D2FCCBC53645124FB",
    width: 1366,
    height: 768,
  });
  assert.deepEqual(POWERAPPS_HOME_TILES.map(tile => [
    tile.moduleId,
    tile.label,
    tile.href,
    tile.color,
    tile.x,
    tile.y,
    tile.width,
    tile.height,
  ]), expectedTiles);
});

test("contrato confere com os controles e HTMLs do snapshot Power Apps", {
  skip: !process.env.POWERAPPS_SOURCE_DIR,
}, () => {
  const source = readFileSync(join(process.env.POWERAPPS_SOURCE_DIR, POWERAPPS_HOME_SOURCE.artifact), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex").toUpperCase(), POWERAPPS_HOME_SOURCE.sha256);
  assert.equal((source.match(/^      - /gm) || []).length, 319);
  assert.equal((source.match(/Control: HtmlViewer@/g) || []).length, 24);

  for (const action of POWERAPPS_HOME_QUICK_ACTIONS) {
    const marker = `      - ${action.sourceControl}:`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${action.id}: controle ${action.sourceControl} ausente`);
    const next = source.indexOf("\n      - ", start + marker.length);
    const block = source.slice(start, next < 0 ? undefined : next)
      .replace(/\s+/g, "")
      .replace(/OnSelect:\|[-+]?/g, "OnSelect:");
    assert.ok(block.includes(`OnSelect:=${action.powerFx}`.replace(/\s+/g, "")), `${action.id}: OnSelect divergente`);
    const htmlMarker = `      - ${action.sourceHtmlControl}:`;
    const htmlStart = source.indexOf(htmlMarker);
    assert.notEqual(htmlStart, -1, `${action.id}: HTMLViewer ${action.sourceHtmlControl} ausente`);
    const htmlNext = source.indexOf("\n      - ", htmlStart + htmlMarker.length);
    const htmlBlock = source.slice(htmlStart, htmlNext < 0 ? undefined : htmlNext);
    assert.match(htmlBlock, /Control: HtmlViewer@/, `${action.id}: ${action.sourceHtmlControl} não é HTMLViewer`);
  }
});

test("todos os atalhos publicados possuem imagem, painel e descrição funcional", () => {
  assert.equal(POWERAPPS_HOME_QUICK_ACTIONS.length, 24);
  for (const action of POWERAPPS_HOME_QUICK_ACTIONS) {
    assert.ok(action.label, `${action.id} sem rótulo`);
    assert.ok(action.image, `${action.id} sem imagem`);
    assert.ok(action.sourceHtmlControl, `${action.id} sem HTMLViewer de origem`);
    assert.ok(action.href || action.report === "resumo-geral", `${action.id} sem destino`);
    assert.equal(action.report, action.id, `${action.id} não preserva o painel sobreposto do Power Apps`);
    assert.equal(/tickets|clientes|moviment/i.test(`${action.href || ""} ${action.label}`), false, `${action.id} entrou no escopo excluído`);
  }
});

test("atalhos que compartilham uma análise recebem visões distintas do HTML de origem", () => {
  const definitions = new Map(POWERAPPS_HOME_QUICK_ACTIONS
    .filter(action => action.href?.startsWith("#/analytics/"))
    .map(action => {
      const analyticsId = action.href.slice("#/analytics/".length);
      return [action.id, homeAnalyticsDefinition(action, analyticsDefinitionById(analyticsId))];
    }));

  assert.equal(definitions.get("lancamentos")?.id, "financeiro");
  assert.equal(definitions.get("provisoes")?.id, "financeiro");
  assert.notEqual(definitions.get("lancamentos")?.homeViewId, definitions.get("provisoes")?.homeViewId);
  assert.notDeepEqual(
    definitions.get("lancamentos")?.charts.map(chart => chart.id),
    definitions.get("provisoes")?.charts.map(chart => chart.id),
  );
  assert.notDeepEqual(
    definitions.get("presenca-semanal")?.charts.map(chart => chart.id),
    definitions.get("apontamentos-funcionarios")?.charts.map(chart => chart.id),
  );
  assert.notDeepEqual(
    definitions.get("presenca-semanal")?.charts.map(chart => chart.id),
    definitions.get("presencas")?.charts.map(chart => chart.id),
  );
});

test("atalhos de entidade usam a permissao do modulo que recebe a navegacao", () => {
  for (const action of POWERAPPS_HOME_QUICK_ACTIONS) {
    if (!action.href?.startsWith("#/entity/")) continue;
    const entity = ENTITIES.find(candidate => candidate.id === action.href.slice("#/entity/".length));
    assert.equal(action.moduleId, entity?.moduleId, action.id);
  }
});

test("atalhos analiticos preservam as bases combinadas dos HTMLs publicados", () => {
  const byId = new Map(POWERAPPS_HOME_QUICK_ACTIONS.map(action => [action.id, action]));
  assert.equal(byId.get("auditoria-pedidos")?.href, "#/analytics/imobilizado");
  assert.equal(byId.get("lancamentos")?.href, "#/analytics/financeiro");
  assert.equal(byId.get("provisoes")?.href, "#/analytics/financeiro");
  assert.equal(byId.get("tarefas")?.href, "#/entity/tarefas-delegadas");
  assert.equal(byId.get("presencas")?.href, "#/analytics/recursos-humanos");
  assert.equal(byId.get("etapas")?.href, "#/analytics/etapa-obra");
  assert.equal(byId.get("receitas")?.href, "#/analytics/comercial");
});

test("todos os ativos visuais da tela inicial existem no caminho servido pelo portal", () => {
  const paths = new Set([
    POWERAPPS_HOME_ASSETS.background,
    POWERAPPS_HOME_ASSETS.logo,
    ...POWERAPPS_HOME_TILES.map(tile => tile.image),
    ...POWERAPPS_HOME_QUICK_ACTIONS.map(action => action.image),
  ]);
  for (const asset of paths) {
    assert.equal(existsSync(resolve(asset)), true, asset);
  }
});

test("markup reproduz o canvas, logo, blocos, atalhos e host do resumo", () => {
  const html = powerAppsHomeMarkup(context());
  assert.match(html, /class="powerapps-home-canvas"/);
  assert.match(html, /powerapps-home-logo\.png/);
  assert.equal((html.match(/data-home-tile=/g) || []).length, 7);
  assert.equal((html.match(/data-home-quick-action=/g) || []).length, 24);
  assert.match(html, /data-home-report="resumo-geral"/);
  assert.match(html, /data-home-report="lancamentos"/);
  assert.equal((html.match(/data-home-report=/g) || []).length, 48);
  assert.match(html, /data-home-report-dialog/);
  assert.doesNotMatch(html, /\sstyle=/);
});

test("permissões removem blocos e atalhos de módulos não liberados", () => {
  const html = powerAppsHomeMarkup(context({
    can: (_access, moduleId) => moduleId !== "financeiro" && moduleId !== "comercial",
  }));
  assert.doesNotMatch(html, /data-home-tile="financeiro"/);
  assert.doesNotMatch(html, /data-home-tile="comercial"/);
  assert.doesNotMatch(html, /href="#\/entity\/receitas"/);
  assert.match(html, /data-home-tile="suprimentos"/);
});
