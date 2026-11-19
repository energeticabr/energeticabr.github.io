# Galeria INSS e FGTS

**Goal:** Solicitar mensalmente as guias por filial e competência, em galeria compartilhada do Energético.
**Architecture:** Lista SharePoint própria, sem criar obrigações financeiras. Recorrência diária no servidor assegura dois registros por filial/competência anterior, desde outubro de 2026. Chave única no SharePoint protege retomadas e concorrência. Galeria nativa reutiliza filtros, edição condicional e anexos.
**Tech Stack:** JavaScript, SharePoint REST/Graph, Python, systemd.

Decisões: reutilizar galeria nativa; automação independente da abertura do app. Valor inicialmente nulo. Competência, filial e tipo identificam a solicitação e são preservados na edição; vencimento e valor podem ser preenchidos. A data de vencimento permanece em branco até ser informada pela guia, evitando inventar prazo oficial. Filiais do cadastro marcadas ATIVO recebem solicitações. Sem envio de mensagens a terceiros.

## Task 1: Recorrência
- [ ] Escrever e executar testes de dois tipos, virada de ano, duplicação, execução concorrente, retomada e preservação de dados/anexos.
- [ ] Implementar `automations/monthly-tax-guides/run.py`, esquema, adaptador e timer.
- [ ] Conferir cadastro real, criar lista e executar/ler novamente o lote inicial.

## Task 2: Galeria
- [ ] Testar exibição dos cinco campos, filtro por tipo/filial/competência, edição e anexos.
- [ ] Adicionar modelo `taxGuides`, rota `action_hr_tax_guides_gallery`, botão no menu RH e retomada Microsoft.
- [ ] Executar testes focados e builds web/nativo.

## Task 3: Publicação
- [ ] Revisar diff e validar assinatura, testes e CI.
- [ ] Integrar e publicar mesma revisão em Pages, Google Play interno e TestFlight; confirmar recibos.
- [ ] Confirmar timer ativo, linhas iniciais e segunda execução sem criação.
