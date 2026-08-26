# Matriz de cobertura Power Apps

Fontes: exportação-base local somente leitura `powerapps-form-audit-20260815` e evidência suplementar verificada `powerapps_debug_verify_publish`. Nenhum ambiente Microsoft foi alterado para gerar esta matriz.

## Método

- 129 artefatos `.pa.yaml` pertencem à exportação-base: 127 telas e 2 arquivos sistêmicos.
- `COMPROVANTE ENTREGA EPI.pa.yaml` acrescenta uma tela suplementar, totalizando 130 artefatos e 128 telas.
- A cobertura suplementar comprova a entrega de EPI e documento por `LANCAMENTOSHTML`.
- O manifesto independente `tests/fixtures/powerapps-export-manifest.json` registra os hashes por arquivo; o SHA-256 agregado da exportação-base é `7e99d2212658c877274b29311dbe5076818b3b5a915560585e1f6b8db386e4c0`.
- 82 fontes SharePoint foram identificadas no arquivo estruturado `References/DataSources.json`.
- As 53 fontes do inventário original e as 31 fontes adicionais possuem entidades próprias no catálogo.
- Nenhuma das 31 fontes adicionais é alias de outra lista.
- `create`, `edit` e `delete` são habilitados somente com evidência literal em uma operação da exportação.
- Quatro fontes conectadas sem operação de tela comprovada ficam catalogadas, mas indisponíveis no menu e sem capacidade de leitura ou mutação.
- Chamadas de Power Automate permanecem inventariadas; uma conexão não prova que o fluxo possa ser executado pelo portal.

## Resumo

- Mapeados: 103
- Parciais: 25
- Lacunas de fonte: 0
- Não aplicáveis: 2
- Fontes SharePoint cobertas: 82
- Conexões de fluxo inventariadas: 34

As 25 telas parciais permanecem assim somente quando o módulo funcional da tela não foi comprovado. Fontes e operações comprovadas continuam disponíveis pelas galerias e formulários genéricos do módulo atribuído.

## Fontes catalogadas, mas indisponíveis

| Fonte exata | Entidade | Motivo |
|---|---|---|
| REGISTROMENSAL | registros-mensais | Fonte conectada, sem operação de tela comprovada. |
| ASSOCIACAOALUGUEL | associacoes-de-aluguel | Fonte conectada, sem operação de tela comprovada. |
| PRODUTOALUGUEL | produtos-de-aluguel | Fonte conectada, sem operação de tela comprovada. |
| TAREFASALUGUEL | tarefas-de-aluguel | Fonte conectada, sem operação de tela comprovada. |

## Telas e fluxos

