import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../portal/catalog/powerapps-gallery-ui-contract.js", import.meta.url);

function galleryFixture(overrides = {}) {
  return {
    fileName: "G10- HISTÓRICO GRUPO.pa.yaml",
    screenName: "G10- HISTÓRICO GRUPO",
    galleryName: "Gallery2_1",
    formulas: {
      items: {
        status: "resolved",
        literal: "=Sort(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), ID, SortOrder.Descending)",
      },
      sort: {
        status: "resolved",
        literals: ["Sort(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), ID, SortOrder.Descending)"],
      },
      filter: {
        status: "resolved",
        literals: ["Filter(CADASTROGRUPO, STATUS = \"ATIVO\")"],
      },
    },
    visibleFields: ["GRUPO", "STATUS", "ID"],
    actions: [],
    primaryAction: { status: "unresolved", reason: "gallery-onselect-not-resolved" },
    ...overrides,
  };
}

function artifactFixture(overrides = {}) {
  return {
    artifact: "G10- HISTÓRICO GRUPO.pa.yaml",
    moduleId: "suprimentos",
    actions: ["view", "edit"],
    operations: [{
      source: "CADASTROGRUPO",
      entityId: "cadastro-de-grupos",
      actions: ["view", "edit"],
      evidence: ["DataSource", "SubmitForm:EDITARGRUPO_11"],
    }],
    ...overrides,
  };
}

test("expoe construtores puros para resolver contratos de Gallery", async () => {
  const contractModule = await import(MODULE_URL.href).catch(() => ({}));

  assert.equal(typeof contractModule.resolvePowerAppsGalleryUiContract, "function");
  assert.equal(typeof contractModule.buildPowerAppsGalleryUiContracts, "function");
});

test("vincula a Gallery somente a operacao do artefato exato citada em Items", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture(),
    [artifactFixture()],
  );

  assert.deepEqual(contract.identity, {
    fileName: "G10- HISTÓRICO GRUPO.pa.yaml",
    screenName: "G10- HISTÓRICO GRUPO",
    galleryName: "Gallery2_1",
  });
  assert.deepEqual(contract.artifact, {
    status: "resolved",
    artifact: "G10- HISTÓRICO GRUPO.pa.yaml",
    moduleId: "suprimentos",
  });
  assert.deepEqual(contract.binding, {
    status: "resolved",
    source: "CADASTROGRUPO",
    entityId: "cadastro-de-grupos",
    actions: ["view", "edit"],
    evidence: ["DataSource", "SubmitForm:EDITARGRUPO_11"],
  });
  assert.deepEqual(contract.visibleFields, {
    status: "resolved",
    values: ["GRUPO", "STATUS", "ID"],
    evidence: "ThisItem field references extracted from the exact Gallery",
  });
});

test("reconhece a fonte como identificador Power Fx, nunca como texto ou comentario", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const falseReference = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Filter(OUTRA_FONTE, OBSERVACAO = \"CADASTROGRUPO\") // CADASTROGRUPO",
        },
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(falseReference.binding, {
    status: "unresolved",
    reason: "operation-not-proven-by-items",
  });

  const commentMarkerInsideText = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Filter(OUTRA_FONTE, OBSERVACAO = \"CADASTROGRUPO//nao e comentario\")",
        },
      },
    }),
    [artifactFixture()],
  );
  assert.equal(commentMarkerInsideText.binding.status, "unresolved");

  const quotedSource = "CADASTRO FAMÍLIA_1";
  const exactQuotedReference = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Filter('CADASTRO FAMÍLIA_1', STATUS = \"ATIVO\")",
        },
      },
    }),
    [artifactFixture({
      operations: [{
        source: quotedSource,
        entityId: "familias",
        actions: ["view"],
        evidence: ["formula-reference"],
      }],
    })],
  );
  assert.equal(exactQuotedReference.binding.status, "resolved");
  assert.equal(exactQuotedReference.binding.source, quotedSource);
  assert.equal(exactQuotedReference.binding.entityId, "familias");
});

test("nao confunde fonte citada em uma clausula com a fonte raiz da Gallery", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const nestedReference = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Filter(OUTRA_FONTE, LookUp(CADASTROGRUPO, ID = 1).ATIVO)",
        },
      },
    }),
    [artifactFixture()],
  );

  assert.deepEqual(nestedReference.binding, {
    status: "unresolved",
    reason: "operation-not-proven-by-items",
  });
});

