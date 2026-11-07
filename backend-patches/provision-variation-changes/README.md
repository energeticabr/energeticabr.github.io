# Antes e depois nas variações da provisão

A etapa `choosing_provision_variation` compara os campos da linha atual com a última linha salva e envia uma tabela opcional `change_table.kind=provision_variation_changes`. São três colunas: Dado alterado, Antes e Depois, com uma linha por campo diferente. Alterações repetidas mantêm o antes original e o depois atual; reverter remove a linha. Sem diferenças, a tabela fica oculta.

Campos: vencimento, fornecedor, filial, imóvel, forma de pagamento e observação. Datas usam o dia civil em pt-BR e vazios usam EM BRANCO. Produto, quantidade, valor unitário e frete não entram nessa comparação dos campos herdados. O histórico da linha anterior, anexos, seleção e gravação financeira permanecem inalterados.

## Verificação

`test_variation.py` usa motor e ChannelMessenger reais com armazenamento e catálogo sintéticos. Cobre os seis campos, branco/data, alteração/reversão, retomada, ausência de metadados em outros fluxos e edição real de filial com a pergunta dependente de imóvel antes do retorno.

Os testes de motor requerem o snapshot privado do backend e a fixture `multi-provision-first-freight/tests/test_first_freight.py`. No estágio privado, `CANDIDATE=1` testa os módulos candidatos; sem a variável, testa os instalados.

`python -B -m unittest discover -s backend-patches/provision-variation-changes/tests -p test_deploy.py -v` verifica o instalador isoladamente: fontes independentes, CRLF/LF, deriva de fontes/pacote, symlinks, backups, rollback integral e preservação de alterações concorrentes sem impedir a restauração dos outros arquivos.

Frontend: `tests/provision-variation-changes.test.mjs` e `tests/provision-variation-changes-browser.test.mjs`. A fixture usa dados fictícios e verifica as três colunas, ordem antes dos botões, escape HTML, ações e quebra de nomes longos em 320, 390 e 1365 px.

## Publicação

O patch altera somente `worker/payment_provision_flow.py`, `worker/workflow.py` e `channel_bridge.py` em produção e no espelho, mantendo os hashes e finais de linha independentes. Pacote verificado por manifesto SHA-256, instalado em diretório root com lock, gate/drain, backup, substituição atômica, restart e health check. A UI precisa ser publicada em web/Windows, Google Play interna e TestFlight.