| Artefato | Origem | Módulo | Fontes | Entidades | Ações | Cobertura funcional | Fluxos | Cobertura | Restrição |
|---|---|---|---|---|---|---|---|---|---|
| _EditorState.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | ATIVIDADE; CORRETOR; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; LANCAMENTOS; PROFISSÃO; SUBFAMÍLIA | atividades; corretores; diarios-de-obras; empreiteiros; filiais; fornecedores; grupos; lancamentos; profissoes; subfamilias | view | - | - | not-applicable | - |
| App.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | PROVISÃO PGTOS | provisoes-de-pagamento | view | - | - | not-applicable | - |
| COMPROVANTE ENTREGA EPI.pa.yaml | supplemental:powerapps_debug_verify_publish | rh-obras | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; FORNECEDORES; SUBFAMÍLIA | contas; produtos; unidades-de-medida; fornecedores; subfamilias | execute-flow; navigate; view | deliver-epi; generate-document | LANCAMENTOSHTML | mapped | - |
| CRIAR SACPATOLOGIA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; FILIAIS; LANCAMENTOCOMPRAS; SACPATOLOGIAS; TIPOPATOLOGIA | clientes; filiais; compras; patologias-sac; tipos-de-patologia | navigate; submit; view | - | - | mapped | - |
| DESPESAS RECORRENTES LOCAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FORMAPGTO LOCACAO; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; RECORRENTESLOCACOES; RESPONSAVELPGTO | grupos-de-imoveis; formas-de-pagamento-de-locacao; fornecedores-de-locacao; grupos; produtos-de-locacao; recorrencias-de-locacao; responsaveis-por-pagamento | create; navigate; view | - | - | mapped | - |
| E1- EDITAR LANÇAMENTO COMPRA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; DESCRICAOMEDICOES; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; TIPO DE TRANSACAO | contas; produtos; unidades-de-medida; descricoes-de-medicao; filiais; fornecedores; lancamentos-de-obras; lancamentos; tipos-de-transacao | edit; navigate; view | - | - | mapped | - |
| E11- EDITAR TAREFA.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRO IMPACTO; CADASTRODIFICULDADE; CADASTROTAREFAS; CADASTROURGÊNCIA; FILIAIS; FORNECEDORES; LANCAMENTOTAREFAS | atividades; impactos; dificuldades; cadastro-de-tarefas; urgencias; filiais; fornecedores; lancamentos-de-tarefas | edit; navigate; view | - | - | mapped | - |
| E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA | atividades; atividades-executadas; demonstrativos-de-etapa; documentos-operacionais; empreiteiros; filiais; fornecedores; lancamentos-de-obras | edit; execute-flow; navigate; view | - | CONTRATOS; LANCAMENTOSHTML | mapped | - |
| E16- EDITAR CADASTRO VENDA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | apontamentos-comerciais; atividades; clientes; corretores; filiais; imoveis; compras; receitas; tipos-de-marco | edit; navigate; view | - | - | mapped | - |
| E2- EDITAR FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO TIPO DOCUMENTO; CADASTROCIDADE; CADASTROTIPOMATERIAL; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; PROFISSÃO | atividades; atividades-executadas; tipos-de-documento; cidades; tipos-de-material; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; imoveis; lancamentos; profissoes | edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| E3- EDITAR DIÁRIO OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | DIÁRIO DE OBRAS; FILIAIS | diarios-de-obras; filiais | edit; navigate; view | - | - | mapped | - |
| E4- EDITAR FILIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; FILIAIS | cidades; filiais | edit; navigate; view | - | - | mapped | - |
| E7- EDITAR ETAPA OBRA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; FILIAIS; LANCAMENTOOBRA | atividades; filiais; lancamentos-de-obras | edit; navigate; view | - | - | mapped | - |
| E8- EDITAR CLIENTE.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO | clientes; corretores; filiais; imoveis | edit; navigate; view | - | - | mapped | - |
| E9- EDITAR ATIVIDADE FUNCIONÁRIOS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | edit; navigate; view | - | - | mapped | - |
| F1- CADASTRO ASSOCIAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | CADASTROTAREFAS | cadastro-de-tarefas | create; edit; navigate; view | - | - | mapped | - |
| F10- CADASTRO FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO TIPO DOCUMENTO; CADASTROCIDADE; CADASTROTIPOMATERIAL; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; HOMOLOGARFORNECEDOR; IMOVEL CADASTRADO; LANCAMENTOOBRA; PROFISSÃO | atividades; atividades-executadas; tipos-de-documento; cidades; tipos-de-material; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; homologacoes-de-fornecedor; imoveis; lancamentos-de-obras; profissoes | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F11- CADASTRO FILIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; FILIAIS | cidades; filiais | create; navigate; view | - | - | mapped | - |
| F12- CADASTRO GRUPO_1.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; FILIAIS; FORNECEDORES; NOTASPENDENTES | contas; filiais; fornecedores; notas-pendentes | create; navigate; view | - | - | mapped | - |
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
| F28- CADASTROTIPODOCUMENTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO TIPO DOCUMENTO; GRUPO; GRUPODOCFILIAL | tipos-de-documento; grupos; grupos-de-documentos-por-filial | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F29- CADASTRO DOCUMENTOS_2.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; GRUPODOCFILIAL; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; TIPOMARCO | apontamentos-comerciais; atividades; clientes; tipos-de-documento; documentos-operacionais; empreiteiros; filiais; fornecedores; grupos; grupos-de-documentos-por-filial; imoveis; compras; lancamentos-de-obras; tipos-de-marco | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F3- CADASTRO PGTO PREV.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; PROVISÃO PGTOS | clientes; contas; produtos; filiais; fornecedores; imoveis; provisoes-de-pagamento | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F31- CADASTRO ATIVIDADE FUNCIONÁRIOS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | create; navigate; view | - | - | mapped | - |
| F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA | atividades; atividades-executadas; demonstrativos-de-etapa; documentos-operacionais; empreiteiros; filiais; fornecedores; lancamentos-de-obras | create; execute-flow; navigate; submit; view | - | CONTRATOS; LANCAMENTOSHTML | mapped | - |
| F33- CADASTRO HTML MEDIÇÃO UNITÁRIA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; demonstrativos-de-etapa; descricoes-de-medicao; empreiteiros; filiais; fornecedores; lancamentos-de-obras; inconsistencias | create; navigate; submit; view | - | - | mapped | - |
| F37- CADASTRO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; SUBFAMÍLIA | produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; subfamilias | create; navigate; view | - | - | mapped | - |
| F38- CADASTRO TIPO MATERIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROTIPOMATERIAL | tipos-de-material | create; navigate; view | - | - | mapped | - |
| F39- CADASTRO UNIDADEMEDIDA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROUNIDADEMEDIDA | unidades-de-medida | create; navigate; view | - | - | mapped | - |
| F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROCIDADE; CADASTROCONTA; CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; CORRETOR; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANCAMENTOS; NOTASPENDENTES; PROVISÃO PGTOS; SUBFAMÍLIA; TIPO DE TRANSACAO | atividades; atividades-executadas; cidades; contas; produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; corretores; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; imoveis; compras; lancamentos-de-obras; lancamentos; notas-pendentes; provisoes-de-pagamento; subfamilias; tipos-de-transacao | create; delete; edit; execute-flow; navigate; view | - | CRIARPROVISAOPGTOSPOWERAPPS; SUBMETERLANCAMENTOSJSON | partial | Módulo funcional não comprovado de forma inequívoca. |
| F40- CADASTRO CIDADE.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE | cidades | create; navigate; view | - | - | mapped | - |
| F41- CADASTRO DIÁRIO DE OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; diarios-de-obras; empreiteiros; filiais; fornecedores; lancamentos-de-obras; inconsistencias | create; navigate; view | - | - | mapped | - |
| F42- CADASTRO FAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | create; navigate; view | - | - | mapped | - |
| F43- CADASTRO SUBFAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; SUBFAMÍLIA | familias; cadastro-de-subfamilias; tipos-de-material; subfamilias | create; navigate; view | - | - | mapped | - |
| F44- APONTAMENTOS COMERCIAIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; CADASTROCONTA; CADASTROPRODUTO; DOCUMENTOS_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | apontamentos-comerciais; clientes; tipos-de-documento; contas; produtos; documentos-operacionais; filiais; imoveis; compras; receitas; tipos-de-marco | create; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| F44- LANÇAMENTO RECEITA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; SUBFAMÍLIA | clientes; contas; produtos; cadastro-de-subfamilias; corretores; filiais; imoveis; compras; receitas; subfamilias | create; navigate; view | - | - | mapped | - |
| F46- ADICIONAR LINHA CONTRATO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROUNIDADEMEDIDA; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; LINHACONTRATO | atividades; atividades-executadas; unidades-de-medida; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; linhas-de-contrato | create; navigate; submit; view | - | - | mapped | - |
| F47- ADICIONAR LINHA MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DESCRICAOMEDICOES; EMPREITEIRO; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOOBRA; LINHACONTRATO; LINHASMEDICAO | atividades; atividades-executadas; descricoes-de-medicao; empreiteiros; filiais; imoveis; lancamentos-de-obras; linhas-de-contrato; linhas-de-medicao | create; navigate; submit; view | - | - | mapped | - |
| F5- CADASTRO PDF COMPROVANTE PGTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; CADASTROPRODUTO; CADASTROUNIDADEMEDIDA; FORNECEDORES | contas; produtos; unidades-de-medida; fornecedores | execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| F8- CADASTRO TAREFA.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRO IMPACTO; CADASTRODIFICULDADE; CADASTROTAREFAS; CADASTROURGÊNCIA; FILIAIS; FORNECEDORES; LANCAMENTOTAREFAS | atividades; impactos; dificuldades; cadastro-de-tarefas; urgencias; filiais; fornecedores; lancamentos-de-tarefas | create; navigate; view | - | - | mapped | - |
| F9- CADASTRO DELEGAÇAO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; TAREFASDELEGADAS | atividades; cadastro-de-tarefas; filiais; fornecedores; imoveis; tarefas-delegadas | create; navigate; view | - | - | mapped | - |
| G1- HISTÓRICO LANÇAMENTOS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ARQUIVOLANCAMENTOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROPRODUTO; CONCLUIDOLANCAMENTOS; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; DIÁRIO DE OBRAS; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHASMEDICAO; NOTASPENDENTES; PROVISÃO PGTOS | comprovantes-de-pagamento; atividades; atividades-executadas; produtos; lancamentos-concluidos; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; diarios-de-obras; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; linhas-de-medicao; notas-pendentes; provisoes-de-pagamento | create; delete; edit; execute-flow; navigate; submit; view | - | ExcluirLancamentosComBackup; PowerAppV2->Getitems | partial | Módulo funcional não comprovado de forma inequívoca. |
| G10- HISTÓRICO GRUPO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G11- HISTÓRICO PROFISSÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | LANCAMENTOS; PROFISSÃO | lancamentos; profissoes | delete; edit; navigate; view | - | - | mapped | - |
| G12- HISTÓRICO MSG.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FORNECEDORES; MENSAGEM PROGRAMADA | fornecedores; mensagens-programadas | delete; edit; execute-flow; navigate; submit; view | - | MENSAGEMPROGRAMADA | mapped | - |
| G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS | cadastro-de-imobilizados; grupos; grupos-de-imobilizados; imobilizados | delete; edit; navigate; view | - | - | mapped | - |
| G14- HISTÓRICOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; CADASTROPRODUTO; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS; SUBFAMÍLIA | cadastro-de-imobilizados; produtos; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados; subfamilias | create; delete; edit; navigate; view | - | - | mapped | - |
| G15- HISTÓRICO IMÓVEIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CORRETOR; DOCUMENTOS_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS; TIPOMARCO | apontamentos-comerciais; atividades; corretores; documentos-operacionais; filiais; imoveis; compras; receitas; lancamentos; tipos-de-marco | delete; edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G16- HISTÓRICOATIVIDADE.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; FILIAIS; LANCAMENTOOBRA | atividades; atividades-executadas; filiais; lancamentos-de-obras | delete; navigate; view | - | - | mapped | - |
| G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTO DE PRESENÇA; ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO | presencas; atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; grupos; imoveis; lancamentos-de-obras; lancamentos; profissoes | create; delete; edit; execute-flow; navigate; submit; view | - | CRIARDESCRITIVOPRESENCAPOWERAPPS; EXCLUIRDESCRITIVOPRESENCAPOWERAPPS; PowerAppV2->Getitems; PowerAppV2->Getitems,ParseJSON,Select,Compose; PowerAppV2->Updateitem,SendpushnotificationV2 | mapped | - |
| G18- HISTÓRICO INCONSISTENCIAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; inconsistencias | delete; edit; navigate; view | - | - | mapped | - |
| G19- HISTÓRICOLOCACOES_1.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; lancamentos; novas-cotacoes; orcamentos | delete; edit; navigate; view | - | - | mapped | - |
| G19- HISTÓRICOLOCACOES_2.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; lancamentos; novas-cotacoes; orcamentos | delete; edit; navigate; view | - | - | mapped | - |
| G19- HISTÓRICOLOCACOES.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROCONTA; CADASTROPRODUTO; DESPESASRECORRENTES; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; PROVISÃO PGTOS | contas; produtos; despesas-recorrentes; filiais; fornecedores; imoveis; lancamentos; provisoes-de-pagamento | delete; edit; execute-flow; navigate; view | - | CRIARPREVISAOPGTO | mapped | - |
| G2- HISTÓRICO TIPO MATERIAL.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROTIPOMATERIAL; LANCAMENTOS | tipos-de-material; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G20- HISTÓRICO VENDAS.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CORRETOR; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS; TIPOMARCO | apontamentos-comerciais; atividades; clientes; corretores; filiais; imoveis; compras; receitas; lancamentos; tipos-de-marco | create; delete; execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| G21- HISTÓRICO CLIENTE.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CORRETOR; FILIAIS | clientes; corretores; filiais | delete; navigate; view | - | - | mapped | - |
| G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROIMOBILIZADO; FILIAIS; FORNECEDORES; FUNCAOIMOBILIZADO; GRUPO; GRUPO IMOBILIZADOS; IMOBILIZADOS; LANCAMENTOS | cadastro-de-imobilizados; filiais; fornecedores; funcoes-de-imobilizado; grupos; grupos-de-imobilizados; imobilizados; lancamentos | delete; edit; execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRITIVOPRESENCA; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-presenca; filiais; fornecedores; imoveis; lancamentos-de-obras; lancamentos; profissoes | delete; edit; execute-flow; navigate; view | - | LANCAMENTOSHTML | mapped | - |
| G24- HISTÓRICO CORRETOR.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTROCIDADE; CORRETOR; GRUPO | cidades; corretores; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; ATIVIDADE; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; DOCUMENTOS_1; FILIAIS; GRUPO; GRUPODOCFILIAL; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; TIPOMARCO | apontamentos-comerciais; atividades; clientes; tipos-de-documento; documentos-operacionais; filiais; grupos; grupos-de-documentos-por-filial; imoveis; compras; receitas; tipos-de-marco | create; delete; edit; navigate; view | - | - | mapped | - |
| G25- HISTÓRICO ETAPA OBRA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRITIVOPRESENCA; FILIAIS; GRUPO; LANCAMENTOOBRA; PROFISSÃO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-presenca; filiais; grupos; lancamentos-de-obras; profissoes | delete; navigate; view | - | - | mapped | - |
| G25- HISTÓRICO TIPO MARCO.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CORRETOR; TIPOMARCO | corretores; tipos-de-marco | delete; edit; navigate; view | - | - | mapped | - |
| G26- HISTÓRICOTIPODOCUMENTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO TIPO DOCUMENTO; GRUPO; GRUPODOCFILIAL | tipos-de-documento; grupos; grupos-de-documentos-por-filial | delete; edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G28- HISTÓRICO PAG PREVISTO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTROCONTA; CADASTROPRODUTO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOOBRA; LANCAMENTOS; NOTASPENDENTES; PROVISÃO PGTOS | contas; produtos; filiais; fornecedores; imoveis; lancamentos-de-obras; lancamentos; notas-pendentes; provisoes-de-pagamento | create; delete; edit; execute-flow; navigate; submit; view | - | CRIARPREVISAOPGTO; LANCAMENTOSHTML | partial | Módulo funcional não comprovado de forma inequívoca. |
| G31- HISTÓRICO CONTRATOS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO IMPACTO; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHACONTRATO; TIPOINCONSISTENCIA | apontamentos-de-funcionarios; atividades; atividades-executadas; impactos; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; linhas-de-contrato; inconsistencias | create; delete; edit; execute-flow; navigate; view | - | FORMULÁRIOMEDIÇÃO; LANCAMENTOSHTML | partial | Módulo funcional não comprovado de forma inequívoca. |
| G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | APONTAMENTO DE PRESENÇA; APONTAMENTOSFUNCIONARIOS; ATIVIDADE; ATIVIDADE EXECUTADA; DESCRITIVOPRESENCA; LANCAMENTOS; PROFISSÃO | presencas; apontamentos-de-funcionarios; atividades; atividades-executadas; descricoes-de-presenca; lancamentos; profissoes | delete; execute-flow; navigate; view | - | CRIARPRESENCABOTAO; LANCAMENTOSHTML | mapped | - |
| G35- HISTÓRICO SUBFAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; SUBFAMÍLIA | familias; cadastro-de-subfamilias; tipos-de-material; subfamilias | delete; edit; navigate; view | - | - | mapped | - |
| G36- HISTÓRICO CIDADE.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; LANCAMENTOS | cidades; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G38- HISTÓRICO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROPRODUTO; CADASTROSUBFAMÍLIA; CADASTROTIPOMATERIAL; CADASTROUNIDADEMEDIDA; LANCAMENTOS; SUBFAMÍLIA | produtos; cadastro-de-subfamilias; tipos-de-material; unidades-de-medida; lancamentos; subfamilias | delete; edit; navigate; view | - | - | mapped | - |
| G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DESCRITIVOPRESENCA; DIÁRIO DE OBRAS; FILIAIS; PROFISSÃO | atividades; atividades-executadas; descricoes-de-presenca; diarios-de-obras; filiais; profissoes | delete; edit; execute-flow; navigate; view | - | EMISSÃODIÁRIODEOBRAS; LANCAMENTOSHTML | mapped | - |
| G40- HISTÓRICO FILIAIS.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | DESCRITIVOPRESENCA; FILIAIS | descricoes-de-presenca; filiais | delete; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROUNIDADEMEDIDA; LANCAMENTOS | unidades-de-medida; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G42- HISTÓRICO FORNECEDOR.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOS | atividades; empreiteiros; filiais; fornecedores; lancamentos | delete; navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; CADASTROCONTA; CADASTROPRODUTO; CORRETOR; EMPREITEIRO; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANÇAMENTORECEITA; LANCAMENTOS | clientes; contas; produtos; corretores; empreiteiros; filiais; imoveis; compras; receitas; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| G45- HISTÓRICO GRUPO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCIDADE; GRUPO; GRUPODOCFILIAL | cidades; grupos; grupos-de-documentos-por-filial | create; delete; edit; navigate; view | - | - | mapped | - |
| G47- HISTÓRICO DOCUMENTOS COMERCIAL_1.pa.yaml | base:powerapps-form-audit-20260815 | comercial | APONTAMENTOSCOMERCIAIS; CADASTRO CLIENTE_1; CADASTRO TIPO DOCUMENTO; CORRETOR; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; HOMOLOGARFORNECEDOR; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANCAMENTOS; TIPOMARCO | apontamentos-comerciais; clientes; tipos-de-documento; corretores; documentos-operacionais; empreiteiros; filiais; fornecedores; homologacoes-de-fornecedor; imoveis; compras; lancamentos-de-obras; lancamentos; tipos-de-marco | create; delete; edit; navigate; view | - | - | mapped | - |
| G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; ATIVIDADE EXECUTADA; CADASTROGRUPO; CADASTROUNIDADEMEDIDA; DEMONSTRATIVOETAPA; EMPREITEIRO; FILIAIS; FORNECEDORES; LINHACONTRATO | atividades; atividades-executadas; cadastro-de-grupos; unidades-de-medida; demonstrativos-de-etapa; empreiteiros; filiais; fornecedores; linhas-de-contrato | delete; edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; CADASTROUNIDADEMEDIDA; DESCRICAOMEDICOES; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; IMOVEL CADASTRADO; LANCAMENTOS; LINHACONTRATO; LINHASMEDICAO | atividades; unidades-de-medida; descricoes-de-medicao; documentos-operacionais; empreiteiros; filiais; fornecedores; imoveis; lancamentos; linhas-de-contrato; linhas-de-medicao | delete; edit; navigate; view | - | - | mapped | - |
| G5- HISTÓRICO ASSOCIAÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | CADASTROTAREFAS | cadastro-de-tarefas | delete; edit; navigate; view | - | - | mapped | - |
| G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; EMPREITEIRO; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; LINHACONTRATO; LINHASMEDICAO | atividades; atividades-executadas; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; empreiteiros; filiais; fornecedores; lancamentos-de-obras; lancamentos; linhas-de-contrato; linhas-de-medicao | create; delete; edit; execute-flow; navigate; submit; view | - | LANCAMENTOSHTML | mapped | - |
| G7- HISTÓRICO TAREFAS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRODIFICULDADE; CADASTROTAREFAS; FORNECEDORES; LANCAMENTOS; LANCAMENTOTAREFAS | atividades; dificuldades; cadastro-de-tarefas; fornecedores; lancamentos; lancamentos-de-tarefas | delete; edit; execute-flow; navigate; submit; view | - | MENSAGEMPROGRAMADA | mapped | - |
| G8- HISTÓRICO FAMÍLIA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO FAMÍLIA_1; CADASTROGRUPO; GRUPO | familias; cadastro-de-grupos; grupos | delete; edit; navigate; view | - | - | mapped | - |
| G9- HISTÓRICO DELEGACAO.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTRODIFICULDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; LANCAMENTOOBRA; LANCAMENTOS; PROFISSÃO; TAREFASDELEGADAS; TAREFASRECORRENTES | atividades; dificuldades; cadastro-de-tarefas; filiais; fornecedores; lancamentos-de-obras; lancamentos; profissoes; tarefas-delegadas; tarefas-recorrentes | delete; edit; execute-flow; navigate; submit; view | - | CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | mapped | - |
| GALERIA TICKETS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES; TICKET MOVIMENTACOES; TICKETS CLIENTES | filiais; fornecedores; lancamentos; notas-pendentes; movimentacoes-de-ticket; tickets-clientes | create; delete; edit; navigate; view | - | - | mapped | - |
| GALERIACONTA.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; LANCAMENTOS | contas; lancamentos | delete; edit; navigate; view | - | - | mapped | - |
| HISTÓRICO FORNECEDORES.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPO; FORNECEDORES; FORNECEDORLOCACAO | cadastro-de-grupos; fornecedores; fornecedores-de-locacao | delete; edit; navigate; view | - | - | mapped | - |
| HISTÓRICO PATOLOGIAS.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CADASTRO CLIENTE_1; FILIAIS; IMOVEL CADASTRADO; LANCAMENTOCOMPRAS; LANCAMENTOS; SACPATOLOGIAS; TIPOPATOLOGIA | clientes; filiais; imoveis; compras; lancamentos; patologias-sac; tipos-de-patologia | delete; edit; navigate; view | - | - | mapped | - |
| HISTÓRICO PRODUTO.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPO; FORNECEDORLOCACAO; LOCACAOPRODUTO | cadastro-de-grupos; fornecedores-de-locacao; produtos-de-locacao | delete; edit; navigate; view | - | - | mapped | - |
| HISTÓRICO TIPO PATOLOGIA.pa.yaml | base:powerapps-form-audit-20260815 | comercial | FILIAIS; LANCAMENTOOBRA; TIPOMARCO; TIPOPATOLOGIA | filiais; lancamentos-de-obras; tipos-de-marco; tipos-de-patologia | delete; navigate; view | - | - | mapped | - |
| HISTORICOTAREFASRECORRENTES.pa.yaml | base:powerapps-form-audit-20260815 | demandas | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; TAREFASDELEGADAS; TAREFASRECORRENTES | atividades; cadastro-de-tarefas; filiais; fornecedores; tarefas-delegadas; tarefas-recorrentes | delete; edit; execute-flow; navigate; view | - | CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | mapped | - |
| I10- GERAL SUPRIMENTOS.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROCONTA; FILIAIS; GRUPO; LANCAMENTOS; SUBFAMÍLIA | contas; filiais; grupos; lancamentos; subfamilias | create; navigate; view | - | - | mapped | - |
| I4- GERAL TAREFAS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FORNECEDORES | fornecedores | execute-flow; navigate; view | - | MENSAGEMPROGRAMADA | mapped | - |
| I6- GERAL RH.pa.yaml | base:powerapps-form-audit-20260815 | rh-obras | ATIVIDADE; ATIVIDADE EXECUTADA; DIÁRIO DE OBRAS; EMPREITEIRO; PROFISSÃO | atividades; atividades-executadas; diarios-de-obras; empreiteiros; profissoes | navigate; view | - | - | mapped | - |
| I7- GERAL COMERCIAL.pa.yaml | base:powerapps-form-audit-20260815 | comercial | CORRETOR; TIPOMARCO | corretores; tipos-de-marco | create; navigate; view | - | - | mapped | - |
| I8- GERAL AUDITORIA.pa.yaml | base:powerapps-form-audit-20260815 | auditoria-compliance | GRUPO; GRUPODOCFILIAL; LANCAMENTOS; LANCAMENTOS AUDITORIA; TIPOS AUDITORIA | grupos; grupos-de-documentos-por-filial; lancamentos; auditorias; tipos-de-auditoria | create; delete; edit; navigate; view | - | - | mapped | - |
| MOVIMENTAÇÃO TICKETS.pa.yaml | base:powerapps-form-audit-20260815 | demandas | FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES; TICKET MOVIMENTACOES | filiais; fornecedores; lancamentos; notas-pendentes; movimentacoes-de-ticket | create; delete; edit; navigate; view | - | - | mapped | - |
| PAGAMENTOS PREVISTOS.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; FILIAIS; FORMAPGTO LOCACAO; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LANCAMENTOS; LOCACAOPRODUTO; NOTASPENDENTES; PREVLOCACOES; RESPONSAVELPGTO | grupos-de-imoveis; filiais; formas-de-pagamento-de-locacao; fornecedores; fornecedores-de-locacao; grupos; lancamentos; produtos-de-locacao; notas-pendentes; previsoes-de-locacao; responsaveis-por-pagamento | delete; edit; execute-flow; navigate; submit; view | - | BOTAOPAGAMENTOS | mapped | - |
| PREVISTO LOCAÇÕES E IARA.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FORMAPGTO LOCACAO; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; PREVLOCACOES; RESPONSAVELPGTO | grupos-de-imoveis; formas-de-pagamento-de-locacao; fornecedores-de-locacao; grupos; produtos-de-locacao; previsoes-de-locacao; responsaveis-por-pagamento | create; navigate; view | - | - | mapped | - |
| RECORRENCIALOCACOES.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | CADASTROGRUPOIMÓVEL; FILIAIS; FORMAPGTO LOCACAO; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LANCAMENTOS; LOCACAOPRODUTO; NOTASPENDENTES; RECORRENTESLOCACOES; RESPONSAVELPGTO | grupos-de-imoveis; filiais; formas-de-pagamento-de-locacao; fornecedores; fornecedores-de-locacao; grupos; lancamentos; produtos-de-locacao; notas-pendentes; recorrencias-de-locacao; responsaveis-por-pagamento | delete; edit; execute-flow; navigate; submit; view | - | BOTAOPAGAMENTOS | mapped | - |
| Screen1.pa.yaml | base:powerapps-form-audit-20260815 | patrimonio-locacoes | ATIVIDADE; CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORNECEDORES; FORNECEDORLOCACAO; GRUPO; LOCACAOPRODUTO; TIPOHOMOLOGACAOLOCACAO | atividades; cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; fornecedores; fornecedores-de-locacao; grupos; produtos-de-locacao; tipos-de-homologacao-de-locacao | create; edit; navigate; view | - | - | mapped | - |
| Screen10.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | ARQUIVOLANCAMENTOS; CADASTROCONTA; FILIAIS; FORNECEDORES; LANCAMENTOS; NOTASPENDENTES | comprovantes-de-pagamento; contas; filiais; fornecedores; lancamentos; notas-pendentes | delete; edit; execute-flow; navigate; view | - | APROVARLANCAMENTOSPORAGRUPAR; LANCAMENTOSHTML | mapped | - |
| Screen11.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTROTAREFAS; FILIAIS; FORNECEDORES; TAREFASRECORRENTES | atividades; cadastro-de-tarefas; filiais; fornecedores; tarefas-recorrentes | navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen12_1.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; novas-cotacoes; orcamentos | navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen12.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; FORNECEDORES; LANCAMENTOOBRA; NOVACOTACAO; ORCAMENTOS | filiais; fornecedores; lancamentos-de-obras; novas-cotacoes; orcamentos | navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen13.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | FILIAIS; LANCAMENTOOBRA; TIPOPATOLOGIA | filiais; lancamentos-de-obras; tipos-de-patologia | navigate; submit; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen2.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; EMPREITEIRO; FORMAPGTO LOCACAO; FORNECEDORES; GRUPO; HOMOLOGARLOCACAO; LANCAMENTOALUGUEL; LANCAMENTOS; TIPOHOMOLOGACAOLOCACAO | cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; empreiteiros; formas-de-pagamento-de-locacao; fornecedores; grupos; homologacoes-de-locacao; lancamentos-de-aluguel; lancamentos; tipos-de-homologacao-de-locacao | create; delete; edit; execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen3.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORMAPGTO LOCACAO; GRUPO | atividades; cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; formas-de-pagamento-de-locacao; grupos | create; execute-flow; navigate; submit; view | - | CRIARLANÇAMENTOALUGUEL | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen4_1.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; DOCUMENTOS_1; GRUPO; HOMOLOGARLOCACAO; LANCAMENTOALUGUEL; LANCAMENTOS; TIPOHOMOLOGACAOLOCACAO | cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; documentos-operacionais; grupos; homologacoes-de-locacao; lancamentos-de-aluguel; lancamentos; tipos-de-homologacao-de-locacao | create; delete; edit; navigate; view | - | - | mapped | - |
| Screen4.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | TIPOHOMOLOGACAOLOCACAO | tipos-de-homologacao-de-locacao | delete; edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen5.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO; LANCAMENTOS; teste | cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; grupos; lancamentos; fonte-teste-legada | create; delete; edit; execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL; HABILITARFILIAL | mapped | - |
| Screen6.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; grupos | delete; navigate; view | - | - | mapped | - |
| Screen7.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | grupos-de-imoveis; cadastro-de-imoveis-locacao; grupos | delete; navigate; view | - | - | mapped | - |
| Screen8.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; GRUPO | grupos-de-imoveis; grupos | delete; edit; navigate; view | - | - | mapped | - |
| Screen9_1.pa.yaml | base:powerapps-form-audit-20260815 | não comprovado | ATIVIDADE; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | atividades; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; grupos | edit; navigate; view | - | - | partial | Módulo funcional não comprovado de forma inequívoca. |
| Screen9_2.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; GRUPO | grupos-de-imoveis; cadastro-de-imoveis-locacao; grupos | edit; navigate; view | - | - | mapped | - |
| Screen9.pa.yaml | base:powerapps-form-audit-20260815 | suprimentos | CADASTRO ALUGUEL; CADASTRO INQUILINO_1; CADASTROGRUPOIMÓVEL; CADASTROIMOVEL; FORMAPGTO LOCACAO; GRUPO | cadastros-de-aluguel; inquilinos; grupos-de-imoveis; cadastro-de-imoveis-locacao; formas-de-pagamento-de-locacao; grupos | edit; navigate; view | - | - | mapped | - |
| TELA INICIAL.pa.yaml | base:powerapps-form-audit-20260815 | dashboard | APONTAMENTOSCOMERCIAIS; ATIVIDADE; ATIVIDADE EXECUTADA; CADASTRO ALUGUEL; CADASTRO CLIENTE_1; CADASTRO INQUILINO_1; CADASTRO TIPO DOCUMENTO; CADASTRODIFICULDADE; CADASTROIMOVEL; CADASTROPRODUTO; CORRETOR; DEMONSTRATIVOETAPA; DESCRICAOMEDICOES; DESCRITIVOPRESENCA; DESPESASRECORRENTES; DIÁRIO DE OBRAS; DOCUMENTOS_1; EMPREITEIRO; FILIAIS; FORNECEDORES; GRUPO; HOMOLOGARFORNECEDOR; HOMOLOGARLOCACAO; IMOBILIZADOS; IMOVEL CADASTRADO; LANCAMENTOALUGUEL; LANCAMENTOCOMPRAS; LANCAMENTOOBRA; LANÇAMENTORECEITA; LANCAMENTOS; LANCAMENTOTAREFAS; NOTASPENDENTES; NOVACOTACAO; ORCAMENTOS; PREVLOCACOES; PROFISSÃO; PROVISÃO PGTOS; TAREFASDELEGADAS; TIPOMARCO | apontamentos-comerciais; atividades; atividades-executadas; cadastros-de-aluguel; clientes; inquilinos; tipos-de-documento; dificuldades; cadastro-de-imoveis-locacao; produtos; corretores; demonstrativos-de-etapa; descricoes-de-medicao; descricoes-de-presenca; despesas-recorrentes; diarios-de-obras; documentos-operacionais; empreiteiros; filiais; fornecedores; grupos; homologacoes-de-fornecedor; homologacoes-de-locacao; imobilizados; imoveis; lancamentos-de-aluguel; compras; lancamentos-de-obras; receitas; lancamentos; lancamentos-de-tarefas; notas-pendentes; novas-cotacoes; orcamentos; previsoes-de-locacao; profissoes; provisoes-de-pagamento; tarefas-delegadas; tipos-de-marco | execute-flow; navigate; view | - | CRIARLANÇAMENTOALUGUEL; CRIARPREVISAOPGTO; LANCAMENTOSHTML | mapped | - |

