# Edição de vencimento e novos anexos para provisões pendentes

**Objetivo:** permitir corrigir a data de vencimento de uma provisão pendente e adicionar vários anexos diretamente à lista `PROVISÃO PGTOS` no SharePoint.

**Desenho:** manter o modal atual de pendências. Cada provisão ganha um botão de lápis cinza antes do check verde. O lápis abre uma tela de edição exclusiva para aquele ID, com data `DD/MM/AAAA` preenchida e mascarada. A gravação atualiza somente a coluna de vencimento no item SharePoint, com ETag. A lista expandida de anexos termina com “Adicionar mais anexos”; a seleção múltipla fica em fila e só é enviada ao SharePoint quando o usuário confirma em “Enviar anexos”. Uploads serão sequenciais; os confirmados saem da fila, os restantes ficam disponíveis para retry. Reusar a fábrica SharePoint autenticada que já lista e baixa anexos.

**Requisitos de segurança e compatibilidade:** validar data real e IDs; resolver a coluna de data pelos metadados da lista; nunca usar `If-Match: *`; enviar somente o campo de vencimento; usar o seletor de documentos existente (Android, iOS e navegador/Windows); não persistir arquivos selecionados fora da sessão; preservar outros fluxos e a trava de gestos.

## Tarefas

### 1. Operações seguras na fábrica SharePoint

- [x] Escrever primeiro testes para atualizar apenas a coluna correta, usar ETag atual, rejeitar data/ID inválidos e enviar anexos para o item correto.
- [x] Expor `updateDueDate`, `uploadAttachment` e atualização forçada da lista de anexos na fábrica dedicada de provisões pendentes.
- [x] Rodar os testes de dados e revisar o tráfego/métodos em mocks.

### 2. Edição de vencimento e fila de upload no modal

- [x] Escrever primeiro testes da tela do lápis, campo preformatado com barras, envio ao SharePoint, múltipla seleção, retry sem perder arquivos e atualização visual dos anexos.
- [x] Implementar botões, tela de data, máscara, validação, fila de anexos e integração do controlador com a fábrica SharePoint.
- [x] Rodar testes focados, toda a suíte mobile, guard de gestos, verificações de segredos e builds web/PWA.

### 3. Revisão e entrega multiplataforma

- [x] Revisar o diff completo, corrigir achados importantes com ciclo teste vermelho-verde.
- [ ] Criar e integrar PR na versão atual de `main` após revisão/testes.
- [ ] Publicar pelos fluxos existentes para Web, Android e iOS/TestFlight e relatar os estados efetivamente verificados.

## Verificações

- Os testes demonstram o cenário antes e depois da implementação.
- Data vazia/inválida não dispara escrita; a atualização envia um único campo e exige ETag.
- Upload de vários arquivos termina sem duplicar os já confirmados e mantém os não enviados recuperáveis.
- `pnpm test`, `pnpm guard:signature-gestures`, `pnpm secrets:verify`, `pnpm build` e `pnpm build:pwa` passam.
- Pipelines de distribuição são consultados antes de afirmar publicação.
