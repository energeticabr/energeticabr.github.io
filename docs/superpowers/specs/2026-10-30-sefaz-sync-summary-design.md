# Resumo conciso da sincronização fiscal

## Intenção

Substituir o texto técnico por fonte da Galeria Notas Fiscais SEFAZ por uma leitura operacional curta, baseada apenas em recibos confirmados.

## Comportamento

- A origem dos dados aparece exatamente como `Fontes: SEFAZ para NF-e e CT-e; ADN nacional para NFS-e.`
- Havendo uma sincronização global bem-sucedida, o aviso mostra data, hora e a quantidade deduplicada de itens realmente criados nas três fontes.
- Havendo um `nextAllowedAt` vigente, o aviso acrescenta o maior horário entre as fontes, pois uma nova consulta completa só está liberada quando todas estiverem disponíveis.
- Um cadastro usa singular; zero ou mais de um usam plural.
- A última contagem bem-sucedida permanece disponível após reconhecimento, reinício e troca de tela, com recuperação pelo servidor autenticado.
- Antes do primeiro sucesso confirmado, o aplicativo mantém a informação operacional necessária sem inventar data ou quantidade.

## Restrições

- Não contar documentos lidos como cadastros; contar somente IDs de itens criados.
- Não regredir um sucesso por causa de uma tentativa parcial, falha ou em espera.
- Não armazenar XML, chaves fiscais, certificados ou credenciais no monitor.
- Formatar datas e horários em `America/Sao_Paulo`.
