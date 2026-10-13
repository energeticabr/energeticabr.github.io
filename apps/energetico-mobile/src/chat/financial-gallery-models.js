const auditFields = ['ID', 'Criado por', 'Criado', 'Modificado', 'Modificado por'];
const auditAliases = { Criado: ['Created'], Modificado: ['Modified'], 'Criado por': ['Author'], 'Modificado por': ['Editor'] };

function model(title, listName, fields, fieldLabels, dateFields = []) {
  return Object.freeze({
    title: `GALERIA ${title}`, listName, aliases: [listName], nativeCard: true,
    recordLabel: 'registro', metadataEditorFields: fields,
    fields: [...fields, ...auditFields], filterFields: ['ID', ...fields],
    dateFilterFields: dateFields, fieldAliases: auditAliases, fieldLabels,
    fieldTypes: Object.fromEntries(dateFields.map(field => [field, 'date'])),
    sourceSort: { field: 'ID', direction: 'desc', type: 'number' },
  });
}

export const FINANCIAL_GALLERY_MODELS = Object.freeze({
  financial_movement: Object.freeze({ ...model('DE MOVIMENTAÇÃO', 'MOVIMENTACOESFINANCEIRAS',
    ['INSTITUICAO', 'DESCRICAO', 'OPERACAO', 'VALOR'],
    { INSTITUICAO: 'Instituição', DESCRICAO: 'Descrição', OPERACAO: 'Operação', VALOR: 'Valor' }),
    recordLabel: 'movimentação', recordArticle: 'a', searchPlaceholder: 'Pesquisar instituição, descrição ou operação',
    fieldTypes: { VALOR: 'currency', Criado: 'date', Modificado: 'date' },
    metadataEditorEntity: { id: 'financial-movement', title: 'Movimentação financeira', siteKey: 'personal', immutableFields: [], messageFields: [] },
  }),
  investment: model('INVESTIMENTOS', 'CADASTRO INVESTIMENTO',
    ['INSTITUICAO', 'DESCRICAO', 'TIPO', 'INVESTIMENTO', 'TRIBUTAÇÃO', 'RENTABILIDADE', 'LIQUIDEZ', 'RISCO', 'PRAZO'],
    { INSTITUICAO: 'Instituição', DESCRICAO: 'Descrição' }, ['PRAZO']),
  institution: model('INSTITUIÇÕES', 'INSTITUICAOEMISSORA', ['INSTITUICAOEMISSORA', 'STATUS'], { INSTITUICAOEMISSORA: 'Instituição emissora' }),
  investment_type: model('TIPOS DE INVESTIMENTO', 'CADASTROTIPOINVESTIMENTO', ['TIPO', 'DESCRICAO', 'STATUS'], { DESCRICAO: 'Descrição' }),
  profitability: Object.freeze({ ...model('RENTABILIDADE', 'RENTABILIDADE', ['RENTABILIDADE', 'STATUS'], {}),
    // The legacy edit variants refer to a different schema. Use the proven
    // Form53 fields and current list metadata for this new gallery.
    metadataEditorEntity: { id: 'financial-profitability', title: 'Rentabilidade', siteKey: 'personal', immutableFields: [], messageFields: [] },
  }),
  taxation: model('TRIBUTAÇÃO', 'TRIBUTAÇÃO', ['TRIBUTACAO', 'STATUS', 'DESCRICAO'], { TRIBUTACAO: 'Tributação', DESCRICAO: 'Descrição' }),
});
