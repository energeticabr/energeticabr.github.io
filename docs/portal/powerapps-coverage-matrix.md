# Matriz de cobertura Power Apps

Fontes: exportação-base local somente leitura `powerapps-form-audit-20260815` e evidência suplementar verificada `powerapps_debug_verify_publish`. Nenhum ambiente Microsoft foi consultado ou alterado para gerar esta matriz.

## Método

- 129 artefatos `.pa.yaml` pertencem à exportação-base: 127 telas e 2 arquivos sistêmicos (`App` e `_EditorState`).
- `COMPROVANTE ENTREGA EPI.pa.yaml` acrescenta 1 tela da exportação suplementar, totalizando 130 artefatos rastreados e 128 telas.
- A cobertura suplementar comprova a entrega de EPI e documento por `LANCAMENTOSHTML`, com navegação a partir de `I6- GERAL RH.pa.yaml`.
- O manifesto independente `tests/fixtures/powerapps-export-manifest.json` registra hashes por arquivo; o SHA-256 agregado da exportação-base é `7e99d2212658c877274b29311dbe5076818b3b5a915560585e1f6b8db386e4c0`.
- 82 fontes SharePoint foram identificadas no arquivo estruturado `References/DataSources.json`.
- 34 conexões de fluxo foram preservadas; a tabela abaixo diferencia conexões chamadas por telas das não referenciadas.
- 53 fontes pertencem ao inventário original: 51 aparecem na exportação-base e 2 foram confirmadas separadamente.
- A exportação revelou outras 31 fontes SharePoint; cada uma permanece documentada sem alias inventado.
- `create`, `edit` e `delete` aparecem somente quando há evidência literal em `Patch`, `Collect`, `SubmitForm`, `UpdateIf`, `Remove` ou `RemoveIf`.
- Uma fonte sem entidade exata permanece como lacuna. A matriz não cria aliases entre listas diferentes.

## Resumo

- Mapeados: 63
- Parciais: 64
- Lacunas: 1
- Não aplicáveis: 2

## Telas e fluxos

