# Baixa por descritivo de provisão

## Escopo aprovado pelo pedido

O popup e os relatórios de provisões pendentes passam a usar DESCRITIVOPROVISAO. Cada cartão representa um pai, com o somatório exato de todos os filhos PROVISÃO PGTOS cujo campo textual DESCRITIVOPROVISAO corresponde ao ID do pai. O valor de cada filho é QTD × VALOR TOTAL (unitário) + FRETE. Filhos já pagos entram no total, mas não são baixados novamente.

## Contratos e segurança

- Snapshot identificado por `sourceKind: provision-description`, IDs dos pais e `childCount`, `pendingChildIds`, total canônico em string e total formatado. Backend é autoritativo: nunca misturar IDs dos pais com o enriquecimento Graph legado dos filhos.
- Consulta completa e paginada de pais e filhos, sem mascarar falhas como lista vazia ou valores zero. Grupo pendente depende de filhos ainda previstos e não pagos, não somente da data em branco no pai. Pai pago com filho pendente permanece disponível para retomada.
- Valor inválido em grupo completamente consultado aparece como desconhecido com baixa bloqueada, mantendo outros grupos visíveis. Falha de esquema/paginação/transporte continua invalidando a consulta inteira. O campo PGTOAGENDADO do pai é DateTime, preservado; o marcador PAGO pertence aos filhos, não ao pai.
- Opções de baixa têm namespace `provision_description:<ID>`; rascunhos antigos com seleção de filho continuam no caminho legado. Anexos e edição de vencimento do popup usam a lista do pai no novo contrato.
- Data efetiva, forma de pagamento e observação são comuns e perguntadas uma vez. Quantidade, preço, decisão de criar lançamento, senha de substituição, etapa, tipo de despesa e campos faltantes continuam individuais. Anexos novos são associados ao descritivo; anexos existentes não são reenviados.
- Antes da confirmação, preparar todos os itens e exibir descritivo, IDs dos filhos e total. Nenhuma escrita financeira durante preparação.
- Na confirmação, validar novamente vínculo e versões; gravar e verificar DESCRITIVOPROVISAO primeiro, depois os filhos individualmente em ordem de ID. Preservar criação opcional de pedido/lançamento e idempotência existente, com chave derivada do grupo e filho.
- Persistir progresso entre filhos; na repetição conferir efeitos já feitos, não duplicar lançamentos nem sobrescrever pagamentos feitos por outra pessoa. Alteração de vínculo ou valores desde a seleção bloqueia a escrita e mantém o rascunho.

## Implementação e entrega

Usar módulo isolado de agrupamento/coordenação, poucos hooks no workflow existente, consulta no SharePointClient, bridge e adaptação do app. Backend parte de cópia atual de produção com hashes pinados, nunca de candidatos antigos. Deploy com backup recuperável, verificação de deriva, rollback e saúde. Não alterar bancos, credenciais, registros reais nem os 14 blocos de gestos protegidos.

Validar com dados fictícios, testes de múltiplos filhos/total/frete/paginação/concorrência/falha parcial/rascunho legado/anexos, suites Python e mobile, prévia visual e revisão independente. Publicar VM, web/Windows, Google Play interno e TestFlight e verificar resultados reais de cada distribuição.
