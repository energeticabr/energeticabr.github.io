# Validação de provisão apenas para fornecedores sem folha

**Objetivo:** dispensar a confirmação de provisões pendentes quando o fornecedor do lançamento tem registro em IDFOLHA, independentemente da competência. Manter a confirmação para os demais fornecedores.

**Arquitetura:** patch mínimo no workflow compartilhado. Consultar IDFOLHA pelo fornecedor do lançamento e confirmar o fornecedor e ID positivo retornados. Não usar o fornecedor alternativo do pedido, a marca EMPREITEIRO ou uma competência limitada. Reavaliar o aviso ao responder em conversas antigas. Erros de consulta não comprovam ausência de folha e devem propagar sem escrita financeira.

**Publicação:** servidor compartilhado com baseline e espelho fixados por hash, lock, drenagem, backup, instalação atômica, health check e rollback. Atende Android, iOS e Windows/web sem modificar clientes.

- [ ] Criar e executar regressões sintéticas contra runtime atual (RED).
- [ ] Implementar consulta e retomada, verificar regressões e fluxo do fornecedor do pedido (GREEN).
- [ ] Revisar patch e instalador, publicar e confirmar saúde/hash/comportamento no servidor.
- [ ] Integrar pacote reproduzível ao repositório e registrar evidências.
