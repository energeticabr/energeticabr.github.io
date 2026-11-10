import { normalizeSearchText } from '../../../../portal/core/search-text.js';

const transactionTypes = [
  [/\bpix\b/, 'Pix'],
  [/\bted\b/, 'TED'],
  [/\bdoc\b/, 'DOC'],
  [/\b(?:transf|transferencia)\b/, 'Transferência'],
  [/\b(?:boleto|titulo|tit)\b/, 'Boleto'],
  [/\bdeb(?:ito)?\.? automatico\b/, 'Débito automático'],
  [/\bcartao\b/, 'Cartão'],
  [/\bconvenio\b/, 'Convênio'],
];

export function financialMovementType(description, fallback = 'Pagamento') {
  const normalized = normalizeSearchText(description);
  const primary = normalized.split('|')[0];
  const type = transactionTypes.find(([pattern]) => pattern.test(primary))?.[1];
  if ((!type || type === 'Transferência')
    && /\|\s*@?(?:pagamento|transferencia) pix(?:\s*\||$)/.test(normalized)) return 'Pix';
  return type || fallback;
}

const auditFields = ['ID', 'Criado por', 'Criado', 'Modificado', 'Modificado por'];
const auditAliases = { Criado: ['Created'], Modificado: ['Modified'], 'Criado por': ['Author'], 'Modificado por': ['Editor'] };
const movementFields = ['INSTITUICAO', 'DESCRICAO', 'OPERACAO', 'VALOR'];
const bankFields = ['RAZAOSOCIALRECEBEDOR', 'DATAPAGAMENTO', 'CONTAPAGADORA', 'CONTARECEBEDOR',
  'DOCUMENTORECEBEDOR', 'REFERENCIABANCARIA', 'ORIGEMMOVIMENTACAO'];

export function isImportedFinancialMovement(fields) {
  return fields?.ORIGEMMOVIMENTACAO === 'SICOOB';
}

export function financialMovementRecipient(fields) {
  const name = String(fields?.RAZAOSOCIALRECEBEDOR ?? '').trim();
  if ((!name || name.toUpperCase() === 'N/A') && /\bPIX\b/i.test(fields?.DESCRICAO ?? '')) {
    return 'Identificação pendente';
  }
  return name || 'N/A';
}

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
    [...movementFields, ...bankFields],
    { INSTITUICAO: 'Instituição', DESCRICAO: 'Descrição', OPERACAO: 'Operação', VALOR: 'Valor',
      RAZAOSOCIALRECEBEDOR: 'Nome ou razão social do recebedor', DATAPAGAMENTO: 'Data do pagamento',
      CONTAPAGADORA: 'Conta pagadora', CONTARECEBEDOR: 'Conta do recebedor',
      DOCUMENTORECEBEDOR: 'CPF/CNPJ do recebedor', REFERENCIABANCARIA: 'Referência bancária',
      ORIGEMMOVIMENTACAO: 'Origem' }),
    metadataEditorFields: movementFields,
    showAttachments: true,
    filterFields: ['ID', ...movementFields, 'RAZAOSOCIALRECEBEDOR', 'CONTAPAGADORA', 'ORIGEMMOVIMENTACAO'],
    dateRangeField: 'DATAPAGAMENTO',
    sourceSort: [{ field: 'DATAPAGAMENTO', direction: 'desc', type: 'date' }, { field: 'ID', direction: 'desc', type: 'number' }],
    recordLabel: 'movimentação', recordArticle: 'a', searchPlaceholder: 'Pesquisar recebedor, conta ou descrição',
    fieldTypes: { VALOR: 'currency', DATAPAGAMENTO: 'date', Criado: 'date', Modificado: 'date' },
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
