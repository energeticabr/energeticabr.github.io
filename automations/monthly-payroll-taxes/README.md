# INSS/FGTS individuais — Power Automate

Este subprojeto gera uma definição WDL com conectores **padrão** SharePoint e
OneDrive for Business. Não usa HTTP premium, não movimenta dinheiro e não cria
lançamentos pagos. Os clientes Android, iOS e Windows leem as listas existentes;
esta automação, isoladamente, não exige uma nova versão binária dos aplicativos.

## Rotina

Dia 01 às 06h Brasília, a partir de 01/11/2026: competência anterior, vencimento
dia 20, um descritivo INSS e um FGTS. Cada fornecedor elegível possui sua própria
provisão e linha FOLHAPGTO, com IDPROVISAO único e o mesmo fornecedor/IDFOLHA.
Produto é PROFISSAO da origem (não CARGO), QTD=1, imóvel TODOS, forma de pagamento
vazia. Provisões permanecem pendentes até a baixa normal; não gravar IDLANCAMENTO
ou DATAPGTOEFETUADO para simular pagamento.

FUNCIONARIOSRH é lida por todas as páginas. A origem é conferida por
IDFORNECEDORORIGEM, e a folha por pessoa e competência. Ausência/duplicidade de
folha, salário sem vigência, cadastro alterado ou regime não coberto bloqueiam o
lote. A automação não inventa nem cria uma folha ausente por suposição.

## Configuração e cálculo

`/ENERGETICA-ENCARGOS-CONFIG.json` no OneDrive da conexão contém `version`,
`confirmed`, `base=SALARIO`, `validFrom`, `validThrough`, `divisor` (30 ou calendar),
`fgtsBps`, `employeeBrackets`, `employerComponents`, `employeeRounding=truncate`
e `employerRounding=truncate`. Taxas são inteiros em pontos-base (800 = 8%).
Nenhum regime patronal é presumido pelo código. Configuração privada e confirmação
do usuário não são incluídas neste repositório. Regras vencidas interrompem o
lote; atualizar a tabela progressiva quando houver nova portaria, sem reaproveitar
silenciosamente faixas de um ano anterior.

SALARIO é a única base; não incluir prêmio, alimentação ou transporte. Salário
proporcional é arredondado a centavos antes dos encargos. A contribuição do
empregado é truncada por faixa; FGTS é truncado por pessoa. Componentes patronais
são totalizados por filial/código e seus centavos residuais distribuídos às maiores
frações (desempate pelo ID de fornecedor), preservando o total do grupo. Filial é
o agrupamento cadastral usado nesta implantação; lotações tributárias diferentes
dentro da mesma filial exigem configuração específica antes de incluí-las.

Para admissão parcial foi adotado mês civil (dias corridos inclusivos / dias reais
do mês), preservando salário integral no mês completo. É uma interpretação
fundamentada, não uma afirmação de que o art.64 impõe um divisor único para toda
admissão; eventual acordo/convenção coletiva específica deve ser observado.

Referências verificadas:

- [Tabela oficial INSS](https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal).
- [MOS eSocial S-1.3, item5.2](https://www.gov.br/esocial/pt-br/documentacao-tecnica/manuais/mos-s-1-3-consolidada-ate-a-no-s-1-3-07-2026.pdf).
- [FGTS Digital, pergunta02.09](https://www.gov.br/trabalho-e-emprego/pt-br/servicos/empregador/fgtsdigital/perguntas-frequentes).
- [Parecer PGE-RS sobre admissão/salário proporcional](https://gestaodepessoas.rs.gov.br/wp-content/uploads/2026/02/Pa21802-25-2000-0125180-4-Dra.-Cristina-Elis-Dillmann.pdf).

## Recuperação e documentos

Um manifesto privado e dois PDFs são reservados no OneDrive sem sobrescrever.
ETags vinculam a recuperação às versões originais. Chaves determinísticas por
competência/tipo/fornecedor e as restrições únicas no SharePoint evitam duplicações.
Cada POST financeiro exige uma intenção durável antes do envio; resposta incerta
é reconciliada por leitura exata, e não por repetição automática. Se não existir
registro confirmado para uma intenção anterior, o fluxo para e solicita conferência.
Registros divergentes e PDFs de conteúdo diferente não são sobrescritos.

Execução manual fora do dia01 gera somente a prévia no namespace separado,
sem descritivos/provisões/FOLHAPGTO. Isso não autoriza a carga inicial: esta possui
plano privado próprio e verificação de ETags/estado pendente antes da substituição.

## Verificação e pacote

```sh
python -m unittest discover -s automations/monthly-payroll-taxes -v
python automations/monthly-payroll-taxes/build_flow.py --output /caminho/privado
```

Mapear somente as conexões existentes no ambiente solicitado. Uma definição
gerada não comprova importação, prévia, ativação nem individualização real.
