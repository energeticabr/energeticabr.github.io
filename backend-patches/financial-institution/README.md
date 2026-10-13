# Cadastro Instituição

Acrescenta CADASTRO INSTITUIÇÃO após CADASTRO INVESTIMENTO em FINANCEIRO → CADASTROS. Segue Screen16.pa.yaml#Form54: INSTITUICAOEMISSORA (texto) e STATUS (seleção fechada ATIVO/INATIVO). A lista de destino é INSTITUICAOEMISSORA, com Title interno para idempotência. A gravação ocorre após revisão e confirmação. O nome pode ficar em branco, conforme a coluna opcional do formulário original.

A instalação confere o hash de origem, valida a configuração e comprova que apenas a nova ação e o novo fluxo foram adicionados. O investimento e os demais cadastros permanecem intactos. Nenhuma configuração privada completa é versionada.

deploy.sh roda os cinco testes do Form54 e os cinco testes anteriores do investimento, com motor real e adaptadores externos isolados. Depois cria backup protegido, publica a configuração e verifica a saúde, com rollback em caso de falha. Não grava registros fictícios no SharePoint.

Menus e perguntas vêm da VM e atendem os clientes Android, iOS e Windows já instalados, sem mudança do código cliente.
