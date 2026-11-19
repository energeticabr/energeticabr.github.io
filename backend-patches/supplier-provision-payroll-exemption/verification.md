# Publicação verificada em 19/11/2026

Implementação integrada pelo PR #1161, merge
`e0f48c143b104ea63e2d15a750d56e424d93799d`.

- Regressão reproduzida na baseline: 12 testes, 7 falhas esperadas por ausência da exceção.
- Candidato: 12 testes de comportamento aprovados no Windows e no Linux.
- Instalador: 37 testes aprovados no Linux; 29 no Windows, com 5 skips de recursos Unix/bash.
- Compatibilidade com cadastro/fornecedor do pedido: mesmos 20 testes aprovados e mesmos dois casos antigos não aprovados em baseline e candidato. Casos antigos: `test_actual_portal_replies_back_and_payroll_stay_with_launch_supplier` (`KeyError: item_id`) e `test_submission_creates_order_and_launch_with_separate_suppliers_then_asks_payroll` (fluxo atual conclui em vez de retornar a decisão antiga de folha).
- Revisão independente sem achados funcionais ou de schema. Trava da assinatura: 14 blocos intactos.
- GitHub CI do PR: instalador e trava de assinatura aprovados; runs `44595017743` e `44595017756`.

Manifesto publicado:
`0b5d208a8e9c82d5ebd3b632b2aed7d1b9f9e4cfb2bffa3387ef3fffb39b7522`.

Workflow ativo anterior:
`c630fcee5e140f15a4194235b722ee7eba0e35bfee6a3d3dc33cf8879355728d`.

Workflow ativo após reinício:
`ebff3658bafe31a1b8bf5e9d6dc6ecd459fbe1b09594c5b3543a49802c4946db`.

Espelho preservado:
`123d1dcad16dc4fa8a65502e785eabf7e8eb50193aa6575fadb7df0e1bd02f18`.

Instalador retornou `deployed` e saúde `ok`; backup
`/var/backups/energetica-whatsapp/supplier-provision-payroll-exemption-20261119T190727313324Z`.
Após a publicação: serviço ativo, hash conferido, gate de ingresso liberado,
`/health` com `status: ok`.

Consulta somente de leitura com o código efetivamente instalado confirmou que
os fornecedores relacionados às provisões 493, 456 e 424 têm folha e retornam
lista vazia na validação de provisões. Fornecedor fictício inexistente não
recebeu exceção. Não foram gravados pagamentos, provisões ou estados reais.

O servidor compartilhado atende Android, iOS e Windows/web com os clientes já
instalados. A alteração não modifica bundles e não exige reinstalação.
