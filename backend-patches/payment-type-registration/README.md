# Cadastro de tipos de pagamento da folha

A pergunta `QUAL O TIPO DE PAGAMENTO?` oferece primeiro `➕ CADASTRAR TIPO DE PAGAMENTO`. O usuário informa o nome, confirma e retorna ao seletor na página do tipo cadastrado. A escolha do pagamento continua explícita. Cadastro/cancelamento não postam linhas financeiras e preservam dados, anexos e folhas selecionadas.

O catálogo é `CADASTROTIPOPAGAMENTO`, no mesmo SharePoint utilizado pelo app: nome em TIPOPGTO/Title e identidade normalizada em CHAVE (obrigatória, indexada e única). A auditoria não encontrou catálogo anterior; FOLHAPGTO.TIPOPGTO é Text. A lista foi inicializada com sete opções existentes e os tipos históricos FGTS/INSS, sem alterar a folha.

- Nome obrigatório, até 255 caracteres; duplicidades sem diferença de caixa/acentos.
- Controles de confirmação/cancelamento vinculados a cada revisão do nome; cliques antigos/repetidos não criam outro tipo.
- Paginação com botão de cadastro em todas as páginas, catálogo vazio e falhas explicadas.
- Suporte às escolhas individual e coletiva; checkpoints de pagamentos preservados.

A alteração atua somente em dois arquivos do backend compartilhado de Android, iOS e Windows/web. Os clientes instalados recebem as opções pelo servidor, sem novo binário.

## Verificação e publicação

`PAYMENT_TYPE_SOURCE` aponta a snapshot privado completo com as fixtures históricas `tests/test_workflow.py` (usadas somente nos testes sintéticos).

```sh
PAYMENT_TYPE_SOURCE=/private/candidate python -B test_registration.py -q
python -B test_deploy.py -q
python -B test_schema.py -q
PAYMENT_TYPE_SOURCE=/private/candidate python -B export_fixture.py /private/packets.json
node verify_ui.mjs /private/packets.json /private/screenshots
python -B package.py --baseline /private/baseline --candidate /private/candidate --stage /private/release
```

`Setup-Catalog.ps1` cria apenas a estrutura da lista com a sessão administrativa existente. A conta técnica do aplicativo não tem permissão para criar listas, mas confirmou leitura e gravação após a criação. `setup_catalog.py` valida estrutura e semeia tipos idempotentemente com essa conta técnica. Não alteram registros financeiros.

O instalador fixa hashes dos dois arquivos ativos e do espelho independente. Usa lock compartilhado, gate de entrada, drenagem, backup, instalação atômica, saúde e rollback. O espelho divergente não é sincronizado. Veja verification.md e publication.json para as evidências finais.