## Cobertura das fontes do inventário

| Fonte exata | Entidade | Módulo | Capacidades comprovadas | Estado |
|---|---|---|---|---|
| LANCAMENTOS | lancamentos | suprimentos | view; create | mapped |
| CADASTROTIPOMATERIAL | tipos-de-material | suprimentos | view; create; edit | mapped |
| CADASTROURGÊNCIA | urgencias | suprimentos | view; create; edit | mapped |
| CADASTROUNIDADEMEDIDA | unidades-de-medida | suprimentos | view; create; edit | mapped |
| FUNCAOIMOBILIZADO | funcoes-de-imobilizado | suprimentos | view | mapped |
| CONCLUIDOLANCAMENTOS | lancamentos-concluidos | suprimentos | view | mapped |
| DEMONSTRATIVOETAPA | demonstrativos-de-etapa | rh-obras | view | mapped |
| DESPESASRECORRENTES | despesas-recorrentes | suprimentos | view | mapped |
| DESCRICAOMEDICOES | descricoes-de-medicao | rh-obras | view | mapped |
| DIÁRIO DE OBRAS | diarios-de-obras | rh-obras | view | mapped |
| DESCRITIVOPRESENCA | descricoes-de-presenca | rh-obras | view | mapped |
| EMPREITEIRO | empreiteiros | rh-obras | view | mapped |
| FILIAIS | filiais | suprimentos | view | mapped |
| FORNECEDORES | fornecedores | suprimentos | view | mapped |
| GRUPO IMOBILIZADOS | grupos-de-imobilizados | suprimentos | view | mapped |
| IMOBILIZADOS | imobilizados | suprimentos | view | mapped |
| LANCAMENTOOBRA | lancamentos-de-obras | rh-obras | view; create | mapped |
| LANCAMENTOS AUDITORIA | auditorias | auditoria-compliance | view; approve | mapped |
| MENSAGEM PROGRAMADA | mensagens-programadas | demandas | view | mapped |
| PROFISSÃO | profissoes | rh-obras | view | mapped |
| PROVISÃO PGTOS | provisoes-de-pagamento | financeiro | view | mapped |
| SUBFAMÍLIA | subfamilias | suprimentos | view | mapped |
| TAREFASDELEGADAS | tarefas-delegadas | demandas | view; create | mapped |
| TIPO DE TRANSACAO | tipos-de-transacao | financeiro | view | mapped |
| TIPOINCONSISTENCIA | inconsistencias | rh-obras | view | mapped |
| TIPOS AUDITORIA | tipos-de-auditoria | auditoria-compliance | view | mapped |
| CADASTROIMOBILIZADO | cadastro-de-imobilizados | suprimentos | view; create; edit | mapped |
| CADASTROGRUPO | cadastro-de-grupos | suprimentos | view; create; edit | mapped |
| CADASTRODIFICULDADE | dificuldades | demandas | view; create; edit | mapped |
| CADASTROCONTA | contas | suprimentos | view; create; edit | mapped |
| CADASTROCIDADE | cidades | suprimentos | view; create; edit | mapped |
| CADASTRO TIPO DOCUMENTO | tipos-de-documento | auditoria-compliance | view; create; edit | mapped |
| CADASTRO IMPACTO | impactos | demandas | view; create; edit | mapped |
| CADASTRO FAMÍLIA_1 | familias | suprimentos | view; create; edit | mapped |
| CADASTRO CLIENTE_1 | clientes | comercial | view; create; edit | mapped |
| ATIVIDADE EXECUTADA | atividades-executadas | rh-obras | view | mapped |
| ATIVIDADE | atividades | rh-obras | view | mapped |
| APONTAMENTOSFUNCIONARIOS | apontamentos-de-funcionarios | rh-obras | view | mapped |
| ARQUIVOLANCAMENTOS | comprovantes-de-pagamento | suprimentos | view | mapped |
| APONTAMENTO DE PRESENÇA | presencas | rh-obras | view | mapped |
| CADASTROTAREFAS | cadastro-de-tarefas | demandas | view; create; edit | mapped |
| CADASTROSUBFAMÍLIA | cadastro-de-subfamilias | suprimentos | view; create; edit | mapped |
| CADASTROPRODUTO | produtos | suprimentos | view; create; edit | mapped |
| GRUPO | grupos | suprimentos | view | mapped |
| LANCAMENTOCOMPRAS | compras | suprimentos | view; create | mapped |
| CORRETOR | corretores | comercial | view | mapped |
| IMOVEL CADASTRADO | imoveis | patrimonio-locacoes | view | mapped |
| LANCAMENTOTAREFAS | lancamentos-de-tarefas | demandas | view; create | mapped |
| LANÇAMENTORECEITA | receitas | comercial | view; create | mapped |
| TICKETS CLIENTES | tickets-clientes | demandas | view | mapped |
| TICKET MOVIMENTACOES | movimentacoes-de-ticket | demandas | view | mapped |
| COMUNICACOES CLIENTES | comunicacoes-clientes | demandas | view | mapped |
| COMUNICACAO MOVIMENTACOES | movimentacoes-de-comunicacao | demandas | view | mapped |

