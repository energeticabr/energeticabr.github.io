# INSS/FGTS individuais e geração mensal

## Pedido e autoridade

Executar a individualização e criar o fluxo mensal no Power Automate, não uma
automação Codex nem um timer da VM. O usuário confirmou SALARIO como única base,
o salário do cargo antes ausente e a substituição das linhas agregadas.
Reaproveitar os descritivos existentes 33/34 na primeira competência, mantendo
originais e recibos privados. Alíquotas foram confirmadas separadamente e ficam
na configuração privada, com vigência. A proporcionalidade adota mês civil,
preservando salário integral no mês completo e ressalvando regra específica de CCT.
As instruções do usuário dispensam perguntas de aprovação do desenho/execução.

## Desenho escolhido

Reutilizar o padrão nativo já publicado da automação semanal: definição WDL
gerada e testada em Python, conectores padrão SharePoint/OneDrive, PDF convertido
pelo OneDrive e manifesto reservado sem sobrescrever. Alternativas descartadas:
HTTP premium (licença desnecessária) e scheduler da VM (não atende ao pedido).
Código público não contém pessoas reais, guias, credenciais nem planos financeiros.

## Contrato mensal

- Dia 01, 06h Brasília, a partir de 01/11/2026; competência anterior e vencimento
  dia 20 do mês de execução. Concorrência 1. Execução manual fora do dia 01 é
  prévia sem criar descritivos/provisões/pagamentos.
- Ler FUNCIONARIOSRH paginado, selecionar ativos EMPREITEIRO=SIM sem desligamento,
  admitidos até o fim da competência. Conservar fornecedor por IDFORNECEDORORIGEM;
  conferir identidade/filial/PROFISSAO na origem sem copiar outros dados.
- SALARIO da tabela CARGOS, com vigência na competência; o cargo é do cadastro RH,
  produto é PROFISSAO da origem. Sem incidência de prêmio/alimentação/transporte.
- Regras financeiras explícitas e versionadas por vigência. Uma regra ausente,
  ambígua ou vencida interrompe o lote antes de qualquer gravação financeira.
- Uma folha única por fornecedor/competência. Folha ausente ou duplicada é erro
  explícito, nunca gravar uma provisão sem vínculo nem escolher uma folha por nome
  parecido. Não criar folha por suposição neste escopo.
- Exatamente dois descritivos: INSS e FGTS. Uma provisão por pessoa/tipo, QTD=1,
  valor unitário igual ao encargo individual, filial da origem, imóvel TODOS,
  forma de pagamento vazia e OBS com tipo, pessoa e competência.
- Cada provisão aponta para IDFOLHA e seu descritivo; FOLHAPGTO aponta para essa
  provisão pelo IDPROVISAO único e para o mesmo IDFOLHA/fornecedor/tipo. Título
  APP-folha-provisao-ID preserva o leitor já instalado. Não criar LANCAMENTOS,
  pedidos, pagamento efetuado ou transferência bancária.
- PDF detalha salário, admissão, proporcionalidade, base, componentes e valor por
  fornecedor; anexar ao descritivo e conservar bytes/versão na retomada.
- Chaves determinísticas por competência/tipo/fornecedor e readback exato.
  POST incerto nunca é repetido cegamente. Divergência existente bloqueia sem
  sobrescrever alteração alheia. Paginação incompleta não é cadastro vazio.

## Primeira competência e limites de mutação

Auditoria e plano congelado privado antes do primeiro POST. Setembro inclui
somente admissões elegíveis e usa as folhas desse mês. Revalidar que origens
agregadas continuam pendentes, sem lançamento/folha já associado e com ETag
idêntico. Reutilizar as linhas agregadas para a primeira pessoa de cada tipo
quando possível, preenchendo o vínculo individual com CAS; criar as restantes.
Não cancelar/apagar obrigações de outra competência ou de outro fornecedor.
Conservar guias originais e registrar diferenças entre guia e estimativa em
memória de cálculo; não inventar ajustes para fazer totais coincidirem.

## Entrega e prova

TDD do modelo financeiro e dos payloads reais gerados, prévia sintética e PDF
renderizado, revisão independente, CI, importação do pacote no ambiente existente,
conexões atuais e leitura independente de agendamento/definição/primeira carga.
Dados nas galerias existentes são compartilhados por Android/iOS/Windows; não
recompilar clientes se nenhum código deles mudar. Distinguir fluxo criado,
agendamento habilitado, prévia validada e registros realmente individualizados.
