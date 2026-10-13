# Cadastros financeiros dentro de seletores de catálogo

As perguntas financeiras que selecionam registros de uma base oferecem
**➕ CADASTRAR** usando o cadastro correspondente já existente no app.
Na configuração atual, o seletor é INSTITUIÇÃO do investimento, baseado em
INSTITUICAOEMISSORA e no cadastro Screen16/Form54. As demais perguntas continuam
com os tipos e as opções dos formulários originais.

Após confirmação e gravação do cadastro auxiliar, o investimento volta com a
instituição selecionada. Respostas, edição de resumo e chave de idempotência do
formulário principal são preservadas. Encerrar o cadastro auxiliar retorna à
pergunta original. Lista vazia, pesquisa e paginação mantêm a opção de cadastro.
Atualizar consulta novamente o catálogo. Respostas de paginação atrasadas não
viram respostas de texto do cadastro auxiliar.
Voltar na primeira pergunta do cadastro auxiliar, antes de preencher, restaura
o formulário de origem sem acionar o descarte automático de rascunho do app.

O adaptador associa os catálogos às cinco bases financeiras por seus metadados;
seleções estáticas não representam cadastros auxiliares. Não altera colunas ou
opções de STATUS nem os outros campos dos modelos PowerApps.

`build_patch.py` exige o hash original antes de produzir `workflow.patch` e o
motor candidato. A configuração completa não é publicada no repositório.
`deploy.py` exige o manifesto com hashes, testa os seis conjuntos de regressão,
faz backup, instala atomicamente nos dois diretórios do servidor, reinicia a
ponte, verifica saúde e hashes e restaura os arquivos em caso de falha.
`deploy_back_return.py` usa o mesmo instalador e fixa os hashes da primeira
publicação, com `back_return_manifest.json`, para publicar a correção de retorno.

O fluxo reside na API compartilhada pelo app Web/Windows, Android e iOS; a
publicação é no servidor e não exige novo pacote nas lojas. Os testes usam
adaptadores em memória e não criam dados financeiros reais.
