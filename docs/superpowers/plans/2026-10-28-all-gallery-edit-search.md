# Busca nos campos suspensos das galerias

> **For agentic workers:** Use superpowers:executing-plans; execute directly as requested by the user.

**Goal:** Permitir pesquisa digitável em todos os campos suspensos editáveis de todas as galerias, iniciando nova busca sem apagar o texto anterior.

**Architecture:** Reutilizar os seletores pesquisáveis existentes do formulário compartilhado e dos editores específicos. Preservar os valores nativos, os vínculos, as validações e os bloqueios de campos.

**Tech Stack:** JavaScript, componentes DOM, node:test, JSDOM, Vite e Capacitor.

**Spec:** Pedido do usuário nesta conversa: todos os campos suspensos de edição em todas as galerias devem permitir filtrar e facilitar a escolha correta, com o mesmo comportamento já entregue em lançamentos.

## Global Constraints

- Preservar os 14 blocos protegidos por SIGNATURE_GESTURE_LOCK.
- Não alterar registros reais nem anexos durante os testes.
- Texto de pesquisa não pode ser gravado como opção fechada ou vínculo.
- Publicar PC/web, Android interno e iOS TestFlight, com CI e destino verificados.

## Review Focus

- Campo obrigatório aberto sem nova escolha mantém seleção e permite salvar.
- Pesquisa remota recebe apenas o novo texto e preserva foco em atualizações.
- Select, lookup, pessoa e múltipla seleção usam o mesmo padrão de busca.
- Cancelar pesquisa preserva opção anterior; campos bloqueados permanecem bloqueados.
- Seleção de variante de formulário também permite pesquisa sem aceitar texto livre.

## Task 1: Formulários compartilhados

**Files:** portal/ui/dynamic-form.js; apps/energetico-mobile/tests/gallery-record-actions.test.mjs.

- [x] Ampliar os testes de abertura, filtro, pesquisa remota e campos obrigatórios para entidades de outras galerias; confirmar falha antes de corrigir.
- [x] Habilitar clearSelectionLabelOnOpen em todo modo edit para select e relações.
- [x] Executar os testes de integração e seletores; manter validações e readonly.

## Task 2: Cobertura dos editores e variantes

**Files:** apps/energetico-mobile/src/ui/gallery-record-actions.js; apps/energetico-mobile/src/ui/contractor-employment-view.js; testes e fixtures das galerias.

- [x] Inventariar os editores próprios, os genéricos e seus campos suspensos.
- [x] Cobrir a filtragem da variante com teste que falha; remover o bloqueio de digitação nesse seletor.
- [x] Corrigir qualquer outro bloqueio concreto identificado e validar com dados fictícios a 320 e 390 px: CARGO/STATUS de Funcionários RH, com cleanup, busy e restauração de conflitos.

## Task 3: Revisão e publicação

- [x] Rodar testes pertinentes, build PWA e guard; revisar diff com revisor independente. 325 testes mobile e 56 do formulário passaram; achado menor de aria-required corrigido com regressão RED/GREEN.
- [ ] Integrar na main conforme regras existentes e acompanhar CI completo.
- [ ] Verificar busca no app publicado sem salvar alterações reais e confirmar Android/iOS.