## Fontes adicionais descobertas

Cada fonte abaixo possui entidade distinta. `mapped-unavailable` significa que a lista foi comprovada como conexão SharePoint, mas nenhuma operação de tela foi encontrada.

| Fonte exata | Entidade | Módulo | Capacidades comprovadas | Estado |
|---|---|---|---|---|
| APONTAMENTOSCOMERCIAIS | apontamentos-comerciais | comercial | view; create; edit; delete | mapped |
| ASSOCIACAOALUGUEL | associacoes-de-aluguel | patrimonio-locacoes | - | mapped-unavailable |
| CADASTRO ALUGUEL | cadastros-de-aluguel | patrimonio-locacoes | view; edit; delete | mapped |
| CADASTRO INQUILINO_1 | inquilinos | patrimonio-locacoes | view; create; edit; delete | mapped |
| CADASTROGRUPOIMÓVEL | grupos-de-imoveis | patrimonio-locacoes | view; create; edit; delete | mapped |
| CADASTROIMOVEL | cadastro-de-imoveis-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| DOCUMENTOS_1 | documentos-operacionais | rh-obras | view; create; edit; delete | mapped |
| FORMAPGTO LOCACAO | formas-de-pagamento-de-locacao | patrimonio-locacoes | view; create | mapped |
| FORNECEDORLOCACAO | fornecedores-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| GRUPODOCFILIAL | grupos-de-documentos-por-filial | auditoria-compliance | view; create; edit; delete | mapped |
| HOMOLOGARFORNECEDOR | homologacoes-de-fornecedor | suprimentos | view; create | mapped |
| HOMOLOGARLOCACAO | homologacoes-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| LANCAMENTOALUGUEL | lancamentos-de-aluguel | patrimonio-locacoes | view; create; edit; delete | mapped |
| LINHACONTRATO | linhas-de-contrato | rh-obras | view; create; edit; delete | mapped |
| LINHASMEDICAO | linhas-de-medicao | rh-obras | view; create; edit; delete | mapped |
| LOCACAOPRODUTO | produtos-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| NOTASPENDENTES | notas-pendentes | suprimentos | view; create; edit; delete | mapped |
| NOVACOTACAO | novas-cotacoes | suprimentos | view; edit; delete | mapped |
| ORCAMENTOS | orcamentos | suprimentos | view; edit; delete | mapped |
| PREVLOCACOES | previsoes-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| PRODUTOALUGUEL | produtos-de-aluguel | patrimonio-locacoes | - | mapped-unavailable |
| RECORRENTESLOCACOES | recorrencias-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| REGISTROMENSAL | registros-mensais | rh-obras | - | mapped-unavailable |
| RESPONSAVELPGTO | responsaveis-por-pagamento | patrimonio-locacoes | view; create | mapped |
| SACPATOLOGIAS | patologias-sac | comercial | view; edit; delete | mapped |
| TAREFASALUGUEL | tarefas-de-aluguel | patrimonio-locacoes | - | mapped-unavailable |
| TAREFASRECORRENTES | tarefas-recorrentes | demandas | view; edit; delete | mapped |
| teste | fonte-teste-legada | suprimentos | view; create | mapped |
| TIPOHOMOLOGACAOLOCACAO | tipos-de-homologacao-de-locacao | patrimonio-locacoes | view; create; edit; delete | mapped |
| TIPOMARCO | tipos-de-marco | comercial | view; create; edit; delete | mapped |
| TIPOPATOLOGIA | tipos-de-patologia | comercial | view; delete | mapped |

