# Baixa de provisões por descritivo

O popup e os relatórios do menu Pendências usam `DESCRITIVOPROVISAO`. O valor de cada grupo é a soma decimal exata de `QTD × VALOR TOTAL + FRETE` de todos os itens vinculados em `PROVISÃO PGTOS`, inclusive os já baixados. A baixa modifica somente os filhos ainda pendentes.

## Fluxo

1. Selecionar o descritivo (`provision_description:<ID>`).
2. Revisar quantidade/preço de cada provisão. Data efetiva, forma de pagamento, observação, decisão de lançar todas as linhas e etapa são comuns, solicitadas uma vez.
3. Conferir o resumo de todos os itens; antes da confirmação não há gravação financeira.
4. Gravar e verificar o descritivo, incluindo somatório recalculado e comprovantes novos.
5. Gravar e verificar cada provisão, em ordem numérica. A conversão opcional usa um único pedido e um lançamento por linha, conforme o patch sucessor [`grouped-provision-single-order`](../grouped-provision-single-order/README.md).

`PGTOAGENDADO` no pai é DateTime: sua data de agendamento é preservada. O marcador textual `PAGO` aplica-se somente aos filhos. Campos canônicos de data são resolvidos contra os metadados reais da lista do pai.

O journal durável permite retomar falhas parciais e respostas perdidas, sem repetir filhos confirmados nem criar pedidos/lançamentos duplicados. Após começar a gravação, o grupo e seus comprovantes ficam protegidos contra abandono/alteração até a conclusão. Vínculos, versões ou valores alterados por outra pessoa interrompem a baixa, preservando o rascunho.

A consulta autenticada do app novo solicita `sourceKind: provision-description`. Apps instalados antigos sem essa capacidade continuam recebendo snapshots com IDs de filhos, evitando editar o filho com um ID coincidente do pai enquanto os aparelhos são atualizados. Fontes desconhecidas são recusadas e falhas na fonte agrupada nunca são convertidas em consulta legada.

Grupos completamente lidos, mas com valores inválidos, aparecem com total desconhecido e baixa bloqueada. Nunca converter valores ausentes para zero. Falhas de transporte, esquema e paginação invalidam a consulta inteira.

## Pacote e implantação

`source.patch` contém apenas seis arquivos de código, derivados de uma cópia atual de produção. `deploy-manifest.json` fixa hashes anterior/final e anterior do espelho separadamente. `package.py` gera o diff mecanicamente, sem importar dados de registros, bancos ou credenciais. O instalador recusa deriva, caminhos inesperados e symlinks, verifica a montagem e preserva backup recuperável de produção e espelho.

Em estágio privado `/home/opc/grouped-provision-settlement-20261011-v5`, colocar `deploy.py`, `deploy-manifest.json`, `source.patch`, o bundle privado `source-files.tar` e o instalador compartilhado `backend-patches/launch-payroll-per-payment/deploy.py` como `shared-deploy.py` (hash fixado pelo instalador). O bundle é gerado fora do repositório público e ignorado pelo Git na pasta privada de artefatos, contém só os seis arquivos de código e é validado sem extrair caminhos arbitrários. Não requer Git/patch na VM. Executar:

```
sudo -n python3 /home/opc/grouped-provision-settlement-20261011-v5/deploy.py --check <SHA256_DO_MANIFESTO>
sudo -n python3 /home/opc/grouped-provision-settlement-20261011-v5/deploy.py --deploy <SHA256_DO_MANIFESTO>
```

A checagem não altera código em produção. O deploy altera somente os seis arquivos, reinicia o bridge, verifica ambos os serviços e `/health`, e grava recibo em `/var/backups/energetica-whatsapp/grouped-provision-settlement-*`. Falha restaura as cópias anteriores sem apagar alterações externas concorrentes. Não altera estado de conversa, anexos, registros financeiros nem segredos.

## Testes

`tests/test_deploy.py` é independente do backend e usa diretórios temporários. Os dois testes de consulta/coordenação são snapshots de fixtures fictícias para execução sobre o candidato completo da VM; exigem os módulos worker e `tests/test_workflow.py` da árvore de testes do backend, não credenciais nem conexão real. Consulta live é somente leitura; testes de baixa usam conectores em memória.

Evidências e resultados finais estão no documento de validação da entrega. Não tratar falhas históricas da suíte do espelho como novos erros nem afirmar que a suíte antiga inteira passou.