| Artefato | Origem | Módulo | Fontes | Entidades | Ações | Cobertura funcional | Fluxos | Cobertura | Lacuna |
|---|---|---|---|---|---|---|---|---|---|
| _EditorState.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | ATIVIDADE; CORRETOR; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; LANCAMENTOS; PROFISSÃO; SUBFAMÍLIA | atividades; corretores; diarios-de-obras; empreiteiros; filiais; fornecedores; grupos; lancamentos; profissoes; subfamilias | view | - | - | not-applicable | - |
| App.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | PROVISÃO PGTOS | provisoes-de-pagamento | view | - | - | not-applicable | - |
| COMPROVANTE ENTREGA EPI.pa.yaml | supplemental:powerapps_debug_verify_publish | rh-obras | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; FORNECEDORES; SUBFAMÍLIA | contas; produtos; unidades-de-medida; fornecedores; subfamilias | execute-flow; navigate; view | deliver-epi; generate-document | LANCAMENTOSHTML | mapped | - |
| CRIAR SACPATOLOGIA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; FILIAIS; LANCAMENTOCOMPRAS; SACPATOLOGIAS; TIPOPATOLOGIA | clientes; filiais; compras | navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: SACPATOLOGIAS, TIPOPATOLOGIA. |
| DESPESAS RECORRENTES LOCAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FORMAPGTO LOCACAO; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; RECORRENTESLOCACOES; RESPONSAVELPGTO | grupos | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, RECORRENTESLOCACOES, RESPONSAVELPGTO. |
| E1- EDITAR LANÇAMENTO COMPRA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; DESCRICAOMEDICOES; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; TIPO DE TRANSACAO | contas; produtos; unidades-de-medida; descricoes-de-medicao; filiais; fornecedores; lancamentos-de-obras; lancamentos; tipos-de-transacao | edit; navigate; view | - | - | mapped | - |
| E11- EDITAR TAREFA.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRO IMPACTO; CADASTRODIFICULDADE; CADASTROTAREFAS; CADASTROURGÊNCIA; FILIAIS; FORNECEDORES; LANCAMENTOTAREFAS | atividades; impactos; dificuldades; cadastro-de-tarefas; urgencias; filiais; fornecedores; lancamentos-de-tarefas | edit; navigate; view | - | - | mapped | - |
| E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA | atividades; atividades-executadas; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; lancamentos-de-obras | edit; execute-flow; navigate; view | - | CONTRATOS; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1. |
| E16- EDITAR CADASTRO VENDA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | atividades; clientes; corretores; filiais; imoveis; compras; receitas | edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, TIPOMARCO. |
| E2- EDITAR FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO TIPO DOCUMENTO; CADASTROCIDADE; CADASTROTIPOMATERIAL; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; PROFISSÃO | atividades; atividades-executadas; tipos-de-documento; cidades; tipos-de-material; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; imoveis; lancamentos; profissoes | edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| E3- EDITAR DIÁRIO OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | DIÁRIO DE OBRAS; FILIAIS | diarios-de-obras; filiais | edit; navigate; view | - | - | mapped | - |
| E4- EDITAR FILIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; FILIAIS | cidades; filiais | edit; navigate; view | - | - | mapped | - |
| E7- EDITAR ETAPA OBRA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; FILIAIS; LANCAMENTOOBRA | atividades; filiais; lancamentos-de-obras | edit; navigate; view | - | - | mapped | - |
| E8- EDITAR CLIENTE.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO | clientes; corretores; filiais; imoveis | edit; navigate; view | - | - | mapped | - |
| E9- EDITAR ATIVIDADE FUNCIONÁRIOS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | edit; navigate; view | - | - | mapped | - |
| F1- CADASTRO ASSOCIAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | CADASTROTAREFAS | cadastro-de-tarefas | create; edit; navigate; view | - | - | mapped | - |
| F10- CADASTRO FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO TIPO DOCUMENTO; CADASTROCIDADE; CADASTROTIPOMATERIAL; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; HOMOLOGARFORNECEDOR; IMOVEL CADASTRADO; LANCAMENTOOBRA; PROFISSÃO | atividades; atividades-executadas; tipos-de-documento; cidades; tipos-de-material; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; imoveis; lancamentos-de-obras; profissoes | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: HOMOLOGARFORNECEDOR. Módulo funcional não comprovado de forma inequívoca. |
| F11- CADASTRO FILIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; FILIAIS | cidades; filiais | create; navigate; view | - | - | mapped | - |
| F12- CADASTRO GRUPO_1.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; FILIAIS; FORNECEDORES; NOTASPENDENTES | contas; filiais; fornecedores | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. |
| F12- CADASTRO GRUPO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPO; GRUPO | cadastro-de-grupos; grupos | create; navigate; view | - | - | mapped | - |
| F16- CADASTRO PROFISSÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | PROFISSÃO | profissoes | create; navigate; view | - | - | mapped | - |
| F17- CADASTRO INCONSISTÊNCIAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; empreiteiros; filiais; fornecedores; lancamentos-de-obras; inconsistencias | create; navigate; view | - | - | mapped | - |
| F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; FILIAIS; FORNECEDORES; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS | cadastro-de-imobilizados; filiais; fornecedores; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados | create; navigate; view | - | - | mapped | - |
| F19- CADASTROGRUPOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS | grupos; grupos-de-imobilizados; imobilizados | create; navigate; view | - | - | mapped | - |
| F2- CADASTRODEMONSTRATIVOETAPA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOOBRA | atividades; atividades-executadas; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; imoveis; lancamentos-de-obras | create; navigate; view | - | - | mapped | - |
| F20- CADASTRO PRODUTO IMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; CADASTROPRODUTO; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS; SUBFAMÍLIA | cadastro-de-imobilizados; produtos; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados; subfamilias | create; navigate; view | - | - | mapped | - |
| F21- CADASTRO DESPESA RECORRENTE.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; DESPESASRECORRENTES; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; PROVISÃO PGTOS | clientes; contas; produtos; despesas-recorrentes; filiais; fornecedores; imoveis; provisoes-de-pagamento | create; execute-flow; navigate; view | - | CRIARPREVISAOPGTO | partial | Módulo funcional não comprovado de forma inequívoca. |
| F22- CADASTRO CORRETOR.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTROCIDADE; CORRETOR; GRUPO | cidades; corretores; grupos | create; navigate; view | - | - | mapped | - |
| F24- CADASTRO ETAPA OBRA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; FILIAIS; FORNECEDORES; LANCAMENTOOBRA | atividades; filiais; fornecedores; lancamentos-de-obras | create; navigate; view | - | - | mapped | - |
| F25- CADASTRO LANCAMENTO VENDA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS | clientes; corretores; filiais; imoveis; compras | create; navigate; submit; view | - | - | mapped | - |
| F26- CADASTRO IMÓVEL.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; IMOVEL CADASTRADO | filiais; imoveis | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F27- CADASTRO CLIENTE.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO | clientes; corretores; filiais; fornecedores; imoveis | create; navigate; view | - | - | mapped | - |
| F28- CADASTROTIPODOCUMENTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO TIPO DOCUMENTO; GRUPO; GRUPODOCFILIAL | tipos-de-documento; grupos | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. Módulo funcional não comprovado de forma inequívoca. |
| F29- CADASTRO DOCUMENTOS_2.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; GRUPODOCFILIAL; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; TIPOMARCO | atividades; clientes; tipos-de-documento; empreiteiros; filiais; fornecedores; grupos; imoveis; compras; lancamentos-de-obras | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, GRUPODOCFILIAL, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca. |
| F3- CADASTRO PGTO PREV.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; PROVISÃO PGTOS | clientes; contas; produtos; filiais; fornecedores; imoveis; provisoes-de-pagamento | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F31- CADASTRO ATIVIDADE FUNCIONÁRIOS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | create; navigate; view | - | - | mapped | - |
| F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA | atividades; atividades-executadas; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; lancamentos-de-obras | create; execute-flow; navigate; submit; view | - | CONTRATOS; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1. |
| F33- CADASTRO HTML MEDIÇÃO UNITÁRIA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; demonstrativos-de-etapa; descricoes-de-medicao; empreiteiros; filiais; fornecedores; lancamentos-de-obras; inconsistencias | create; navigate; submit; view | - | - | mapped | - |
| F37- CADASTRO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; SUBFAMÍLIA | produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; subfamilias | create; navigate; view | - | - | mapped | - |
| F38- CADASTRO TIPO MATERIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROTIPOMATERIAL | tipos-de-material | create; navigate; view | - | - | mapped | - |
| F39- CADASTRO UNIDADEMEDIDA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROUNIDADEMEDIDA | unidades-de-medida | create; navigate; view | - | - | mapped | - |
| F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROCIDADE; CADASTROCONTA; CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; CORRETOR; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANCAMENTOS; NOTASPENDENTES; PROVISÃO PGTOS; SUBFAMÍLIA; TIPO DE TRANSACAO | atividades; atividades-executadas; cidades; contas; produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; corretores; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; imoveis; compras; lancamentos-de-obras; lancamentos; provisoes-de-pagamento; subfamilias; tipos-de-transacao | create; delete; edit; execute-flow; navigate; view | - | CRIARPROVISAOPGTOSPOWERAPPS; SUBMETERLANCAMENTOSJSON | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca. |
| F40- CADASTRO CIDADE.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE | cidades | create; navigate; view | - | - | mapped | - |
| F41- CADASTRO DIÁRIO DE OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; diarios-de-obras; empreiteiros; filiais; fornecedores; lancamentos-de-obras; inconsistencias | create; navigate; view | - | - | mapped | - |
| F42- CADASTRO FAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | create; navigate; view | - | - | mapped | - |
| F43- CADASTRO SUBFAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; SUBFAMÍLIA | familias; cadastro-de-subfamilias; tipos-de-material; subfamilias | create; navigate; view | - | - | mapped | - |
| F44- APONTAMENTOS COMERCIAIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; CADASTROCONTA; CADASTROPRODUTO; DOCUMENTOS_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | clientes; tipos-de-documento; contas; produtos; filiais; imoveis; compras; receitas | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca. |
| F44- LANÇAMENTO RECEITA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; SUBFAMÍLIA | clientes; contas; produtos; cadastro-de-subfamilias; corretores; filiais; imoveis; compras; receitas; subfamilias | create; navigate; view | - | - | mapped | - |
| F46- ADICIONAR LINHA CONTRATO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROUNIDADEMEDIDA; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; LINHACONTRATO | atividades; atividades-executadas; unidades-de-medida; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores | create; navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: LINHACONTRATO. |
| F47- ADICIONAR LINHA MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DESCRICAOMEDICOES; EMPREITEIRO; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOOBRA; LINHACONTRATO; LINHASMEDICAO | atividades; atividades-executadas; descricoes-de-medicao; empreiteiros; filiais; imoveis; lancamentos-de-obras | create; navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: LINHACONTRATO, LINHASMEDICAO. |
| F5- CADASTRO PDF COMPROVANTE PGTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; FORNECEDORES | contas; produtos; unidades-de-medida; fornecedores | execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| F8- CADASTRO TAREFA.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRO IMPACTO; CADASTRODIFICULDADE; CADASTROTAREFAS; CADASTROURGÊNCIA; FILIAIS; FORNECEDORES; LANCAMENTOTAREFAS | atividades; impactos; dificuldades; cadastro-de-tarefas; urgencias; filiais; fornecedores; lancamentos-de-tarefas | create; navigate; view | - | - | mapped | - |
| F9- CADASTRO DELEGAÇAO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; TAREFASDELEGADAS | atividades; cadastro-de-tarefas; filiais; fornecedores; imoveis; tarefas-delegadas | create; navigate; view | - | - | mapped | - |
| G1- HISTÓRICO LANÇAMENTOS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ARQUIVOLANCAMENTOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROPRODUTO; CONCLUIDOLANCAMENTOS; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHASMEDICAO; NOTASPENDENTES; PROVISÃO PGTOS | comprovantes-de-pagamento; atividades; atividades-executadas; produtos; lancamentos-concluidos; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; diarios-de-obras; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; provisoes-de-pagamento | create; delete; edit; execute-flow; navigate; submit; view | - | ExcluirLancamentosComBackup; PowerAppV2->Getitems | partial | Fontes SharePoint sem entidade no catálogo: LINHASMEDICAO, NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca. |
| G10- HISTÓRICO GRUPO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G11- HISTÓRICO PROFISSÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | LANCAMENTOS; PROFISSÃO | lancamentos; profissoes | delete; edit; navigate; view | - | - | mapped | - |
| G12- HISTÓRICO MSG.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FORNECEDORES; MENSAGEM PROGRAMADA | fornecedores; mensagens-programadas | delete; edit; execute-flow; navigate; submit; view | - | MENSAGEMPROGRAMADA | mapped | - |
| G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS | cadastro-de-imobilizados; grupos; grupos-de-imobilizados; imobilizados | delete; edit; navigate; view | - | - | mapped | - |
| G14- HISTÓRICOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; CADASTROPRODUTO; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS; SUBFAMÍLIA | cadastro-de-imobilizados; produtos; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados; subfamilias | create; delete; edit; navigate; view | - | - | mapped | - |
| G15- HISTÓRICO IMÓVEIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CORRETOR; DOCUMENTOS_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS; TIPOMARCO | atividades; corretores; filiais; imoveis; compras; receitas; lancamentos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, TIPOMARCO. Módulo funcional não comprovado de forma inequívoca. |
| G16- HISTÓRICOATIVIDADE.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | delete; navigate; view | - | - | mapped | - |
| G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTO DE PRESENÇA; ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO | presencas; atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; grupos; imoveis; lancamentos-de-obras; lancamentos; profissoes | create; delete; edit; execute-flow; navigate; submit; view | - | CRIARDESCRITIVOPRESENCAPOWERAPPS; EXCLUIRDESCRITIVOPRESENCAPOWERAPPS; PowerAppV2->Getitems; PowerAppV2->Getitems,ParseJSON,Select,Compose; PowerAppV2->Updateitem,SendpushnotificationV2 | mapped | - |
| G18- HISTÓRICO INCONSISTENCIAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; inconsistencias | delete; edit; navigate; view | - | - | mapped | - |
| G19- HISTÓRICOLOCACOES_1.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; lancamentos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. |
| G19- HISTÓRICOLOCACOES_2.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; lancamentos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. |
| G19- HISTÓRICOLOCACOES.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROCONTA; CADASTROPRODUTO; DESPESASRECORRENTES; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; PROVISÃO PGTOS | contas; produtos; despesas-recorrentes; filiais; fornecedores; imoveis; lancamentos; provisoes-de-pagamento | delete; edit; execute-flow; navigate; view | - | CRIARPREVISAOPGTO | mapped | - |
| G2- HISTÓRICO TIPO MATERIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROTIPOMATERIAL; LANCAMENTOS | tipos-de-material; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G20- HISTÓRICO VENDAS.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS; TIPOMARCO | atividades; clientes; corretores; filiais; imoveis; compras; receitas; lancamentos | create; delete; execute-flow; navigate; view | - | LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, TIPOMARCO. |
| G21- HISTÓRICO CLIENTE.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS | clientes; corretores; filiais | delete; navigate; view | - | - | mapped | - |
| G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; FILIAIS; FORNECEDORES; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS; LANCAMENTOS | cadastro-de-imobilizados; filiais; fornecedores; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados; lancamentos | delete; edit; execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRITIVOPRESENCA; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-presenca; filiais; fornecedores; imoveis; lancamentos-de-obras; lancamentos; profissoes | delete; edit; execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| G24- HISTÓRICO CORRETOR.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTROCIDADE; CORRETOR; GRUPO | cidades; corretores; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; DOCUMENTOS_1; FILIAIS; GRUPO; GRUPODOCFILIAL; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | atividades; clientes; tipos-de-documento; filiais; grupos; imoveis; compras; receitas | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, GRUPODOCFILIAL, TIPOMARCO. |
| G25- HISTÓRICO ETAPA OBRA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRITIVOPRESENCA; FILIAIS; GRUPO; LANCAMENTOOBRA; PROFISSÃO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-presenca; filiais; grupos; lancamentos-de-obras; profissoes | delete; navigate; view | - | - | mapped | - |
| G25- HISTÓRICO TIPO MARCO.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CORRETOR; TIPOMARCO | corretores | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: TIPOMARCO. |
| G26- HISTÓRICOTIPODOCUMENTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO TIPO DOCUMENTO; GRUPO; GRUPODOCFILIAL | tipos-de-documento; grupos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. Módulo funcional não comprovado de forma inequívoca. |
| G28- HISTÓRICO PAG PREVISTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTROCONTA; CADASTROPRODUTO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; NOTASPENDENTES; PROVISÃO PGTOS | contas; produtos; filiais; fornecedores; imoveis; lancamentos-de-obras; lancamentos; provisoes-de-pagamento | create; delete; edit; execute-flow; navigate; submit; view | - | CRIARPREVISAOPGTO; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. Módulo funcional não comprovado de forma inequívoca. |
| G31- HISTÓRICO CONTRATOS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHACONTRATO; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; inconsistencias | create; delete; edit; execute-flow; navigate; view | - | FORMULÁRIOMEDIÇÃO; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: LINHACONTRATO. Módulo funcional não comprovado de forma inequívoca. |
| G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTO DE PRESENÇA; APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; DESCRITIVOPRESENCA; LANCAMENTOS; PROFISSÃO | presencas; apontamentos-de-funcionarios; atividades; atividades-executadas; descricoes-de-presenca; lancamentos; profissoes | delete; execute-flow; navigate; view | - | CRIARPRESENCABOTAO; LANCAMENTOSHTML | mapped | - |
| G35- HISTÓRICO SUBFAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; SUBFAMÍLIA | familias; cadastro-de-subfamilias; tipos-de-material; subfamilias | delete; edit; navigate; view | - | - | mapped | - |
| G36- HISTÓRICO CIDADE.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; LANCAMENTOS | cidades; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G38- HISTÓRICO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; LANCAMENTOS; SUBFAMÍLIA | produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; lancamentos; subfamilias | delete; edit; navigate; view | - | - | mapped | - |
| G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DESCRITIVOPRESENCA; DIÁRIO DE OBRAS; FILIAIS; PROFISSÃO | atividades; atividades-executadas; descricoes-de-presenca; diarios-de-obras; filiais; profissoes | delete; edit; execute-flow; navigate; view | - | EMISSÃODIÁRIODEOBRAS; LANCAMENTOSHTML | mapped | - |
| G40- HISTÓRICO FILIAIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | DESCRITIVOPRESENCA; FILIAIS | descricoes-de-presenca; filiais | delete; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROUNIDADEMEDIDA; LANCAMENTOS | unidades-de-medida; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G42- HISTÓRICO FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOS | atividades; empreiteiros; filiais; fornecedores; lancamentos | delete; navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; CORRETOR; EMPREITEIRO; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS | clientes; contas; produtos; corretores; empreiteiros; filiais; imoveis; compras; receitas; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G45- HISTÓRICO GRUPO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; GRUPO; GRUPODOCFILIAL | cidades; grupos | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. |
| G47- HISTÓRICO DOCUMENTOS COMERCIAL_1.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; CORRETOR; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; HOMOLOGARFORNECEDOR; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANCAMENTOS; TIPOMARCO | clientes; tipos-de-documento; corretores; empreiteiros; filiais; fornecedores; imoveis; compras; lancamentos-de-obras; lancamentos | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, DOCUMENTOS_1, HOMOLOGARFORNECEDOR, TIPOMARCO. |
| G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROGRUPO; CADASTROUNIDADEMEDIDA; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; LINHACONTRATO | atividades; atividades-executadas; cadastro-de-grupos; unidades-de-medida; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: LINHACONTRATO. Módulo funcional não comprovado de forma inequívoca. |
| G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; CADASTROUNIDADEMEDIDA; DESCRICAOMEDICOES; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; LINHACONTRATO; LINHASMEDICAO | atividades; unidades-de-medida; descricoes-de-medicao; empreiteiros; filiais; fornecedores; imoveis; lancamentos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: DOCUMENTOS_1, LINHACONTRATO, LINHASMEDICAO. |
| G5- HISTÓRICO ASSOCIAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | CADASTROTAREFAS | cadastro-de-tarefas | delete; edit; navigate; view | - | - | mapped | - |
| G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHACONTRATO; LINHASMEDICAO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos | create; delete; edit; execute-flow; navigate; submit; view | - | LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: LINHACONTRATO, LINHASMEDICAO. |
| G7- HISTÓRICO TAREFAS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRODIFICULDADE; CADASTROTAREFAS; FORNECEDORES; LANCAMENTOS; LANCAMENTOTAREFAS | atividades; dificuldades; cadastro-de-tarefas; fornecedores; lancamentos; lancamentos-de-tarefas | delete; edit; execute-flow; navigate; submit; view | - | MENSAGEMPROGRAMADA | mapped | - |
| G8- HISTÓRICO FAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G9- HISTÓRICO DELEGACAO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRODIFICULDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO; TAREFASDELEGADAS; TAREFASRECORRENTES | atividades; dificuldades; cadastro-de-tarefas; filiais; fornecedores; lancamentos-de-obras; lancamentos; profissoes; tarefas-delegadas | delete; edit; execute-flow; navigate; submit; view | - | CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | partial | Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES. |
| GALERIA TICKETS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES; TICKET MOVIMENTACOES; TICKETS CLIENTES | filiais; fornecedores; lancamentos; movimentacoes-de-ticket; tickets-clientes | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. |
| GALERIACONTA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; LANCAMENTOS | contas; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| HISTÓRICO FORNECEDORES.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPO; FORNECEDORES; FORNECEDORLOCACAO | cadastro-de-grupos; fornecedores | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: FORNECEDORLOCACAO. |
| HISTÓRICO PATOLOGIAS.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOS; SACPATOLOGIAS; TIPOPATOLOGIA | clientes; filiais; imoveis; compras; lancamentos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: SACPATOLOGIAS, TIPOPATOLOGIA. |
| HISTÓRICO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPO; FORNECEDORLOCACAO; LOCACAOPRODUTO | cadastro-de-grupos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: FORNECEDORLOCACAO, LOCACAOPRODUTO. |
| HISTÓRICO TIPO PATOLOGIA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | FILIAIS; LANCAMENTOOBRA; TIPOMARCO; TIPOPATOLOGIA | filiais; lancamentos-de-obras | delete; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: TIPOMARCO, TIPOPATOLOGIA. |
| HISTORICOTAREFASRECORRENTES.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; TAREFASDELEGADAS; TAREFASRECORRENTES | atividades; cadastro-de-tarefas; filiais; fornecedores; tarefas-delegadas | delete; edit; execute-flow; navigate; view | - | CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | partial | Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES. |
| I10- GERAL SUPRIMENTOS.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; FILIAIS; GRUPO; LANCAMENTOS; SUBFAMÍLIA | contas; filiais; grupos; lancamentos; subfamilias | create; navigate; view | - | - | mapped | - |
| I4- GERAL TAREFAS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FORNECEDORES | fornecedores | execute-flow; navigate; view | - | MENSAGEMPROGRAMADA | mapped | - |
| I6- GERAL RH.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DIÁRIO DE OBRAS; EMPREITEIRO; PROFISSÃO | atividades; atividades-executadas; diarios-de-obras; empreiteiros; profissoes | navigate; view | - | - | mapped | - |
| I7- GERAL COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CORRETOR; TIPOMARCO | corretores | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: TIPOMARCO. |
| I8- GERAL AUDITORIA.pa.yaml | base:powerapps-form-audit-20260815 | auditoria-compliance | GRUPO; GRUPODOCFILIAL; LANCAMENTOS; LANCAMENTOS AUDITORIA; TIPOS AUDITORIA | grupos; lancamentos; auditorias; tipos-de-auditoria | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: GRUPODOCFILIAL. |
| MOVIMENTAÇÃO TICKETS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES; TICKET MOVIMENTACOES | filiais; fornecedores; lancamentos; movimentacoes-de-ticket | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. |
| PAGAMENTOS PREVISTOS.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; FILIAIS; FORMAPGTO LOCACAO; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LANCAMENTOS; LOCACAOPRODUTO; NOTASPENDENTES; PREVLOCACOES; RESPONSAVELPGTO | filiais; fornecedores; grupos; lancamentos | delete; edit; execute-flow; navigate; submit; view | - | BOTAOPAGAMENTOS | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, NOTASPENDENTES, PREVLOCACOES, RESPONSAVELPGTO. |
| PREVISTO LOCAÇÕES E IARA.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FORMAPGTO LOCACAO; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; PREVLOCACOES; RESPONSAVELPGTO | grupos | create; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, PREVLOCACOES, RESPONSAVELPGTO. |
| RECORRENCIALOCACOES.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FILIAIS; FORMAPGTO LOCACAO; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LANCAMENTOS; LOCACAOPRODUTO; NOTASPENDENTES; RECORRENTESLOCACOES; RESPONSAVELPGTO | filiais; fornecedores; grupos; lancamentos | delete; edit; execute-flow; navigate; submit; view | - | BOTAOPAGAMENTOS | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, FORMAPGTO LOCACAO, FORNECEDORLOCACAO, LOCACAOPRODUTO, NOTASPENDENTES, RECORRENTESLOCACOES, RESPONSAVELPGTO. |
| Screen1.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | ATIVIDADE; CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; TIPOHOMOLOGACAOLOCACAO | atividades; fornecedores; grupos | create; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORNECEDORLOCACAO, LOCACAOPRODUTO, TIPOHOMOLOGACAOLOCACAO. |
| Screen10.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | ARQUIVOLANCAMENTOS; CADASTROCONTA; FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES | comprovantes-de-pagamento; contas; filiais; fornecedores; lancamentos | delete; edit; execute-flow; navigate; view | - | APROVARLANCAMENTOSPORAGRUPAR; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: NOTASPENDENTES. |
| Screen11.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; TAREFASRECORRENTES | atividades; cadastro-de-tarefas; filiais; fornecedores | navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: TAREFASRECORRENTES. Módulo funcional não comprovado de forma inequívoca. |
| Screen12_1.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras | navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. Módulo funcional não comprovado de forma inequívoca. |
| Screen12.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras | navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: NOVACOTACAO, ORCAMENTOS. Módulo funcional não comprovado de forma inequívoca. |
| Screen13.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; LANCAMENTOOBRA; TIPOPATOLOGIA | filiais; lancamentos-de-obras | navigate; submit; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: TIPOPATOLOGIA. Módulo funcional não comprovado de forma inequívoca. |
| Screen2.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; EMPREITEIRO; FORMAPGTO LOCACAO; FORNECEDORES; GRUPO; HOMOLOGARLOCACAO; LANCAMENTOALUGUEL; LANCAMENTOS; TIPOHOMOLOGACAOLOCACAO | empreiteiros; fornecedores; grupos; lancamentos | create; delete; edit; execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, TIPOHOMOLOGACAOLOCACAO. Módulo funcional não comprovado de forma inequívoca. |
| Screen3.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORMAPGTO LOCACAO; GRUPO | atividades; grupos | create; execute-flow; navigate; submit; view | - | CRIARLANÇAMENTOALUGUEL | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO. Módulo funcional não comprovado de forma inequívoca. |
| Screen4_1.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; DOCUMENTOS_1; GRUPO; HOMOLOGARLOCACAO; LANCAMENTOALUGUEL; LANCAMENTOS; TIPOHOMOLOGACAOLOCACAO | grupos; lancamentos | create; delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, DOCUMENTOS_1, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, TIPOHOMOLOGACAOLOCACAO. |
| Screen4.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | TIPOHOMOLOGACAOLOCACAO | - | delete; edit; navigate; view | - | - | gap | Nenhuma fonte SharePoint desta tela possui entidade no catálogo: TIPOHOMOLOGACAOLOCACAO. Módulo funcional não comprovado de forma inequívoca. |
| Screen5.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO; LANCAMENTOS; teste | grupos; lancamentos | create; delete; edit; execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL; HABILITARFILIAL | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, teste. |
| Screen6.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | grupos | delete; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL. |
| Screen7.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | grupos | delete; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, CADASTROIMOVEL. |
| Screen8.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; GRUPO | grupos | delete; edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL. |
| Screen9_1.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | atividades; grupos | edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL. Módulo funcional não comprovado de forma inequívoca. |
| Screen9_2.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | grupos | edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTROGRUPOIMÓVEL, CADASTROIMOVEL. |
| Screen9.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORMAPGTO LOCACAO; GRUPO | grupos | edit; navigate; view | - | - | partial | Fontes SharePoint sem entidade no catálogo: CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROGRUPOIMÓVEL, CADASTROIMOVEL, FORMAPGTO LOCACAO. |
| TELA INICIAL.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | APONTAMENTOSCOMERCIAIS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO ALUGUEL; CADASTRO CLIENTE_1; CADASTRO INQUILINO_1; CADASTRO TIPO DOCUMENTO; CADASTRODIFICULDADE; CADASTROIMOVEL; CADASTROPRODUTO; CORRETOR; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; DESPESASRECORRENTES; DIÁRIO DE OBRAS; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; HOMOLOGARFORNECEDOR; HOMOLOGARLOCACAO; IMOBILIZADOS; IMOVEL CADASTRADO; LANCAMENTOALUGUEL; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANÇAMENTORECEITA; LANCAMENTOS; LANCAMENTOTAREFAS; NOTASPENDENTES; NOVACOTACAO; ORCAMENTOS; PREVLOCACOES; PROFISSÃO; PROVISÃO PGTOS; TAREFASDELEGADAS; TIPOMARCO | atividades; atividades-executadas; clientes; tipos-de-documento; dificuldades; produtos; corretores; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; despesas-recorrentes; diarios-de-obras; empreiteiros; filiais; fornecedores; grupos; imobilizados; imoveis; compras; lancamentos-de-obras; receitas; lancamentos; lancamentos-de-tarefas; profissoes; provisoes-de-pagamento; tarefas-delegadas | execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL; CRIARPREVISAOPGTO; LANCAMENTOSHTML | partial | Fontes SharePoint sem entidade no catálogo: APONTAMENTOSCOMERCIAIS, CADASTRO ALUGUEL, CADASTRO INQUILINO_1, CADASTROIMOVEL, DOCUMENTOS_1, HOMOLOGARFORNECEDOR, HOMOLOGARLOCACAO, LANCAMENTOALUGUEL, NOTASPENDENTES, NOVACOTACAO, ORCAMENTOS, PREVLOCACOES, TIPOMARCO. |

