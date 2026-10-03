import { createOrdersGalleryData } from "./orders-gallery-data.js";
import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import { createSharePointAttachmentTransport } from "../../../../portal/data/attachments.js";
import { createRegistrationGalleryFilterData } from "./registration-gallery-filter-data.js";

const AUDIT_FIELDS = ["ID", "Criado por", "Criado", "Modificado", "Modificado por"];
const AUDIT_ALIASES = { Criado: ["Created"], Modificado: ["Modified"], "Criado por": ["Author"], "Modificado por": ["Editor"] };

// Lista e campos das galerias baseadas nas telas Power Apps.
export const REGISTRATION_GALLERY_MODELS = Object.freeze({
  group: Object.freeze({ title: "GALERIA GRUPO", screen: "G10- HISTÓRICO GRUPO", listName: "CADASTROGRUPO", aliases: ["CADASTROGRUPO", "CADASTRO GRUPO"], fields: ["GRUPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { GRUPO: ["Title"] } }),
  family: Object.freeze({ title: "GALERIA FAMÍLIA", screen: "G8- HISTÓRICO FAMÍLIA", listName: "CADASTRO FAMÍLIA_1", aliases: ["CADASTRO FAMÍLIA_1", "CADASTRO FAMILIA_1"], fields: ["FAMÍLIA", "GRUPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { "FAMÍLIA": ["field_1"], GRUPO: ["Title"] } }),
  subfamily: Object.freeze({ title: "GALERIA SUBFAMÍLIA", screen: "G35- HISTÓRICO SUBFAMÍLIA", listName: "CADASTROSUBFAMÍLIA", aliases: ["CADASTROSUBFAMÍLIA", "CADASTROSUBFAMILIA", "CADASTRO SUBFAMÍLIA", "CADASTRO SUBFAMILIA"], fields: ["SUBFAMÍLIAS CADASTRADAS", "FAMÍLIA", "UNIDADE", "TIPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { "SUBFAMÍLIAS CADASTRADAS": ["field_1"], "FAMÍLIA": ["Title"], UNIDADE: ["field_2"], TIPO: ["field_3"] } }),
  product: Object.freeze({ title: "GALERIA PRODUTO", screen: "G38- HISTÓRICO PRODUTO", listName: "CADASTROPRODUTO", aliases: ["CADASTROPRODUTO", "CADASTRO PRODUTO"], fields: ["PRODUTO", "SUBFAMÍLIA", "UNIDADE", "TIPO", "TIPODESPESA", "GERADESEMBOLSO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { PRODUTO: ["field_1"], "SUBFAMÍLIA": ["Title"], STATUS: ["SATUS"] } }),
  documents: Object.freeze({
    title: "GALERIA DOCUMENTOS",
    screen: "G47- HISTÓRICO DOCUMENTOS COMERCIAL_1",
    listName: "DOCUMENTOS_1",
    aliases: ["DOCUMENTOS_1"],
    searchPlaceholder: "Pesquisar documento ou ID",
    fields: ["PESSOARELACIONADA", "STATUS", "FILIAL", "IMOVEL", "TIPODOCUMENTO", "TIPOHOMOLOGACAO", "ETAPA", "TIPOMARCO", "OBS", "DATA", "DATAVALIDADE", "DATASUBMETIDO", "ID", "Criado por", "Criado", "Modificado por", "Modificado"],
    filterFields: ["TIPOHOMOLOGACAO", "FILIAL", "IMOVEL", "ETAPA", "ID", "TIPODOCUMENTO", "PESSOARELACIONADA", "STATUS"],
    fieldAliases: { PESSOARELACIONADA: ["PESSOA RELACIONADA"], IMOVEL: ["IMÓVEL"], DATASUBMETIDO: ["DATA SUBMETIDO"] },
    showAttachments: true,
  }),
  asset: Object.freeze({
    title: "GALERIA DE IMOBILIZADO", screen: "G22- HISTÓRICOLANCAMENTOIMOBILIZADO", listName: "IMOBILIZADOS", aliases: ["IMOBILIZADOS"],
    nativeCard: true, showAttachments: true, recordLabel: "imobilizado", searchPlaceholder: "Pesquisar imobilizado ou patrimônio",
    fields: ["IMOBILIZADO", "NÚMEROIMOBILIZADO", "FORNECEDOR", "FILIAL", "QTD", "VALOR ESTIMADO", "VALOR RESIDUAL", "VALOR DEPRECIADO", "DATA DEPRECIAÇÃO", "DATA CADASTRO", "DATA COMPRA", "DEPRECIAR", "STATUS", ...AUDIT_FIELDS],
    filterFields: ["NÚMEROIMOBILIZADO", "IMOBILIZADO", "FILIAL", "FORNECEDOR", "STATUS", "DEPRECIAR"],
    fieldAliases: { ...AUDIT_ALIASES, IMOBILIZADO: ["ITEM"], NÚMEROIMOBILIZADO: ["N_x00da_MEROIMOBILIZADO"], "VALOR ESTIMADO": ["VALORESTIMADO"], "VALOR RESIDUAL": ["VALORRESIDUAL"], "DATA CADASTRO": ["DATACADASTRO"], "DATA COMPRA": ["DATACOMPRA"], "DATA DEPRECIAÇÃO": ["DATADEPRECIA_x00c7__x00c3_O"] },
    fieldLabels: { NÚMEROIMOBILIZADO: "Número patrimônio", "VALOR ESTIMADO": "Valor compra", "DATA DEPRECIAÇÃO": "Próxima depreciação", QTD: "Quantidade" },
    fieldTypes: { QTD: "number", "VALOR ESTIMADO": "currency", "VALOR RESIDUAL": "currency", "VALOR DEPRECIADO": "currency", "DATA DEPRECIAÇÃO": "date", "DATA CADASTRO": "date", "DATA COMPRA": "date" },
    computedFields: { "VALOR DEPRECIADO": { subtract: ["VALOR ESTIMADO", "VALOR RESIDUAL"] } },
    sourceSort: { field: "VALOR RESIDUAL", direction: "desc", type: "number" },
  }),
  assetFunction: Object.freeze({
    title: "GALERIA DE FUNÇÃO DO IMOBILIZADO", listName: "FUNCAOIMOBILIZADO", aliases: ["FUNCAOIMOBILIZADO", "FUNÇÃO IMOBILIZADO"],
    nativeCard: true, showAttachments: true, recordLabel: "registro de função", fields: ["FUNCAO", ...AUDIT_FIELDS], filterFields: ["FUNCAO"], fieldAliases: AUDIT_ALIASES, fieldLabels: { FUNCAO: "Função" }, sourceSort: { field: "ID", direction: "desc", type: "number" }, metadataEditorFields: ["FUNCAO"],
  }),
  assetProduct: Object.freeze({
    title: "GALERIA DE PRODUTO IMOBILIZADO", screen: "G14- HISTÓRICOIMOBILIZADO", listName: "CADASTROIMOBILIZADO", aliases: ["CADASTROIMOBILIZADO", "CADASTRO IMOBILIZADO"],
    nativeCard: true, showAttachments: true, recordLabel: "produto imobilizado", fields: ["IMOBILIZADO", "GRUPOIMOBILIZADO", "FUNCAO", ...AUDIT_FIELDS], filterFields: ["GRUPOIMOBILIZADO", "FUNCAO", "IMOBILIZADO"], fieldAliases: AUDIT_ALIASES, fieldLabels: { GRUPOIMOBILIZADO: "Grupo imobilizado", FUNCAO: "Função" }, sourceSort: null,
  }),
  assetGroup: Object.freeze({
    title: "GALERIA DE GRUPO IMOBILIZADO", screen: "G13- HISTÓRICOGRUPOIMOBILIZADO", listName: "GRUPO IMOBILIZADOS", aliases: ["GRUPO IMOBILIZADOS", "GRUPOIMOBILIZADOS"],
    nativeCard: true, showAttachments: true, recordLabel: "grupo imobilizado", fields: ["GRUPOIMOBILIZADOS", ...AUDIT_FIELDS], filterFields: ["GRUPOIMOBILIZADOS"], fieldAliases: AUDIT_ALIASES, fieldLabels: { GRUPOIMOBILIZADOS: "Grupo imobilizado" }, sourceSort: { field: "ID", direction: "desc", type: "number" },
  }),
  workDiary: Object.freeze({
    title: "GALERIA DE DIÁRIO DE OBRAS", screen: "G39- HISTÓRICO DIÁRIO DE OBRAS", listName: "DIÁRIO DE OBRAS", aliases: ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS"],
    nativeCard: true, showAttachments: true, recordLabel: "diário de obras", fields: ["DATA", "FILIAL", "STATUS", "INFORMAÇÕES CLIMÁTICAS", "TIPO", "ETAPA", ...AUDIT_FIELDS], filterFields: ["FILIAL", "STATUS", "INFORMAÇÕES CLIMÁTICAS", "ID", "TIPO", "ETAPA"],
    fieldAliases: { ...AUDIT_ALIASES, "INFORMAÇÕES CLIMÁTICAS": ["INFORMA_x00c7__x00d5_ESCLIM_x00c"] }, fieldTypes: { DATA: "weekday-date" }, substringFilters: ["ETAPA"], dateRangeField: "DATA", sourceSort: { field: "ID", direction: "desc", type: "number" },
  }),
  quotes: Object.freeze({
    title: "GALERIA DE NOVA COTAÇÃO", screen: "G19- HISTÓRICOLOCACOES_2", listName: "NOVACOTACAO", aliases: ["NOVACOTACAO", "NOVA COTACAO"],
    nativeCard: true, showAttachments: true, recordLabel: "cotação", recordArticle: "a", searchPlaceholder: "Pesquisar descrição", searchFields: ["DESCRICAO"],
    fields: ["DESCRICAO", "FILIAL", "ETAPA", "FORNECEDOR", "STATUS", "Criado", "DATAFINALIZADO", "COTACOESVINCULADAS", "ORCAMENTOESCOLHIDO", "ID"], filterFields: ["ID", "FILIAL", "ETAPA", "STATUS"], fieldAliases: AUDIT_ALIASES,
    fieldLabels: { DESCRICAO: "Descrição", Criado: "Data início", DATAFINALIZADO: "Data finalização", COTACOESVINCULADAS: "Orçamentos vinculados à cotação", ORCAMENTOESCOLHIDO: "Orçamento escolhido" }, fieldTypes: { DATAFINALIZADO: "date" },
    sourceSort: { field: "Criado", direction: "desc", type: "date" },
    defaultSort: "ID:desc", defaultFilters: { STATUS: "ATIVO" }, filterChoices: { STATUS: ["ATIVO", "INATIVO"] },
    sortOptions: [
      { value: "Created:desc", label: "Criado mais recente", field: "Criado", direction: "desc", type: "date" },
      { value: "Created:asc", label: "Criado mais antigo", field: "Criado", direction: "asc", type: "date" },
      { value: "Modified:desc", label: "Modificado mais recente", field: "Modificado", direction: "desc", type: "date" },
      { value: "ID:desc", label: "Maior ID", field: "ID", direction: "desc", type: "number" },
      { value: "ID:asc", label: "Menor ID", field: "ID", direction: "asc", type: "number" },
    ],
  }),
  contracts: Object.freeze({
    title: "GALERIA DE CONTRATOS", screen: "G31- HISTÓRICO CONTRATOS", listName: "EMPREITEIRO", aliases: ["EMPREITEIRO", "EMPREITEIROS"],
    nativeCard: true, showAttachments: true, recordLabel: "contrato", fields: ["FORNECEDOR", "FILIAL", "STATUS", "CONTRATO", "ATIVIDADEEXECUTADA", "DESCRITIVOETAPA", "ACRÉSCIMO", "DATA INÍCIO", "DATA FIM", "DURAÇÃO", ...AUDIT_FIELDS],
    filterFields: ["FORNECEDOR", "STATUS", "ID", "ATIVIDADEEXECUTADA", "FILIAL"], defaultFilters: { STATUS: "ATIVO" }, filterChoices: { STATUS: ["ATIVO", "INATIVO"] }, dateRangeField: "DATA", dateRangeBothRequired: true,
    fieldAliases: { ...AUDIT_ALIASES, "ACRÉSCIMO": ["ACR_x00c9_SCIMO"], "DATA INÍCIO": ["DATAIN_x00cd_CIO"], "DATA FIM": ["DATAFIM"] }, fieldTypes: { "ACRÉSCIMO": "currency", "DATA INÍCIO": "date", "DATA FIM": "date", DURAÇÃO: "days" },
    fieldLabels: { ATIVIDADEEXECUTADA: "Atividade executada", DESCRITIVOETAPA: "ID demonstrativo etapa", "ACRÉSCIMO": "Acréscimo", "DATA INÍCIO": "Data início", "DATA FIM": "Data fim", DURAÇÃO: "Duração", CONTRATO: "Contrato" }, computedFields: { DURAÇÃO: { elapsedDays: ["DATA INÍCIO", "DATA FIM"] } }, sourceSort: { field: "ID", direction: "desc", type: "number" }, editFormVariant: "E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml#Form1_8",
  }),
  contractLines: Object.freeze({
    title: "GALERIA DE LINHAS DE CONTRATO", screen: "G48 - HISTÓRICO LINHAS CONTRATO", listName: "LINHACONTRATO", aliases: ["LINHACONTRATO"],
    nativeCard: true, showAttachments: true, recordLabel: "linha do contrato", recordArticle: "a", fields: ["FORNECEDOR", "IDCONTRATO", "ETAPA", "FILIAL", "DATAINICIO", "TIPOMEDICAO", "VALORUNITARIO", "UNIDADE", "QTD", "DESCRICAO", "VALOR TOTAL", "TIPOLINHA", "ATIVIDADE", ...AUDIT_FIELDS], filterFields: ["FORNECEDOR", "IDCONTRATO", "FILIAL", "ATIVIDADE", "ID"],
    fieldAliases: { ...AUDIT_ALIASES, ETAPA: ["DEMONSTRATIVOETAPA"] }, fieldTypes: { DATAINICIO: "date", VALORUNITARIO: "currency", QTD: "number", "VALOR TOTAL": "currency" }, fieldLabels: { IDCONTRATO: "ID contrato", DATAINICIO: "Data início", TIPOMEDICAO: "Tipo de medição", VALORUNITARIO: "Valor unitário", UNIDADE: "Unidade", QTD: "Quantidade", DESCRICAO: "Descrição", "VALOR TOTAL": "Valor total", TIPOLINHA: "Tipo de linha", ATIVIDADE: "Atividade" },
    computedFields: { "VALOR TOTAL": { multiply: ["QTD", "VALORUNITARIO"] } }, sourceSort: [{ field: "IDCONTRATO", direction: "desc", type: "text" }, { field: "INDICELINHA", direction: "desc", type: "text" }], editFormVariant: "G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml#EDITARGRUPO_18",
  }),
  measurements: Object.freeze({
    title: "GALERIA DE MEDIÇÕES", screen: "G6- HISTÓRICO DESCRITIVO MEDIÇÃO", listName: "DESCRICAOMEDICOES", aliases: ["DESCRICAOMEDICOES", "DESCRIÇÃO MEDIÇÕES"],
    nativeCard: true, showAttachments: true, recordLabel: "medição", recordArticle: "a", fields: ["FORNECEDOR", "FILIAL", "STATUS", "VALORTOTAL", "DATA FIM", "NUMEROCONTRATO", "ETAPA OBRA", "QTD", "OBSERVACAO", "PENDENCIAS", "IDLANCAMENTO", "VALORUNITARIO", ...AUDIT_FIELDS], filterFields: ["FORNECEDOR", "STATUS", "ID"], defaultFilters: { STATUS: "ATIVO" }, filterChoices: { STATUS: ["ATIVO", "INATIVO"] },
    fieldAliases: { ...AUDIT_ALIASES, "DATA FIM": ["DATAFIM"], "ETAPA OBRA": ["ETAPAOBRA"] }, fieldTypes: { VALORTOTAL: "currency", "DATA FIM": "date", QTD: "number", VALORUNITARIO: "currency" }, fieldLabels: { VALORTOTAL: "Valor lançamento atual", "DATA FIM": "Data pagamento", NUMEROCONTRATO: "Medição de contrato", "ETAPA OBRA": "Etapa obra", QTD: "Quantidade", OBSERVACAO: "Observações", PENDENCIAS: "Pendências", IDLANCAMENTO: "ID pagamento", VALORUNITARIO: "Valor unitário" }, sourceSort: { field: "DATA FIM", direction: "desc", type: "date" }, editFormVariant: "G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml#Form24",
  }),
  measurementLines: Object.freeze({
    title: "GALERIA DE LINHAS DE MEDIÇÃO", screen: "G49 - HISTÓRICO LINHAS MEDIÇÃO", listName: "LINHASMEDICAO", aliases: ["LINHASMEDICAO"],
    nativeCard: true, showAttachments: true, recordLabel: "linha de medição", recordArticle: "a", fields: ["Título", "NUMEROCONTRATO", "FORNECEDOR", "FILIAL", "IMOVEL", "DATAMEDICAO", "LINHACONTRATO", "ATIVIDADEEXECUTADA", "IDMEDICAO", "TIPOMEDICAO", "ETAPA", "VALORUNITARIO", "VALOR TOTAL", "QTD", "ALTURA", "LARGURA", "TIPO", "DATAPGTO", "STATUS", "IDPGTO", "OBSERVAÇÃO", ...AUDIT_FIELDS], filterFields: ["FORNECEDOR", "FILIAL", "NUMEROCONTRATO", "TIPO", "ID", "STATUS"], defaultFilters: { STATUS: "PENDENTE PGTO" }, filterChoices: { STATUS: ["PENDENTE PGTO", "PAGO", "ABATIDO"], TIPO: ["ACRÉSCIMO", "RETENÇÃO", "ABATIMENTO"] },
    fieldAliases: { ...AUDIT_ALIASES, Título: ["Title"], "OBSERVAÇÃO": ["OBSERVA_x00c7__x00c3_O"] }, fieldTypes: { DATAMEDICAO: "date", DATAPGTO: "date", VALORUNITARIO: "currency", "VALOR TOTAL": "currency", QTD: "rounded-number", ALTURA: "rounded-number", LARGURA: "rounded-number" }, fieldLabels: { NUMEROCONTRATO: "ID contrato", DATAMEDICAO: "Data medição", LINHACONTRATO: "Linha contrato", ATIVIDADEEXECUTADA: "Atividade executada", IDMEDICAO: "ID medição", TIPOMEDICAO: "Tipo de medição", VALORUNITARIO: "Valor unitário", "VALOR TOTAL": "Valor total", QTD: "Quantidade", ALTURA: "Altura", LARGURA: "Largura", DATAPGTO: "Data pagamento", IDPGTO: "ID pagamento", "OBSERVAÇÃO": "Observação" },
    fieldVisibility: { QTD: { field: "TIPOMEDICAO", equals: "MEDIÇÃO VALOR GLOBAL" }, ALTURA: { field: "TIPOMEDICAO", equals: "MEDIÇÃO VALOR UNITÁRIO" }, LARGURA: { field: "TIPOMEDICAO", equals: "MEDIÇÃO VALOR UNITÁRIO" }, IDPGTO: { field: "STATUS", includes: ["PAGO", "ABATIDO"] } },
    fieldDefaults: { IMOVEL: "TODOS" },
    computedFields: { "VALOR TOTAL": { when: { field: "TIPOMEDICAO", equals: "MEDIÇÃO VALOR GLOBAL", then: { multiply: ["VALORUNITARIO", "QTD"], roundInputs: 2 }, else: { multiply: ["ALTURA", "LARGURA", "VALORUNITARIO"] } } } }, sourceSort: { field: "ID", direction: "desc", type: "number" }, editFormVariant: "G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml#EDITARGRUPO_19",
  }),
  stageDemonstratives: Object.freeze({
    title: "GALERIA DE DEMONSTRATIVO ETAPA", screen: "G23- HISTÓRICO DESCRITIVO ETAPA", listName: "DEMONSTRATIVOETAPA", aliases: ["DEMONSTRATIVOETAPA", "DEMONSTRATIVO ETAPA"],
    nativeCard: true, showAttachments: true, recordLabel: "demonstrativo de etapa", fields: ["ATIVIDADEEXECUTADA", "FILIAL", "IMOVEL", "FORNECEDOR", "DATAEXECUTADO", "DATAPREVISTO", "STATUS", "ETAPA", "QTDEXECUTADA", "TOTAL", "PERCENTUAL EXECUTADO", "OBSERVACOESFINALIZACAO", ...AUDIT_FIELDS], filterFields: ["FILIAL", "ATIVIDADEEXECUTADA", "ETAPA", "FORNECEDOR", "STATUS"], defaultFilters: { STATUS: "ATIVIDADE INICIADA" }, filterChoices: { STATUS: ["ATIVIDADE FINALIZADA", "ATIVIDADE INICIADA"] }, fieldAliases: AUDIT_ALIASES,
    fieldTypes: { DATAEXECUTADO: "date", DATAPREVISTO: "date", QTDEXECUTADA: "number", TOTAL: "number", "PERCENTUAL EXECUTADO": "percent" }, fieldLabels: { ATIVIDADEEXECUTADA: "Atividade executada", DATAEXECUTADO: "Data início", DATAPREVISTO: "Data fim", QTDEXECUTADA: "Quantidade executada", TOTAL: "Quantidade total", "PERCENTUAL EXECUTADO": "Andamento", OBSERVACOESFINALIZACAO: "Observações" }, computedFields: { "PERCENTUAL EXECUTADO": { ratio: ["QTDEXECUTADA", "TOTAL"] } }, sourceSort: [{ field: "FILIAL", direction: "asc", type: "text" }, { field: "ATIVIDADEEXECUTADA", direction: "asc", type: "text" }], editFormVariant: "G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml#Form20_1",
  }),
  constructionStages: Object.freeze({
    title: "GALERIA DE ETAPA OBRA", screen: "G25- HISTÓRICO ETAPA OBRA", listName: "LANCAMENTOOBRA", aliases: ["LANCAMENTOOBRA"],
    nativeCard: true, showAttachments: true, recordLabel: "etapa de obra", recordArticle: "a", fields: ["ETAPA", "FILIAL", "GRUPO DE OBRA", "PERCENTUALEFETUADO", "INÍCIO", "DATA FATAL", "FIM", "STATUS", ...AUDIT_FIELDS], filterFields: ["TIPO", "FILIAL", "ETAPA", "STATUS"], defaultFilters: { TIPO: "ATIVIDADE COMUM", STATUS: "INICIADO" }, filterChoices: { STATUS: ["NÃO INICIADO", "INICIADO", "FINALIZADO"] },
    fieldAliases: { ...AUDIT_ALIASES, "GRUPO DE OBRA": ["Title"], TIPO: ["field_2"], ETAPA: ["field_3"], "INÍCIO": ["field_4"], FIM: ["field_5"], "DATA FATAL": ["DATAFATAL"] }, fieldTypes: { PERCENTUALEFETUADO: "percent", "INÍCIO": "date", "DATA FATAL": "date", FIM: "date" }, fieldLabels: { "GRUPO DE OBRA": "Grupo de obra", PERCENTUALEFETUADO: "Andamento", "INÍCIO": "Data início", "DATA FATAL": "Data fatal", FIM: "Data final" }, sourceSort: [{ field: "FILIAL", direction: "asc", type: "text" }, { field: "INDICE", direction: "asc", type: "number" }], editFormVariant: "E7- EDITAR ETAPA OBRA.pa.yaml#EDITARGRUPO_9",
  }),
  recurringTasks: Object.freeze({
    title: "GALERIA DE TAREFAS RECORRENTES", screen: "HISTORICOTAREFASRECORRENTES", listName: "TAREFASRECORRENTES", aliases: ["TAREFASRECORRENTES"],
    nativeCard: true, showAttachments: true, recordLabel: "tarefa recorrente", recordArticle: "a", searchPlaceholder: "Pesquisar descrição", searchFields: ["TAREFA"],
    fields: ["TAREFA", "ASSOCIAÇÃO", "FORNECEDOR", "FILIAL", "RECORRENCIA", "COBRAR", "PRIORITARIA", "STATUS", "DATA", "DATACRIARNOVAMENTE", "DATAVENCIMENTO", ...AUDIT_FIELDS],
    filterFields: ["FORNECEDOR", "FILIAL", "RECORRENCIA", "COBRAR", "PRIORITARIA", "STATUS", "ASSOCIAÇÃO"], fieldAliases: { ...AUDIT_ALIASES, "ASSOCIAÇÃO": ["ASSOCIA_x00c7__x00c3_O"] },
    fieldLabels: { TAREFA: "Descrição", RECORRENCIA: "Recorrência", PRIORITARIA: "Atividade prioritária", DATA: "Data início", DATACRIARNOVAMENTE: "Data próxima criação", DATAVENCIMENTO: "Data próximo vencimento" },
    fieldTypes: { DATA: "date", DATACRIARNOVAMENTE: "date", DATAVENCIMENTO: "date" }, defaultFilters: { STATUS: "ATIVO" },
    filterChoices: { STATUS: ["ATIVO", "INATIVO"], COBRAR: ["SIM", "NÃO"], PRIORITARIA: ["NÃO PRIORITÁRIA", "ATIVIDADE PRIORITÁRIA", "ATIVIDADE EMERGENCIAL"] },
    sourceSort: null, editFormVariant: "HISTORICOTAREFASRECORRENTES.pa.yaml#Form14_1",
  }),
  delegatedTasks: Object.freeze({
    title: "GALERIA DE TAREFAS DELEGADAS", screen: "G9- HISTÓRICO DELEGACAO", listName: "TAREFASDELEGADAS", aliases: ["TAREFASDELEGADAS", "TAREFAS DELEGADAS"],
    nativeCard: true, showAttachments: true, recordLabel: "tarefa delegada", recordArticle: "a", searchPlaceholder: "Pesquisar descrição ou número da tarefa", searchFields: ["ID 2", "TAREFA"],
    fields: ["TAREFA", "ID 2", "ASSOCIAÇÃO", "FILIAL", "RESPONSÁVEL", "PRIORITÁRIA", "CONCLUÍDO", "RECORRENCIA", "DATAIDENTIFICACAO", "DATA INÍCIO", "DATA FATAL", "DATA CONCLUSAO", "PONTUAÇÃO", "PRAZO", "TEMPO", ...AUDIT_FIELDS],
    filterFields: ["CONCLUÍDO", "ASSOCIAÇÃO", "DIFICULDADE", "PRIORITÁRIA", "DATA FATAL"], multiSelectFilters: ["CONCLUÍDO"], dateFilterFields: ["DATA FATAL"],
    fieldAliases: { ...AUDIT_ALIASES, "ID 2": ["OData__x0049_D2"], "ASSOCIAÇÃO": ["ASSOCIACAO", "ASSOCIA_x00c7__x00c3_O"], "RESPONSÁVEL": ["RESPONS_x00c1_VEL"], "PRIORITÁRIA": ["PRIORIT_x00c1_RIA"], "CONCLUÍDO": ["CONCLU_x00cd_DO"], "DATA FATAL": ["DATAFATAL"], "DATA INÍCIO": ["DATAIN_x00cd_CIO"], "DATA CONCLUSAO": ["DATACONCLUSAO0"] },
    fieldLabels: { "ID 2": "Número da tarefa", RECORRENCIA: "Recorrência", DATAIDENTIFICACAO: "Data identificação", "DATA CONCLUSAO": "Data conclusão" },
    fieldTypes: { DATAIDENTIFICACAO: "date", "DATA INÍCIO": "date", "DATA FATAL": "date", "DATA CONCLUSAO": "date", "PONTUAÇÃO": "number" },
    computedFields: {
      "PONTUAÇÃO": { priorityScore: [
        { field: "DIFICULDADE", weights: { "MUITO ALTA DIFICULDADE": 5, "ALTA DIFICULDADE": 4, "MÉDIA DIFICULDADE": 3, "BAIXA DIFICULDADE": 2, "MUITO BAIXA DIFICULDADE": 1 } },
        { field: "IMPACTO", weights: { "ALTO IMPACTO": 5, "MÉDIO IMPACTO": 3, "BAIXO IMPACTO": 1 } },
        { field: "URGENCIA", weights: { "ALTA URGÊNCIA": 5, "MÉDIA URGÊNCIA": 3, "BAIXA URGÊNCIA": 1 } },
      ] },
      PRAZO: { deadlineNotice: ["DATA FATAL", "DATA CONCLUSAO"] },
      TEMPO: { taskElapsed: ["DATA INÍCIO", "DATAIDENTIFICACAO", "DATA CONCLUSAO"] },
    },
    defaultFilters: { "CONCLUÍDO": ["ATIVIDADE CRIADA", "EM ATENDIMENTO"] }, filterChoices: { "CONCLUÍDO": ["CONCLUÍDO", "EM ATENDIMENTO", "ATIVIDADE CRIADA"], "PRIORITÁRIA": ["ATIVIDADE PRIORITÁRIA", "NÃO PRIORITÁRIA"] },
    sourceSort: [{ field: "PRIORITÁRIA", direction: "asc", type: "text" }, { field: "DATA FATAL", direction: "asc", type: "date" }], editFormVariant: "G9- HISTÓRICO DELEGACAO.pa.yaml#FORM.TAREFA_4",
  }),
});

export function registrationFieldKey(value) {
  return String(value || "").replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function registrationRawField(fields, name, model) {
  const accepted = [name, ...(model.fieldAliases?.[name] || [])].map(registrationFieldKey);
  return Object.entries(fields || {}).find(([key, value]) => value != null && accepted.includes(registrationFieldKey(key)))?.[1];
}

export function registrationNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").trim().replace(/R\$|\s/g, "");
  if (!text) return null;
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function registrationDateKey(value) {
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const local = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s.*)?$/);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : local ? `${local[3]}-${local[2]}-${local[1]}` : "";
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : "";
}

export function sortRegistrationRows(rows, model, selectedSort) {
  const selected = selectedSort || model.sourceSort;
  if (!selected) return [...rows];
  const criteria = Array.isArray(selected) ? selected : [selected];
  const sortValue = (row, sort) => {
    const raw = sort.field === "ID" ? row.id : registrationRawField(row.fields, sort.field, model);
    if (sort.type === "number") return registrationNumber(raw);
    if (sort.type === "date") { const date = Date.parse(/^\d{2}\//.test(String(raw)) ? registrationDateKey(raw) : raw); return Number.isFinite(date) ? date : null; }
    return raw == null ? null : String(raw);
  };
  return [...rows].sort((left, right) => {
    for (const sort of criteria) {
      const a = sortValue(left, sort), b = sortValue(right, sort);
      if (a == null || b == null) { if (a != null || b != null) return a == null ? 1 : -1; continue; }
      const comparison = typeof a === "number" ? a - b : a.localeCompare(b, "pt-BR", { numeric: false });
      if (comparison) return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}

function galleryRepository(options) {
  const siteConfig = options.siteConfig || SHAREPOINT_SITES;
  let repository = options.repository;
  if (!repository) {
    if (typeof options.tokenProvider !== "function") throw new TypeError("A consulta SharePoint requer a sessão Microsoft ativa.");
    const fetch = options.fetchImpl || globalThis.fetch;
    repository = createSharePointRepository(createGraphClient(options.tokenProvider, { fetch }), siteConfig, {
      attachmentTransport: createSharePointAttachmentTransport({ tokenProvider: options.tokenProvider, allowedSites: Object.values(siteConfig), fetch }),
    });
  }
  const columnCache = new Map();
  // A frozen repository cannot be the Proxy target when returning adapters
  // for its methods. Forward through an empty facade to preserve invariants.
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "getItemsPage") return async (site, list, ...args) => {
        if (!columnCache.has(list)) columnCache.set(list, typeof repository.getColumns === "function"
          ? Promise.resolve(repository.getColumns(site, list, args[1]?.signal ? { signal: args[1].signal } : {})).catch(error => { columnCache.delete(list); throw error; }) : Promise.resolve([]));
        const [page, columns] = await Promise.all([repository.getItemsPage(site, list, ...args), columnCache.get(list)]);
        if (page?.hasMore === true && (typeof page.nextLink !== "string" || !page.nextLink)) throw new Error("A paginação da galeria não retornou o próximo cursor.");
        const items = (Array.isArray(page?.items) ? page.items : []).map(item => {
          const fields = { ...item.fields };
          for (const column of Array.isArray(columns) ? columns : []) {
            if (column.name && column.displayName && Object.hasOwn(fields, column.name) && !Object.hasOwn(fields, column.displayName)) fields[column.displayName] = fields[column.name];
          }
          return { ...item, fields };
        });
        return { ...page, items };
      };
      const value = repository[property];
      return typeof value === "function" ? value.bind(repository) : value;
    },
  });
}

export function createRegistrationGalleryData({ kind, ...options } = {}) {
  const model = REGISTRATION_GALLERY_MODELS[kind];
  if (!model) throw new RangeError("Galeria de cadastro desconhecida.");
  const repository = model.nativeCard ? galleryRepository(options) : options.repository;
  const data = createOrdersGalleryData({
    ...options,
    ...(model.nativeCard ? { repository, preserveSourceOrder: model.sourceSort == null } : {}),
    listAliases: model.aliases,
    listName: model.listName,
    listMissingCode: `registration_${kind}_list_missing`,
  });
  if (!model.nativeCard) return data;
  const filters = createRegistrationGalleryFilterData({ repository, siteKey: options.siteKey || "personal", kind });
  // This list has no extracted edit form. Its inventory proves FUNCAO is a
  // writable text field; only that field may enter the metadata editor.
  let editorPromise;
  function metadataEditor() {
    return editorPromise ||= import("./gallery-record-data.js").then(({ createGalleryRecordData }) => {
      const editorRepository = new Proxy(Object.create(null), {
        get(_target, property) {
          if (property === "getColumns") return async (...args) => {
            const columns = await repository.getColumns(...args);
            return (Array.isArray(columns) ? columns : []).filter(column => model.metadataEditorFields.some(field =>
              [column.name, column.displayName].some(name => registrationFieldKey(name) === registrationFieldKey(field))));
          };
          const value = repository[property];
          return typeof value === "function" ? value.bind(repository) : value;
        },
      });
      return createGalleryRecordData({ repository: editorRepository, siteKey: options.siteKey || "personal", listName: model.listName, listAliases: model.aliases, metadataOnly: true,
        async resolveList(signal) {
          const list = await repository.resolveList(options.siteKey || "personal", model.aliases, signal ? { signal } : {});
          if (list?.status !== "resolved" || !list.id) throw new Error(`A lista ${model.listName} não está disponível nesta conta SharePoint.`);
          return list;
        },
      });
    });
  }
  return Object.freeze({ ...data,
    ...filters,
    ...(kind === "recurringTasks" ? { getFilterPolicy(field) {
      if (registrationFieldKey(field) !== "fornecedor") return null;
      const email = String(options.userEmail || "").trim().toLowerCase();
      return { disabled: email !== "bernardonotini@energeticabr.com", defaultValue: email === "arthurmarcos@energeticabr.com" ? "ARTHUR MARCOS SILVA ROCHA" : "" };
    } } : {}),
    ...(model.editFormVariant ? { loadEditor: async (id, loadOptions = {}) => {
      if (loadOptions.formVariantId && loadOptions.formVariantId !== model.editFormVariant) throw new Error("O formulário solicitado não pertence a esta galeria.");
      return data.loadEditor(id, { ...loadOptions, formVariantId: model.editFormVariant });
    } } : {}),
    ...(model.metadataEditorFields ? {
      loadEditor: async (id, options) => (await metadataEditor()).loadEditor(id, options),
      saveEditor: async (context, fields) => (await metadataEditor()).saveEditor(context, fields),
      deleteItem: async (id, options) => (await metadataEditor()).deleteItem(id, options),
    } : {}),
    async loadSnapshot(loadOptions) {
      const snapshot = await data.loadSnapshot(loadOptions);
      const rows = model.sourceSort ? sortRegistrationRows(snapshot.rows, model)
        : snapshot.rows;
      return Object.freeze({ ...snapshot, rows: Object.freeze(rows) });
    },
  });
}
