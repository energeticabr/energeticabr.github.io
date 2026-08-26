# Portal administrativo Microsoft e SharePoint

Data: 26/08/2026

## Objetivo

Substituir integralmente a area administrativa atual por um portal interno da Energetica, acessivel somente por contas Microsoft autorizadas. O novo portal deve reproduzir e organizar as funcoes existentes no Power Apps, mantendo o SharePoint como fonte unica dos dados e sem alterar o aplicativo original.

## Escopo aprovado

- Manter o site publico existente.
- Remover o login administrativo por e-mail e senha do Supabase.
- Iniciar o acesso administrativo exclusivamente pelo login Microsoft.
- Definir `bernardonotini@energeticabr.com` como superadministrador inicial.
- Permitir ao superadministrador criar, ativar, inativar e remover acessos.
- Controlar permissoes por modulo e por acao: visualizar, cadastrar, editar, excluir e aprovar.
- Replicar no portal as areas e operacoes relevantes do Power Apps.
- Nao alterar o Power Apps durante o levantamento ou a migracao.
- Usar o SharePoint como base principal, sem duplicar os registros operacionais no Supabase.

## Arquitetura

O site publico permanece hospedado no endereco atual. A area administrativa passa a usar Microsoft Entra ID para autenticacao e Microsoft Graph com permissoes delegadas do proprio usuario para acessar as listas do SharePoint. Segredos, credenciais de aplicacao e permissoes de aplicacao nao serao colocados no HTML ou no JavaScript entregue ao navegador.

O portal tera quatro camadas:

1. Interface administrativa responsiva, com identidade da Energetica.
2. Autenticacao Microsoft, sessao e token delegado do usuario.
3. Microsoft Graph, que aplica as permissoes efetivas da conta autenticada.
4. SharePoint como fonte unica para registros, anexos, historicos, grupos e configuracoes de acesso.

O Supabase deixa de participar do login administrativo e nao sera usado para replicar as novas bases do portal. A retirada das dependencias antigas sera feita de forma controlada, preservando temporariamente somente o que ainda nao tiver sido migrado.

## Autenticacao e acesso

A pagina administrativa exibira uma apresentacao curta com o logotipo oficial, o mascote e um unico comando: `Entrar com Microsoft`. Quando o usuario ja possuir uma sessao valida, o portal seguira diretamente para o painel inicial.

O superadministrador inicial sera reconhecido pelo e-mail `bernardonotini@energeticabr.com`. Os demais usuarios dependerao de um cadastro ativo na lista `PORTAL_ACESSOS`.

A lista de acessos contera, no minimo:

- e-mail Microsoft;
- nome de exibicao;
- status ativo ou inativo;
- perfil base;
- permissoes por modulo;
- permissoes por acao;
- criador e data de criacao;
- ultimo editor e data de alteracao.

O portal negará acesso por padrao quando uma permissao nao estiver definida. Ocultar um botao nao sera considerado seguranca: as permissoes das listas e grupos do SharePoint serao a barreira efetiva para consulta e alteracao dos dados.

## Modulos do portal

O inventario do Power Apps identificou 129 telas e aproximadamente 50 fontes do SharePoint. Elas serao consolidadas nos seguintes modulos:

### Painel inicial

- indicadores por area;
- tarefas, pagamentos, contratos, inconsistencias e documentos pendentes;
- atalhos conforme as permissoes do usuario;
- atividades recentes.

### Suprimentos

- lancamentos de compra;
- pedidos, cotacoes e orcamentos;
- fornecedores;
- produtos, familias e subfamilias;
- contas, grupos, cidades e unidades de medida;
- comprovantes de pagamento;
- imobilizados e despesas recorrentes.

### Demandas

- tickets e movimentacoes;
- tarefas e tarefas recorrentes;
- delegacoes;
- e-mails programados;
- associacoes e historicos.

### Comercial

- clientes;
- imoveis;
- corretores;
- contratos e vendas;
- receitas;
- apontamentos comerciais;
- SAC e patologias;
- homologacoes e documentos comerciais.

### Financeiro

- pagamentos previstos e efetuados;
- provisoes;
- receitas;
- despesas recorrentes;
- contas e agrupamentos;
- consultas e conciliacao operacional.

### RH e obras

- presenca e apontamentos de funcionarios;
- atividades executadas;
- diario de obras;
- inconsistencias;
- profissoes;
- contratos de empreiteiros;
- etapas de obra;
- medicoes e linhas de medicao;
- entrega de EPI e documentos.

### Patrimonio e locacoes

