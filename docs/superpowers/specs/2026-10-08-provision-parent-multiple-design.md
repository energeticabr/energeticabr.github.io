# Provisões de pagamento com registro pai

## Resultado solicitado

Antes do vencimento, perguntar o tipo: PROVISÃO COM PRODUTO ÚNICO ou PROVISÃO COM MÚLTIPLOS PRODUTOS. Produto único mantém as perguntas e dados atuais. Múltiplos produtos reutiliza a ideia de linhas sucessivas dos lançamentos: perguntar se deseja adicionar outra linha e quais dados alterar. Mostrar na parte inferior um resumo recolhível das linhas e do total.

Na conclusão, criar um pai em DESCRITIVOPROVISAO e um item por linha em PROVISÃO PGTOS. Cada filho recebe o ID do pai em DESCRITIVOPROVISAO. Quando há fornecedores distintos, exigir a escolha de um deles como referência; caso contrário usar o único fornecedor automaticamente.

## Esquema verificado

Consulta REST somente leitura confirmou as duas listas no site pessoal informado. DESCRITIVOPROVISAO contém FILIAL, FORNECEDOR, VALORTOTAL (Text), OBS, FORMAPGTO, DATAPREVISTOPGTO (DateTime), DATAPGTOEFETUADO, PGTOAGENDADO, DATAPGTOAGENDADO e DATAEXECUCAOAGENDAMENTO (todos DateTime). PROVISÃO PGTOS contém DESCRITIVOPROVISAO (Text).

O campo filho VALORTOTAL tem título VALOR TOTAL, porém o fluxo existente o utiliza como valor unitário. Preservar essa semântica: total da linha = QTD × VALOR TOTAL + FRETE; total do pai = soma exata desses totais. Não substituir os valores unitários dos filhos por totais.

O pai usa filial, vencimento, observação e forma de pagamento da primeira linha/origem. Fornecedor é o de referência. Os quatro campos de pagamento/agendamento do pai ficam nulos, sem sentinela de data ou PENDENTE. Campos atuais dos filhos permanecem inalterados, além do vínculo.

## Estado e persistência

Separar provision_lines dos launch_lines. Estado contém snapshots completos da linha, modo, fornecedor de referência e progresso de gravação. Não criar itens reais enquanto o usuário compõe linhas. Na confirmação final criar pai e filhos com tokens idempotentes estáveis; persistir IDs e verificar dados antes de anunciar sucesso. Falhas parciais permitem retomada sem duplicar pai/filhos nem sobrescrever pagamentos posteriormente efetuados.

Nova linha herda a anterior; o usuário escolhe campos para alterar e pode fazer mais de uma alteração. Revalidar dependências, particularmente imóvel ao trocar filial e frete/observação condicionais. Navegação, rascunhos, recuperação, fluxos antigos em andamento e modo único continuam seguros.

Anexos continuam pelo mecanismo existente após a composição. No modo único permanecem no filho como antes; no modo múltiplo os anexos comuns permanecem no primeiro filho, sem cópias implícitas para outros fornecedores.

Após começar a gravação, congelar metadados e SHA256 dos bytes dos anexos junto do grupo. Bloquear exclusão e compactação no portal, inclusive escolha de prévia já existente; retomadas usam o contrato congelado e não repetem gravações dos filhos confirmados.

## Interface entre VM e app

activeFlow.provisionLines = {id, ownerFlow:"payment", currency:"BRL", count, total, totalDisplay, lines}.
Cada linha: {index, product, quantity, unitPrice, unitPriceDisplay, freight, freightDisplay, total, totalDisplay, details:{supplier,branch,property,paymentMethod,dueDate,observation}}.
Valores numéricos são strings decimais canônicas; textos de moeda são formatados em pt-BR. O resumo é somente leitura; composição/alterações usam as perguntas existentes.

Manter o resumo nos cadastros auxiliares de produto, fornecedor, subfamília, família e grupo quando a VM validar sua origem no pai payment. Não alterar a identidade de navegação do cadastro. No app, aceitar ownerFlow=payment somente para esses cadastros suportados, preservando expansão ao retornar ao mesmo lote; rejeitar fluxos alheios. Payment direto mantém compatibilidade com snapshots anteriores sem ownerFlow.

## Segurança e entrega

Não alterar blocos de gestos de assinatura. Não registrar provisões fictícias nas listas reais para testes. Validar com testes de fluxo e persistência usando doubles no limite SharePoint e conferir a pergunta do app publicado sem concluir um lançamento financeiro. Publicar web/Windows, Google Play interno e TestFlight, com revisão independente e confirmação das publicações.
