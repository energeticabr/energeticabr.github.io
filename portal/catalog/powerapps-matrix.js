import { ENTITIES } from "./entities.js";

const RAW_POWERAPPS_ARTIFACTS = [
  {
    "artifact": "_EditorState.pa.yaml",
    "kind": "system",
    "moduleId": "dashboard",
    "sources": [
      "ATIVIDADE",
      "CORRETOR",
      "DIÁRIO DE OBRAS",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "GRUPO",
      "LANCAMENTOS",
      "PROFISSÃO",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "atividades",
      "corretores",
      "diarios-de-obras",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "grupos",
      "lancamentos",
      "profissoes",
      "subfamilias"
    ],
    "actions": [
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "not-applicable",
    "gapReason": ""
  },
  {
    "artifact": "App.pa.yaml",
    "kind": "system",
    "moduleId": "dashboard",
    "sources": [
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "provisoes-de-pagamento"
    ],
    "actions": [
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "not-applicable",
    "gapReason": ""
  },
  {
    "artifact": "CRIAR SACPATOLOGIA.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "FILIAIS",
      "LANCAMENTOCOMPRAS",
      "SACPATOLOGIAS",
      "TIPOPATOLOGIA"
    ],
    "entityIds": [
      "clientes",
      "filiais",
      "compras"
    ],
    "actions": [
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SACPATOLOGIAS",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form31"
        ]
      },
      {
        "source": "TIPOPATOLOGIA",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: SACPATOLOGIAS, TIPOPATOLOGIA."
  },
  {
    "artifact": "DESPESAS RECORRENTES LOCAÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "FORMAPGTO LOCACAO",
      "FORNECEDORLOCACAO",
      "GRUPO",
      "LOCACAOPRODUTO",
      "RECORRENTESLOCACOES",
      "RESPONSAVELPGTO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form49_1"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form50_2"
        ]
      },
      {
        "source": "RECORRENTESLOCACOES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form47"
        ]
      },
      {
        "source": "RESPONSAVELPGTO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form48_1"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, RECORRENTESLOCACOES, RESPONSAVELPGTO."
  },
  {
    "artifact": "E1- EDITAR LANÇAMENTO COMPRA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "CADASTROUNIDADEMEDIDA",
      "DESCRICAOMEDICOES",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "TIPO DE TRANSACAO"
    ],
    "entityIds": [
      "contas",
      "produtos",
      "unidades-de-medida",
      "descricoes-de-medicao",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos",
      "tipos-de-transacao"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARLANCAMENTO"
        ]
      },
      {
        "source": "TIPO DE TRANSACAO",
        "entityId": "tipos-de-transacao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E11- EDITAR TAREFA.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTRO IMPACTO",
      "CADASTRODIFICULDADE",
      "CADASTROTAREFAS",
      "CADASTROURGÊNCIA",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOTAREFAS"
    ],
    "entityIds": [
      "atividades",
      "impactos",
      "dificuldades",
      "cadastro-de-tarefas",
      "urgencias",
      "filiais",
      "fornecedores",
      "lancamentos-de-tarefas"
    ],
    "actions": [
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRODIFICULDADE",
        "entityId": "dificuldades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROURGÊNCIA",
        "entityId": "urgencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOTAREFAS",
        "entityId": "lancamentos-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "DataSource"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras"
    ],
    "actions": [
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CONTRATOS",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_8"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1."
  },
  {
    "artifact": "E16- EDITAR CADASTRO VENDA.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "clientes",
      "corretores",
      "filiais",
      "imoveis",
      "compras",
      "receitas"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_35"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, TIPOMARCO."
  },
  {
    "artifact": "E2- EDITAR FORNECEDOR.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO TIPO DOCUMENTO",
      "CADASTROCIDADE",
      "CADASTROTIPOMATERIAL",
      "DEMONSTRATIVOETAPA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "tipos-de-documento",
      "cidades",
      "tipos-de-material",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos",
      "profissoes"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARFORNECEDOR"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "E3- EDITAR DIÁRIO OBRAS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "DIÁRIO DE OBRAS",
      "FILIAIS"
    ],
    "entityIds": [
      "diarios-de-obras",
      "filiais"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDIATARDIÁRIO"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E4- EDITAR FILIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCIDADE",
      "FILIAIS"
    ],
    "entityIds": [
      "cidades",
      "filiais"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARFORNECEDOR_1"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E7- EDITAR ETAPA OBRA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "FILIAIS",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARGRUPO_9"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E8- EDITAR CLIENTE.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS",
      "IMOVEL CADASTRADO"
    ],
    "entityIds": [
      "clientes",
      "corretores",
      "filiais",
      "imoveis"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form6"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "E9- EDITAR ATIVIDADE FUNCIONÁRIOS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "FILIAIS",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARGRUPO_3"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F1- CADASTRO ASSOCIAÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "CADASTROTAREFAS"
    ],
    "entityIds": [
      "cadastro-de-tarefas"
    ],
    "actions": [
      "create",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "create",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:CADASTROASSOCIAÇÃO"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F10- CADASTRO FORNECEDOR.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO TIPO DOCUMENTO",
      "CADASTROCIDADE",
      "CADASTROTIPOMATERIAL",
      "DEMONSTRATIVOETAPA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "HOMOLOGARFORNECEDOR",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "tipos-de-documento",
      "cidades",
      "tipos-de-material",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos-de-obras",
      "profissoes"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_20"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:CADASTROASSOCIAÇÃO_10"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form2"
        ]
      },
      {
        "source": "HOMOLOGARFORNECEDOR",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: HOMOLOGARFORNECEDOR. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F11- CADASTRO FILIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCIDADE",
      "FILIAIS"
    ],
    "entityIds": [
      "cidades",
      "filiais"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F12- CADASTRO GRUPO_1.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCONTA",
      "FILIAIS",
      "FORNECEDORES",
      "NOTASPENDENTES"
    ],
    "entityIds": [
      "contas",
      "filiais",
      "fornecedores"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form42_7"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES."
  },
  {
    "artifact": "F12- CADASTRO GRUPO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPO",
      "GRUPO"
    ],
    "entityIds": [
      "cadastro-de-grupos",
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F16- CADASTRO PROFISSÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "PROFISSÃO"
    ],
    "entityIds": [
      "profissoes"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_41"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F17- CADASTRO INCONSISTÊNCIAS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO IMPACTO",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "TIPOINCONSISTENCIA"
    ],
    "entityIds": [
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "impactos",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "inconsistencias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_45"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOINCONSISTENCIA",
        "entityId": "inconsistencias",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form21"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROIMOBILIZADO",
      "FILIAIS",
      "FORNECEDORES",
      "FUNCAOIMOBILIZADO",
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS"
    ],
    "entityIds": [
      "cadastro-de-imobilizados",
      "filiais",
      "fornecedores",
      "funcoes-de-imobilizado",
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROIMOBILIZADO",
        "entityId": "cadastro-de-imobilizados",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_47"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FUNCAOIMOBILIZADO",
        "entityId": "funcoes-de-imobilizado",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form22"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_46"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form1_38"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F19- CADASTROGRUPOIMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS"
    ],
    "entityIds": [
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_37"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F2- CADASTRODEMONSTRATIVOETAPA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_23"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:CADASTROASSOCIAÇÃO_6"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F20- CADASTRO PRODUTO IMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROIMOBILIZADO",
      "CADASTROPRODUTO",
      "FUNCAOIMOBILIZADO",
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "cadastro-de-imobilizados",
      "produtos",
      "funcoes-de-imobilizado",
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados",
      "subfamilias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROIMOBILIZADO",
        "entityId": "cadastro-de-imobilizados",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_40"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "FUNCAOIMOBILIZADO",
        "entityId": "funcoes-de-imobilizado",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F21- CADASTRO DESPESA RECORRENTE.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTRO CLIENTE_1",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "DESPESASRECORRENTES",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "clientes",
      "contas",
      "produtos",
      "despesas-recorrentes",
      "filiais",
      "fornecedores",
      "imoveis",
      "provisoes-de-pagamento"
    ],
    "actions": [
      "create",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARPREVISAOPGTO"
    ],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESPESASRECORRENTES",
        "entityId": "despesas-recorrentes",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_36"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F22- CADASTRO CORRETOR.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTROCIDADE",
      "CORRETOR",
      "GRUPO"
    ],
    "entityIds": [
      "cidades",
      "corretores",
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_32"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F24- CADASTRO ETAPA OBRA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form1_10"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F25- CADASTRO LANCAMENTO VENDA.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS"
    ],
    "entityIds": [
      "clientes",
      "corretores",
      "filiais",
      "imoveis",
      "compras"
    ],
    "actions": [
      "create",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "Patch:unclassified-record",
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_31"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F26- CADASTRO IMÓVEL.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "FILIAIS",
      "IMOVEL CADASTRADO"
    ],
    "entityIds": [
      "filiais",
      "imoveis"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_30"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F27- CADASTRO CLIENTE.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO"
    ],
    "entityIds": [
      "clientes",
      "corretores",
      "filiais",
      "fornecedores",
      "imoveis"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_29"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F28- CADASTROTIPODOCUMENTO.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTRO TIPO DOCUMENTO",
      "GRUPO",
      "GRUPODOCFILIAL"
    ],
    "entityIds": [
      "tipos-de-documento",
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_28"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F29- CADASTRO DOCUMENTOS_2.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "CADASTRO CLIENTE_1",
      "CADASTRO TIPO DOCUMENTO",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "GRUPO",
      "GRUPODOCFILIAL",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANCAMENTOOBRA",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "clientes",
      "tipos-de-documento",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "grupos",
      "imoveis",
      "compras",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_59"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form42"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, GRUPODOCFILIAL, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F3- CADASTRO PGTO PREV.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTRO CLIENTE_1",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "clientes",
      "contas",
      "produtos",
      "filiais",
      "fornecedores",
      "imoveis",
      "provisoes-de-pagamento"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form9"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F31- CADASTRO ATIVIDADE FUNCIONÁRIOS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "FILIAIS",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form1_18"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "CONTRATOS",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "Patch:unclassified-record",
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_6"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1."
  },
  {
    "artifact": "F33- CADASTRO HTML MEDIÇÃO UNITÁRIA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO IMPACTO",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "TIPOINCONSISTENCIA"
    ],
    "entityIds": [
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "impactos",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "inconsistencias"
    ],
    "actions": [
      "create",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_52"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form18"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOINCONSISTENCIA",
        "entityId": "inconsistencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F37- CADASTRO PRODUTO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROPRODUTO",
      "CADASTROSUBFAMÍLIA",
      "CADASTROTIPOMATERIAL",
      "CADASTROUNIDADEMEDIDA",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "produtos",
      "cadastro-de-subfamilias",
      "tipos-de-material",
      "unidades-de-medida",
      "subfamilias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form1_5"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F38- CADASTRO TIPO MATERIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROTIPOMATERIAL"
    ],
    "entityIds": [
      "tipos-de-material"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_3"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F39- CADASTRO UNIDADEMEDIDA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROUNIDADEMEDIDA"
    ],
    "entityIds": [
      "unidades-de-medida"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_4"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTROCIDADE",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "CADASTROSUBFAMÍLIA",
      "CADASTROTIPOMATERIAL",
      "CADASTROUNIDADEMEDIDA",
      "CORRETOR",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "NOTASPENDENTES",
      "PROVISÃO PGTOS",
      "SUBFAMÍLIA",
      "TIPO DE TRANSACAO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "cidades",
      "contas",
      "produtos",
      "cadastro-de-subfamilias",
      "tipos-de-material",
      "unidades-de-medida",
      "corretores",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "compras",
      "lancamentos-de-obras",
      "lancamentos",
      "provisoes-de-pagamento",
      "subfamilias",
      "tipos-de-transacao"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARPROVISAOPGTOSPOWERAPPS",
      "SUBMETERLANCAMENTOSJSON"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form52"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_34"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form2_1"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARGRUPO_23"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "delete",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPO DE TRANSACAO",
        "entityId": "tipos-de-transacao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F40- CADASTRO CIDADE.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCIDADE"
    ],
    "entityIds": [
      "cidades"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form4"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F41- CADASTRO DIÁRIO DE OBRAS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO IMPACTO",
      "DIÁRIO DE OBRAS",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "TIPOINCONSISTENCIA"
    ],
    "entityIds": [
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "impactos",
      "diarios-de-obras",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "inconsistencias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_54"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form4_1"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOINCONSISTENCIA",
        "entityId": "inconsistencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F42- CADASTRO FAMÍLIA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO FAMÍLIA_1",
      "CADASTROGRUPO",
      "GRUPO"
    ],
    "entityIds": [
      "familias",
      "cadastro-de-grupos",
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO FAMÍLIA_1",
        "entityId": "familias",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_1"
        ]
      },
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F43- CADASTRO SUBFAMÍLIA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO FAMÍLIA_1",
      "CADASTROSUBFAMÍLIA",
      "CADASTROTIPOMATERIAL",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "familias",
      "cadastro-de-subfamilias",
      "tipos-de-material",
      "subfamilias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO FAMÍLIA_1",
        "entityId": "familias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_2"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F44- APONTAMENTOS COMERCIAIS.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "CADASTRO CLIENTE_1",
      "CADASTRO TIPO DOCUMENTO",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "DOCUMENTOS_1",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "TIPOMARCO"
    ],
    "entityIds": [
      "clientes",
      "tipos-de-documento",
      "contas",
      "produtos",
      "filiais",
      "imoveis",
      "compras",
      "receitas"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form33_2"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_57"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form44_1"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "F44- LANÇAMENTO RECEITA.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "CADASTROSUBFAMÍLIA",
      "CORRETOR",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "clientes",
      "contas",
      "produtos",
      "cadastro-de-subfamilias",
      "corretores",
      "filiais",
      "imoveis",
      "compras",
      "receitas",
      "subfamilias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_44"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form33"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F46- ADICIONAR LINHA CONTRATO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTROUNIDADEMEDIDA",
      "DEMONSTRATIVOETAPA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LINHACONTRATO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "unidades-de-medida",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores"
    ],
    "actions": [
      "create",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "create",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form38"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHACONTRATO."
  },
  {
    "artifact": "F47- ADICIONAR LINHA MEDIÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DESCRICAOMEDICOES",
      "EMPREITEIRO",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA",
      "LINHACONTRATO",
      "LINHASMEDICAO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "descricoes-de-medicao",
      "empreiteiros",
      "filiais",
      "imoveis",
      "lancamentos-de-obras"
    ],
    "actions": [
      "create",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHASMEDICAO",
        "entityId": null,
        "actions": [
          "create",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form25"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHACONTRATO, LINHASMEDICAO."
  },
  {
    "artifact": "F5- CADASTRO PDF COMPROVANTE PGTO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "CADASTROUNIDADEMEDIDA",
      "FORNECEDORES"
    ],
    "entityIds": [
      "contas",
      "produtos",
      "unidades-de-medida",
      "fornecedores"
    ],
    "actions": [
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F8- CADASTRO TAREFA.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTRO IMPACTO",
      "CADASTRODIFICULDADE",
      "CADASTROTAREFAS",
      "CADASTROURGÊNCIA",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOTAREFAS"
    ],
    "entityIds": [
      "atividades",
      "impactos",
      "dificuldades",
      "cadastro-de-tarefas",
      "urgencias",
      "filiais",
      "fornecedores",
      "lancamentos-de-tarefas"
    ],
    "actions": [
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRODIFICULDADE",
        "entityId": "dificuldades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROURGÊNCIA",
        "entityId": "urgencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOTAREFAS",
        "entityId": "lancamentos-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "DataSource"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "F9- CADASTRO DELEGAÇAO.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTROTAREFAS",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "TAREFASDELEGADAS"
    ],
    "entityIds": [
      "atividades",
      "cadastro-de-tarefas",
      "filiais",
      "fornecedores",
      "imoveis",
      "tarefas-delegadas"
    ],
    "actions": [
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASDELEGADAS",
        "entityId": "tarefas-delegadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "DataSource"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G1- HISTÓRICO LANÇAMENTOS.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ARQUIVOLANCAMENTOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTROPRODUTO",
      "CONCLUIDOLANCAMENTOS",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "DIÁRIO DE OBRAS",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "LINHASMEDICAO",
      "NOTASPENDENTES",
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "comprovantes-de-pagamento",
      "atividades",
      "atividades-executadas",
      "produtos",
      "lancamentos-concluidos",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "diarios-de-obras",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos",
      "provisoes-de-pagamento"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "ExcluirLancamentosComBackup",
      "PowerAppV2->Getitems"
    ],
    "operations": [
      {
        "source": "ARQUIVOLANCAMENTOS",
        "entityId": "comprovantes-de-pagamento",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CONCLUIDOLANCAMENTOS",
        "entityId": "lancamentos-concluidos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form23_1"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "SubmitForm:Form4_2"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "create",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "Patch:unclassified-record",
          "SubmitForm:Form5_1",
          "SubmitForm:Form7"
        ]
      },
      {
        "source": "LINHASMEDICAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHASMEDICAO, NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G10- HISTÓRICO GRUPO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO FAMÍLIA_1",
      "CADASTROGRUPO",
      "GRUPO"
    ],
    "entityIds": [
      "familias",
      "cadastro-de-grupos",
      "grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO FAMÍLIA_1",
        "entityId": "familias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_11"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G11- HISTÓRICO PROFISSÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "LANCAMENTOS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "lancamentos",
      "profissoes"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_13"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G12- HISTÓRICO MSG.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "FORNECEDORES",
      "MENSAGEM PROGRAMADA"
    ],
    "entityIds": [
      "fornecedores",
      "mensagens-programadas"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "MENSAGEMPROGRAMADA"
    ],
    "operations": [
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "MENSAGEM PROGRAMADA",
        "entityId": "mensagens-programadas",
        "actions": [
          "delete",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove",
          "SubmitForm:Form27"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROIMOBILIZADO",
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS"
    ],
    "entityIds": [
      "cadastro-de-imobilizados",
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROIMOBILIZADO",
        "entityId": "cadastro-de-imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form15_1"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G14- HISTÓRICOIMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROIMOBILIZADO",
      "CADASTROPRODUTO",
      "FUNCAOIMOBILIZADO",
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "cadastro-de-imobilizados",
      "produtos",
      "funcoes-de-imobilizado",
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados",
      "subfamilias"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROIMOBILIZADO",
        "entityId": "cadastro-de-imobilizados",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form15"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "FUNCAOIMOBILIZADO",
        "entityId": "funcoes-de-imobilizado",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G15- HISTÓRICO IMÓVEIS.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "CORRETOR",
      "DOCUMENTOS_1",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "LANCAMENTOS",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "corretores",
      "filiais",
      "imoveis",
      "compras",
      "receitas",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_14"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G16- HISTÓRICOATIVIDADE.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "FILIAIS",
      "LANCAMENTOOBRA"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTO DE PRESENÇA",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "GRUPO",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "presencas",
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "grupos",
      "imoveis",
      "lancamentos-de-obras",
      "lancamentos",
      "profissoes"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "CRIARDESCRITIVOPRESENCAPOWERAPPS",
      "EXCLUIRDESCRITIVOPRESENCAPOWERAPPS",
      "PowerAppV2->Getitems",
      "PowerAppV2->Getitems,ParseJSON,Select,Compose",
      "PowerAppV2->Updateitem,SendpushnotificationV2"
    ],
    "operations": [
      {
        "source": "APONTAMENTO DE PRESENÇA",
        "entityId": "presencas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_24"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:CADASTROASSOCIAÇÃO_9"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form20"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "delete",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove",
          "SubmitForm:EDITARFORNECEDOR_3"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:EDITARGRUPO_16"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G18- HISTÓRICO INCONSISTENCIAS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO IMPACTO",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "TIPOINCONSISTENCIA"
    ],
    "entityIds": [
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "impactos",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos",
      "inconsistencias"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form30_1"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOINCONSISTENCIA",
        "entityId": "inconsistencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G19- HISTÓRICOLOCACOES_1.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "NOVACOTACAO",
      "ORCAMENTOS"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOVACOTACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ORCAMENTOS",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form36_4"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS."
  },
  {
    "artifact": "G19- HISTÓRICOLOCACOES_2.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "NOVACOTACAO",
      "ORCAMENTOS"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOVACOTACAO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form36_1"
        ]
      },
      {
        "source": "ORCAMENTOS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS."
  },
  {
    "artifact": "G19- HISTÓRICOLOCACOES.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "DESPESASRECORRENTES",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOS",
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "contas",
      "produtos",
      "despesas-recorrentes",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos",
      "provisoes-de-pagamento"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARPREVISAOPGTO"
    ],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESPESASRECORRENTES",
        "entityId": "despesas-recorrentes",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form1_39"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G2- HISTÓRICO TIPO MATERIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROTIPOMATERIAL",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "tipos-de-material",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form13"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G20- HISTÓRICO VENDAS.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "LANCAMENTOS",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "clientes",
      "corretores",
      "filiais",
      "imoveis",
      "compras",
      "receitas",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, TIPOMARCO."
  },
  {
    "artifact": "G21- HISTÓRICO CLIENTE.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CORRETOR",
      "FILIAIS"
    ],
    "entityIds": [
      "clientes",
      "corretores",
      "filiais"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROIMOBILIZADO",
      "FILIAIS",
      "FORNECEDORES",
      "FUNCAOIMOBILIZADO",
      "GRUPO",
      "GRUPO IMOBILIZADOS",
      "IMOBILIZADOS",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "cadastro-de-imobilizados",
      "filiais",
      "fornecedores",
      "funcoes-de-imobilizado",
      "grupos",
      "grupos-de-imobilizados",
      "imobilizados",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "CADASTROIMOBILIZADO",
        "entityId": "cadastro-de-imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FUNCAOIMOBILIZADO",
        "entityId": "funcoes-de-imobilizado",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO IMOBILIZADOS",
        "entityId": "grupos-de-imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form16"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DESCRITIVOPRESENCA",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "descricoes-de-presenca",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos-de-obras",
      "lancamentos",
      "profissoes"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form20_1"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G24- HISTÓRICO CORRETOR.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTROCIDADE",
      "CORRETOR",
      "GRUPO"
    ],
    "entityIds": [
      "cidades",
      "corretores",
      "grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form1_49"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "CADASTRO CLIENTE_1",
      "CADASTRO TIPO DOCUMENTO",
      "DOCUMENTOS_1",
      "FILIAIS",
      "GRUPO",
      "GRUPODOCFILIAL",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "clientes",
      "tipos-de-documento",
      "filiais",
      "grupos",
      "imoveis",
      "compras",
      "receitas"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form33_3"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_62"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_61"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, GRUPODOCFILIAL, TIPOMARCO."
  },
  {
    "artifact": "G25- HISTÓRICO ETAPA OBRA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DESCRITIVOPRESENCA",
      "FILIAIS",
      "GRUPO",
      "LANCAMENTOOBRA",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "descricoes-de-presenca",
      "filiais",
      "grupos",
      "lancamentos-de-obras",
      "profissoes"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G25- HISTÓRICO TIPO MARCO.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CORRETOR",
      "TIPOMARCO"
    ],
    "entityIds": [
      "corretores"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form1_56"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TIPOMARCO."
  },
  {
    "artifact": "G26- HISTÓRICOTIPODOCUMENTO.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTRO TIPO DOCUMENTO",
      "GRUPO",
      "GRUPODOCFILIAL"
    ],
    "entityIds": [
      "tipos-de-documento",
      "grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_10"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G28- HISTÓRICO PAG PREVISTO.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "NOTASPENDENTES",
      "PROVISÃO PGTOS"
    ],
    "entityIds": [
      "contas",
      "produtos",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos-de-obras",
      "lancamentos",
      "provisoes-de-pagamento"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "CRIARPREVISAOPGTO",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "delete",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove",
          "SubmitForm:Form11",
          "SubmitForm:Form12"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G31- HISTÓRICO CONTRATOS.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO IMPACTO",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "LINHACONTRATO",
      "TIPOINCONSISTENCIA"
    ],
    "entityIds": [
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "impactos",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos",
      "inconsistencias"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "FORMULÁRIOMEDIÇÃO",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_53"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO IMPACTO",
        "entityId": "impactos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form1_11",
          "SubmitForm:Form7_1",
          "SubmitForm:Form8"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOINCONSISTENCIA",
        "entityId": "inconsistencias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHACONTRATO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "APONTAMENTO DE PRESENÇA",
      "APONTAMENTOSFUNCIONARIOS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DESCRITIVOPRESENCA",
      "LANCAMENTOS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "presencas",
      "apontamentos-de-funcionarios",
      "atividades",
      "atividades-executadas",
      "descricoes-de-presenca",
      "lancamentos",
      "profissoes"
    ],
    "actions": [
      "delete",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARPRESENCABOTAO",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "APONTAMENTO DE PRESENÇA",
        "entityId": "presencas",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "APONTAMENTOSFUNCIONARIOS",
        "entityId": "apontamentos-de-funcionarios",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G35- HISTÓRICO SUBFAMÍLIA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO FAMÍLIA_1",
      "CADASTROSUBFAMÍLIA",
      "CADASTROTIPOMATERIAL",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "familias",
      "cadastro-de-subfamilias",
      "tipos-de-material",
      "subfamilias"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO FAMÍLIA_1",
        "entityId": "familias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARSUBFAMÍLIA_1"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G36- HISTÓRICO CIDADE.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCIDADE",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "cidades",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form32"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G38- HISTÓRICO PRODUTO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROPRODUTO",
      "CADASTROSUBFAMÍLIA",
      "CADASTROTIPOMATERIAL",
      "CADASTROUNIDADEMEDIDA",
      "LANCAMENTOS",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "produtos",
      "cadastro-de-subfamilias",
      "tipos-de-material",
      "unidades-de-medida",
      "lancamentos",
      "subfamilias"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_12"
        ]
      },
      {
        "source": "CADASTROSUBFAMÍLIA",
        "entityId": "cadastro-de-subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTIPOMATERIAL",
        "entityId": "tipos-de-material",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DESCRITIVOPRESENCA",
      "DIÁRIO DE OBRAS",
      "FILIAIS",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "descricoes-de-presenca",
      "diarios-de-obras",
      "filiais",
      "profissoes"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "EMISSÃODIÁRIODEOBRAS",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form5"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G40- HISTÓRICO FILIAIS.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "DESCRITIVOPRESENCA",
      "FILIAIS"
    ],
    "entityIds": [
      "descricoes-de-presenca",
      "filiais"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROUNIDADEMEDIDA",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "unidades-de-medida",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form23"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G42- HISTÓRICO FORNECEDOR.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "atividades",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "delete",
          "submit",
          "view"
        ],
        "evidence": [
          "Patch:unclassified-record",
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "CADASTROCONTA",
      "CADASTROPRODUTO",
      "CORRETOR",
      "EMPREITEIRO",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANÇAMENTORECEITA",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "clientes",
      "contas",
      "produtos",
      "corretores",
      "empreiteiros",
      "filiais",
      "imoveis",
      "compras",
      "receitas",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form33_1",
          "SubmitForm:Form7_2",
          "SubmitForm:Form8_1"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G45- HISTÓRICO GRUPO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCIDADE",
      "GRUPO",
      "GRUPODOCFILIAL"
    ],
    "entityIds": [
      "cidades",
      "grupos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCIDADE",
        "entityId": "cidades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "create",
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form32_1",
          "SubmitForm:Form34",
          "SubmitForm:Form35"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL."
  },
  {
    "artifact": "G47- HISTÓRICO DOCUMENTOS COMERCIAL_1.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "CADASTRO CLIENTE_1",
      "CADASTRO TIPO DOCUMENTO",
      "CORRETOR",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "HOMOLOGARFORNECEDOR",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "TIPOMARCO"
    ],
    "entityIds": [
      "clientes",
      "tipos-de-documento",
      "corretores",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "compras",
      "lancamentos-de-obras",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "create",
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "Remove",
          "SubmitForm:Form36_3",
          "SubmitForm:Form42_1"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "HOMOLOGARFORNECEDOR",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, HOMOLOGARFORNECEDOR, TIPOMARCO."
  },
  {
    "artifact": "G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTROGRUPO",
      "CADASTROUNIDADEMEDIDA",
      "DEMONSTRATIVOETAPA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LINHACONTRATO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "cadastro-de-grupos",
      "unidades-de-medida",
      "demonstrativos-de-etapa",
      "empreiteiros",
      "filiais",
      "fornecedores"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_18"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHACONTRATO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "CADASTROUNIDADEMEDIDA",
      "DESCRICAOMEDICOES",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "IMOVEL CADASTRADO",
      "LANCAMENTOS",
      "LINHACONTRATO",
      "LINHASMEDICAO"
    ],
    "entityIds": [
      "atividades",
      "unidades-de-medida",
      "descricoes-de-medicao",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "imoveis",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROUNIDADEMEDIDA",
        "entityId": "unidades-de-medida",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHASMEDICAO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_19",
          "SubmitForm:Form19"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1, LINHACONTRATO, LINHASMEDICAO."
  },
  {
    "artifact": "G5- HISTÓRICO ASSOCIAÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "CADASTROTAREFAS"
    ],
    "entityIds": [
      "cadastro-de-tarefas"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:CADASTROASSOCIAÇÃO_7"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "LINHACONTRATO",
      "LINHASMEDICAO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "delete",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove",
          "SubmitForm:Form24",
          "SubmitForm:Form7_3"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "Patch:Defaults",
          "formula-reference"
        ]
      },
      {
        "source": "LINHACONTRATO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LINHASMEDICAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: LINHACONTRATO, LINHASMEDICAO."
  },
  {
    "artifact": "G7- HISTÓRICO TAREFAS.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTRODIFICULDADE",
      "CADASTROTAREFAS",
      "FORNECEDORES",
      "LANCAMENTOS",
      "LANCAMENTOTAREFAS"
    ],
    "entityIds": [
      "atividades",
      "dificuldades",
      "cadastro-de-tarefas",
      "fornecedores",
      "lancamentos",
      "lancamentos-de-tarefas"
    ],
    "actions": [
      "delete",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "MENSAGEMPROGRAMADA"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRODIFICULDADE",
        "entityId": "dificuldades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOTAREFAS",
        "entityId": "lancamentos-de-tarefas",
        "actions": [
          "delete",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G8- HISTÓRICO FAMÍLIA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO FAMÍLIA_1",
      "CADASTROGRUPO",
      "GRUPO"
    ],
    "entityIds": [
      "familias",
      "cadastro-de-grupos",
      "grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO FAMÍLIA_1",
        "entityId": "familias",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARFAMÍLIA_1"
        ]
      },
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "G9- HISTÓRICO DELEGACAO.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTRODIFICULDADE",
      "CADASTROTAREFAS",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "LANCAMENTOS",
      "PROFISSÃO",
      "TAREFASDELEGADAS",
      "TAREFASRECORRENTES"
    ],
    "entityIds": [
      "atividades",
      "dificuldades",
      "cadastro-de-tarefas",
      "filiais",
      "fornecedores",
      "lancamentos-de-obras",
      "lancamentos",
      "profissoes",
      "tarefas-delegadas"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRODIFICULDADE",
        "entityId": "dificuldades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASDELEGADAS",
        "entityId": "tarefas-delegadas",
        "actions": [
          "delete",
          "edit",
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:unclassified-record",
          "Remove",
          "SubmitForm:Form17"
        ]
      },
      {
        "source": "TAREFASRECORRENTES",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES."
  },
  {
    "artifact": "GALERIA TICKETS.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOS",
      "NOTASPENDENTES",
      "TICKET MOVIMENTACOES",
      "TICKETS CLIENTES"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos",
      "movimentacoes-de-ticket",
      "tickets-clientes"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form42_6"
        ]
      },
      {
        "source": "TICKET MOVIMENTACOES",
        "entityId": "movimentacoes-de-ticket",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TICKETS CLIENTES",
        "entityId": "tickets-clientes",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form43_2"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES."
  },
  {
    "artifact": "GALERIACONTA.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCONTA",
      "LANCAMENTOS"
    ],
    "entityIds": [
      "contas",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form52_2"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "HISTÓRICO FORNECEDORES.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPO",
      "FORNECEDORES",
      "FORNECEDORLOCACAO"
    ],
    "entityIds": [
      "cadastro-de-grupos",
      "fornecedores"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_21"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: FORNECEDORLOCACAO."
  },
  {
    "artifact": "HISTÓRICO PATOLOGIAS.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CADASTRO CLIENTE_1",
      "FILIAIS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOCOMPRAS",
      "LANCAMENTOS",
      "SACPATOLOGIAS",
      "TIPOPATOLOGIA"
    ],
    "entityIds": [
      "clientes",
      "filiais",
      "imoveis",
      "compras",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SACPATOLOGIAS",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form31_1"
        ]
      },
      {
        "source": "TIPOPATOLOGIA",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: SACPATOLOGIAS, TIPOPATOLOGIA."
  },
  {
    "artifact": "HISTÓRICO PRODUTO.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPO",
      "FORNECEDORLOCACAO",
      "LOCACAOPRODUTO"
    ],
    "entityIds": [
      "cadastro-de-grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPO",
        "entityId": "cadastro-de-grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:EDITARGRUPO_22"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: FORNECEDORLOCACAO, LOCACAOPRODUTO."
  },
  {
    "artifact": "HISTÓRICO TIPO PATOLOGIA.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "FILIAIS",
      "LANCAMENTOOBRA",
      "TIPOMARCO",
      "TIPOPATOLOGIA"
    ],
    "entityIds": [
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOPATOLOGIA",
        "entityId": null,
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TIPOMARCO, TIPOPATOLOGIA."
  },
  {
    "artifact": "HISTORICOTAREFASRECORRENTES.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "ATIVIDADE",
      "CADASTROTAREFAS",
      "FILIAIS",
      "FORNECEDORES",
      "TAREFASDELEGADAS",
      "TAREFASRECORRENTES"
    ],
    "entityIds": [
      "atividades",
      "cadastro-de-tarefas",
      "filiais",
      "fornecedores",
      "tarefas-delegadas"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASDELEGADAS",
        "entityId": "tarefas-delegadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASRECORRENTES",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form14_1"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES."
  },
  {
    "artifact": "I10- GERAL SUPRIMENTOS.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROCONTA",
      "FILIAIS",
      "GRUPO",
      "LANCAMENTOS",
      "SUBFAMÍLIA"
    ],
    "entityIds": [
      "contas",
      "filiais",
      "grupos",
      "lancamentos",
      "subfamilias"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form52_1"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "SUBFAMÍLIA",
        "entityId": "subfamilias",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "I4- GERAL TAREFAS.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "FORNECEDORES"
    ],
    "entityIds": [
      "fornecedores"
    ],
    "actions": [
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "MENSAGEMPROGRAMADA"
    ],
    "operations": [
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "I6- GERAL RH.pa.yaml",
    "kind": "screen",
    "moduleId": "rh-obras",
    "sources": [
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "DIÁRIO DE OBRAS",
      "EMPREITEIRO",
      "PROFISSÃO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "diarios-de-obras",
      "empreiteiros",
      "profissoes"
    ],
    "actions": [
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "mapped",
    "gapReason": ""
  },
  {
    "artifact": "I7- GERAL COMERCIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "comercial",
    "sources": [
      "CORRETOR",
      "TIPOMARCO"
    ],
    "entityIds": [
      "corretores"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form44"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TIPOMARCO."
  },
  {
    "artifact": "I8- GERAL AUDITORIA.pa.yaml",
    "kind": "screen",
    "moduleId": "auditoria-compliance",
    "sources": [
      "GRUPO",
      "GRUPODOCFILIAL",
      "LANCAMENTOS",
      "LANCAMENTOS AUDITORIA",
      "TIPOS AUDITORIA"
    ],
    "entityIds": [
      "grupos",
      "lancamentos",
      "auditorias",
      "tipos-de-auditoria"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPODOCFILIAL",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form26"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS AUDITORIA",
        "entityId": "auditorias",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form30"
        ]
      },
      {
        "source": "TIPOS AUDITORIA",
        "entityId": "tipos-de-auditoria",
        "actions": [
          "create",
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form28",
          "SubmitForm:Form29"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL."
  },
  {
    "artifact": "MOVIMENTAÇÃO TICKETS.pa.yaml",
    "kind": "screen",
    "moduleId": "demandas",
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOS",
      "NOTASPENDENTES",
      "TICKET MOVIMENTACOES"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos",
      "movimentacoes-de-ticket"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form42_5"
        ]
      },
      {
        "source": "TICKET MOVIMENTACOES",
        "entityId": "movimentacoes-de-ticket",
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form43_1"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES."
  },
  {
    "artifact": "PAGAMENTOS PREVISTOS.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "FILIAIS",
      "FORMAPGTO LOCACAO",
      "FORNECEDORES",
      "FORNECEDORLOCACAO",
      "GRUPO",
      "LANCAMENTOS",
      "LOCACAOPRODUTO",
      "NOTASPENDENTES",
      "PREVLOCACOES",
      "RESPONSAVELPGTO"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "grupos",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "BOTAOPAGAMENTOS"
    ],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form42_2"
        ]
      },
      {
        "source": "PREVLOCACOES",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form46_1"
        ]
      },
      {
        "source": "RESPONSAVELPGTO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, NOTASPENDENTES, PREVLOCACOES, RESPONSAVELPGTO."
  },
  {
    "artifact": "PREVISTO LOCAÇÕES E IARA.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "FORMAPGTO LOCACAO",
      "FORNECEDORLOCACAO",
      "GRUPO",
      "LOCACAOPRODUTO",
      "PREVLOCACOES",
      "RESPONSAVELPGTO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "create",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form49"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form50"
        ]
      },
      {
        "source": "PREVLOCACOES",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form46"
        ]
      },
      {
        "source": "RESPONSAVELPGTO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form48"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, PREVLOCACOES, RESPONSAVELPGTO."
  },
  {
    "artifact": "RECORRENCIALOCACOES.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "FILIAIS",
      "FORMAPGTO LOCACAO",
      "FORNECEDORES",
      "FORNECEDORLOCACAO",
      "GRUPO",
      "LANCAMENTOS",
      "LOCACAOPRODUTO",
      "NOTASPENDENTES",
      "RECORRENTESLOCACOES",
      "RESPONSAVELPGTO"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "grupos",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "BOTAOPAGAMENTOS"
    ],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form42_4"
        ]
      },
      {
        "source": "RECORRENTESLOCACOES",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form47_1"
        ]
      },
      {
        "source": "RESPONSAVELPGTO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, NOTASPENDENTES, RECORRENTESLOCACOES, RESPONSAVELPGTO."
  },
  {
    "artifact": "Screen1.pa.yaml",
    "kind": "screen",
    "moduleId": "patrimonio-locacoes",
    "sources": [
      "ATIVIDADE",
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "FORNECEDORES",
      "FORNECEDORLOCACAO",
      "GRUPO",
      "LOCACAOPRODUTO",
      "TIPOHOMOLOGACAOLOCACAO"
    ],
    "entityIds": [
      "atividades",
      "fornecedores",
      "grupos"
    ],
    "actions": [
      "create",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form2_4"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3_6"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "create",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3_10"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORLOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form51"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LOCACAOPRODUTO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form50_1"
        ]
      },
      {
        "source": "TIPOHOMOLOGACAOLOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form39"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORNECEDORLOCACAO, LOCACAOPRODUTO, TIPOHOMOLOGACAOLOCACAO."
  },
  {
    "artifact": "Screen10.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "ARQUIVOLANCAMENTOS",
      "CADASTROCONTA",
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOS",
      "NOTASPENDENTES"
    ],
    "entityIds": [
      "comprovantes-de-pagamento",
      "contas",
      "filiais",
      "fornecedores",
      "lancamentos"
    ],
    "actions": [
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "APROVARLANCAMENTOSPORAGRUPAR",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "ARQUIVOLANCAMENTOS",
        "entityId": "comprovantes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROCONTA",
        "entityId": "contas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form43"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES."
  },
  {
    "artifact": "Screen11.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "CADASTROTAREFAS",
      "FILIAIS",
      "FORNECEDORES",
      "TAREFASRECORRENTES"
    ],
    "entityIds": [
      "atividades",
      "cadastro-de-tarefas",
      "filiais",
      "fornecedores"
    ],
    "actions": [
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROTAREFAS",
        "entityId": "cadastro-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASRECORRENTES",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form14"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen12_1.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "NOVACOTACAO",
      "ORCAMENTOS"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos-de-obras"
    ],
    "actions": [
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOVACOTACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ORCAMENTOS",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form36_2"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen12.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "FILIAIS",
      "FORNECEDORES",
      "LANCAMENTOOBRA",
      "NOVACOTACAO",
      "ORCAMENTOS"
    ],
    "entityIds": [
      "filiais",
      "fornecedores",
      "lancamentos-de-obras"
    ],
    "actions": [
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOVACOTACAO",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form36"
        ]
      },
      {
        "source": "ORCAMENTOS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen13.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "FILIAIS",
      "LANCAMENTOOBRA",
      "TIPOPATOLOGIA"
    ],
    "entityIds": [
      "filiais",
      "lancamentos-de-obras"
    ],
    "actions": [
      "navigate",
      "submit",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOPATOLOGIA",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form37"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: TIPOPATOLOGIA. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen2.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "EMPREITEIRO",
      "FORMAPGTO LOCACAO",
      "FORNECEDORES",
      "GRUPO",
      "HOMOLOGARLOCACAO",
      "LANCAMENTOALUGUEL",
      "LANCAMENTOS",
      "TIPOHOMOLOGACAOLOCACAO"
    ],
    "entityIds": [
      "empreiteiros",
      "fornecedores",
      "grupos",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARLANÇAMENTOALUGUEL"
    ],
    "operations": [
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_12"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "HOMOLOGARLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOALUGUEL",
        "entityId": null,
        "actions": [
          "create",
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Patch:Defaults",
          "Remove",
          "SubmitForm:Form10",
          "SubmitForm:Form3_7"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOHOMOLOGACAOLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, TIPOHOMOLOGACAOLOCACAO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen3.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "FORMAPGTO LOCACAO",
      "GRUPO"
    ],
    "entityIds": [
      "atividades",
      "grupos"
    ],
    "actions": [
      "create",
      "execute-flow",
      "navigate",
      "submit",
      "view"
    ],
    "flows": [
      "CRIARLANÇAMENTOALUGUEL"
    ],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "submit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_7"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form2_2"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3_8"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3_9"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form41"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen4_1.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "DOCUMENTOS_1",
      "GRUPO",
      "HOMOLOGARLOCACAO",
      "LANCAMENTOALUGUEL",
      "LANCAMENTOS",
      "TIPOHOMOLOGACAOLOCACAO"
    ],
    "entityIds": [
      "grupos",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "HOMOLOGARLOCACAO",
        "entityId": null,
        "actions": [
          "create",
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form39_2",
          "SubmitForm:Form39_3",
          "SubmitForm:Form40"
        ]
      },
      {
        "source": "LANCAMENTOALUGUEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOHOMOLOGACAOLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, DOCUMENTOS_1, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, TIPOHOMOLOGACAOLOCACAO."
  },
  {
    "artifact": "Screen4.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "TIPOHOMOLOGACAOLOCACAO"
    ],
    "entityIds": [],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "TIPOHOMOLOGACAOLOCACAO",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form39_1"
        ]
      }
    ],
    "coverage": "gap",
    "gapReason": "Nenhuma fonte SharePoint desta tela possui entidade no catálogo: TIPOHOMOLOGACAOLOCACAO. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen5.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "GRUPO",
      "LANCAMENTOS",
      "teste"
    ],
    "entityIds": [
      "grupos",
      "lancamentos"
    ],
    "actions": [
      "create",
      "delete",
      "edit",
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARLANÇAMENTOALUGUEL",
      "HABILITARFILIAL"
    ],
    "operations": [
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form18_2",
          "SubmitForm:Form19_2"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "teste",
        "entityId": null,
        "actions": [
          "create",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_51"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, teste."
  },
  {
    "artifact": "Screen6.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "GRUPO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL."
  },
  {
    "artifact": "Screen7.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "GRUPO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "delete",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "delete",
          "view"
        ],
        "evidence": [
          "Remove",
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, CADASTROIMOVEL."
  },
  {
    "artifact": "Screen8.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "GRUPO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "delete",
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "delete",
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "Remove",
          "SubmitForm:Form3_5"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL."
  },
  {
    "artifact": "Screen9_1.pa.yaml",
    "kind": "screen",
    "moduleId": null,
    "sources": [
      "ATIVIDADE",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "GRUPO"
    ],
    "entityIds": [
      "atividades",
      "grupos"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form2_3"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL. Módulo funcional não comprovado de forma inequívoca."
  },
  {
    "artifact": "Screen9_2.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "GRUPO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form3_4"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, CADASTROIMOVEL."
  },
  {
    "artifact": "Screen9.pa.yaml",
    "kind": "screen",
    "moduleId": "suprimentos",
    "sources": [
      "CADASTRO ALUGUEL",
      "CADASTRO INQUILINO_1",
      "CADASTROGRUPOIMÓVEL",
      "CADASTROIMOVEL",
      "FORMAPGTO LOCACAO",
      "GRUPO"
    ],
    "entityIds": [
      "grupos"
    ],
    "actions": [
      "edit",
      "navigate",
      "view"
    ],
    "flows": [],
    "operations": [
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "edit",
          "view"
        ],
        "evidence": [
          "DataSource",
          "SubmitForm:Form1_9"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROGRUPOIMÓVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORMAPGTO LOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO."
  },
  {
    "artifact": "TELA INICIAL.pa.yaml",
    "kind": "screen",
    "moduleId": "dashboard",
    "sources": [
      "APONTAMENTOSCOMERCIAIS",
      "ATIVIDADE",
      "ATIVIDADE EXECUTADA",
      "CADASTRO ALUGUEL",
      "CADASTRO CLIENTE_1",
      "CADASTRO INQUILINO_1",
      "CADASTRO TIPO DOCUMENTO",
      "CADASTRODIFICULDADE",
      "CADASTROIMOVEL",
      "CADASTROPRODUTO",
      "CORRETOR",
      "DEMONSTRATIVOETAPA",
      "DESCRICAOMEDICOES",
      "DESCRITIVOPRESENCA",
      "DESPESASRECORRENTES",
      "DIÁRIO DE OBRAS",
      "DOCUMENTOS_1",
      "EMPREITEIRO",
      "FILIAIS",
      "FORNECEDORES",
      "GRUPO",
      "HOMOLOGARFORNECEDOR",
      "HOMOLOGARLOCACAO",
      "IMOBILIZADOS",
      "IMOVEL CADASTRADO",
      "LANCAMENTOALUGUEL",
      "LANCAMENTOCOMPRAS",
      "LANCAMENTOOBRA",
      "LANÇAMENTORECEITA",
      "LANCAMENTOS",
      "LANCAMENTOTAREFAS",
      "NOTASPENDENTES",
      "NOVACOTACAO",
      "ORCAMENTOS",
      "PREVLOCACOES",
      "PROFISSÃO",
      "PROVISÃO PGTOS",
      "TAREFASDELEGADAS",
      "TIPOMARCO"
    ],
    "entityIds": [
      "atividades",
      "atividades-executadas",
      "clientes",
      "tipos-de-documento",
      "dificuldades",
      "produtos",
      "corretores",
      "demonstrativos-de-etapa",
      "descricoes-de-medicao",
      "descricoes-de-presenca",
      "despesas-recorrentes",
      "diarios-de-obras",
      "empreiteiros",
      "filiais",
      "fornecedores",
      "grupos",
      "imobilizados",
      "imoveis",
      "compras",
      "lancamentos-de-obras",
      "receitas",
      "lancamentos",
      "lancamentos-de-tarefas",
      "profissoes",
      "provisoes-de-pagamento",
      "tarefas-delegadas"
    ],
    "actions": [
      "execute-flow",
      "navigate",
      "view"
    ],
    "flows": [
      "CRIARLANÇAMENTOALUGUEL",
      "CRIARPREVISAOPGTO",
      "LANCAMENTOSHTML"
    ],
    "operations": [
      {
        "source": "APONTAMENTOSCOMERCIAIS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE",
        "entityId": "atividades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ATIVIDADE EXECUTADA",
        "entityId": "atividades-executadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO ALUGUEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO CLIENTE_1",
        "entityId": "clientes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO INQUILINO_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRO TIPO DOCUMENTO",
        "entityId": "tipos-de-documento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTRODIFICULDADE",
        "entityId": "dificuldades",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROIMOVEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CADASTROPRODUTO",
        "entityId": "produtos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "CORRETOR",
        "entityId": "corretores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DEMONSTRATIVOETAPA",
        "entityId": "demonstrativos-de-etapa",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRICAOMEDICOES",
        "entityId": "descricoes-de-medicao",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESCRITIVOPRESENCA",
        "entityId": "descricoes-de-presenca",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DESPESASRECORRENTES",
        "entityId": "despesas-recorrentes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DIÁRIO DE OBRAS",
        "entityId": "diarios-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "DOCUMENTOS_1",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "EMPREITEIRO",
        "entityId": "empreiteiros",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FILIAIS",
        "entityId": "filiais",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "FORNECEDORES",
        "entityId": "fornecedores",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "GRUPO",
        "entityId": "grupos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "HOMOLOGARFORNECEDOR",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "HOMOLOGARLOCACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOBILIZADOS",
        "entityId": "imobilizados",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "IMOVEL CADASTRADO",
        "entityId": "imoveis",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOALUGUEL",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOCOMPRAS",
        "entityId": "compras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOOBRA",
        "entityId": "lancamentos-de-obras",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANÇAMENTORECEITA",
        "entityId": "receitas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOS",
        "entityId": "lancamentos",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "LANCAMENTOTAREFAS",
        "entityId": "lancamentos-de-tarefas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOTASPENDENTES",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "NOVACOTACAO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "ORCAMENTOS",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PREVLOCACOES",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROFISSÃO",
        "entityId": "profissoes",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "PROVISÃO PGTOS",
        "entityId": "provisoes-de-pagamento",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TAREFASDELEGADAS",
        "entityId": "tarefas-delegadas",
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      },
      {
        "source": "TIPOMARCO",
        "entityId": null,
        "actions": [
          "view"
        ],
        "evidence": [
          "formula-reference"
        ]
      }
    ],
    "coverage": "partial",
    "gapReason": "Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROIMOVEL, DOCUMENTOS_1, HOMOLOGARFORNECEDOR, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, NOTASPENDENTES, NOVACOTACAO, ORCAMENTOS, PREVLOCACOES, TIPOMARCO."
  }
];

export const POWERAPPS_INVENTORY_SOURCES = Object.freeze([
  "LANCAMENTOS",
  "CADASTROTIPOMATERIAL",
  "CADASTROURGÊNCIA",
  "CADASTROUNIDADEMEDIDA",
  "FUNCAOIMOBILIZADO",
  "CONCLUIDOLANCAMENTOS",
  "DEMONSTRATIVOETAPA",
  "DESPESASRECORRENTES",
  "DESCRICAOMEDICOES",
  "DIÁRIO DE OBRAS",
  "DESCRITIVOPRESENCA",
  "EMPREITEIRO",
  "FILIAIS",
  "FORNECEDORES",
  "GRUPO IMOBILIZADOS",
  "IMOBILIZADOS",
  "LANCAMENTOOBRA",
  "LANCAMENTOS AUDITORIA",
  "MENSAGEM PROGRAMADA",
  "PROFISSÃO",
  "PROVISÃO PGTOS",
  "SUBFAMÍLIA",
  "TAREFASDELEGADAS",
  "TIPO DE TRANSACAO",
  "TIPOINCONSISTENCIA",
  "TIPOS AUDITORIA",
  "CADASTROIMOBILIZADO",
  "CADASTROGRUPO",
  "CADASTRODIFICULDADE",
  "CADASTROCONTA",
  "CADASTROCIDADE",
  "CADASTRO TIPO DOCUMENTO",
  "CADASTRO IMPACTO",
  "CADASTRO FAMÍLIA_1",
  "CADASTRO CLIENTE_1",
  "ATIVIDADE EXECUTADA",
  "ATIVIDADE",
  "APONTAMENTOSFUNCIONARIOS",
  "ARQUIVOLANCAMENTOS",
  "APONTAMENTO DE PRESENÇA",
  "CADASTROTAREFAS",
  "CADASTROSUBFAMÍLIA",
  "CADASTROPRODUTO",
  "GRUPO",
  "LANCAMENTOCOMPRAS",
  "CORRETOR",
  "IMOVEL CADASTRADO",
  "LANCAMENTOTAREFAS",
  "LANÇAMENTORECEITA",
  "TICKETS CLIENTES",
  "TICKET MOVIMENTACOES",
  "COMUNICACOES CLIENTES",
  "COMUNICACAO MOVIMENTACOES"
]);

export const POWERAPPS_SHAREPOINT_SOURCES = Object.freeze([
  "APONTAMENTO DE PRESENÇA",
  "APONTAMENTOSCOMERCIAIS",
  "APONTAMENTOSFUNCIONARIOS",
  "ARQUIVOLANCAMENTOS",
  "ASSOCIACAOALUGUEL",
  "ATIVIDADE",
  "ATIVIDADE EXECUTADA",
  "CADASTRO ALUGUEL",
  "CADASTRO CLIENTE_1",
  "CADASTRO FAMÍLIA_1",
  "CADASTRO IMPACTO",
  "CADASTRO INQUILINO_1",
  "CADASTRO TIPO DOCUMENTO",
  "CADASTROCIDADE",
  "CADASTROCONTA",
  "CADASTRODIFICULDADE",
  "CADASTROGRUPO",
  "CADASTROGRUPOIMÓVEL",
  "CADASTROIMOBILIZADO",
  "CADASTROIMOVEL",
  "CADASTROPRODUTO",
  "CADASTROSUBFAMÍLIA",
  "CADASTROTAREFAS",
  "CADASTROTIPOMATERIAL",
  "CADASTROUNIDADEMEDIDA",
  "CADASTROURGÊNCIA",
  "CONCLUIDOLANCAMENTOS",
  "CORRETOR",
  "DEMONSTRATIVOETAPA",
  "DESCRICAOMEDICOES",
  "DESCRITIVOPRESENCA",
  "DESPESASRECORRENTES",
  "DIÁRIO DE OBRAS",
  "DOCUMENTOS_1",
  "EMPREITEIRO",
  "FILIAIS",
  "FORMAPGTO LOCACAO",
  "FORNECEDORES",
  "FORNECEDORLOCACAO",
  "FUNCAOIMOBILIZADO",
  "GRUPO",
  "GRUPO IMOBILIZADOS",
  "GRUPODOCFILIAL",
  "HOMOLOGARFORNECEDOR",
  "HOMOLOGARLOCACAO",
  "IMOBILIZADOS",
  "IMOVEL CADASTRADO",
  "LANCAMENTOALUGUEL",
  "LANCAMENTOCOMPRAS",
  "LANCAMENTOOBRA",
  "LANÇAMENTORECEITA",
  "LANCAMENTOS",
  "LANCAMENTOS AUDITORIA",
  "LANCAMENTOTAREFAS",
  "LINHACONTRATO",
  "LINHASMEDICAO",
  "LOCACAOPRODUTO",
  "MENSAGEM PROGRAMADA",
  "NOTASPENDENTES",
  "NOVACOTACAO",
  "ORCAMENTOS",
  "PREVLOCACOES",
  "PRODUTOALUGUEL",
  "PROFISSÃO",
  "PROVISÃO PGTOS",
  "RECORRENTESLOCACOES",
  "REGISTROMENSAL",
  "RESPONSAVELPGTO",
  "SACPATOLOGIAS",
  "SUBFAMÍLIA",
  "TAREFASALUGUEL",
  "TAREFASDELEGADAS",
  "TAREFASRECORRENTES",
  "teste",
  "TICKET MOVIMENTACOES",
  "TICKETS CLIENTES",
  "TIPO DE TRANSACAO",
  "TIPOHOMOLOGACAOLOCACAO",
  "TIPOINCONSISTENCIA",
  "TIPOMARCO",
  "TIPOPATOLOGIA",
  "TIPOS AUDITORIA"
]);

export const POWERAPPS_CONNECTED_FLOWS = Object.freeze([
  "APROVARLANCAMENTOSPORAGRUPAR",
  "ATIVIDADES",
  "ATUALIZARBI",
  "BOTAOPAGAMENTOS",
  "CHECKLIST",
  "COMPROVANTEPGTO",
  "CONTRATOS",
  "CRIARDESCRITIVOPRESENCAPOWERAPPS",
  "CRIARLANÇAMENTOALUGUEL",
  "CRIARPRESENCABOTAO",
  "CRIARPREVISAOPGTO",
  "CRIARPROVISAOPGTOSPOWERAPPS",
  "CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS",
  "EMISSÃODIÁRIODEOBRAS",
  "ENVIOHTML",
  "EXCLUIRDESCRITIVOPRESENCAPOWERAPPS",
  "ExcluirLancamentosComBackup",
  "FORMULÁRIOFUNCIONÁRIOS",
  "FORMULÁRIOMEDIÇÃO",
  "HABILITARFILIAL",
  "HOMOLOGARDOCUMENTOFORNECEDOR",
  "HOMOLOGARFORNECEDOR",
  "LANCAMENTOSHTML",
  "MENSAGEMPROGRAMADA",
  "MENSAGEMPROGRAMADAIMAGEM",
  "PowerAppV2->Createfile,Convertfile,Addattachment",
  "PowerAppV2->Getitems",
  "PowerAppV2->Getitems,ParseJSON,Select,Compose",
  "PowerAppV2->Updateitem,SendpushnotificationV2",
  "REGISTROMENSAL",
  "REGISTROMENSALFUNCIONÁRIOS",
  "RELATORIOPRESENCA",
  "SUBMETERHTMLCONTRATO",
  "SUBMETERLANCAMENTOSJSON"
]);

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    sources: Object.freeze([...entry.sources]),
    entityIds: Object.freeze([...entry.entityIds]),
    actions: Object.freeze([...entry.actions]),
    flows: Object.freeze([...entry.flows]),
    operations: Object.freeze(entry.operations.map(operation => Object.freeze({
      ...operation,
      actions: Object.freeze([...operation.actions]),
      evidence: Object.freeze([...operation.evidence]),
    }))),
  });
}

