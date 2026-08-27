function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const filterOnly = (...targets) => ({ filter: targets, highlight: [] });
const noCrossFilters = () => ({ filter: [], highlight: [] });

export const AUDITORIA_DEFINITION = deepFreeze({
  id: "auditoria",
  title: "AUDITORIA",
  sourceEntityIds: [
    "tipos-de-documento",
    "diarios-de-obras",
    "filiais",
    "notas-pendentes",
    "homologacoes-de-fornecedor",
    "linhas-de-contrato",
    "documentos-operacionais",
    "homologacao-comercial",
  ],
  filters: [
    { id: "filial", title: "FILIAL", field: "FILIAIS.FILIAL" },
    { id: "status", title: "STATUS", field: "Tabela_Documentos.STATUS" },
    { id: "tipo-documento", title: "TIPO DOC", field: "Tabela_Documentos.TIPODOCUMENTO" },
    { id: "fornecedor", title: "FORNECEDOR", field: "Tabela_Documentos.FORNECEDOR" },
  ],
  kpis: [
    {
      id: "diarios-pendentes",
      title: "DIÁRIOS PENDENTES",
      measure: "DIÁRIO DE OBRAS.DIARIOSPENDENTES",
      format: "integer",
    },
    {
      id: "homologacoes-pendentes",
      title: "HOMOLOGAÇÕES PENDENTES",
      measure: "Min(Tabela_Documentos.TIPODOCUMENTO)",
      format: "text",
    },
  ],
  charts: [
    {
      id: "status-homologacao",
      title: "STATUS POR HOMOLOGAÇÃO",
      type: "columnChart",
      dimensions: ["CADASTRO TIPO DOCUMENTO.HOMOLOGAÇÃO", "Tabela_Documentos.STATUS"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-fornecedor",
        "status-pendente-tipo-documento",
        "status-tipo-documento",
        "status-pendente-homologacao",
        "status-homologacao-filial",
      ),
    },
    {
      id: "status-pendente-homologacao",
      title: "STATUS PENDENTE POR HOMOLOGAÇÃO",
      type: "hundredPercentStackedColumnChart",
      dimensions: ["CADASTRO TIPO DOCUMENTO.HOMOLOGAÇÃO"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-homologacao",
        "status-fornecedor",
        "status-pendente-tipo-documento",
        "status-tipo-documento",
        "status-homologacao-filial",
        "notas-fiscais-pendentes",
      ),
    },
    {
      id: "status-pendente-tipo-documento",
      title: "STATUS PENDENTE POR TIPO DOC",
      type: "barChart",
      dimensions: ["Tabela_Documentos.STATUS", "Tabela_Documentos.TIPODOCUMENTO"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-fornecedor",
        "status-homologacao",
        "status-pendente-homologacao",
        "status-tipo-documento",
        "status-homologacao-filial",
      ),
    },
    {
      id: "status-tipo-documento",
      title: "STATUS POR TIPO DOCUMENTO",
      type: "barChart",
      dimensions: ["Tabela_Documentos.STATUS", "Tabela_Documentos.TIPODOCUMENTO"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-pendente-homologacao",
        "status-homologacao",
        "status-fornecedor",
        "status-pendente-tipo-documento",
        "status-homologacao-filial",
      ),
    },
    {
      id: "status-fornecedor",
      title: "STATUS POR FORNECEDOR",
      type: "barChart",
      dimensions: ["Tabela_Documentos.FORNECEDOR", "Tabela_Documentos.STATUS"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-pendente-tipo-documento",
        "status-tipo-documento",
        "status-homologacao",
        "status-pendente-homologacao",
        "status-homologacao-filial",
      ),
    },
    {
      id: "status-homologacao-filial",
      title: "STATUS POR HOMOLOGAÇÃO FILIAL",
      type: "columnChart",
      dimensions: ["Tabela_Documentos.FILIAL", "Tabela_Documentos.STATUS"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "status-diarios-obras",
      title: "STATUS DIÁRIOS DE OBRA",
      type: "columnChart",
      dimensions: ["DIÁRIO DE OBRAS.DATA", "DIÁRIO DE OBRAS.FILIAL", "DIÁRIO DE OBRAS.STATUS"],
      measures: ["CountNonNull(DIÁRIO DE OBRAS.DATA)"],
      crossFilters: filterOnly(
        "status-homologacao-filial",
        "status-homologacao",
        "status-tipo-documento",
        "status-fornecedor",
        "status-pendente-tipo-documento",
        "status-pendente-homologacao",
      ),
    },
    {
      id: "notas-fiscais-pendentes",
      title: "NOTAS FISCAIS PEND. LANÇAMENTO",
      type: "barChart",
      dimensions: ["NOTASPENDENTES.FORNECEDOR", "NOTASPENDENTES.STATUS"],
      measures: ["Sum(NOTASPENDENTES.VALORTOTAL)"],
      crossFilters: noCrossFilters(),
    },
    {
      id: "status-pendente-homologacao-filial",
      title: "STATUS PENDENTE POR HOMOLOGAÇÃO",
      type: "hundredPercentStackedColumnChart",
      dimensions: ["Tabela_Documentos.FILIAL"],
      measures: ["CountNonNull(Tabela_Documentos.TIPODOCUMENTO)"],
      crossFilters: filterOnly(
        "status-homologacao",
        "status-fornecedor",
        "notas-fiscais-pendentes",
        "status-homologacao-filial",
        "status-pendente-tipo-documento",
      ),
    },
  ],
  table: {
    id: "documentos",
    title: "DOCUMENTOS",
    source: "Tabela_Documentos",
    columns: [
      "Tabela_Documentos.Created",
      "Tabela_Documentos.DATASUBMETIDO",
      "Tabela_Documentos.FILIAL",
      "Tabela_Documentos.FORNECEDOR",
      "Tabela_Documentos.STATUS",
      "Tabela_Documentos.TIPODOCUMENTO",
    ],
    crossFilters: noCrossFilters(),
  },
});

export default AUDITORIA_DEFINITION;