test("traduz apenas a ordenacao externa simples comprovada em Items", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture(),
    [artifactFixture()],
  );

  assert.deepEqual(contract.sort, {
    status: "resolved",
    field: "ID",
    direction: "descending",
    evidence: "=Sort(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), ID, SortOrder.Descending)",
  });

  const unsafe = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Sort(CADASTROGRUPO, If(Admin, ID, SEGREDO), SortOrder.Descending)",
        },
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(unsafe.sort, {
    status: "unresolved",
    reason: "sort-formula-not-translatable",
  });

  const byColumns = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=SortByColumns(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), \"GRUPO\", SortOrder.Ascending)",
        },
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(byColumns.sort, {
    status: "resolved",
    field: "GRUPO",
    direction: "ascending",
    evidence: "=SortByColumns(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), \"GRUPO\", SortOrder.Ascending)",
  });
  assert.deepEqual(byColumns.filter.values, [{
    kind: "fixed-equals",
    field: "STATUS",
    value: "ATIVO",
    evidence: "STATUS = \"ATIVO\"",
  }]);
});

test("traduz filtros e pesquisa somente para clausulas Power Fx suportadas", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const items = `=Sort(Filter(
    CADASTROGRUPO,
    (IsBlank(Dropdown8.Selected.Value) || STATUS = Dropdown8.Selected.Value),
    (IsBlank(SearchBox.Text) || StartsWith(GRUPO, SearchBox.Text)),
    ATIVO = true
  ), ID, SortOrder.Descending)`;

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: { status: "resolved", literal: items },
      },
    }),
    [artifactFixture()],
  );

  assert.deepEqual(contract.filter, {
    status: "resolved",
    values: [
      {
        kind: "optional-equals",
        field: "STATUS",
        input: "Dropdown8.Selected.Value",
        evidence: "IsBlank(Dropdown8.Selected.Value) || STATUS = Dropdown8.Selected.Value",
      },
      {
        kind: "fixed-equals",
        field: "ATIVO",
        value: true,
        evidence: "ATIVO = true",
      },
    ],
    unresolved: [],
  });
  assert.deepEqual(contract.search, {
    status: "resolved",
    values: [{
      kind: "starts-with",
      field: "GRUPO",
      input: "SearchBox.Text",
      optional: true,
      evidence: "IsBlank(SearchBox.Text) || StartsWith(GRUPO, SearchBox.Text)",
    }],
    unresolved: [],
  });
});

test("expoe apenas acoes reconhecidas e comprovadas pela operacao ou artefato", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const actions = [
    {
      controlName: "Title2_1",
      kind: "select-parent",
      onSelect: "=Select(Parent)",
    },
    {
      controlName: "IconEditar",
      kind: "action",
      onSelect: "=EditForm(EDITARGRUPO_11)",
    },
    {
      controlName: "IconComposto",
      kind: "action",
      onSelect: "=EditForm(EDITARGRUPO_11);Remove(CADASTROGRUPO, ThisItem)",
    },
    {
      controlName: "IconDetalhe",
      kind: "action",
      onSelect: "=Navigate('E10- DETALHE GRUPO', ScreenTransition.Fade)",
    },
    {
      controlName: "IconDesconhecido",
      kind: "action",
      onSelect: "=Set(htmlcorreto, HtmlText24_7.HtmlText)",
    },
  ];

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({ actions }),
    [artifactFixture({ actions: ["view", "edit", "navigate"] })],
  );

  assert.deepEqual(contract.actions, {
    status: "partial",
    values: [
      {
        kind: "select",
        controlName: "Title2_1",
        evidence: "=Select(Parent)",
      },
      {
        kind: "edit",
        controlName: "IconEditar",
        formName: "EDITARGRUPO_11",
        evidence: "=EditForm(EDITARGRUPO_11)",
      },
      {
        kind: "navigate",
        controlName: "IconDetalhe",
        target: "E10- DETALHE GRUPO",
        evidence: "=Navigate('E10- DETALHE GRUPO', ScreenTransition.Fade)",
      },
    ],
    unresolved: [
      {
        controlName: "IconComposto",
        reason: "action-not-translatable",
        evidence: "=EditForm(EDITARGRUPO_11);Remove(CADASTROGRUPO, ThisItem)",
      },
      {
        controlName: "IconDesconhecido",
        reason: "action-not-translatable",
        evidence: "=Set(htmlcorreto, HtmlText24_7.HtmlText)",
      },
    ],
  });
});

