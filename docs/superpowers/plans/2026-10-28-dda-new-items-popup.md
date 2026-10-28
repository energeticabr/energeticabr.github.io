# Pop-up de novos DDAs

> Execução inline com superpowers:executing-plans; revisão independente antes do merge.

**Objetivo:** após sincronização manual confirmada, mostrar os itens realmente criados nessa execução.

**Desenho:** o coletor registra os IDs retornados pelo recibo de criação e verificação do PDF no SharePoint. Agente e fila transportam somente IDs, sem dados bancários. A galeria cruza esses IDs com o snapshot completo e abre um diálogo com fornecedor, ID, vencimento e valor. Busca e paginação não limitam o recibo. Se o snapshot falhar, os IDs confirmados ainda aparecem, sem inventar detalhes.

**Restrições:** somente clique manual; zero novos não abre pop-up; atualizações não são criações; falhas não confirmam sucesso; fechamento da galeria impede resposta tardia; sem mudanças em permissões, pagamento ou rotina07/12/17. Compatibilidade com recibos antigos sem IDs; nunca deduzir criação pela diferença entre snapshots.

- [ ] Testes de recibos, IDs válidos, duplicados e inconsistentes; testes de pop-up único/múltiplo, zero, erro, filtros e fechamento.
- [ ] Coletor privado, agente e fila passam createdItemIds validados (até10000 IDs inteiros positivos); entrada CLI limitada a128KiB.
- [ ] Diálogo acessível e responsivo reaproveita padrões existentes; fechamento restaura foco e interatividade.
- [ ] Guard, testes pertinentes, builds, visual320/390 com dados fictícios e revisão independente.
- [ ] Instalar componentes privados com verificação de hashes/backups; testar consulta real sem fabricar novos boletos.
- [ ] PR, merge e publicação Windows/web, Android interno e TestFlight com recibos.
