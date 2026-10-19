# Um pedido por descritivo na baixa agrupada

Supersede a conversão individual em pedido/lançamento do patch histórico `grouped-provision-settlement`, sem alterar a baixa legada de uma provisão selecionada individualmente.

## Contrato atual

- Revisar os valores de cada provisão, mantendo os dados de pagamento comuns.
- Exibir o resumo de todas as linhas revisadas e perguntar uma única vez se todas devem ser adicionadas a `LANCAMENTOS`.
- Se SIM, perguntar `ETAPA` uma vez e aplicá-la a todas as linhas. O tipo de despesa continua específico do produto; não copiar o último produto para os demais.
- Antes da confirmação financeira final, não gravar pedido nem lançamento.
- Na confirmação, manter a coordenação pai/filhos, criar/verificar um único `NOTASPENDENTES` com o total das linhas convertidas e criar um `LANCAMENTOS` por provisão. Todos usam o mesmo pedido em `AGRUPAR` e `IDPEDIDO`; cada linha mantém seu `IDPGTOAGENDADO` e `IDLANCAMENTOS` próprios.
- Persistir a intenção e o pedido comum no journal. Retomadas e respostas perdidas não criam outros pedidos. Não sobrescrever silenciosamente pedidos alterados por outra pessoa.
- Rascunhos antigos ainda sem gravação que optaram por novos lançamentos precisam confirmar a decisão do grupo. Journals antigos já iniciados com criação individual e descritivos com pedidos preexistentes conflitantes param para conferência, em vez de gerar mais pedidos.
- Uma única nota/pedido exige fornecedor e filial compatíveis. Inconsistência bloqueia antes de gravação financeira.

## Implantação

Alteração somente no runtime Python compartilhado por Android, iOS e web/Windows. Não requer alteração do contrato do aplicativo nem nova build nativa para consumir o fluxo.

`source.patch` contém somente os dois arquivos alterados. `deploy-manifest.json` fixa hashes de produção, espelho, candidato, patch e bundle privado. O bundle completo fica fora do Git. O instalador reutiliza as verificações de deriva, escopo, backup recuperável, saúde e rollback do fluxo anterior. Não modifica estado de conversa, registros ou credenciais.

Preparar `/home/opc/grouped-provision-one-order-20261019` com os arquivos do pacote, `source-files.tar` privado e o instalador compartilhado de `backend-patches/launch-payroll-per-payment/deploy.py` como `shared-deploy.py`. Executar `deploy.py --check <sha256_do_manifesto>` antes de `--deploy` com o mesmo hash. Conferir recibo, hashes e saúde dos serviços.

## Verificação

`tests/test_single_order.py` e `tests/test_group_flow.py` executam o código real do backend com conectores sintéticos e a configuração atual. Definir `ENERGETICA_BACKEND_TEST_ROOT` para a cópia completa de testes. `tests/test_deploy.py` testa o instalador em diretórios temporários, sem servidor ou SharePoint.

Uma correção de dados já existentes exige auditoria e plano privados separados: preservar lançamentos e anexos, conferir referências inversas e versões, atualizar somente os vínculos e o total agregado, e verificar os itens removidos na lixeira. Não incluir registros reais ou credenciais neste pacote público. A [documentação Microsoft](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest) descreve as atualizações condicionais de itens por ETag.
