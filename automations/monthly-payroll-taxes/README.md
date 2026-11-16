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

O campo Sim/Não `CONCILIARSALARIOFAMILIA` de `FUNCIONARIOSRH` sinaliza
a conciliação mensal. Provisões e memórias de INSS identificam o vínculo
marcado. A coluna deve existir com padrão Não antes da publicação.
Manifestos anteriores aceitam o campo ausente.

A configuração privada opcional `salaryFamily` identifica um único vínculo por
`employeeId` de RH e informa `quotas`, `quotaCents`, `limitCents` e `year`.
O benefício previsto exige o vínculo também sinalizado, a competência no ano
da tabela e o salário mensal cadastrado dentro do limite. No mês de admissão,
a cota é proporcional. O cálculo usa a base de salário do fluxo. Outras verbas,
vínculos simultâneos e mudanças na elegibilidade dos dependentes devem ser
refletidos no fechamento oficial. Atualize as cotas elegíveis e a tabela na
configuração privada quando houver mudança.
A memória e as provisões apresentam o líquido previsto. O manifesto preserva
os componentes brutos para comparação com a declaração oficial.

## Conciliação do salário-família

No descritivo de INSS da competência, anexar o **XML de Saída** obtido em
**Relatórios** na DCTFWeb após a transmissão. O serviço
`energetica-inss-dctfweb.timer` consulta os anexos a cada 30 minutos na OCI.
O arquivo informa o valor vinculado de salário-família no código 1082-01.
O serviço compara o bruto e o líquido dos códigos da folha com o manifesto
original. Com um único vínculo marcado, aplica o crédito na provisão desse
trabalhador, no vínculo FOLHAPGTO e no descritivo, substituindo o crédito
previsto pelo apurado. A observação informa o crédito e o recibo. Divergências de valor, outros abatimentos nos códigos da
folha e valores já agendados ou pagos exigem conferência. A retenção de
prestador (1162) segue a provisão própria.

O agendamento usa os dois arquivos systemd deste diretório e o Python do
serviço SharePoint existente. Instalar os dois módulos em
`/opt/energetica-inss-dctfweb` e criar a pasta privada de estado
`/var/lib/energetica-whatsapp/inss-dctfweb`. Em
`/etc/energetica-inss-dctfweb.env`, configurar `ENERGETICA_DCTFWEB_CNPJ`
e `ENERGETICA_DCTFWEB_FROM` (competência inicial, AAAA-MM). O estado
registra o recibo e a intenção de atualização antes da escrita e permite
retomar alterações parciais sem aplicar o crédito novamente. O executor
usa os documentos anexados ao descritivo. A obtenção dos XML diretamente
da DCTFWeb requer uma fonte autenticada, como o Integra Contador.

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

Os nomes de arquivos de intenção substituem os dois-pontos das chaves por
hífens antes da codificação da URI. O OneDrive decodifica nomes recebidos pelo
conector e recusa dois-pontos, mesmo quando enviados como `%3A`. Leitura,
reserva, criação e preflight usam a mesma transformação; as chaves financeiras
no SharePoint e os nomes já válidos de intenções FOLHAPGTO são preservados.

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