## Cobertura das fontes do inventário

| Fonte exata | Entidade | Estado |
|---|---|---|
| LANCAMENTOS | lancamentos | mapped |
| CADASTROTIPOMATERIAL | tipos-de-material | mapped |
| CADASTROURGÊNCIA | urgencias | mapped |
| CADASTROUNIDADEMEDIDA | unidades-de-medida | mapped |
| FUNCAOIMOBILIZADO | funcoes-de-imobilizado | mapped |
| CONCLUIDOLANCAMENTOS | lancamentos-concluidos | mapped |
| DEMONSTRATIVOETAPA | demonstrativos-de-etapa | mapped |
| DESPESASRECORRENTES | despesas-recorrentes | mapped |
| DESCRICAOMEDICOES | descricoes-de-medicao | mapped |
| DIÁRIO DE OBRAS | diarios-de-obras | mapped |
| DESCRITIVOPRESENCA | descricoes-de-presenca | mapped |
| EMPREITEIRO | empreiteiros | mapped |
| FILIAIS | filiais | mapped |
| FORNECEDORES | fornecedores | mapped |
| GRUPO IMOBILIZADOS | grupos-de-imobilizados | mapped |
| IMOBILIZADOS | imobilizados | mapped |
| LANCAMENTOOBRA | lancamentos-de-obras | mapped |
| LANCAMENTOS AUDITORIA | auditorias | mapped |
| MENSAGEM PROGRAMADA | mensagens-programadas | mapped |
| PROFISSÃO | profissoes | mapped |
| PROVISÃO PGTOS | provisoes-de-pagamento | mapped |
| SUBFAMÍLIA | subfamilias | mapped |
| TAREFASDELEGADAS | tarefas-delegadas | mapped |
| TIPO DE TRANSACAO | tipos-de-transacao | mapped |
| TIPOINCONSISTENCIA | inconsistencias | mapped |
| TIPOS AUDITORIA | tipos-de-auditoria | mapped |
| CADASTROIMOBILIZADO | cadastro-de-imobilizados | mapped |
| CADASTROGRUPO | cadastro-de-grupos | mapped |
| CADASTRODIFICULDADE | dificuldades | mapped |
| CADASTROCONTA | contas | mapped |
| CADASTROCIDADE | cidades | mapped |
| CADASTRO TIPO DOCUMENTO | tipos-de-documento | mapped |
| CADASTRO IMPACTO | impactos | mapped |
| CADASTRO FAMÍLIA_1 | familias | mapped |
| CADASTRO CLIENTE_1 | clientes | mapped |
| ATIVIDADE EXECUTADA | atividades-executadas | mapped |
| ATIVIDADE | atividades | mapped |
| APONTAMENTOSFUNCIONARIOS | apontamentos-de-funcionarios | mapped |
| ARQUIVOLANCAMENTOS | comprovantes-de-pagamento | mapped |
| APONTAMENTO DE PRESENÇA | presencas | mapped |
| CADASTROTAREFAS | cadastro-de-tarefas | mapped |
| CADASTROSUBFAMÍLIA | cadastro-de-subfamilias | mapped |
| CADASTROPRODUTO | produtos | mapped |
| GRUPO | grupos | mapped |
| LANCAMENTOCOMPRAS | compras | mapped |
| CORRETOR | corretores | mapped |
| IMOVEL CADASTRADO | imoveis | mapped |
| LANCAMENTOTAREFAS | lancamentos-de-tarefas | mapped |
| LANÇAMENTORECEITA | receitas | mapped |
| TICKETS CLIENTES | tickets-clientes | mapped |
| TICKET MOVIMENTACOES | movimentacoes-de-ticket | mapped |
| COMUNICACOES CLIENTES | comunicacoes-clientes | mapped |
| COMUNICACAO MOVIMENTACOES | movimentacoes-de-comunicacao | mapped |

