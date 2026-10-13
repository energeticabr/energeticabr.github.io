# Financeiro e Cadastro Investimento

Adiciona o caminho FINANCEIRO → CADASTROS → CADASTRO INVESTIMENTO na tela inicial, usando o mecanismo de cadastros do app. O contrato é `Screen15.pa.yaml#Form45`: INSTITUICAO, DESCRICAO, TIPO, INVESTIMENTO, TRIBUTAÇÃO, RENTABILIDADE, LIQUIDEZ, RISCO e PRAZO, nessa ordem. Instituição é selecionada da lista INSTITUICAOEMISSORA; prazo é uma data e os demais campos são texto. Campos opcionais da base podem ficar em branco. Não há entrada de Title, que permanece a chave interna de idempotência.

Grava em CADASTRO INVESTIMENTO somente após revisão e confirmação do usuário. O seletor de instituição rejeita valores fora da base. O instalador confere o hash da configuração atual e comprova que todas as configurações anteriores permanecem intactas, descontando apenas as quatro adições. A configuração completa de produção não é incluída no repositório.

Os cinco testes exercitam os métodos reais do motor instalado, com persistência, mensageria e SharePoint isolados: navegação, contrato dos controles, instituição inexistente, preenchimento completo até revisão sem postagem e retorno ao menu Financeiro. A implantação valida a configuração, executa os testes, cria backup protegido e restaura em caso de falha de saúde.

Esta mudança é servida pela VM aos clientes Android, iOS e Windows, sem alterar o código instalado nem os gestos protegidos. Não executar o instalador antigo novamente após implantação: a verificação do hash impede sobrescrever alterações posteriores.
