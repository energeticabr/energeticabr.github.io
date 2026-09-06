# Plano de implementação da tela inicial e criação

1. Adicionar um contrato imutável da tela inicial com a evidência do pacote publicado, os sete módulos e os atalhos rápidos.
2. Copiar somente os recursos visuais usados pela tela inicial para `portal/assets/powerapps-home/`.
3. Criar testes de contrato, renderização, permissões, navegação e painel de resumo antes da implementação.
4. Implementar `powerapps-home-page.js` com canvas proporcional, fallback responsivo e interação acessível.
5. Integrar a nova tela à rota `dashboard`, mantendo o painel consolidado atual como resumo sobreposto.
6. Confirmar que todos os botões de lançamento em escopo resolvem para um Form de criação comprovado; excluir somente Tickets e Movimentações.
7. Executar testes focados e a suite completa.
8. Iniciar servidor local e validar pixels, links, foco, modal e responsividade por navegador automatizado.
9. Publicar apenas após a validação local e repetir uma auditoria somente leitura na produção.
