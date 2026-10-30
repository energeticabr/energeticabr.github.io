# Retenções SEFAZ vazias em cinza neutro

## Intenção

Na seção “Tributos e encargos” da Galeria Notas Fiscais SEFAZ, campos de retenção sem valor ou com valor zero devem ser visualmente neutros. O usuário precisa distinguir rapidamente ausência de retenção de uma retenção obrigatória real.

## Comportamento

- Campos de retenção ausentes, vazios ou zero exibem somente `-`.
- Esses campos usam cluster cinza neutro.
- Apenas campos de retenção obrigatória com valor positivo usam cluster vermelho.
- O cartão e o aviso geral de retenção continuam vermelhos somente quando `buyerWithholding` identificar retenção do comprador.
- Valores fiscais e XML/SharePoint não são alterados; a normalização é apenas visual.

## Abordagens consideradas

1. Normalizar na apresentação e classificar o vermelho pelos campos reconhecidos por `buyerWithholding` — escolhida por preservar a origem fiscal e concentrar o comportamento na galeria.
2. Substituir valores na base SharePoint — rejeitada porque alteraria dados de origem.
3. Ocultar campos vazios — rejeitada porque removeria a visão estrutural dos tipos de retenção.

## Limites

Não muda a regra que determina retenção obrigatória, não calcula tributos e não altera campos comuns como ICMS, IPI, ISS, frete, seguro ou outras despesas.
