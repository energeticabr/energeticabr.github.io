import assert from "node:assert/strict";
import test from "node:test";

import {
  POWERAPPS_GALLERY_TOOLBAR_RULES,
  getPowerAppsGalleryToolbarRules,
} from "../portal/ui/powerapps-gallery-toolbar-rules.js";

const identity = (fileName, screenName, galleryName) => ({
  fileName,
  screenName,
  galleryName,
});

const EXPECTED_GALLERIES = Object.freeze([
  ["G1- HISTÓRICO LANÇAMENTOS.pa.yaml", "G1- HISTÓRICO LANÇAMENTOS", "Gallery1"],
  ["Screen10.pa.yaml", "Screen10", "Gallery6"],
  ["G28- HISTÓRICO PAG PREVISTO.pa.yaml", "G28- HISTÓRICO PAG PREVISTO", "Gallery2_19"],
  ["G19- HISTÓRICOLOCACOES.pa.yaml", "G19- HISTÓRICOLOCACOES", "Gallery2_28"],
  ["G10- HISTÓRICO GRUPO.pa.yaml", "G10- HISTÓRICO GRUPO", "Gallery2_1"],
  ["G8- HISTÓRICO FAMÍLIA.pa.yaml", "G8- HISTÓRICO FAMÍLIA", "Gallery2"],
  ["G35- HISTÓRICO SUBFAMÍLIA.pa.yaml", "G35- HISTÓRICO SUBFAMÍLIA", "Gallery2_2"],
  ["G38- HISTÓRICO PRODUTO.pa.yaml", "G38- HISTÓRICO PRODUTO", "Gallery2_3"],
  ["G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml", "G41- HISTÓRICO UNIDADE MEDIDA", "Gallery2_4"],
  ["GALERIACONTA.pa.yaml", "GALERIACONTA", "Gallery8"],
  ["G42- HISTÓRICO FORNECEDOR.pa.yaml", "G42- HISTÓRICO FORNECEDOR", "Gallery2_5"],
  ["G40- HISTÓRICO FILIAIS.pa.yaml", "G40- HISTÓRICO FILIAIS", "Gallery2_7"],
  ["G15- HISTÓRICO IMÓVEIS.pa.yaml", "G15- HISTÓRICO IMÓVEIS", "Gallery2_18"],
  ["G36- HISTÓRICO CIDADE.pa.yaml", "G36- HISTÓRICO CIDADE", "Gallery2_6"],
  ["G2- HISTÓRICO TIPO MATERIAL.pa.yaml", "G2- HISTÓRICO TIPO MATERIAL", "Gallery1_3"],
  ["G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml", "G13- HISTÓRICOGRUPOIMOBILIZADO", "Gallery2_29"],
  ["G14- HISTÓRICOIMOBILIZADO.pa.yaml", "G14- HISTÓRICOIMOBILIZADO", "Gallery2_30"],
  ["G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml", "G22- HISTÓRICOLANCAMENTOIMOBILIZADO", "Gallery2_27"],
]);

test("declara uma regra exata para cada uma das 18 Galleries auditadas", () => {
  assert.equal(Object.keys(POWERAPPS_GALLERY_TOOLBAR_RULES).length, 18);

  for (const galleryIdentity of EXPECTED_GALLERIES) {
    const rules = getPowerAppsGalleryToolbarRules(identity(...galleryIdentity));
    assert.equal(rules.matched, true, galleryIdentity.join("::"));
    assert.deepEqual(rules.identity, identity(...galleryIdentity));
  }
});

test("G41 e G2 começam honestamente sem indicador de ordenação", () => {
  for (const galleryIdentity of [EXPECTED_GALLERIES[8], EXPECTED_GALLERIES[14]]) {
    const rules = getPowerAppsGalleryToolbarRules({
      galleryVariant: { identity: identity(...galleryIdentity) },
    });

    assert.deepEqual(rules.initialSort, {
      status: "unsorted",
      field: null,
      direction: null,
      indicator: "unsorted",
    });
  }
});

