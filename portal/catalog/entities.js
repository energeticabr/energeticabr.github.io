import { mutationEvidenceForSource } from "./powerapps-matrix.js";

const ACTIONS = Object.freeze({ view: true, create: false, edit: false, delete: false, approve: false });
const MUTATION_ACTIONS = Object.freeze(["create", "edit", "delete", "approve"]);

// A tela I10 do Power Apps expõe estes lançamentos como operações próprias,
// embora o inventário exportado só preserve o Form de edição correspondente.
export const OPERATIONAL_CAPABILITY_OVERRIDES = Object.freeze({
  "novas-cotacoes": Object.freeze({ create: true }),
  orcamentos: Object.freeze({ create: true }),
});

function freezeList(values = []) {
  return Object.freeze([...values]);
}

function entity({
  id,
  moduleId,
  title,
  listNames,
  siteKey = "personal",
  searchFields = ["Title"],
  statusFields = [],
  uppercaseFields = ["Title"],
  messageFields = [],
  immutableFields = [],
  deletionPolicy = "delete",
  archiveField = "",
  archiveValue = "",
  available = true,
  operationCapabilities = {},
}) {
  const capabilities = { ...ACTIONS, view: available };
  const listCapabilityEvidence = listNames.map(listName => {
    const evidence = mutationEvidenceForSource(listName);
    return Object.freeze({
      listName,
      capabilities: Object.freeze({ ...ACTIONS, view: available, ...evidence }),
    });
  });
  for (const { capabilities: evidence } of listCapabilityEvidence) {
    for (const action of MUTATION_ACTIONS) {
      capabilities[action] ||= evidence[action] === true;
    }
  }
  for (const action of MUTATION_ACTIONS) {
    capabilities[action] ||= operationCapabilities[action] === true;
  }
  return Object.freeze({
    id,
    moduleId,
    title,
    siteKey,
    listNames: freezeList(listNames),
    listCapabilityEvidence: Object.freeze(listCapabilityEvidence),
    capabilities: Object.freeze(capabilities),
    searchFields: freezeList(searchFields),
    statusFields: freezeList(statusFields),
    uppercaseFields: freezeList(uppercaseFields),
    messageFields: freezeList(messageFields),
    immutableFields: freezeList(immutableFields),
    deletionPolicy,
    archiveField,
    archiveValue,
    available,
  });
}

