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

test("resolve a fonte principal dentro de With e If sem confundir colecoes auxiliares", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: `=With(
            { Base: Filter(CADASTROGRUPO, IsBlank(StatusBox.Selected.Value) || STATUS = StatusBox.Selected.Value) },
            If(OrdemBox.Selected.Value = "ASC", Sort(Base, ID, SortOrder.Ascending), Sort(Base, ID, SortOrder.Descending))
          )`,
        },
      },
    }),
    [artifactFixture()],
  );

  assert.equal(contract.binding.status, "resolved");
  assert.equal(contract.binding.source, "CADASTROGRUPO");
  assert.deepEqual(contract.filter.values.map(value => value.field), ["STATUS"]);
});

test("audita os filtros e a pesquisa da Gallery real de ORCAMENTOS com Search antes do alias", async () => {
  const { POWERAPPS_GALLERY_UI_CONTRACTS } = await import(MODULE_URL.href);
  const contract = POWERAPPS_GALLERY_UI_CONTRACTS.galleries.find(candidate => (
    candidate.identity.fileName === "G19- HISTÓRICOLOCACOES_1.pa.yaml"
    && candidate.identity.galleryName === "Gallery2_41"
  ));

  assert.equal(contract?.binding.entityId, "orcamentos");
  assert.equal(contract.filter.status, "resolved");
  assert.deepEqual(contract.filter.values.map(value => value.field), [
    "ID",
    "IDCOTACAO",
    "FILIAL",
    "FORNECEDOR",
    "ETAPA",
    "STATUS",
  ]);
  assert.deepEqual(contract.search.values.map(value => [value.kind, value.field]), [["contains", "OBS"]]);
});

test("remove somente o alias comprovado do campo filtrado", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: "=Filter(CADASTROGRUPO As T, IsBlank(StatusBox.Selected.Value) || T.STATUS = StatusBox.Selected.Value)",
        },
      },
    }),
    [artifactFixture()],
  );

  assert.equal(contract.binding.status, "resolved");
  assert.deepEqual(contract.filter.values.map(value => value.field), ["STATUS"]);
});

test("preserva o campo antes de Value em alias e trata ponto dentro de nome citado como literal", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: `=Filter(
            CADASTROGRUPO As T,
            IsBlank(RecorrenciaBox.Selected.Value) || T.RECORRENCIA.Value = RecorrenciaBox.Selected.Value,
            IsBlank(ContratoBox.Selected.Value) || 'NUM. CONTRATO ALUGUEL' = ContratoBox.Selected.Value
          )`,
        },
      },
    }),
    [artifactFixture()],
  );

  assert.equal(contract.filter.status, "resolved");
  assert.deepEqual(contract.filter.values.map(value => value.field), [
    "RECORRENCIA",
    "NUM. CONTRATO ALUGUEL",
  ]);
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

test("traduz todas as variacoes seguras de filtros usadas nas Galleries reais", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const items = `=SortByColumns(
    Filter(
      CADASTROGRUPO,
      (IsBlank(FilialBox.Selected) Or FILIAL = FilialBox.Selected.FILIAL) &&
      (IsBlank(StatusBox.Selected.Value) || STATUS = StatusBox.Selected.Value),
      IsBlank(ContratoBox.Selected.ID) || IDCONTRATO = Text(ContratoBox.Selected.ID),
      If(!IsBlank(GrupoBox.Selected.GRUPO), GRUPO = GrupoBox.Selected.GRUPO, true),
      IsBlank(DificuldadeBox.Selected) Or DIFICULDADE = DificuldadeBox.SelectedText.Value,
      If(IsEmpty(ConcluidoBox.SelectedItems), true, CONCLUIDO in ConcluidoBox.SelectedItems.Value),
      !PendentesBox.Value || APROVACAO = "PENDENTE DE APROVACAO",
      (IsBlank(DataInicial.SelectedDate) || DateValue(DATA) >= DataInicial.SelectedDate) &&
      (IsBlank(DataFinal.SelectedDate) || DateValue(DATA) <= DataFinal.SelectedDate)
    ),
    "ID",
    SortOrder.Descending
  )`;

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({ formulas: { items: { status: "resolved", literal: items } } }),
    [artifactFixture()],
  );

  assert.equal(contract.filter.status, "resolved");
  assert.deepEqual(contract.filter.values.map(value => ({
    kind: value.kind,
    field: value.field,
    operator: value.operator,
  })), [
    { kind: "optional-equals", field: "FILIAL", operator: undefined },
    { kind: "optional-equals", field: "STATUS", operator: undefined },
    { kind: "optional-equals", field: "IDCONTRATO", operator: undefined },
    { kind: "optional-equals", field: "GRUPO", operator: undefined },
    { kind: "optional-equals", field: "DIFICULDADE", operator: undefined },
    { kind: "optional-in", field: "CONCLUIDO", operator: undefined },
    { kind: "optional-fixed", field: "APROVACAO", operator: undefined },
    { kind: "optional-range", field: "DATA", operator: "gte" },
    { kind: "optional-range", field: "DATA", operator: "lte" },
  ]);
});

