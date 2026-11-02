# Pedido vinculado à depreciação

Execução inline, sem perguntas intermediárias conforme autorização do usuário.

**Goal:** Criar NÚMERO DO PEDIDO (IDPEDIDO, Number opcional) em LANCAMENTOSIMOBILIZADOS e gravar o ID real de NOTASPENDENTES ligado pelo AGRUPAR do LANCAMENTOS.
**Architecture:** Adicionar apenas um parâmetro ao Create_depreciation_record do fluxo publicado, usando a resposta real de Create_item. Preservar cálculos, criação financeira, relatório, atualizações do cadastro e agendamento. Preencher registros existentes somente quando IDLANCAMENTO → AGRUPAR → NOTASPENDENTES estiver comprovado; sem inferir vínculos legados.

- [x] RED/GREEN do transformador e plano idempotente de preenchimento, sem alterar outros campos.
- [x] Backup e nova coluna; probe WDL somente leitura (pedido numérico, nulo, vazio), aprovação vinculada ao hash exato; revisão; publicação e releitura.
- [x] Preencher somente IDPEDIDO nos históricos comprovados, com ETag e validação imediata do lançamento/pedido; verificar preservação dos demais dados.
- [ ] Exibir a coluna na galeria e relatório; validar junto ao botão selecionável e publicar Windows/web, Android interno e TestFlight.

Preflight atual: 276 históricos, um com vínculo financeiro. Histórico276 → LANCAMENTOS3720 → AGRUPAR494. As 275 linhas sem IDLANCAMENTO ficarão sem pedido inferido. Lista real NOTASPENDENTES e GUID dfffa843-823f-4da3-939b-aaafb5297893 comprovados no fluxo.

Concluído na base/fluxo: IDPEDIDO criado, probe real3casos/30checks sem conectores aprovado, fluxo ativo publicado com só um parâmetro novo. Histórico276 recebeu494 por MERGEETag1→2; segundoBackfill alterouzero registros. 276históricos e47cadastros preservados; 275legados semIDLANCAMENTO não receberam pedido inferido. RevisãoP2da verificação de legados corrigida e8/8testesbackend aprovados. App49checks ebuildsfinalizados; aguardando publicação da mesma revisão final.