export const POWERAPPS_ARTIFACTS = Object.freeze(RAW_POWERAPPS_ARTIFACTS.map(freezeEntry));

const ENTITY_BY_SOURCE = new Map();
for (const entity of ENTITIES) {
  for (const source of entity.listNames) {
    if (!ENTITY_BY_SOURCE.has(source)) ENTITY_BY_SOURCE.set(source, entity);
  }
}

export function sourceCoverage(source) {
  const entity = ENTITY_BY_SOURCE.get(source);
  if (entity) return Object.freeze({ source, coverage: "mapped", entityId: entity.id, reason: "" });
  return Object.freeze({ source, coverage: "gap", entityId: null, reason: "Fonte exata ainda não possui entidade no catálogo." });
}

export function artifactsForModule(moduleId) {
  return Object.freeze(POWERAPPS_ARTIFACTS.filter(entry => entry.moduleId === moduleId));
}

export function artifactsForEntity(entityId) {
  return Object.freeze(POWERAPPS_ARTIFACTS.filter(entry => entry.entityIds.includes(entityId)));
}

export function artifactsForFlow(flowName) {
  return Object.freeze(POWERAPPS_ARTIFACTS.filter(entry => entry.flows.includes(flowName)));
}

export function unmappedSharePointSources() {
  return Object.freeze(POWERAPPS_SHAREPOINT_SOURCES.filter(source => sourceCoverage(source).coverage === "gap"));
}

export function coverageSummary() {
  const byCoverage = Object.fromEntries(["mapped", "partial", "gap", "not-applicable"].map(status => [status, 0]));
  for (const entry of POWERAPPS_ARTIFACTS) byCoverage[entry.coverage] += 1;
  return Object.freeze({
    artifacts: POWERAPPS_ARTIFACTS.length,
    screens: POWERAPPS_ARTIFACTS.filter(entry => entry.kind === "screen").length,
    system: POWERAPPS_ARTIFACTS.filter(entry => entry.kind === "system").length,
    inventorySources: POWERAPPS_INVENTORY_SOURCES.length,
    discoveredSharePointSources: POWERAPPS_SHAREPOINT_SOURCES.length,
    connectedFlows: POWERAPPS_CONNECTED_FLOWS.length,
    ...byCoverage,
  });
}
