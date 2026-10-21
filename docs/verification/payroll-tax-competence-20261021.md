# INSS/FGTS — competência e auditoria histórica

## Comportamento

- Rubricas literais INSS e FGTS, com competência confirmada separada da data do pagamento.
- Sugestão: mês calendário anterior à data do pagamento; janeiro sugere dezembro do ano anterior.
- Somente IDFOLHA do funcionário e da competência confirmada pode receber encargos.
- Lote misto mantém a folha salarial separada da folha de encargos; lote só de encargos dispensa uma folha salarial fictícia.
- Formulário de vínculo de lançamento existente grava somente FOLHAPGTO. Não cria obrigação, lançamento ou pedido.
- Grade semanal não oferece encargos em cada sexta; totais mensais e histórico incluem as duas rubricas.

## Auditoria de dados existentes — somente leitura

Coleta de 21/10/2026: 3.378 registros em 36 páginas, nas cinco listas IDFOLHA,
FOLHAPGTO, PROVISÃO PGTOS, LANCAMENTOS e DESCRITIVOPROVISAO. Contagens conferidas
com metadados; páginas completas. Snapshot não transacional.

- Nenhuma linha FOLHAPGTO já classificada INSS/FGTS.
- 16 origens fiscais examinadas: nenhuma com fornecedor individual e competência/folha inequívocos suficientes para backfill automático.
- Guias atuais agregadas não têm rateio por funcionário; algumas origens históricas também não têm folha da competência cadastrada.
- IDPROVISAO tem unicidade no esquema real. Repetir uma provisão agregada em várias folhas não é válido.
- Zero gravações financeiras, zero alterações de esquema/permissões e zero downloads de anexos nesta auditoria.

O vínculo retroativo permanece pendente de demonstrativo individual por funcionário
e competência. Não foram criados rateios, repetidos totais de guias, alterados
valores/status/datas ou antecipados lançamentos de provisões ainda não baixadas.

Snapshot privado: SHA-256 5cd91e522193c6f7e765c94daad5996ec3497564180d3b0d18ea34f220eed26a.
Dados pessoais/financeiros e documentos permanecem fora deste repositório.

## Evidências de desenvolvimento

Testes RED/GREEN cobrem competência histórica/virada do ano, lote misto e somente
encargos, folha alheia/ambígua, página inválida, POST incerto, recuperação e vínculo
de origem já existente. Teste visual usa exclusivamente dados sintéticos, sem POST
em produção. Recibos finais de testes/builds/publicações são registrados na PR.
