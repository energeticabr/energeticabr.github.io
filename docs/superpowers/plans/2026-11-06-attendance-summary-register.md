# Cadastro a partir do resumo de presenças

**Goal:** Inserir Cadastrar acima de Submeter todos, escolher descritivo etapa ou atividade executada e voltar ao mesmo resumo após o cadastro.

**Architecture:** Reutilizar os fluxos construction_stage_demonstrative_create e hr_activity_registration no backend compartilhado. Preservar o estado completo do resumo como retorno incorporado; restaurar sem aplicar automaticamente o cadastro e consultar novamente os catálogos dos seletores.

**Tech Stack:** Python WorkflowEngine; ações e seletores existentes dos clientes web, Android e iOS.

## Restrições

- Preservar linhas, alterações individuais, presença, motivação, anexos e navegação.
- Cadastro separado não submete nem altera presenças ou padrões de fornecedor.
- Cancelamento e reconexão mantêm o contexto; opções antigas não iniciam cadastros.
- Implantar app e build com hashes independentes, backup, lock, saúde e rollback.

## Execução

- [ ] Testar botão, escolha, retorno dos dois cadastros, cancelamento, reconexão e atualização dos seletores usando o motor real com serviços em memória; demonstrar falha anterior.
- [ ] Implementar patch com âncoras exatas e snapshot completo apenas para este novo retorno.
- [ ] Executar regressões de presença e testes de implantação; revisar diff.
- [ ] Commit/PR/CI e implantação protegida; repetir testes contra o módulo instalado e confirmar saúde e hashes das duas cópias.

## Revisão

Verificar cadastro aninhado de atividade dentro do descritivo, filial ausente, comandos antigos, erro de catálogo e nenhuma escrita em presença antes de Submeter todos.