test("traduz selecao primaria somente quando ela atribui exatamente ThisItem", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      actions: [],
      primaryAction: {
        status: "resolved",
        controlName: "Gallery2_1",
        onSelect: "=Set(dados, ThisItem)",
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(contract.actions, {
    status: "resolved",
    values: [{
      kind: "select",
      controlName: "Gallery2_1",
      evidence: "=Set(dados, ThisItem)",
    }],
    unresolved: [],
  });

  const contextSelection = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      actions: [],
      primaryAction: {
        status: "resolved",
        controlName: "Gallery2_1",
        onSelect: "=UpdateContext({LANÇAMENTOS: ThisItem})",
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(contextSelection.actions.values, [{
    kind: "select",
    controlName: "Gallery2_1",
    evidence: "=UpdateContext({LANÇAMENTOS: ThisItem})",
  }]);

  const unsafe = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      actions: [],
      primaryAction: {
        status: "resolved",
        controlName: "Gallery2_1",
        onSelect: "=Set(dados, First(CADASTROGRUPO))",
      },
    }),
    [artifactFixture()],
  );
  assert.deepEqual(unsafe.actions, {
    status: "unresolved",
    reason: "actions-not-translatable",
    values: [],
    unresolved: [{
      controlName: "Gallery2_1",
      reason: "action-not-translatable",
      evidence: "=Set(dados, First(CADASTROGRUPO))",
    }],
  });
});

test("falha fechado sem artefato exato ou com operacao ambigua", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const nameInference = resolvePowerAppsGalleryUiContract(
    galleryFixture(),
    [artifactFixture({ artifact: "g10- histórico grupo.pa.yaml" })],
  );
  assert.equal(nameInference.status, "unresolved");
  assert.deepEqual(nameInference.artifact, {
    status: "unresolved",
    reason: "exact-artifact-not-found",
  });
  assert.deepEqual(nameInference.visibleFields.values, []);

  const ambiguous = resolvePowerAppsGalleryUiContract(
    galleryFixture(),
    [artifactFixture({
      operations: [
        ...artifactFixture().operations,
        {
          source: "CADASTROGRUPO",
          entityId: "outra-entidade",
          actions: ["view"],
          evidence: ["formula-reference"],
        },
      ],
    })],
  );
  assert.equal(ambiguous.status, "unresolved");
  assert.deepEqual(ambiguous.binding, {
    status: "unresolved",
    reason: "operation-ambiguous-for-items",
  });
  assert.deepEqual(ambiguous.actions.values, []);
});

test("publica apenas nomes de campos visiveis efetivamente comprovados", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);

  const sanitized = resolvePowerAppsGalleryUiContract(
    galleryFixture({ visibleFields: ["ID", "", null, "ID", "STATUS"] }),
    [artifactFixture()],
  );
  assert.deepEqual(sanitized.visibleFields, {
    status: "resolved",
    values: ["ID", "STATUS"],
    evidence: "ThisItem field references extracted from the exact Gallery",
  });

  const absent = resolvePowerAppsGalleryUiContract(
    galleryFixture({ visibleFields: [] }),
    [artifactFixture()],
  );
  assert.deepEqual(absent.visibleFields, {
    status: "unresolved",
    reason: "visible-fields-not-proven",
    values: [],
  });
});

test("agrega um catalogo imutavel e consulta somente contratos resolvidos por entidade", async () => {
  const {
    POWERAPPS_GALLERY_UI_CONTRACTS,
    buildPowerAppsGalleryUiContracts,
    galleryUiContractsForEntity,
  } = await import(MODULE_URL.href);

  const controlled = buildPowerAppsGalleryUiContracts({
    galleryCatalog: { schemaVersion: 7, galleries: [galleryFixture()] },
    artifacts: [artifactFixture()],
  });

  assert.deepEqual(controlled.source, {
    gallerySchemaVersion: 7,
    galleryCount: 1,
    artifactCount: 1,
  });
  assert.equal(Object.isFrozen(controlled), true);
  assert.equal(Object.isFrozen(controlled.galleries), true);
  assert.equal(Object.isFrozen(controlled.galleries[0].binding), true);
  assert.deepEqual(
    galleryUiContractsForEntity("cadastro-de-grupos", controlled)
      .map(contract => contract.identity.galleryName),
    ["Gallery2_1"],
  );
  assert.deepEqual(galleryUiContractsForEntity("nao-existe", controlled), []);

  assert.equal(POWERAPPS_GALLERY_UI_CONTRACTS.schemaVersion, 1);
  assert.equal(POWERAPPS_GALLERY_UI_CONTRACTS.galleries.length, 84);
  assert.equal(
    POWERAPPS_GALLERY_UI_CONTRACTS.galleries.every(contract => (
      contract.artifact.status === "resolved"
    )),
    true,
  );
  for (const contract of POWERAPPS_GALLERY_UI_CONTRACTS.galleries) {
    if (contract.binding.status === "unresolved") {
      assert.deepEqual(contract.visibleFields.values, []);
      assert.deepEqual(contract.actions.values, []);
    }
  }
});
