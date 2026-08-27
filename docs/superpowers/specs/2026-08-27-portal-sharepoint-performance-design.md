# Portal SharePoint Leve - Design

## Objetivo

Reduzir o tempo de entrada e de abertura das telas administrativas sem duplicar dados. O Power Apps permanece como evidência de regras de negócio; o SharePoint permanece como fonte exclusiva de listas, nomes exibidos, colunas, tipos, choices, registros e anexos.

## Princípios

- Os aliases técnicos do catálogo servem somente para localizar listas e colunas no SharePoint.
- Todo rótulo físico mostrado ao usuário vem de `list.displayName` ou `column.displayName` retornado pelo SharePoint.
- Choices e relacionamentos são consultados no SharePoint quando o campo é usado.
- Regras derivadas do Power Apps incluem ordem, visibilidade, obrigatoriedade adicional, dependências, filtros fixos, defaults e fluxo de submissão; elas não substituem metadados físicos.
- Nenhuma lista completa é carregada antes do primeiro lote visível da galeria.

## Arquitetura

### Entrada e rotas

`portal/app.js` mantém apenas autenticação, autorização, shell, catálogo leve e roteamento. Páginas de auditoria, relatórios, analytics, acessos, galeria, formulário e detalhe são importadas dinamicamente quando a rota correspondente é aberta.

O menu de módulos não consulta o catálogo pesado do Power Apps para decidir se mostra um botão. Ele usa a capacidade leve da entidade; a validação completa do formulário ocorre apenas quando o usuário abre o lançamento.

### Contrato Power Apps compacto

O gerador mantém o arquivo de evidências completo para testes e auditoria, mas produz um artefato de runtime sem evidências duplicadas nem fórmulas já convertidas em estruturas. O navegador recebe somente regras executáveis.

### SharePoint sob demanda

Ao abrir uma galeria, a ordem é: resolver a lista, ler suas colunas, montar o contrato usando os nomes internos validados e carregar o primeiro lote. As opções globais de filtros são carregadas depois da primeira renderização e ficam em cache durante a sessão.

Ao abrir um ComboBox, as opções são pesquisadas no SharePoint a partir de uma letra, respeitando as dependências comprovadas pelo Power Apps. Choices usam os valores atuais da coluna SharePoint.

### Cache e invalidação

Listas e colunas usam o cache de metadados já existente por sessão. Registros não são persistidos no navegador. Criação, edição e exclusão invalidam apenas filtros e páginas da entidade afetada. Logout limpa todos os caches.

## Tratamento de falhas

- Falha em opções de filtro não bloqueia a primeira página da galeria.
- Falha de uma rota é exibida dentro da área de conteúdo e não derruba o shell.
- Metadado ausente no SharePoint fecha o campo e informa o diagnóstico; o portal não inventa coluna nem opção.
- Cancelamento de rota aborta consultas ainda em andamento.

## Critérios de aceite

- O catálogo Power Apps de aproximadamente 7 MB não participa do carregamento inicial nem das páginas de módulo.
- Dashboard e módulo abrem sem baixar módulos de galeria, formulário, relatórios ou analytics.
- A primeira página da galeria aparece antes da varredura das opções de filtro.
- Títulos de bases, labels, tipos e choices exibidos são provenientes do SharePoint.
- As regras e dependências comprovadas do Power Apps continuam cobertas pelos testes existentes.
- A suíte integral permanece verde e há testes específicos para importação sob demanda, ordem das consultas e origem dos metadados.