test("preserva os Refresh explícitos e suas fontes SharePoint", () => {
  const cases = [
    [EXPECTED_GALLERIES[0], ["Image21_8"], ["LANCAMENTOS"]],
    [EXPECTED_GALLERIES[1], ["Icon64_12"], ["NOTASPENDENTES"]],
    [EXPECTED_GALLERIES[2], ["Icon64"], ["PROVISÃO PGTOS"]],
    [EXPECTED_GALLERIES[3], ["Icon65"], ["DESPESASRECORRENTES"]],
    [EXPECTED_GALLERIES[5], ["Icon64_4"], ["CADASTRO FAMÍLIA_1"]],
    [EXPECTED_GALLERIES[8], ["Image21_12"], ["CADASTROUNIDADEMEDIDA"]],
    [EXPECTED_GALLERIES[12], ["Image21_13"], ["IMOVEL CADASTRADO"]],
    [EXPECTED_GALLERIES[17], ["Icon50"], ["IMOBILIZADOS"]],
  ];

  for (const [galleryIdentity, controls, sources] of cases) {
    const rules = getPowerAppsGalleryToolbarRules({
      contract: { identity: identity(...galleryIdentity) },
    });
    assert.deepEqual(rules.refresh, { present: true, controls, sources });
  }
});

test("não inventa Refresh nas quatro Galleries que não possuem o controle", () => {
  for (const index of [9, 13, 15, 16]) {
    const rules = getPowerAppsGalleryToolbarRules(identity(...EXPECTED_GALLERIES[index]));
    assert.deepEqual(rules.refresh, { present: false, controls: [], sources: [] });
  }
});

test("expõe a ordenação inicial efetiva, inclusive regras condicionais já resolvidas", () => {
  const cases = [
    [EXPECTED_GALLERIES[0], "ID", "desc", "descending"],
    [EXPECTED_GALLERIES[1], "ID", "desc", "descending"],
    [EXPECTED_GALLERIES[2], "DATA PREVISTO PGTO", "asc", "ascending"],
    [EXPECTED_GALLERIES[3], "ID", "desc", "descending"],
    [EXPECTED_GALLERIES[12], "IMOVEL", "asc", "ascending"],
    [EXPECTED_GALLERIES[17], "VALOR RESIDUAL", "desc", "descending"],
  ];

  for (const [galleryIdentity, field, direction, indicator] of cases) {
    const rules = getPowerAppsGalleryToolbarRules(identity(...galleryIdentity));
    assert.deepEqual(rules.initialSort, {
      status: "sorted",
      field,
      direction,
      indicator,
    });
  }
});

test("G28 ordena por data prevista crescente quando PAGAMENTO PREVISTO participa do filtro", () => {
  const rules = getPowerAppsGalleryToolbarRules({
    identity: identity(...EXPECTED_GALLERIES[2]),
    filters: {
      STATUS: JSON.stringify(["PAGAMENTO SEM DATA PREVISTA", "PAGAMENTO PREVISTO"]),
    },
  });

  assert.deepEqual(rules.initialSort, {
    status: "sorted",
    field: "DATA PREVISTO PGTO",
    direction: "asc",
    indicator: "ascending",
  });
});

test("G28 ordena por Modified decrescente quando PAGAMENTO PREVISTO não participa do filtro", () => {
  for (const statusFilter of [
    JSON.stringify(["PAGAMENTO SEM DATA PREVISTA"]),
    JSON.stringify(["PAGAMENTO EFETUADO"]),
    JSON.stringify([]),
  ]) {
    const rules = getPowerAppsGalleryToolbarRules({
      galleryVariant: { identity: identity(...EXPECTED_GALLERIES[2]) },
      filters: { STATUS: statusFilter },
    });

    assert.deepEqual(rules.initialSort, {
      status: "sorted",
      field: "Modified",
      direction: "desc",
      indicator: "descending",
    }, statusFilter);
  }
});

test("uma identidade não auditada permanece desconhecida em vez de ganhar defaults fictícios", () => {
  const rules = getPowerAppsGalleryToolbarRules({
    identity: identity("Outra.pa.yaml", "Outra", "Gallery99"),
    sort: { status: "resolved", field: "ID", direction: "descending" },
  });

  assert.equal(rules.matched, false);
  assert.deepEqual(rules.refresh, { present: false, controls: [], sources: [] });
  assert.deepEqual(rules.initialSort, {
    status: "unknown",
    field: null,
    direction: null,
    indicator: "unknown",
  });
});