## Fontes adicionais descobertas

Estas fontes existem na exportação completa, mas não constavam entre as 53 fontes do inventário inicial. Elas permanecem documentadas como mapeadas ou como lacunas, sem conexão inventada.

| Fonte exata | Entidade | Estado |
|---|---|---|
| APONTAMENTOSCOMERCIAIS | - | gap |
| ASSOCIACAOALUGUEL | - | gap |
| CADASTRO ALUGUEL | - | gap |
| CADASTRO INQUILINO_1 | - | gap |
| CADASTROGRUPOIMÓVEL | - | gap |
| CADASTROIMOVEL | - | gap |
| DOCUMENTOS_1 | - | gap |
| FORMAPGTO LOCACAO | - | gap |
| FORNECEDORLOCACAO | - | gap |
| GRUPODOCFILIAL | - | gap |
| HOMOLOGARFORNECEDOR | - | gap |
| HOMOLOGARLOCACAO | - | gap |
| LANCAMENTOALUGUEL | - | gap |
| LINHACONTRATO | - | gap |
| LINHASMEDICAO | - | gap |
| LOCACAOPRODUTO | - | gap |
| NOTASPENDENTES | - | gap |
| NOVACOTACAO | - | gap |
| ORCAMENTOS | - | gap |
| PREVLOCACOES | - | gap |
| PRODUTOALUGUEL | - | gap |
| RECORRENTESLOCACOES | - | gap |
| REGISTROMENSAL | - | gap |
| RESPONSAVELPGTO | - | gap |
| SACPATOLOGIAS | - | gap |
| TAREFASALUGUEL | - | gap |
| TAREFASRECORRENTES | - | gap |
| teste | - | gap |
| TIPOHOMOLOGACAOLOCACAO | - | gap |
| TIPOMARCO | - | gap |
| TIPOPATOLOGIA | - | gap |

