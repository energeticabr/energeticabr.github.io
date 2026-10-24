# INSS/FGTS: conclusão cadastral, galeria e auditoria do fluxo

## Autoridade e estado verificado

O usuário pediu verificar o vínculo ponta a ponta, concluir a galeria e todos os
pedidos pendentes deste tema. A revisão anterior de cadastro/galeria, PR556
(`ce4097db`), nunca foi publicada. A lista FUNCIONARIOSRH existe, tem os 27 campos
explícitos e está vazia; confirmado novamente com a identidade já usada pelo serviço.
INSS/FGTS por competência e vínculo automático do lançamento foram integrados em
PR557/PR587. Isso não comprova individualização histórica nem rotina mensal.

O histórico recuperado contém pedidos posteriores ao desenho de base vazia:
uma carga inicial de sete pessoas nomeadas, com cargo e admissão fornecidos;
uma primeira competência excepcional e execução futura no dia 01. Esses pedidos
posteriores autorizam somente a carga inicial explicitamente delimitada, não uma
importação geral ou sincronização periódica de fornecedores. Os dados identificáveis
e o manifesto dessa carga permanecem privados, fora do repositório.

## Abordagem e limites

Reaproveitar as partes verificadas da PR556, integrando cirurgicamente na main atual.
Não substituir os arquivos compartilhados inteiros nem aplicar seu pacote antigo
na VM: isso removeria correções recentes. Conservar implementações independentes
da VM e do espelho. Uma reescrita completa acrescentaria risco sem mudar o contrato.

Esta entrega contém o cadastro/galeria e a conclusão controlada das operações
autorizadas. Não inventa salário, incidência, rateio, desligamento, competência ou
pagamento. A rotina mensal não pode postar valores sem os dados efetivos que a
fundamentam. Perguntas financeiras indispensáveis podem ser feitas sem interromper
as partes técnicas independentes. Transferências bancárias não fazem parte do escopo.

## Cadastro futuro e galeria

- Novo cadastro EMPREITEIRO=SIM pergunta um cargo dentre SERVENTE DE PEDREIRO
  I/II/III, PEDREIRO I/II/III, MESTRE DE OBRAS, SUPERVISOR DE OBRAS e depois admissão,
  uma pergunta por etapa, independentemente de CLT/TERCEIRIZADO/INFORMAL.
- Após confirmar o fornecedor novo SIM/ATIVO, criar uma única linha FUNCIONARIOSRH,
  com IDFORNECEDORORIGEM único/indexado, respostas e arquivos locais desse cadastro.
  Admissão/desligamento são campos do destino, não novas colunas de FORNECEDORES.
- Prova durável de fluxo iniciado após ativação e recibo antes do primeiro POST.
  Sessões antigas ou POST incerto não autorizam importação ou repetição cega.
  Preservar bytes, nomes e ordem dos anexos e exigir reenvio idêntico se necessário.
- Galeria FUNCIONÁRIOS RH imediatamente abaixo de Presenças, sem criação independente.
  Carregar o destino paginado, busca/filtros, detalhes dos 27 campos e metadados de
  auditoria disponíveis; cargo e datas destacados; vazio/erro explícitos.
- Cargo/datas editados somente no destino. Inativação de vínculo existente exige
  desligamento válido, não anterior à admissão, e confirma STATUS nas duas listas.
  Antigo sem vínculo não é importado por editar STATUS.
- Toda leitura de origem nesse editor fica restrita à identidade/STATUS/EMPREITEIRO/ETag,
  incluindo o readback do adaptador. As chamadas de outros consumidores não mudam.
- Salvamento parcial, ETag 412, rede incerta e recriação da página devem permitir
  retomada/reconciliação do mesmo item e intenção, sem sobrescrever conflito alheio.
  Persistir o diário mínimo por site/conta antes da mutação; indisponibilidade bloqueia
  uma nova mutação. A galeria e o portal precisam expor recuperação de conflito.
- Preservar os menus SIM/NÃO de homologação/WhatsApp recém-corrigidos e os blocos
  SIGNATURE_GESTURE_LOCK_START/END, sem atualizar fingerprints.

## Carga inicial e encargos

- Carga inicial: exatamente os sete nomes/cargos/admissões do pedido posterior,
  identidade inequívoca por cadastro e chave única; não varrer/copiar os demais.
  Conferir STATUS e os campos de origem autorizados, preservar branco e campos
  próprios do destino. Registrar recibos duráveis e confirmar cada destino.
- Auditar novamente IDFOLHA, FOLHAPGTO, LANCAMENTOS, PROVISÃO PGTOS e DESCRITIVOPROVISAO
  com GETs e paginação íntegra. Um vínculo exige mesma pessoa, competência e rubrica;
  ausência/duplicidade de folha ou origem agregada não admite rateio presumido.
- Encargos mensais usam competência anterior, vencimento dia 20 do mês de execução,
  dois descritivos (INSS/FGTS), uma linha por fornecedor elegível, produto PROFISSAO,
  filial cadastrada, imóvel TODOS, forma de pagamento vazia, QTD=1 e PDF detalhado.
  A operação recorrente pedida é Power Automate no dia 01, não trocar de scheduler.
- Base salarial/incidências e cargo sem salário são pendências de dados a conferir.
  Guias agregadas existentes não podem ser duplicadas por uma nova primeira carga.
  Preparação/relatórios e bloqueios explícitos não são apresentados como automação
  ativa, vínculo histórico gravado ou cálculo financeiro concluído.

## Verificação e publicação

Testes RED/GREEN com componentes/transportes reais e dados sintéticos. Nenhum
funcionário fictício ou pagamento real será criado para QA. Revisão por tarefa e
do conjunto, suíte geral, assinatura, builds. Backend com CAS, bloqueios, backup,
saúde e leitura independente. Publicar e confirmar Windows/web, Android internal
e iOS TestFlight da mesma revisão. Abrir a galeria publicada. Listar toda pendência
real remanescente e o dado/decisão necessária; não declarar tudo pronto se faltar.
