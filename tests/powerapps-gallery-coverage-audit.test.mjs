import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_GALLERY_COVERAGE_EXCLUSIONS,
  DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR,
  auditPowerAppsGalleryCoverage,
  buildPowerAppsGalleryCoverageAudit,
} from "../scripts/audit-powerapps-gallery-coverage.mjs";

const gallery = ({ fileName, galleryName, actions = [] }) => ({
  fileName,
  screenName: fileName.replace(/\.pa\.yaml$/i, ""),
  galleryName,
  actions,
});

const contract = ({ fileName, galleryName, entityId, source, actions }) => ({
  identity: {
    fileName,
    screenName: fileName.replace(/\.pa\.yaml$/i, ""),
    galleryName,
  },
  binding: entityId
    ? { status: "resolved", entityId, source }
    : { status: "unresolved", reason: "operation-not-proven-by-items" },
  actions,
});

test("a auditoria exclui somente Tickets e Movimentacoes e conta apenas comandos acionaveis", () => {
  const galleries = [
    gallery({
      fileName: "Historico A.pa.yaml",
      galleryName: "GalleryA",
      actions: [
        { controlName: "Titulo", kind: "select-parent", onSelect: "=Select(Parent)" },
        { controlName: "Editar", kind: "action", onSelect: "=EditForm(FormA)" },
        { controlName: "Anexo", kind: "action", onSelect: "=Set(MostrarAnexo, true)" },
      ],
    }),
    gallery({
      fileName: "Historico B.pa.yaml",
      galleryName: "GalleryB",
      actions: [
        { controlName: "Excluir", kind: "action", onSelect: "=Remove(LISTA_B, ThisItem)" },
      ],
    }),
    gallery({ fileName: "Clientes.pa.yaml", galleryName: "GalleryClientes" }),
    gallery({
      fileName: "Colecao local.pa.yaml",
      galleryName: "GalleryLocal",
      actions: [
        { controlName: "LocalOnly", kind: "action", onSelect: "=Collect(Local, ThisItem)" },
      ],
    }),
    gallery({ fileName: "Sem entidade.pa.yaml", galleryName: "GallerySemEntidade" }),
  ];
  const uiContracts = [
    contract({
      fileName: "Historico A.pa.yaml",
      galleryName: "GalleryA",
      entityId: "entidade-a",
      source: "LISTA_A",
      actions: {
        status: "partial",
        values: [
          { kind: "select", controlName: "Titulo" },
          { kind: "edit", controlName: "Editar", formName: "FormA" },
        ],
        unresolved: [
          { controlName: "Anexo", reason: "action-not-translatable", evidence: "=Set(MostrarAnexo, true)" },
        ],
      },
    }),
    contract({
      fileName: "Historico B.pa.yaml",
      galleryName: "GalleryB",
      entityId: "entidade-b",
      source: "LISTA_B",
      actions: {
        status: "unresolved",
        values: [],
        unresolved: [
          { controlName: "Excluir", reason: "action-not-translatable", evidence: "=Remove(LISTA_B, ThisItem)" },
        ],
      },
    }),
    contract({
      fileName: "Clientes.pa.yaml",
      galleryName: "GalleryClientes",
      entityId: "clientes",
      source: "CADASTRO CLIENTE_1",
      actions: { status: "resolved", values: [], unresolved: [] },
    }),
    contract({
      fileName: "Colecao local.pa.yaml",
      galleryName: "GalleryLocal",
      actions: { status: "resolved", values: [], unresolved: [] },
    }),
    contract({
      fileName: "Sem entidade.pa.yaml",
      galleryName: "GallerySemEntidade",
      entityId: "entidade-ausente",
      source: "LISTA_SEM_ENTIDADE",
      actions: { status: "resolved", values: [], unresolved: [] },
    }),
  ];

  const audit = buildPowerAppsGalleryCoverageAudit({
    galleryCatalog: { source: { inventory: "fixture", galleryCount: 5 }, galleries },
    uiCatalog: { galleries: uiContracts },
    entities: [
      { id: "entidade-a", available: true },
      { id: "entidade-b", available: true },
    ],
    routes: [{ name: "entity", pattern: ["entity", ":entityId"] }],
    formVariants: {
      "entidade-a": [{
        id: "Editar A.pa.yaml#FormA",
        fileName: "Editar A.pa.yaml",
        formName: "FormA",
      }],
    },
  });

  assert.deepEqual(DEFAULT_GALLERY_COVERAGE_EXCLUSIONS.map(item => item.entityId), [
    "tickets-clientes",
    "movimentacoes-de-ticket",
  ]);
  assert.deepEqual(audit.counts, {
    rawGalleries: 5,
    excludedGalleries: 0,
    inScopeGalleries: 5,
    sharePointGalleries: 4,
    sharePointEntities: 4,
    entityLinkedGalleries: 2,
    routeLinkedGalleries: 2,
    entityRoutes: 2,
    unboundGalleries: 1,
    missingEntities: 2,
    missingRoutes: 0,
    commandControls: 3,
    translatedCommandControls: 1,
    commandGaps: 2,
    formReferences: 1,
    coveredFormReferences: 1,
    recoveredFormReferences: 0,
    formGaps: 0,
  });
  assert.deepEqual(audit.excluded.map(item => item.entityId), []);
  assert.deepEqual(audit.gaps.commands.map(item => item.family), ["Set", "Remove"]);
  assert.deepEqual(audit.gaps.forms, []);
});

