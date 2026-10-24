# Vale-alimentação: bandeja, confirmação e OBS

## Objetivo

Usar exclusivamente os arquivos da bandeja de anexos no vale-alimentação. Não apresentar seletor de arquivos no passo de OBS. Entregar cada arquivo ao pedido e somente ao último lançamento deste lote. Preservar retomadas sem repetir registros financeiros.

## Decisões de implementação

- Reutilizar seleção/câmera/escaneamento, leitura e remoção da bandeja no controlador. A tela terá uma barra ligada à mesma coleção, disponível durante o preenchimento; a revisão congela a seleção e rejeita alterações antes de confirmar.
- Conferir anexos pelo contrato real `{name, size, ...}` e pelo conteúdo (tamanho/SHA-256). Respostas de upload perdidas e arquivos já entregues podem ser reconciliados; nomes iguais com conteúdo diferente não podem ser sobrescritos.
- Guardar o controle de operação/revisão/destino em `NOTASPENDENTES.VALECONTROLE`, texto simples multilinha oculto, opcional. Não reaproveitar `Title` (pode ser FILIAL), campo fiscal ou de conformidade. A coluna é preparada e verificada antes de qualquer gravação financeira, conforme o padrão de migração de provisões existente.
- Reconhecer marcadores legados de OBS/Title. Em uma retomada confirmada, migrar marcadores reconhecidos e limpar apenas suas linhas técnicas no mesmo PATCH condicionado ao ETag. Manter as notas humanas e da auditoria. Não varrer nem modificar registros históricos fora do lote submetido.
- Manter todos os controles anteriores de concorrência, versão, proteção de lote parcial e vínculo IDFOLHA. Persistir o fornecedor do último lançamento como destino dos anexos; a ordem de exibição de uma retomada não pode mudar o destino.

## Alternativas consideradas

Esconder os códigos somente na interface não limpa a OBS armazenada. Apagar os códigos sem substituição perde idempotência. Um campo técnico dedicado preserva a recuperação e mantém as observações livres de identificadores internos.

## Limites e verificação

Não reenviar o lote financeiro real das imagens nem alterar seu texto histórico nesta tarefa. Verificar unitários, recuperação, fronteira real do repositório, navegador em 320/390px e PC, builds e publicação web/Windows, Play interno e TestFlight. Os blocos `SIGNATURE_GESTURE_LOCK_START`/`SIGNATURE_GESTURE_LOCK_END` permanecem intocados.