- grupos de imoveis;
- imoveis e inquilinos;
- contratos de aluguel;
- pagamentos e recorrencias;
- fornecedores e produtos relacionados;
- homologacao de documentos.

### Auditoria e compliance

- auditorias;
- tipos de auditoria;
- grupos e tipos de documento;
- documentos e homologacoes;
- trilha de alteracoes e exclusoes.

### Usuarios e acessos

- usuarios autorizados;
- permissoes por modulo e acao;
- ativacao e inativacao;
- historico de alteracoes de acesso.

## Padrao das paginas

Cada area usara uma estrutura consistente:

- cabecalho compacto com nome da area e acoes principais;
- indicadores relevantes, sem excesso de cartoes;
- filtros persistentes;
- tabela ou galeria para consulta;
- formulario aberto apenas quando o usuario escolher criar ou editar;
- pagina de detalhes para registros complexos;
- anexos ligados ao registro correto;
- confirmacao antes de exclusoes;
- notificacao visual apos cada operacao.

As paginas serao geradas por um catalogo de modulos e entidades. Cada entidade definira fonte SharePoint, campos, filtros, colunas, validacoes e permissoes. Isso reduz repeticao e permite incluir novas listas sem reconstruir todo o portal.

## Fluxo de dados

1. O usuario entra com a conta Microsoft.
2. O Microsoft Graph valida o token delegado e identifica o e-mail.
3. O superadministrador recebe acesso integral; outros usuarios sao validados em `PORTAL_ACESSOS` e nos grupos de permissao do SharePoint.
4. O menu mostra somente modulos autorizados.
5. Consultas e alteracoes passam pelo Microsoft Graph usando a identidade do usuario.
6. O SharePoint valida a permissao efetiva antes de liberar a acao.
7. O SharePoint grava o item, anexos e metadados.
8. O portal atualiza a tela sem recarregar ou redirecionar desnecessariamente.

## Auditoria e seguranca

- Nenhuma chave secreta sera exposta no repositorio ou no navegador.
- O usuario inativo perdera acesso na proxima validacao de sessao.
- Exclusoes relevantes serao registradas antes da remocao quando a lista permitir.
- Alteracoes sensiveis registrarao usuario, data, valor anterior e valor novo.
- O acesso aos dados dependera simultaneamente da identidade Microsoft e das permissoes internas.
- Acoes administrativas dependerao das permissoes delegadas da conta e dos grupos do SharePoint.
- Caso uma camada serverless seja contratada no futuro, o catalogo e a interface permitirao acrescenta-la sem reconstruir as paginas.

## Tratamento de erros

- Sessao expirada: solicitar nova autenticacao Microsoft.
- Usuario sem acesso: exibir pagina institucional de acesso nao autorizado.
- Permissao insuficiente: bloquear a acao e informar o modulo necessario.
- Falha temporaria do SharePoint: manter o formulario preenchido e oferecer nova tentativa.
- Conflito de edicao: informar que o registro foi alterado por outra pessoa e recarregar os dados atuais.
- Anexo invalido: informar formato e limite antes do envio.

## Migracao

A migracao sera incremental, mas o usuario percebera uma unica nova area administrativa:

1. base visual, login Microsoft e sessao;
2. usuarios, acessos e auditoria;
3. painel inicial e catalogo de modulos;
4. cadastros mestres compartilhados;
5. Suprimentos e Financeiro;
6. Demandas e Comercial;
7. RH/Obras, Patrimonio/Locacoes e Auditoria;
8. retirada das dependencias administrativas antigas do Supabase;
9. validacao final com comparacao contra o Power Apps.

As telas sem nome ou duplicadas do Power Apps nao serao copiadas literalmente. Suas funcoes serao incorporadas nas entidades correspondentes, evitando telas obsoletas e caminhos repetidos.

## Verificacao

- testes de login, sessao e encerramento;
- testes de permissao para cada acao;
- testes de consulta, criacao, edicao e exclusao por entidade;
- testes de anexos;
- testes de conflito e falha do SharePoint;
- verificacao responsiva em desktop e celular;
- comparacao funcional com cada grupo de telas do Power Apps;
- confirmacao de que nenhuma rota administrativa antiga permite contornar o login Microsoft.

## Resultado esperado

O portal administrativo substituira a navegacao fragmentada do Power Apps por uma experiencia web consistente, mantendo as mesmas bases e operacoes essenciais. O administrador podera controlar quem acessa cada area, e os usuarios autorizados poderao consultar, cadastrar e editar dados do SharePoint conforme suas permissoes.