## Conexões de fluxo

| Fluxo conectado | Artefatos que chamam `.Run()` | Estado |
|---|---|---|
| APROVARLANCAMENTOSPORAGRUPAR | Screen10.pa.yaml | referenced |
| ATIVIDADES | - | unreferenced |
| ATUALIZARBI | - | unreferenced |
| BOTAOPAGAMENTOS | PAGAMENTOS PREVISTOS.pa.yaml; RECORRENCIALOCACOES.pa.yaml | referenced |
| CHECKLIST | - | unreferenced |
| COMPROVANTEPGTO | - | unreferenced |
| CONTRATOS | E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml; F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml | referenced |
| CRIARDESCRITIVOPRESENCAPOWERAPPS | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| CRIARLANÇAMENTOALUGUEL | Screen2.pa.yaml; Screen3.pa.yaml; Screen5.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| CRIARPRESENCABOTAO | G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml | referenced |
| CRIARPREVISAOPGTO | F21- CADASTRO DESPESA RECORRENTE.pa.yaml; G19- HISTÓRICOLOCACOES.pa.yaml; G28- HISTÓRICO PAG PREVISTO.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| CRIARPROVISAOPGTOSPOWERAPPS | F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | referenced |
| CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | G9- HISTÓRICO DELEGACAO.pa.yaml; HISTORICOTAREFASRECORRENTES.pa.yaml | referenced |
| EMISSÃODIÁRIODEOBRAS | G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml | referenced |
| ENVIOHTML | - | unreferenced |
| EXCLUIRDESCRITIVOPRESENCAPOWERAPPS | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| ExcluirLancamentosComBackup | G1- HISTÓRICO LANÇAMENTOS.pa.yaml | referenced |
| FORMULÁRIOFUNCIONÁRIOS | - | unreferenced |
| FORMULÁRIOMEDIÇÃO | G31- HISTÓRICO CONTRATOS.pa.yaml | referenced |
| HABILITARFILIAL | Screen5.pa.yaml | referenced |
| HOMOLOGARDOCUMENTOFORNECEDOR | - | unreferenced |
| HOMOLOGARFORNECEDOR | - | unreferenced |
| LANCAMENTOSHTML | COMPROVANTE ENTREGA EPI.pa.yaml; E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml; F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml; F5- CADASTRO PDF COMPROVANTE PGTO.pa.yaml; G20- HISTÓRICO VENDAS.pa.yaml; G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml; G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml; G28- HISTÓRICO PAG PREVISTO.pa.yaml; G31- HISTÓRICO CONTRATOS.pa.yaml; G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml; G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml; G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml; Screen10.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| MENSAGEMPROGRAMADA | G12- HISTÓRICO MSG.pa.yaml; G7- HISTÓRICO TAREFAS.pa.yaml; I4- GERAL TAREFAS.pa.yaml | referenced |
| MENSAGEMPROGRAMADAIMAGEM | - | unreferenced |
| PowerAppV2->Createfile,Convertfile,Addattachment | - | unreferenced |
| PowerAppV2->Getitems | G1- HISTÓRICO LANÇAMENTOS.pa.yaml; G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| PowerAppV2->Getitems,ParseJSON,Select,Compose | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| PowerAppV2->Updateitem,SendpushnotificationV2 | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| REGISTROMENSAL | - | unreferenced |
| REGISTROMENSALFUNCIONÁRIOS | - | unreferenced |
| RELATORIOPRESENCA | - | unreferenced |
| SUBMETERHTMLCONTRATO | - | unreferenced |
| SUBMETERLANCAMENTOSJSON | F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | referenced |
