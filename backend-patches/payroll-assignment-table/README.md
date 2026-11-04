# Tabela dos pagamentos em atribuição

As perguntas de IDFOLHA e tipo de pagamento exibem ID, FORNECEDOR e VALOR TOTAL. A atribuição individual mostra somente a linha atual; a coletiva mostra os pagamentos selecionados ainda afetados pela escolha. O valor reutiliza o cálculo existente com quantidade, valor unitário e frete. A baixa usa o ID da provisão; lançamentos usam seu próprio ID.

O servidor envia `detail_table.kind = payroll_assignment` somente nas etapas de folha/tipo dos fluxos `launch` e `payment_settlement`. O texto mantém uma tabela simples para clientes antigos e outros canais. O cliente atualizado apresenta uma tabela semântica, escapa os valores e retira somente as linhas desse fallback, preservando instruções posteriores. Nomes longos quebram linha; a tabela possui seu próprio contêiner de rolagem.

Na seleção individual de folha, `_display_step` reconstrói a tabela a partir da linha atual do rascunho em cada página/filtro. Na retomada coletiva, pagamentos com checkpoint verificado ficam fora da tabela. Respostas, tipos, vínculos de mês e operações financeiras permanecem no fluxo existente.

## Verificação e publicação

Os testes de integração usam os handlers reais e os fixtures sintéticos do pacote `payroll-batch-assignment`, sem registros financeiros reais. Os testes do instalador não precisam do backend privado:

```sh
python -B -m unittest discover -s backend-patches/payroll-assignment-table/tests -p test_deploy.py -v
```

O pacote transforma somente `worker/workflow.py` e `channel_bridge.py`, com hashes independentes de produção/mirror e preservação de LF/CRLF. O instalador usa o gate, lock compartilhado, backup, troca atômica, saúde e rollback existentes. O diretório de execução pertence a root e recusa escrita por grupo/outros. O manifesto é argumento obrigatório; configurações, estados, anexos e dados financeiros não fazem parte da instalação.

A apresentação depende do componente compartilhado do app. A publicação inclui web/Windows, Google Play internal e TestFlight, com evidência separada para cada plataforma.