## Conexões de fluxo

`connected-only` mantém o fluxo visível no inventário, sem afirmar uma execução não comprovada na tela.

| Fluxo conectado | Artefatos que chamam `.Run()` | Estado |
|---|---|---|
| APROVARLANCAMENTOSPORAGRUPAR | Screen10.pa.yaml | referenced |
| ATIVIDADES | - | connected-only |
| ATUALIZARBI | - | connected-only |
| BOTAOPAGAMENTOS | PAGAMENTOS PREVISTOS.pa.yaml; RECORRENCIALOCACOES.pa.yaml | referenced |
| CHECKLIST | - | connected-only |
| COMPROVANTEPGTO | - | connected-only |
| CONTRATOS | E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml; F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml | referenced |
| CRIARDESCRITIVOPRESENCAPOWERAPPS | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| CRIARLANÇAMENTOALUGUEL | Screen2.pa.yaml; Screen3.pa.yaml; Screen5.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| CRIARPRESENCABOTAO | G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml | referenced |
| CRIARPREVISAOPGTO | F21- CADASTRO DESPESA RECORRENTE.pa.yaml; G19- HISTÓRICOLOCACOES.pa.yaml; G28- HISTÓRICO PAG PREVISTO.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| CRIARPROVISAOPGTOSPOWERAPPS | F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | referenced |
| CRIARTAREFASDELEGADASAPARTIRDETAREFASRECORRENTES-BOTÃOPOWERAPPS | G9- HISTÓRICO DELEGACAO.pa.yaml; HISTORICOTAREFASRECORRENTES.pa.yaml | referenced |
| EMISSÃODIÁRIODEOBRAS | G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml | referenced |
| ENVIOHTML | - | connected-only |
| EXCLUIRDESCRITIVOPRESENCAPOWERAPPS | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| ExcluirLancamentosComBackup | G1- HISTÓRICO LANÇAMENTOS.pa.yaml | referenced |
| FORMULÁRIOFUNCIONÁRIOS | - | connected-only |
| FORMULÁRIOMEDIÇÃO | G31- HISTÓRICO CONTRATOS.pa.yaml | referenced |
| HABILITARFILIAL | Screen5.pa.yaml | referenced |
| HOMOLOGARDOCUMENTOFORNECEDOR | - | connected-only |
| HOMOLOGARFORNECEDOR | - | connected-only |
| LANCAMENTOSHTML | COMPROVANTE ENTREGA EPI.pa.yaml; E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml; F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml; F5- CADASTRO PDF COMPROVANTE PGTO.pa.yaml; G20- HISTÓRICO VENDAS.pa.yaml; G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml; G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml; G28- HISTÓRICO PAG PREVISTO.pa.yaml; G31- HISTÓRICO CONTRATOS.pa.yaml; G33- HISTÓRICO APONTAMENTO PRESENCA.pa.yaml; G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml; G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml; Screen10.pa.yaml; TELA INICIAL.pa.yaml | referenced |
| MENSAGEMPROGRAMADA | G12- HISTÓRICO MSG.pa.yaml; G7- HISTÓRICO TAREFAS.pa.yaml; I4- GERAL TAREFAS.pa.yaml | referenced |
| MENSAGEMPROGRAMADAIMAGEM | - | connected-only |
| PowerAppV2->Createfile,Convertfile,Addattachment | - | connected-only |
| PowerAppV2->Getitems | G1- HISTÓRICO LANÇAMENTOS.pa.yaml; G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| PowerAppV2->Getitems,ParseJSON,Select,Compose | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| PowerAppV2->Updateitem,SendpushnotificationV2 | G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml | referenced |
| REGISTROMENSAL | - | connected-only |
| REGISTROMENSALFUNCIONÁRIOS | - | connected-only |
| RELATORIOPRESENCA | - | connected-only |
| SUBMETERHTMLCONTRATO | - | connected-only |
| SUBMETERLANCAMENTOSJSON | F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml | referenced |
