# Plano do resumo conciso da sincronização fiscal

**Objetivo:** trocar os textos longos da galeria por fonte curta e resumo persistente da última atualização.

**Arquitetura:** a fila devolve os IDs criados pelo último sucesso; cliente e monitor validam, deduplicam e persistem a contagem; a galeria combina a medida com o maior cooldown vigente.

- [x] Fixar em testes o contrato da fila, do monitor e da interface.
- [x] Expor e persistir a contagem do último sucesso sem dados fiscais sensíveis.
- [x] Renderizar o resumo curto e reduzir o texto de fontes.
- [x] Validar testes, builds, larguras móveis e trava de gestos.
- [ ] Publicar a mesma revisão para web/Windows, Android interno e TestFlight.
