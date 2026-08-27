import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generatedTextMatches } from "../scripts/generated-text-normalization.mjs";

const GENERATOR_URL = new URL("../scripts/generate-powerapps-gallery-contracts.mjs", import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POWERAPPS_SOURCE_DIR = process.env.POWERAPPS_SOURCE_DIR || resolve(
  ROOT,
  "..",
  "_tmp",
  "powerapps-ui-inventory-20260826-1501",
  "ENERGETICA-current",
  "Src",
);

async function galleryGenerator() {
  return import(GENERATOR_URL.href).catch(() => ({}));
}

test("extrai formulas, campos visiveis, acoes e selecao sem inferir entidade ou lista", async () => {
  const { extractPowerAppsGalleryContracts } = await galleryGenerator();
  assert.equal(typeof extractPowerAppsGalleryContracts, "function");

  const yaml = `Screens:
  Tela Teste:
    Children:
      - GalleryPedidos:
          Control: Gallery@2.15.0
          Variant: BrowseLayout_Vertical_TwoTextVariant_ver5.0
          Properties:
            Default: =First(PEDIDOS)
            Items: |-
              =Sort(
                  Filter(PEDIDOS, STATUS = "ATIVO"),
                  ID,
                  SortOrder.Descending
              )
            OnSelect: =Set(itemAtual, ThisItem)
          Children:
            - TitlePedido:
                Control: Label@2.5.1
                Properties:
                  OnSelect: =Select(Parent)
                  Text: ="CLIENTE: " & ThisItem.'NOME CLIENTE'
            - StatusPedido:
                Control: Label@2.5.1
                Properties:
                  Text: =ThisItem.STATUS
                  Visible: =ThisItem.STATUS = "ATIVO"
            - CampoOculto:
                Control: Label@2.5.1
                Properties:
                  Text: =ThisItem.SEGREDO
                  Visible: =false
            - EditarPedido:
                Control: Classic/Icon@2.5.0
                Properties:
                  Icon: =Icon.Edit
                  OnSelect: =EditForm(FormPedido)
            - SelectionMarker:
                Control: Rectangle@2.3.0
                Properties:
                  Visible: =ThisItem.IsSelected
`;

  const result = extractPowerAppsGalleryContracts([
    { fileName: "Tela Teste.pa.yaml", content: yaml },
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.galleries.length, 1);

  const gallery = result.galleries[0];
  assert.equal(gallery.fileName, "Tela Teste.pa.yaml");
  assert.equal(gallery.screenName, "Tela Teste");
  assert.equal(gallery.galleryName, "GalleryPedidos");
  assert.equal(gallery.lineNumber, 4);
  assert.equal(gallery.control, "Gallery@2.15.0");
  assert.equal(gallery.variant, "BrowseLayout_Vertical_TwoTextVariant_ver5.0");
  assert.deepEqual(gallery.formulas.items, {
    status: "resolved",
    literal: `=Sort(
    Filter(PEDIDOS, STATUS = "ATIVO"),
    ID,
    SortOrder.Descending
)`,
  });
  assert.deepEqual(gallery.formulas.default, {
    status: "resolved",
    literal: "=First(PEDIDOS)",
  });
  assert.deepEqual(gallery.formulas.sort, {
    status: "resolved",
    literals: [`Sort(
    Filter(PEDIDOS, STATUS = "ATIVO"),
    ID,
    SortOrder.Descending
)`],
  });
  assert.deepEqual(gallery.formulas.filter, {
    status: "resolved",
    literals: [`Filter(PEDIDOS, STATUS = "ATIVO")`],
  });

  assert.deepEqual(gallery.visibleControls.map(control => control.controlName), [
    "TitlePedido",
    "StatusPedido",
  ]);
  assert.deepEqual(gallery.visibleControls[0], {
    controlName: "TitlePedido",
    controlType: "Label",
    lineNumber: 17,
    displayProperty: "Text",
    displayLiteral: "=\"CLIENTE: \" & ThisItem.'NOME CLIENTE'",
    visibility: { status: "always", conditions: [] },
    fieldReferences: [
      { fieldName: "NOME CLIENTE", literal: "ThisItem.'NOME CLIENTE'" },
    ],
    textLiterals: ["CLIENTE: "],
  });
  assert.deepEqual(gallery.visibleControls[1].visibility, {
    status: "conditional",
    conditions: [
      { controlName: "StatusPedido", literal: "=ThisItem.STATUS = \"ATIVO\"" },
    ],
  });
  assert.deepEqual(gallery.visibleControls[1].fieldReferences, [
    { fieldName: "STATUS", literal: "ThisItem.STATUS" },
  ]);
  assert.equal(gallery.visibleControls.some(control => control.controlName === "CampoOculto"), false);
  assert.deepEqual(gallery.visibleFields, ["NOME CLIENTE", "STATUS"]);
  assert.deepEqual(gallery.visibleLabels, ["CLIENTE: "]);

  assert.deepEqual(gallery.actions.map(action => ({
    controlName: action.controlName,
    kind: action.kind,
    onSelect: action.onSelect,
  })), [
    { controlName: "TitlePedido", kind: "select-parent", onSelect: "=Select(Parent)" },
    { controlName: "EditarPedido", kind: "action", onSelect: "=EditForm(FormPedido)" },
  ]);
  assert.deepEqual(gallery.primaryAction, {
    status: "resolved",
    controlName: "GalleryPedidos",
    onSelect: "=Set(itemAtual, ThisItem)",
  });
  assert.deepEqual(gallery.selection, {
    default: { status: "resolved", literal: "=First(PEDIDOS)" },
    onSelect: { status: "resolved", literal: "=Set(itemAtual, ThisItem)" },
    parentSelectors: [
      { controlName: "TitlePedido", onSelect: "=Select(Parent)" },
    ],
    indicators: [
      {
        controlName: "SelectionMarker",
        propertyName: "Visible",
        literal: "=ThisItem.IsSelected",
      },
    ],
  });
  assert.equal(gallery.binding.portalEntity.status, "unresolved");
  assert.equal(gallery.binding.sharePointList.status, "unresolved");
  assert.equal(Object.hasOwn(gallery.binding.portalEntity, "value"), false);
  assert.equal(Object.hasOwn(gallery.binding.sharePointList, "value"), false);
});

test("ignora campos e strings citados apenas em strings ou comentarios Power Fx", async () => {
  const { extractPowerAppsGalleryContracts } = await galleryGenerator();
  const yaml = `Screens:
  Tela Comentarios:
    Children:
      - GalleryComentarios:
          Control: Gallery@2.15.0
          Properties:
            Items: =DADOS
          Children:
            - LabelComentario:
                Control: Label@2.5.1
                Properties:
                  Text: |-
                    =ThisItem.Title & "ThisItem.FALSO"
                    // "LABEL COMENTADO" & ThisItem.COMENTADO
`;

  const result = extractPowerAppsGalleryContracts([
    { fileName: "Tela Comentarios.pa.yaml", content: yaml },
  ]);
  const control = result.galleries[0].visibleControls[0];

  assert.deepEqual(control.fieldReferences, [
    { fieldName: "Title", literal: "ThisItem.Title" },
  ]);
  assert.deepEqual(control.textLiterals, ["ThisItem.FALSO"]);
  assert.deepEqual(result.galleries[0].visibleFields, ["Title"]);
  assert.deepEqual(result.galleries[0].visibleLabels, ["ThisItem.FALSO"]);
});

test("cobre as 84 Galleries atuais em ordem deterministica e preserva evidencia literal real", async () => {
  const { extractPowerAppsGalleryContractsFromDirectory } = await galleryGenerator();
  const result = await extractPowerAppsGalleryContractsFromDirectory(POWERAPPS_SOURCE_DIR);

  assert.deepEqual(result.source, {
    inventory: "_tmp/powerapps-ui-inventory-20260826-1501/ENERGETICA-current/Src",
    fileCount: 130,
    galleryFileCount: 75,
    screenCount: 75,
    galleryCount: 84,
  });
  assert.equal(result.galleries.length, 84);

  const identities = result.galleries.map(gallery => (
    `${gallery.fileName}\u0000${gallery.screenName}\u0000${gallery.galleryName}`
  ));
  assert.equal(new Set(identities).size, 84);
  assert.deepEqual(identities, [...identities].sort());

  const known = result.galleries.find(gallery => (
    gallery.fileName === "G10- HISTÓRICO GRUPO.pa.yaml"
    && gallery.galleryName === "Gallery2_1"
  ));
  assert.ok(known);
  assert.equal(known.screenName, "G10- HISTÓRICO GRUPO");
  assert.equal(known.lineNumber, 151);
  assert.equal(known.formulas.items.literal, `=Sort(Filter(
    CADASTROGRUPO,
    (IsBlank(Dropdown8.Selected.Value) || STATUS = Dropdown8.Selected.Value),
    (IsBlank('LBL. PRODUTO_6'.Text) || StartsWith(GRUPO, 'LBL. PRODUTO_6'.Text))
),ID,SortOrder.Descending)

`);
  assert.equal(known.formulas.sort.status, "resolved");
  assert.equal(known.formulas.filter.status, "resolved");
  assert.deepEqual(known.visibleFields, [
    "GRUPO",
    "STATUS",
    "ID",
    "Criado por",
    "Criado",
    "Modificado",
    "Modificado por",
  ]);
  assert.equal(known.visibleLabels.includes(" 🕒ADICIONADO POR: "), true);
  assert.deepEqual(known.primaryAction, {
    status: "unresolved",
    reason: "gallery-onselect-not-resolved",
  });
  assert.equal(known.selection.indicators.some(indicator => (
    indicator.controlName === "Rectangle2_1"
    && indicator.literal === "=ThisItem.IsSelected"
  )), true);

  for (const gallery of result.galleries) {
    assert.equal(gallery.binding.portalEntity.status, "unresolved");
    assert.equal(gallery.binding.sharePointList.status, "unresolved");
    assert.equal(Object.hasOwn(gallery.binding.portalEntity, "value"), false);
    assert.equal(Object.hasOwn(gallery.binding.sharePointList, "value"), false);
  }
});

test("catalogo e documentacao gerados sao deterministas e estao atualizados", async () => {
  const {
    extractPowerAppsGalleryContractsFromDirectory,
    renderPowerAppsGalleryContracts,
    renderPowerAppsGalleryFieldParity,
  } = await galleryGenerator();
  const result = await extractPowerAppsGalleryContractsFromDirectory(POWERAPPS_SOURCE_DIR);
  const catalog = renderPowerAppsGalleryContracts(result);
  let documentation;
  assert.doesNotThrow(() => {
    documentation = renderPowerAppsGalleryFieldParity(result);
  });

  assert.equal(renderPowerAppsGalleryContracts(result), catalog);
  assert.equal(renderPowerAppsGalleryFieldParity(result), documentation);
  assert.match(documentation, /84 Galleries/);
  assert.match(documentation, /75 telas\/arquivos/);
  assert.match(documentation, /G10- HISTÓRICO GRUPO/);
  assert.match(documentation, /Gallery2_1/);
  assert.match(documentation, /GRUPO/);
  assert.match(documentation, /unresolved/);

  const [currentCatalog, currentDocumentation] = await Promise.all([
    readFile(resolve(ROOT, "portal", "catalog", "powerapps-gallery-contracts.generated.js"), "utf8"),
    readFile(resolve(ROOT, "docs", "analysis", "powerapps-gallery-field-parity.md"), "utf8"),
  ]);
  assert.equal(generatedTextMatches(currentCatalog, catalog), true);
  assert.equal(generatedTextMatches(currentDocumentation, documentation), true);
});
