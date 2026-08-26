const ACTIONS = Object.freeze({ view: true, create: false, edit: false, delete: false, approve: false });

function freezeList(values = []) {
  return Object.freeze([...values]);
}

function entity({
  id,
  moduleId,
  title,
  listNames,
  siteKey = "personal",
  capabilities = {},
  searchFields = ["Title"],
  statusFields = [],
  uppercaseFields = ["Title"],
  messageFields = [],
}) {
  return Object.freeze({
    id,
    moduleId,
    title,
    siteKey,
    listNames: freezeList(listNames),
    capabilities: Object.freeze({ ...ACTIONS, ...capabilities }),
    searchFields: freezeList(searchFields),
    statusFields: freezeList(statusFields),
    uppercaseFields: freezeList(uppercaseFields),
    messageFields: freezeList(messageFields),
  });
}

const cadastro = { create: true, edit: true };
const novo = { create: true };
const lancamento = { create: true };

export const ENTITIES = Object.freeze([
  entity({ id: "lancamentos", moduleId: "suprimentos", title: "Lançamentos", listNames: ["LANCAMENTOS"], capabilities: lancamento, searchFields: ["Title", "DESCRICAO", "FORNECEDOR"], statusFields: ["STATUS"], uppercaseFields: ["Title", "DESCRICAO"] }),
  entity({ id: "tipos-de-material", moduleId: "suprimentos", title: "Tipos de material", listNames: ["CADASTROTIPOMATERIAL", "CADASTRO TIPO MATERIAL"], capabilities: cadastro }),
  entity({ id: "urgencias", moduleId: "suprimentos", title: "Urgências", listNames: ["CADASTROURGÊNCIA", "CADASTROURGENCIA", "CADASTRO URGÊNCIA"], capabilities: cadastro }),
  entity({ id: "unidades-de-medida", moduleId: "suprimentos", title: "Unidades de medida", listNames: ["CADASTROUNIDADEMEDIDA", "CADASTRO UNIDADE MEDIDA"], capabilities: cadastro }),
  entity({ id: "funcoes-de-imobilizado", moduleId: "suprimentos", title: "Funções de imobilizado", listNames: ["FUNCAOIMOBILIZADO", "FUNÇÃO IMOBILIZADO"] }),
  entity({ id: "lancamentos-concluidos", moduleId: "suprimentos", title: "Lançamentos concluídos", listNames: ["CONCLUIDOLANCAMENTOS", "CONCLUÍDO LANÇAMENTOS"], statusFields: ["STATUS", "CONCLUIDO"] }),
  entity({ id: "despesas-recorrentes", moduleId: "suprimentos", title: "Despesas recorrentes", listNames: ["DESPESASRECORRENTES", "DESPESAS RECORRENTES"], searchFields: ["Title", "FORNECEDOR", "DESCRICAO"], statusFields: ["STATUS"] }),
  entity({ id: "filiais", moduleId: "suprimentos", title: "Filiais", listNames: ["FILIAIS"] }),
  entity({ id: "fornecedores", moduleId: "suprimentos", title: "Fornecedores", listNames: ["FORNECEDORES"], searchFields: ["Title", "CNPJ", "EMAIL"] }),
  entity({ id: "grupos-de-imobilizados", moduleId: "suprimentos", title: "Grupos de imobilizados", listNames: ["GRUPO IMOBILIZADOS", "GRUPOIMOBILIZADOS"] }),
  entity({ id: "imobilizados", moduleId: "suprimentos", title: "Imobilizados", listNames: ["IMOBILIZADOS"], searchFields: ["Title", "CODIGO", "PATRIMONIO"], statusFields: ["STATUS"] }),
  entity({ id: "cadastro-de-imobilizados", moduleId: "suprimentos", title: "Cadastro de imobilizados", listNames: ["CADASTROIMOBILIZADO", "CADASTRO IMOBILIZADO"], capabilities: cadastro }),
  entity({ id: "cadastro-de-grupos", moduleId: "suprimentos", title: "Cadastro de grupos", listNames: ["CADASTROGRUPO", "CADASTRO GRUPO"], capabilities: cadastro }),
  entity({ id: "grupos", moduleId: "suprimentos", title: "Grupos", listNames: ["GRUPO", "GRUPOS"] }),
  entity({ id: "contas", moduleId: "suprimentos", title: "Contas", listNames: ["CADASTROCONTA", "CADASTRO CONTA"], capabilities: cadastro }),
  entity({ id: "cidades", moduleId: "suprimentos", title: "Cidades", listNames: ["CADASTROCIDADE", "CADASTRO CIDADE"], capabilities: cadastro }),
  entity({ id: "familias", moduleId: "suprimentos", title: "Famílias", listNames: ["CADASTRO FAMÍLIA_1", "CADASTRO FAMILIA_1"], capabilities: cadastro }),
  entity({ id: "subfamilias", moduleId: "suprimentos", title: "Subfamílias", listNames: ["SUBFAMÍLIA", "SUBFAMILIA", "SUBFAMÍLIAS", "SUBFAMILIAS"] }),
  entity({ id: "cadastro-de-subfamilias", moduleId: "suprimentos", title: "Cadastro de subfamílias", listNames: ["CADASTROSUBFAMÍLIA", "CADASTROSUBFAMILIA", "CADASTRO SUBFAMÍLIA", "CADASTRO SUBFAMILIA"], capabilities: cadastro }),
  entity({ id: "produtos", moduleId: "suprimentos", title: "Produtos", listNames: ["CADASTROPRODUTO", "CADASTRO PRODUTO"], capabilities: cadastro, searchFields: ["Title", "CODIGO", "DESCRICAO"] }),
  entity({ id: "compras", moduleId: "suprimentos", title: "Compras", listNames: ["LANCAMENTOCOMPRAS", "LANCAMENTO COMPRAS"], capabilities: lancamento, searchFields: ["Title", "FORNECEDOR", "PEDIDO"], statusFields: ["STATUS"] }),
  entity({ id: "comprovantes-de-pagamento", moduleId: "suprimentos", title: "Comprovantes de pagamento", listNames: ["ARQUIVOLANCAMENTOS", "ARQUIVO LANCAMENTOS"], searchFields: ["Title", "LANCAMENTO"], uppercaseFields: [] }),

  entity({ id: "tickets-clientes", moduleId: "demandas", title: "Tickets de clientes", listNames: ["TICKETS CLIENTES"], siteKey: "company", searchFields: ["Title", "CLIENTE", "ASSUNTO"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "DESCRICAO", "ASSUNTO"] }),
  entity({ id: "movimentacoes-de-ticket", moduleId: "demandas", title: "Movimentações de ticket", listNames: ["TICKET MOVIMENTACOES", "TICKET MOVIMENTAÇÕES"], siteKey: "company", searchFields: ["Title", "TICKET"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "COMENTARIO", "DESCRICAO"] }),
  entity({ id: "comunicacoes-clientes", moduleId: "demandas", title: "Comunicações de clientes", listNames: ["COMUNICACOES CLIENTES", "COMUNICAÇÕES CLIENTES"], siteKey: "company", searchFields: ["Title", "CLIENTE", "ASSUNTO"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "CORPO", "ASSUNTO"] }),
  entity({ id: "movimentacoes-de-comunicacao", moduleId: "demandas", title: "Movimentações de comunicação", listNames: ["COMUNICACAO MOVIMENTACOES", "COMUNICAÇÃO MOVIMENTAÇÕES"], siteKey: "company", searchFields: ["Title", "COMUNICACAO"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "COMENTARIO", "DESCRICAO"] }),
  entity({ id: "mensagens-programadas", moduleId: "demandas", title: "Mensagens programadas", listNames: ["MENSAGEM PROGRAMADA", "MENSAGENS PROGRAMADAS"], searchFields: ["Title", "DESTINATARIO", "ASSUNTO"], statusFields: ["STATUS"], uppercaseFields: [], messageFields: ["Title", "MENSAGEM", "CORPO", "ASSUNTO"] }),
  entity({ id: "tarefas-delegadas", moduleId: "demandas", title: "Tarefas delegadas", listNames: ["TAREFASDELEGADAS", "TAREFAS DELEGADAS"], capabilities: novo, searchFields: ["Title", "RESPONSAVEL", "DELEGADO"], statusFields: ["STATUS"] }),
  entity({ id: "cadastro-de-tarefas", moduleId: "demandas", title: "Cadastro de tarefas", listNames: ["CADASTROTAREFAS", "CADASTRO TAREFAS"], capabilities: cadastro, searchFields: ["Title", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "lancamentos-de-tarefas", moduleId: "demandas", title: "Lançamentos de tarefas", listNames: ["LANCAMENTOTAREFAS", "LANCAMENTO TAREFAS"], capabilities: lancamento, searchFields: ["Title", "TAREFA", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "dificuldades", moduleId: "demandas", title: "Dificuldades", listNames: ["CADASTRODIFICULDADE", "CADASTRO DIFICULDADE"], capabilities: cadastro }),
  entity({ id: "impactos", moduleId: "demandas", title: "Impactos", listNames: ["CADASTRO IMPACTO", "CADASTROIMPACTO"], capabilities: cadastro }),

  entity({ id: "receitas", moduleId: "comercial", title: "Receitas", listNames: ["LANÇAMENTORECEITA", "LANCAMENTORECEITA", "LANCAMENTO RECEITA"], capabilities: lancamento, searchFields: ["Title", "CLIENTE", "CONTRATO"], statusFields: ["STATUS"] }),
  entity({ id: "clientes", moduleId: "comercial", title: "Clientes", listNames: ["CADASTRO CLIENTE_1", "CADASTRO CLIENTE", "CADASTROCLIENTE_1"], capabilities: cadastro, searchFields: ["Title", "CPF_CNPJ", "EMAIL"] }),
  entity({ id: "corretores", moduleId: "comercial", title: "Corretores", listNames: ["CORRETOR", "CORRETORES"], searchFields: ["Title", "CRECI", "EMAIL"] }),
  entity({ id: "homologacao-comercial", moduleId: "comercial", title: "Homologação comercial", listNames: ["HOMOLOGAÇÃO COMERCIAL", "HOMOLOGACAO COMERCIAL"], capabilities: { approve: true }, searchFields: ["Title", "CLIENTE", "CONTRATO"], statusFields: ["STATUS", "HOMOLOGACAO"] }),

  entity({ id: "provisoes-de-pagamento", moduleId: "financeiro", title: "Programação de pagamentos", listNames: ["PROVISÃO PGTOS", "PROVISAO PGTOS", "PROVISAO PAGAMENTOS"], searchFields: ["Title", "FORNECEDOR", "DOCUMENTO"], statusFields: ["STATUS"] }),
  entity({ id: "tipos-de-transacao", moduleId: "financeiro", title: "Tipos de transação", listNames: ["TIPO DE TRANSACAO", "TIPO DE TRANSAÇÃO"] }),

  entity({ id: "demonstrativos-de-etapa", moduleId: "rh-obras", title: "Demonstrativos de etapa", listNames: ["DEMONSTRATIVOETAPA", "DEMONSTRATIVO ETAPA"], searchFields: ["Title", "ETAPA", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "descricoes-de-medicao", moduleId: "rh-obras", title: "Descrições de medição", listNames: ["DESCRICAOMEDICOES", "DESCRIÇÃO MEDIÇÕES"] }),
  entity({ id: "diarios-de-obras", moduleId: "rh-obras", title: "Diários de obras", listNames: ["DIÁRIO DE OBRAS", "DIARIO DE OBRAS"], searchFields: ["Title", "OBRA", "RESPONSAVEL"], statusFields: ["STATUS"], messageFields: ["DESCRICAO", "OBSERVACOES"], uppercaseFields: ["Title", "OBRA"] }),
  entity({ id: "presencas", moduleId: "rh-obras", title: "Apontamentos de presença", listNames: ["APONTAMENTO DE PRESENÇA", "APONTAMENTO DE PRESENCA"], searchFields: ["Title", "FUNCIONARIO", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "apontamentos-de-funcionarios", moduleId: "rh-obras", title: "Apontamentos de funcionários", listNames: ["APONTAMENTOSFUNCIONARIOS", "APONTAMENTOS FUNCIONARIOS", "APONTAMENTOS FUNCIONÁRIOS"], searchFields: ["Title", "FUNCIONARIO", "OBRA"], statusFields: ["STATUS"] }),
  entity({ id: "descricoes-de-presenca", moduleId: "rh-obras", title: "Descrições de presença", listNames: ["DESCRITIVOPRESENCA", "DESCRITIVO PRESENCA"] }),
  entity({ id: "empreiteiros", moduleId: "rh-obras", title: "Empreiteiros", listNames: ["EMPREITEIRO", "EMPREITEIROS"], searchFields: ["Title", "CNPJ", "EMAIL"] }),
  entity({ id: "lancamentos-de-obras", moduleId: "rh-obras", title: "Lançamentos de obras", listNames: ["LANCAMENTOOBRA", "LANCAMENTO OBRA"], capabilities: lancamento, searchFields: ["Title", "OBRA", "ETAPA"], statusFields: ["STATUS"] }),
  entity({ id: "profissoes", moduleId: "rh-obras", title: "Profissões", listNames: ["PROFISSÃO", "PROFISSAO"] }),
  entity({ id: "atividades-executadas", moduleId: "rh-obras", title: "Atividades executadas", listNames: ["ATIVIDADE EXECUTADA", "ATIVIDADES EXECUTADAS"], searchFields: ["Title", "OBRA", "RESPONSAVEL"], statusFields: ["STATUS"] }),
  entity({ id: "atividades", moduleId: "rh-obras", title: "Atividades", listNames: ["ATIVIDADE", "ATIVIDADES"] }),
  entity({ id: "inconsistencias", moduleId: "rh-obras", title: "Tipos de inconsistência", listNames: ["TIPOINCONSISTENCIA", "TIPO INCONSISTENCIA", "TIPO INCONSISTÊNCIA"] }),

  entity({ id: "imoveis", moduleId: "patrimonio-locacoes", title: "Imóveis", listNames: ["IMOVEL CADASTRADO", "IMÓVEL CADASTRADO"], searchFields: ["Title", "CODIGO", "ENDERECO"], statusFields: ["STATUS"] }),
  entity({ id: "homologacao-de-documentos", moduleId: "patrimonio-locacoes", title: "Homologação de documentos", listNames: ["HOMOLOGAÇÃO DE DOCUMENTOS", "HOMOLOGACAO DE DOCUMENTOS"], capabilities: { approve: true }, searchFields: ["Title", "DOCUMENTO", "FORNECEDOR"], statusFields: ["STATUS", "HOMOLOGACAO"] }),

  entity({ id: "auditorias", moduleId: "auditoria-compliance", title: "Auditorias", listNames: ["LANCAMENTOS AUDITORIA", "LANCAMENTOS DE AUDITORIA"], capabilities: { approve: true }, searchFields: ["Title", "RESPONSAVEL", "DOCUMENTO"], statusFields: ["STATUS", "HOMOLOGACAO"] }),
  entity({ id: "tipos-de-auditoria", moduleId: "auditoria-compliance", title: "Tipos de auditoria", listNames: ["TIPOS AUDITORIA", "TIPOS DE AUDITORIA"] }),
  entity({ id: "tipos-de-documento", moduleId: "auditoria-compliance", title: "Tipos de documento", listNames: ["CADASTRO TIPO DOCUMENTO", "CADASTROTIPODOCUMENTO"], capabilities: cadastro }),
]);

export function entitiesForModule(moduleId) {
  return Object.freeze(ENTITIES.filter(entity => entity.moduleId === moduleId));
}

export default ENTITIES;
