# Comparação do ENERGÉTICO iOS com o chatbot web — 08/09/2026

Escopo: entradas `src/main.js` (pacote Apple) e `src/web/main.js` (PWA original), suas dependências e testes. Esta inspeção de código não substitui testes no iPhone nem comprova que um cache antigo do site esteja atualizado. Nenhuma alteração em outros aplicativos Apple ou nas bases de dados.

## Correção desta entrega

O iOS criava a conversa no modo padrão `full`; apenas o web selecionava `current-step`. O iOS agora também usa `current-step`: o lote da nova pergunta substitui as mensagens anteriores após confirmação da VM. Uma falha conserva a pergunta e a resposta digitada; os anexos ficam em uma coleção independente e permanecem selecionáveis.

Dois testes executam a entrada nativa com controller/store reais e portas de dispositivo/rede substituídas. Antes da correção, reproduziram três mensagens acumuladas em vez de uma; depois, passaram. Suíte completa: 253 testes aprovados, zero falhas. Build Vite, validação iOS e verificação de segredos também aprovados localmente. A disponibilidade da atualização é registrada em `ACCEPTANCE.md` somente após confirmação da Apple.

## Outras diferenças encontradas, ainda não corrigidas nesta entrega

| Recurso | Web original | App Apple | Impacto |
| --- | --- | --- | --- |
| Abrir imagem/PDF completo | Injeta `createAttachmentPreview`, com visualizador interno e PDF em rolagem | `native-ports.js` não fornece `previewMedia`; `showMedia` usa `exportMedia` e a folha de compartilhamento do iOS | A miniatura existe nos dois, mas a abertura completa não é a mesma experiência |
| Texto ainda não enviado ao fechar | Injeta `createRecoveryStorage`, salvando prévia por conta e texto digitado | Não injeta `recovery` no controller | O fluxo já registrado na VM pode ser retomado, mas o texto que ainda estava no campo não tem a mesma recuperação local |
| Atualização de anexos ao retornar de outro app | `bindAttachmentSync` reage a foco/visibilidade; `bindPageLifecycle` trata retomada | Entrada nativa não liga esses eventos nem `App.appStateChange`; importa a caixa compartilhada no início | Receber/confirmar na extensão não garante atualização imediata da conversa que continuou aberta em segundo plano |

Referências: `src/main.js`, `src/web/main.js`, `src/native/native-ports.js`, `src/app-controller.js` (`showMedia`, `start`, `continueConversation`), `src/web/recovery-storage.js`, `src/web/attachment-sync.js`, `src/web/page-lifecycle.js`.

## Recursos compartilhados e diferenças esperadas

- Mesmos `app-controller`, `chat-client`, `conversation-store`, `chat-view`, estilos e URL de API da VM. Renderização de log, rascunhos, linhas múltiplas (editar/excluir/detalhar), lista de anexos, miniaturas, compressão solicitada à VM, três linhas iniciais no campo e rolagem para a nova pergunta usam o mesmo código. Isso é evidência de implementação compartilhada, não aceite físico de todos os fluxos.
- Autenticação é Microsoft nativa/Keychain no iOS e MSAL de navegador no web. Ambos usam o mesmo tenant/client e política corporativa; esta entrega não muda login, MFA nem autorização.
- Instalação/configuração de Atalho é específica do web. O iOS tem sua extensão de compartilhamento e seletores nativos, por isso não precisa do painel de instalação do PWA.
- Atualizações de regras/dados da VM são compartilhadas. Atualizações do JavaScript/CSS embarcado no app Apple precisam de nova compilação distribuída; o aplicativo instalado não recebe automaticamente cada mudança visual publicada no site.
- Compressão de vídeo para menos de 10 MB não foi implementada nesta alteração e não deve ser anunciada como disponível.

## Aceite físico da correção

1. Atualizar para a compilação indicada em `ACCEPTANCE.md`.
2. Responder a uma pergunta de texto e a uma opção: somente a nova etapa deve permanecer, visível desde o topo.
3. Interromper a rede durante uma resposta: conservar pergunta/texto e permitir nova tentativa.
4. Com anexo já confirmado, avançar uma pergunta: a lista de anexos deve continuar disponível.
