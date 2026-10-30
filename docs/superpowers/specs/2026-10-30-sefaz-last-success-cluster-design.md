# Cluster da última atualização fiscal bem-sucedida

## Intenção

Exibir na Galeria Notas Fiscais SEFAZ uma medida persistente com a data e a hora da última sincronização manual que terminou com sucesso nas três fontes: NF-e, CT-e e NFS-e nacional.

## Comportamento

- O cluster aparece sempre no topo da galeria, com o título `Última atualização bem-sucedida`.
- Antes do primeiro sucesso confirmado, o valor exibido é `—`.
- Somente um recibo global `succeeded`, que já exige as três fontes concluídas, atualiza a medida.
- Estados `waiting`, `partial`, `failed`, rejeições e cooldowns preservam o valor anterior.
- O servidor devolve o último sucesso já registrado para a conta, inclusive depois de o popup ter sido reconhecido.
- O app guarda uma cópia local para preservar a leitura durante reaberturas e indisponibilidade temporária, sem armazenar XML, documentos ou credenciais.
- A data é apresentada no fuso `America/Sao_Paulo`, no formato curto brasileiro com hora e minuto.

## Abordagens consideradas

1. Usar apenas o último registro ainda visível no monitor: simples, mas perde o valor após o reconhecimento do popup.
2. Persistir apenas no aparelho: mantém reaberturas locais, mas não acompanha outro aparelho nem recupera armazenamento limpo.
3. Persistir no servidor e manter cache local: escolhida por manter a informação durável e tolerar falhas momentâneas de rede.

## Restrições

- Não alterar blocos protegidos de gestos de assinatura.
- Não considerar uma execução parcial como atualização bem-sucedida.
- Preservar o fluxo e o popup existentes.
- Validar o mesmo comportamento nas larguras 320 px e 390 px e nos builds web/PWA e móveis.

