# Navegação entre relatórios por cor

> Implementar autonomamente conforme autorização permanente do usuário. Usar TDD, revisão independente e verificação antes de publicar.

**Objetivo:** setas circulares vermelhas nas laterais do popup para navegar na ordem vertical dos mascotes, exclusivamente dentro da mesma família de cor visível.

**Arquitetura:** catálogo explícito de grupos, componente compartilhado de setas e decoração dos painéis existentes no controlador. Reusar abertura, autenticação, orientação e cancelamento existentes; não alterar dados do SharePoint nem gestos de assinatura.

**Grupos:** azul: provisões pendentes, relatório de provisões, pagamentos, gerencial, validação de pedidos, documentos. Rosa: cargos, presenças, etapas. Laranja: recebimentos, andamento comercial, documentos comerciais, patologias. Cotações ilustradas, depreciação cinza e atividades verdes são grupos unitários, sem setas. As cores são famílias visuais, não valores CSS herdados.

**Limites:** primeiro só avançar; intermediários ambas; último só recuar; sem retorno circular; alvo de toque >=44px. Navegação preserva a regra horizontal dos relatórios e fechamento externo; nunca escreve em listas.

## Tarefas

- [x] Testar catálogo, extremos, isolamento de cores, clique único, foco e descarte em testes DOM reais. Primeiro executar RED sem o componente.
- [x] Implementar `getReportNeighbors(action)`, `reportNavigationMarkup(action)` e `decorateReportNavigation(panel,{action,onNavigate})` em `src/ui/report-navigation.js`; estilos em `src/styles.css`.
- [x] Integrar todos os painéis de mascotes pelo controlador, e seta do popup inicial por markup/evento. Testar troca real dos painéis, cancelamento e recusa de destinos de outra cor.
- [ ] Executar suíte completa, builds normal/PWA, guardas, revisão independente e teste visual publicado em telefone horizontal/PC.
- [ ] PR, merge e publicação da mesma revisão em Pages, Play internal e TestFlight; confirmar cada envio.

## Riscos a verificar

Setas não podem criar modais simultâneos; navegação durante consulta deve cancelar a origem; duplo toque não deve duplicar consulta; ausência de conta/fluxo ativo deve impedir abertura; grupos unitários e extremos devem omitir botões inexistentes.

## Evidências de execução

Base 64bf6d4. Catálogo/componente: RED sem funções, GREEN 23 testes. Controlador: RED sem rota/decoração e para galeria atrasada, GREEN 63 testes; integração 86/86. Navegador local: avanço/recuo, setas 46px em 844x390 e 56px no PC, sem overflow, aviso vertical mantido e setas ocultas em 390x844. Guardas: 14 blocos de assinatura intactos. Builds normal/PWA aprovados. Suíte final iniciada após a última alteração de código; aguardar resultado e revisão antes do commit.

Revisão independente: três achados importantes reproduzidos em RED (snapshot pendente atrasado, factory gerencial atrasada e Tab em cargos). Corrigidos por cancelamento compartilhado da navegação/descartes antes de novas aberturas e seleção dinâmica dos elementos do focus trap. GREEN 89/89. Nenhum achado menor. Suíte geral reiniciada após essas correções. Publicação e aparência nativa serão verificadas nos canais existentes; não presumir conclusão do CI.

Verificação final após as correções: `pnpm test` 3.710/3.710, zero falhas, cancelamentos ou skips; builds normal/PWA e verificadores iOS/assinatura/segredos aprovados. Próxima etapa: PR, CI, merge, publicações e prova visual no app publicado.