export const ENTITIES = Object.freeze([
  entity({ id: "lancamentos", moduleId: "suprimentos", title: "Lançamentos", listNames: ["LANCAMENTOS"], searchFields: ["FILIAL", "PRODUTO", "DESCRICAO", "FORNECEDOR"], statusFields: ["CONCLUIDO", "CONCLUÍDO"], uppercaseFields: ["FILIAL", "PRODUTO", "DESCRICAO"] }),
  entity({ id: "tipos-de-material", moduleId: "suprimentos", title: "Tipos de material", listNames: ["CADASTROTIPOMATERIAL", "CADASTRO TIPO MATERIAL"] }),
  entity({ id: "urgencias", moduleId: "suprimentos", title: "Urgências", listNames: ["CADASTROURGÊNCIA", "CADASTROURGENCIA", "CADASTRO URGÊNCIA"] }),
  entity({ id: "unidades-de-medida", moduleId: "suprimentos", title: "Unidades de medida", listNames: ["CADASTROUNIDADEMEDIDA", "CADASTRO UNIDADE MEDIDA"] }),
  entity({ id: "funcoes-de-imobilizado", moduleId: "suprimentos", title: "Funções de imobilizado", listNames: ["FUNCAOIMOBILIZADO", "FUNÇÃO IMOBILIZADO"] }),
  entity({ id: "lancamentos-concluidos", moduleId: "suprimentos", title: "Lançamentos concluídos", listNames: ["CONCLUIDOLANCAMENTOS", "CONCLUÍDO LANÇAMENTOS"], statusFields: ["STATUS", "CONCLUIDO"] }),
  entity({ id: "despesas-recorrentes", moduleId: "suprimentos", title: "Despesas recorrentes", listNames: ["DESPESASRECORRENTES", "DESPESAS RECORRENTES"], searchFields: ["Title", "FORNECEDOR", "DESCRICAO"], statusFields: ["STATUS"] }),
  entity({ id: "filiais", moduleId: "suprimentos", title: "Filiais", listNames: ["FILIAIS"] }),
  entity({ id: "fornecedores", moduleId: "suprimentos", title: "Fornecedores", listNames: ["FORNECEDORES"], searchFields: ["Title", "CNPJ", "EMAIL"] }),
  entity({ id: "grupos-de-imobilizados", moduleId: "suprimentos", title: "Grupos de imobilizados", listNames: ["GRUPO IMOBILIZADOS", "GRUPOIMOBILIZADOS"] }),
  entity({ id: "imobilizados", moduleId: "suprimentos", title: "Imobilizados", listNames: ["IMOBILIZADOS"], searchFields: ["Title", "CODIGO", "PATRIMONIO"], statusFields: ["STATUS"] }),
  entity({ id: "cadastro-de-imobilizados", moduleId: "suprimentos", title: "Cadastro de imobilizados", listNames: ["CADASTROIMOBILIZADO", "CADASTRO IMOBILIZADO"] }),
  entity({ id: "cadastro-de-grupos", moduleId: "suprimentos", title: "Cadastro de grupos", listNames: ["CADASTROGRUPO", "CADASTRO GRUPO"] }),
  entity({ id: "grupos", moduleId: "suprimentos", title: "Grupos", listNames: ["GRUPO", "GRUPOS"] }),
  entity({ id: "contas", moduleId: "suprimentos", title: "Contas", listNames: ["CADASTROCONTA", "CADASTRO CONTA"] }),
  entity({ id: "cidades", moduleId: "suprimentos", title: "Cidades", listNames: ["CADASTROCIDADE", "CADASTRO CIDADE"] }),
  entity({ id: "familias", moduleId: "suprimentos", title: "Famílias", listNames: ["CADASTRO FAMÍLIA_1", "CADASTRO FAMILIA_1"] }),
  entity({ id: "subfamilias", moduleId: "suprimentos", title: "Subfamílias", listNames: ["SUBFAMÍLIA", "SUBFAMILIA", "SUBFAMÍLIAS", "SUBFAMILIAS"] }),
  entity({ id: "cadastro-de-subfamilias", moduleId: "suprimentos", title: "Cadastro de subfamílias", listNames: ["CADASTROSUBFAMÍLIA", "CADASTROSUBFAMILIA", "CADASTRO SUBFAMÍLIA", "CADASTRO SUBFAMILIA"] }),
  entity({ id: "produtos", moduleId: "suprimentos", title: "Produtos", listNames: ["CADASTROPRODUTO", "CADASTRO PRODUTO"], searchFields: ["Title", "CODIGO", "DESCRICAO"] }),
  entity({ id: "compras", moduleId: "suprimentos", title: "Compras", listNames: ["LANCAMENTOCOMPRAS", "LANCAMENTO COMPRAS"], searchFields: ["Title", "FORNECEDOR", "PEDIDO"], statusFields: ["STATUS"] }),
  entity({ id: "comprovantes-de-pagamento", moduleId: "suprimentos", title: "Comprovantes de pagamento", listNames: ["ARQUIVOLANCAMENTOS", "ARQUIVO LANCAMENTOS"], searchFields: ["Title", "LANCAMENTO"], uppercaseFields: [] }),
  entity({ id: "notas-pendentes", moduleId: "suprimentos", title: "Notas pendentes", listNames: ["NOTASPENDENTES"], searchFields: ["Title", "FORNECEDOR", "DOCUMENTO"], statusFields: ["STATUS"] }),
  entity({ id: "homologacoes-de-fornecedor", moduleId: "suprimentos", title: "Homologações de fornecedor", listNames: ["HOMOLOGARFORNECEDOR"], searchFields: ["Title", "FORNECEDOR"], statusFields: ["STATUS"] }),
  entity({ id: "novas-cotacoes", moduleId: "suprimentos", title: "Novas cotações", listNames: ["NOVACOTACAO"], searchFields: ["Title", "FORNECEDOR", "OBRA"], statusFields: ["STATUS"], operationCapabilities: OPERATIONAL_CAPABILITY_OVERRIDES["novas-cotacoes"] }),
  entity({ id: "orcamentos", moduleId: "suprimentos", title: "Orçamentos", listNames: ["ORCAMENTOS"], searchFields: ["Title", "FORNECEDOR", "OBRA"], statusFields: ["STATUS"], operationCapabilities: OPERATIONAL_CAPABILITY_OVERRIDES.orcamentos }),
  entity({ id: "mensagens-programadas", moduleId: "demandas", title: "Mensagens programadas", listNames: ["MENSAGEM PROGRAMADA", "MENSAGENS PROGRAMADAS"], searchFields: ["Title", "DESTINATARIO", "ASSUNTO"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "CORPO", "ASSUNTO"] }),
  entity({ id: "tarefas-delegadas", moduleId: "demandas", title: "Tarefas delegadas", listNames: ["TAREFASDELEGADAS", "TAREFAS DELEGADAS"], searchFields: ["Title", "RESPONSAVEL", "DELEGADO"], statusFields: ["STATUS"] }),
  entity({ id: "cadastro-de-tarefas", moduleId: "demandas", title: "Cadastro de tarefas", listNames: ["CADASTROTAREFAS", "CADASTRO TAREFAS"], searchFields: ["Title", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "lancamentos-de-tarefas", moduleId: "demandas", title: "Lançamentos de tarefas", listNames: ["LANCAMENTOTAREFAS", "LANCAMENTO TAREFAS"], searchFields: ["Title", "TAREFA", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "dificuldades", moduleId: "demandas", title: "Dificuldades", listNames: ["CADASTRODIFICULDADE", "CADASTRO DIFICULDADE"] }),
  entity({ id: "impactos", moduleId: "demandas", title: "Impactos", listNames: ["CADASTRO IMPACTO", "CADASTROIMPACTO"] }),
  entity({ id: "tarefas-recorrentes", moduleId: "demandas", title: "Tarefas recorrentes", listNames: ["TAREFASRECORRENTES"], searchFields: ["Title", "RESPONSAVEL"], statusFields: ["STATUS"] }),

  entity({ id: "receitas", moduleId: "comercial", title: "Receitas", listNames: ["LANÇAMENTORECEITA", "LANCAMENTORECEITA", "LANCAMENTO RECEITA"], searchFields: ["Title", "CLIENTE", "CONTRATO"], statusFields: ["STATUS"] }),
  entity({ id: "clientes", moduleId: "comercial", title: "Clientes", listNames: ["CADASTRO CLIENTE_1", "CADASTRO CLIENTE", "CADASTROCLIENTE_1"], searchFields: ["Title", "CPF_CNPJ", "EMAIL"] }),
  entity({ id: "corretores", moduleId: "comercial", title: "Corretores", listNames: ["CORRETOR", "CORRETORES"], searchFields: ["Title", "CRECI", "EMAIL"] }),
  entity({ id: "homologacao-comercial", moduleId: "comercial", title: "Homologação comercial", listNames: ["HOMOLOGAÇÃO COMERCIAL", "HOMOLOGACAO COMERCIAL"], searchFields: ["Title", "CLIENTE", "CONTRATO"], statusFields: ["STATUS", "HOMOLOGACAO"] }),
  entity({ id: "apontamentos-comerciais", moduleId: "comercial", title: "Apontamentos comerciais", listNames: ["APONTAMENTOSCOMERCIAIS"], searchFields: ["Title", "CLIENTE", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "patologias-sac", moduleId: "comercial", title: "Patologias do SAC", listNames: ["SACPATOLOGIAS"], searchFields: ["Title", "CLIENTE", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "tipos-de-patologia", moduleId: "comercial", title: "Tipos de patologia", listNames: ["TIPOPATOLOGIA"] }),
  entity({ id: "tipos-de-marco", moduleId: "comercial", title: "Tipos de marco", listNames: ["TIPOMARCO"] }),

  entity({ id: "provisoes-de-pagamento", moduleId: "financeiro", title: "Programação de pagamentos", listNames: ["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"], searchFields: ["Title", "FORNECEDOR", "DOCUMENTO"], statusFields: ["STATUS"] }),
  entity({ id: "tipos-de-transacao", moduleId: "financeiro", title: "Tipos de transação", listNames: ["TIPO DE TRANSACAO", "TIPO DE TRANSAÇÃO"] }),

  entity({ id: "demonstrativos-de-etapa", moduleId: "rh-obras", title: "Demonstrativos de etapa", listNames: ["DEMONSTRATIVOETAPA", "DEMONSTRATIVO ETAPA"], searchFields: ["Title", "ETAPA", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "descricoes-de-medicao", moduleId: "rh-obras", title: "Descrições de medição", listNames: ["DESCRICAOMEDICOES", "DESCRIÇÃO MEDIÇÕES"] }),
  entity({ id: "diarios-de-obras", moduleId: "rh-obras", title: "Diários de obras", listNames: ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS"], searchFields: ["Title", "OBRA", "RESPONSAVEL"], statusFields: ["STATUS"], messageFields: ["DESCRICAO", "OBSERVACOES"], uppercaseFields: ["Title", "OBRA"] }),
  entity({ id: "presencas", moduleId: "rh-obras", title: "Apontamentos de presença", listNames: ["APONTAMENTO DE PRESENÇA", "APONTAMENTO DE PRESENCA"], searchFields: ["Title", "FUNCIONARIO", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "apontamentos-de-funcionarios", moduleId: "rh-obras", title: "Apontamentos de funcionários", listNames: ["APONTAMENTOSFUNCIONARIOS", "APONTAMENTOS FUNCIONARIOS", "APONTAMENTOS FUNCIONÁRIOS"], searchFields: ["Title", "FUNCIONARIO", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "descricoes-de-presenca", moduleId: "rh-obras", title: "Descrições de presença", listNames: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"] }),
  entity({ id: "empreiteiros", moduleId: "rh-obras", title: "Empreiteiros", listNames: ["EMPREITEIRO", "EMPREITEIROS"], searchFields: ["Title", "CNPJ", "EMAIL"] }),
  entity({ id: "lancamentos-de-obras", moduleId: "rh-obras", title: "Lançamentos de obras", listNames: ["LANCAMENTOOBRA", "LANCAMENTO OBRA"], searchFields: ["Title", "OBRA", "ETAPA"], statusFields: ["STATUS"] }),
  entity({ id: "profissoes", moduleId: "rh-obras", title: "Profissões", listNames: ["PROFISSÃO", "PROFISSAO"] }),
  entity({ id: "atividades-executadas", moduleId: "rh-obras", title: "Atividades executadas", listNames: ["ATIVIDADE EXECUTADA", "ATIVIDADES EXECUTADAS"], searchFields: ["Title", "OBRA", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "atividades", moduleId: "rh-obras", title: "Atividades", listNames: ["ATIVIDADE", "ATIVIDADES"] }),
  entity({ id: "inconsistencias", moduleId: "rh-obras", title: "Tipos de inconsistência", listNames: ["TIPOINCONSISTENCIA", "TIPO INCONSISTENCIA", "TIPO INCONSISTÊNCIA"] }),
  entity({ id: "documentos-operacionais", moduleId: "rh-obras", title: "Documentos operacionais", listNames: ["DOCUMENTOS_1"], searchFields: ["Title", "DOCUMENTO", "FORNECEDOR"], statusFields: ["STATUS"] }),
  entity({ id: "linhas-de-contrato", moduleId: "rh-obras", title: "Linhas de contrato", listNames: ["LINHACONTRATO"], searchFields: ["Title", "CONTRATO", "EMPREITEIRO"], statusFields: ["STATUS"] }),
  entity({ id: "linhas-de-medicao", moduleId: "rh-obras", title: "Linhas de medição", listNames: ["LINHASMEDICAO"], searchFields: ["Title", "MEDICAO", "CONTRATO"], statusFields: ["STATUS"] }),
  entity({ id: "registros-mensais", moduleId: "rh-obras", title: "Registros mensais", listNames: ["REGISTROMENSAL"] }),

  entity({ id: "imoveis", moduleId: "patrimonio-locacoes", title: "Imóveis", listNames: ["IMOVEL CADASTRADO", "IMÓVEL CADASTRADO"], searchFields: ["Title", "CODIGO", "ENDERECO"], statusFields: ["STATUS"] }),
  entity({ id: "homologacao-de-documentos", moduleId: "patrimonio-locacoes", title: "Homologação de documentos", listNames: ["HOMOLOGAÇÃO DE DOCUMENTOS", "HOMOLOGACAO DE DOCUMENTOS"], searchFields: ["Title", "DOCUMENTO", "FORNECEDOR"], statusFields: ["STATUS", "HOMOLOGACAO"] }),
  entity({ id: "associacoes-de-aluguel", moduleId: "patrimonio-locacoes", title: "Associações de aluguel", listNames: ["ASSOCIACAOALUGUEL"] }),
  entity({ id: "cadastros-de-aluguel", moduleId: "patrimonio-locacoes", title: "Cadastros de aluguel", listNames: ["CADASTRO ALUGUEL"], searchFields: ["Title", "INQUILINO", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "inquilinos", moduleId: "patrimonio-locacoes", title: "Inquilinos", listNames: ["CADASTRO INQUILINO_1"], searchFields: ["Title", "CPF_CNPJ", "EMAIL"], statusFields: ["STATUS"] }),
  entity({ id: "grupos-de-imoveis", moduleId: "patrimonio-locacoes", title: "Grupos de imóveis", listNames: ["CADASTROGRUPOIMÓVEL"] }),
  entity({ id: "cadastro-de-imoveis-locacao", moduleId: "patrimonio-locacoes", title: "Cadastro de imóveis para locação", listNames: ["CADASTROIMOVEL"], searchFields: ["Title", "CODIGO", "ENDERECO"], statusFields: ["STATUS"] }),
  entity({ id: "formas-de-pagamento-de-locacao", moduleId: "patrimonio-locacoes", title: "Formas de pagamento de locação", listNames: ["FORMAPGTO LOCACAO"] }),
  entity({ id: "fornecedores-de-locacao", moduleId: "patrimonio-locacoes", title: "Fornecedores de locação", listNames: ["FORNECEDORLOCACAO"], searchFields: ["Title", "CNPJ", "EMAIL"], statusFields: ["STATUS"] }),
  entity({ id: "homologacoes-de-locacao", moduleId: "patrimonio-locacoes", title: "Homologações de locação", listNames: ["HOMOLOGARLOCACAO"], statusFields: ["STATUS"] }),
  entity({ id: "lancamentos-de-aluguel", moduleId: "patrimonio-locacoes", title: "Lançamentos de aluguel", listNames: ["LANCAMENTOALUGUEL"], searchFields: ["Title", "INQUILINO", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "produtos-de-locacao", moduleId: "patrimonio-locacoes", title: "Produtos de locação", listNames: ["LOCACAOPRODUTO"], searchFields: ["Title", "PRODUTO", "FORNECEDOR"], statusFields: ["STATUS"] }),
  entity({ id: "previsoes-de-locacao", moduleId: "patrimonio-locacoes", title: "Previsões de locação", listNames: ["PREVLOCACOES"], searchFields: ["Title", "INQUILINO", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "produtos-de-aluguel", moduleId: "patrimonio-locacoes", title: "Produtos de aluguel", listNames: ["PRODUTOALUGUEL"] }),
  entity({ id: "recorrencias-de-locacao", moduleId: "patrimonio-locacoes", title: "Recorrências de locação", listNames: ["RECORRENTESLOCACOES"], searchFields: ["Title", "INQUILINO", "IMOVEL"], statusFields: ["STATUS"] }),
  entity({ id: "responsaveis-por-pagamento", moduleId: "patrimonio-locacoes", title: "Responsáveis por pagamento", listNames: ["RESPONSAVELPGTO"] }),
  entity({ id: "tarefas-de-aluguel", moduleId: "patrimonio-locacoes", title: "Tarefas de aluguel", listNames: ["TAREFASALUGUEL"] }),
  entity({ id: "tipos-de-homologacao-de-locacao", moduleId: "patrimonio-locacoes", title: "Tipos de homologação de locação", listNames: ["TIPOHOMOLOGACAOLOCACAO"], statusFields: ["STATUS"] }),

  entity({ id: "auditorias", moduleId: "auditoria-compliance", title: "Auditorias", listNames: ["LANCAMENTOS AUDITORIA", "LANCAMENTOS DE AUDITORIA"], searchFields: ["Title", "RESPONSAVEL", "DOCUMENTO"], statusFields: ["STATUS", "HOMOLOGACAO"] }),
  entity({ id: "tipos-de-auditoria", moduleId: "auditoria-compliance", title: "Tipos de auditoria", listNames: ["TIPOS AUDITORIA", "TIPOS DE AUDITORIA"] }),
  entity({ id: "tipos-de-documento", moduleId: "auditoria-compliance", title: "Tipos de documento", listNames: ["CADASTRO TIPO DOCUMENTO", "CADASTROTIPODOCUMENTO"] }),
  entity({ id: "grupos-de-documentos-por-filial", moduleId: "auditoria-compliance", title: "Grupos de documentos por filial", listNames: ["GRUPODOCFILIAL"], searchFields: ["Title", "FILIAL", "GRUPO"], statusFields: ["STATUS"] }),
]);

export function entitiesForModule(moduleId) {
  return Object.freeze(ENTITIES.filter(entity => entity.moduleId === moduleId && entity.available));
}

export default ENTITIES;