test("o snapshot atual publica contagens exatas e lacunas rastreaveis", {
  skip: !existsSync(DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR),
}, async () => {
  const audit = await auditPowerAppsGalleryCoverage(DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR);

  assert.equal(audit.source.inventory, DEFAULT_POWERAPPS_GALLERY_SOURCE_DIR);
  assert.deepEqual(audit.counts, {
    rawGalleries: 86,
    excludedGalleries: 2,
    inScopeGalleries: 84,
    sharePointGalleries: 69,
    sharePointEntities: 63,
    entityLinkedGalleries: 69,
    routeLinkedGalleries: 69,
    entityRoutes: 63,
    unboundGalleries: 15,
    missingEntities: 0,
    missingRoutes: 0,
    commandControls: 231,
    translatedCommandControls: 164,
    commandGaps: 67,
    formReferences: 36,
    coveredFormReferences: 36,
    recoveredFormReferences: 4,
    formGaps: 0,
  });
  assert.deepEqual(
    audit.excluded.map(item => [item.exclusion, item.entityId, item.galleryName]),
    [
      ["Tickets", "tickets-clientes", "Gallery6_5"],
      ["Movimentacoes", "movimentacoes-de-ticket", "Gallery6_4"],
    ],
  );
  assert.deepEqual(audit.gaps.forms, []);
  assert.deepEqual(
    audit.recoveries.forms.map(item => [
      item.entityId,
      item.formName,
      item.reason,
      item.recoveredVariantIds,
      item.crossEntityMatches.map(match => match.entityId),
    ]),
    [
      ["grupos-de-imobilizados", "Form15", "cross-entity-reference-recovered-by-entity-form", ["G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml#Form15_1"], ["cadastro-de-imobilizados"]],
      ["imobilizados", "Form15", "cross-entity-reference-recovered-by-entity-form", ["G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml#Form16"], ["cadastro-de-imobilizados"]],
      ["patologias-sac", "Form1_35", "cross-entity-reference-recovered-by-entity-form", ["HISTÓRICO PATOLOGIAS.pa.yaml#Form31_1"], ["compras"]],
      ["auditorias", "Form29", "cross-entity-reference-recovered-by-entity-form", ["I8- GERAL AUDITORIA.pa.yaml#Form30"], ["tipos-de-auditoria"]],
    ],
  );
  assert.equal(audit.gaps.commands.every(item => item.controlName && item.evidence), true);
  assert.equal(audit.gaps.commands.some(item => item.family === "Select"), false);
});