test("traduz a pesquisa textual declarada com variavel e operador in", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: '=Filter(CADASTROGRUPO, IsBlank(_textoDescricao) || _textoDescricao in Coalesce(GRUPO, ""))',
        },
      },
    }),
    [artifactFixture()],
  );

  assert.equal(contract.search.status, "resolved");
  assert.deepEqual(contract.search.values.map(value => [value.kind, value.field]), [["contains", "GRUPO"]]);
});

test("traduz o intervalo aninhado usado no historico do Diario de Obras", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const nestedDate = `=Filter(CADASTROGRUPO,
    If(
      IsBlank(DataInicial.SelectedDate) && IsBlank(DataFinal.SelectedDate),
      true,
      If(
        IsBlank(DataInicial.SelectedDate),
        DATA <= DataFinal.SelectedDate,
        If(
          IsBlank(DataFinal.SelectedDate),
          DATA >= DataInicial.SelectedDate,
          DATA >= DataInicial.SelectedDate && DATA <= DataFinal.SelectedDate
        )
      )
    )
  )`;

  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({ formulas: { items: { status: "resolved", literal: nestedDate } } }),
    [artifactFixture()],
  );

  assert.equal(contract.filter.status, "resolved");
  assert.deepEqual(contract.filter.values.map(value => [value.kind, value.field, value.operator]), [
    ["optional-range", "DATA", "lte"],
    ["optional-range", "DATA", "gte"],
  ]);
});

test("nao inventa faixa opcional quando o If compara justamente no ramo vazio", async () => {
  const { resolvePowerAppsGalleryUiContract } = await import(MODULE_URL.href);
  const contract = resolvePowerAppsGalleryUiContract(
    galleryFixture({
      formulas: {
        items: {
          status: "resolved",
          literal: `=Filter(
            CADASTROGRUPO,
            If(IsBlank(DataInicial.SelectedDate), DATA >= DataInicial.SelectedDate, true)
          )`,
        },
      },
    }),
    [artifactFixture()],
  );

  assert.equal(contract.filter.status, "unresolved");
  assert.deepEqual(contract.filter.values, []);
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
  const boundContracts = POWERAPPS_GALLERY_UI_CONTRACTS.galleries.filter(contract => (
    contract.binding.status === "resolved"
  ));
  assert.equal(boundContracts.length, 69);
  assert.equal(boundContracts.filter(contract => contract.filter.status === "resolved").length, 60);
  assert.equal(boundContracts.filter(contract => contract.search.status === "resolved").length, 60);
  assert.equal(boundContracts.some(contract => (
    contract.filter.status === "partial" || contract.search.status === "partial"
  )), false);
  assert.equal(boundContracts.every(contract => (
    contract.filter.status !== "resolved" || contract.filter.unresolved.length === 0
  )), true);
  assert.equal(boundContracts.every(contract => (
    contract.search.status !== "resolved" || contract.search.unresolved.length === 0
  )), true);
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
