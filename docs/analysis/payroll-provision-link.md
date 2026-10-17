# Provisões vinculadas à folha e total PAGO

O desdobramento usa a única IDFOLHA cadastrada para o fornecedor e o mês de referência escolhidos. Uma referência ausente ou ambígua impede o envio; o cadastro da folha continua no fluxo existente. PAGO soma pagamentos dessa referência, inclusive quando efetuados em outro mês.

Cada linha cria um DESCRITIVOPROVISAO, uma PROVISÃO PGTOS e um FOLHAPGTO. A provisão recebe IDFOLHA e nasce com PGTOAGENDADO=PENDENTE e sem DATAPGTOEFETUADO. O pagamento da folha aponta para a provisão; seus valores e situação são consultados nessa origem a cada atualização. A baixa faz a mesma linha contribuir para os totais pagos. Agendamento sem pagamento não compensa. O total considera quantidade × valor unitário + frete e mantém os centavos. Os pagamentos anteriores vinculados a LANCAMENTOS mantêm sua origem. A rubrica é obrigatória em FOLHAPGTO; TIPOPGTO continua opcional na lista de provisões e, quando preenchido, é conferido na leitura.

## Preparação do SharePoint

Ao abrir o desdobramento, a conta Microsoft conectada verifica e cria somente as colunas ausentes:

| Lista | Coluna | Configuração |
| --- | --- | --- |
| PROVISÃO PGTOS | IDFOLHA | Número, opcional, indexado |
| FOLHAPGTO | IDPROVISAO | Número, opcional, indexado, valores exclusivos |
| DESCRITIVOPROVISAO | FOLHAOPERACAO | Texto, opcional, indexado, valores exclusivos |
| PROVISÃO PGTOS | FOLHAOPERACAO | Texto, opcional, indexado, valores exclusivos |

A criação solicita Sites.Manage.All somente se faltar uma coluna. A conta precisa ter permissão e consentimento Microsoft para administrar a lista. A preparação confirma as propriedades por uma nova consulta, recupera respostas perdidas e não cria registros financeiros. Sem a confirmação dos vínculos exclusivos, o envio não começa. IDLANCAMENTO em FOLHAPGTO precisa ser opcional, pois a provisão pode ainda não ter lançamento.

FOLHAOPERACAO identifica a combinação operação/data/rubrica; IDPROVISAO garante apenas um pagamento por provisão. As restrições no servidor protegem retomadas simultâneas, desde a criação do descritivo até o pagamento. Os identificadores técnicos não são editáveis nos formulários móveis. O título APP-folha-provisao-ID identifica a origem para leitura, com conferência de fornecedor, rubrica e folha.

## Compatibilidade e recuperação

As provisões antigas não recebem vínculos por inferência. Rascunhos parcialmente enviados por versões anteriores podem ter registros sem os novos identificadores. A retomada recusa esses registros, preservando os existentes; antes de iniciar outro lote, é necessário conferir e reconciliar os itens já criados. Não se deve apagar o rascunho e reenviar sem essa conferência.

Os testes cobrem criação pendente, pagamento e agendamento, mês de referência, metadados ausentes, falta de permissão, resposta perdida e retomadas simultâneas em todas as etapas. O layout de três colunas é verificado em 320, 589 e 1024 px. As verificações usam repositórios sintéticos e dados de prévia, sem criar pagamentos reais.
