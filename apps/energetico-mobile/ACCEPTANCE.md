# Aceitação do Energético no iPhone

Status atual: `TESTFLIGHT_AVAILABLE_DEVICE_ACCEPTANCE_PENDING` para 1.0 (4). A versão 1.0 (2) teve `ACCEPTANCE_FAILED`: o Authenticator abre sem aprovação e retorna em loop. Não considerar o aplicativo funcional nem pronto para publicação pública sem confirmar o login físico e a conversa da nova versão.

## Conversa por etapa e auditoria de paridade — 08/09/2026

- Código `a86636b`: app nativo usa o mesmo modo `current-step` do web. Novas respostas confirmadas substituem o lote anterior; falhas preservam pergunta e texto, sem eliminar anexos.
- Dois testes da entrada nativa reproduziram o acúmulo antes da alteração e passaram depois. Suíte completa: 253 aprovados; revisão independente: 28 testes focados aprovados, sem achados. Builds Vite nativo/PWA e validações iOS/segredos aprovados localmente.
- O HTML público do web referencia `index-3zFvsfEU.js`, mesmo nome com hash gerado pelo build PWA local. O download separado do bundle público excedeu o timeout; não foi feita comparação byte a byte.
- CI `34270564750`: todos os três jobs aprovados. `ARCHIVE SUCCEEDED` às 19:53:39 UTC, `Upload succeeded` às 19:55:27 UTC e `EXPORT SUCCEEDED` às 19:55:28 UTC. Aviso não bloqueante de símbolos MSAL sem dSYM, já existente.
- Apple build `d13143f1-1f27-48cb-aa68-f416c018bb2c`, versão 1.0 (4): processamento `VALID` e `IN_BETA_TESTING`. Associação ao grupo interno `ENERGETICO Validacao`, notas de teste salvas e notificação automática habilitada. Mesma declaração de algoritmos padrão/sem distribuição de teste na França; nenhum outro aplicativo alterado.
- Comparação detalhada e pendências em `PARITY-AUDIT.md`: visualizador completo de mídia, recuperação de texto local e atualização de anexos em foreground ainda diferem entre web e nativo. Não foram incluídos como corrigidos nesta entrega.
- Aceite físico da conversa após atualizar continua pendente.

## Login, compartilhamento e domínio — 08/09/2026

- Novo teste físico em 1.0 (3), 19:26:04 UTC: Microsoft retornou `AADSTS50011`, informando que `msauth.br.com.energetica.energetico://auth` não estava cadastrado no cliente `94018e25-f756-4aa6-974e-27b8b43d7fe9`. O cadastro Entra foi então inspecionado diretamente: só havia os dois retornos SPA do portal e `http://localhost`.
- Correção de configuração aplicada no mesmo registro Entra: adicionada plataforma iOS/macOS com Bundle ID `br.com.energetica.energetico`, gerando exatamente o URI requerido. Preservados `https://www.energeticabr.com/energetico/`, `https://www.energeticabr.com/admin.html` e `http://localhost`; nenhuma permissão, segredo ou outro aplicativo alterado. Não requer novo build; novo aceite físico continua pendente.
- Relato físico: Authenticator apenas mostra contas, sem pedido de aprovação; retornar ao ENERGÉTICO provoca novo encaminhamento.
- Commit candidato `8eac51d`: MSAL usa `ASWebAuthenticationSession` com broker automático desabilitado e apresentação na thread principal; chamadas simultâneas compartilham uma única tentativa. A Microsoft continua responsável por MFA e Acesso Condicional. O comportamento interno que impedia a resposta do Authenticator não foi observado diretamente.
- Recebimento nativo tenta representações de arquivo/dados e preserva a cópia antes de o aplicativo de origem liberar sua URL. Falhas parciais são exibidas; uma miniatura não substitui um original anunciado indisponível.
- Upload nativo inclui a origem permitida e mantém o identificador do item nas tentativas feitas pela extensão e pelo aplicativo. Limite alinhado ao servidor: 60.000.000 bytes; bloqueios de scripts/executáveis mantidos.
- 251 testes JavaScript locais aprovados, pacote Vite e verificações do projeto iOS e de segredos aprovados. O primeiro harness compilou, mas bloqueava callbacks da Foundation com um semáforo na thread principal (`34265778215`); corrigido no commit `65d946d`, sem desativar testes.
- Testes Foundation/NSItemProvider aprovados no macOS às 18:58:23 UTC, CI `34266106547`; compilação completa dos targets iOS aprovada às 19:01:08 UTC. Todos os três jobs concluídos com sucesso.
- `ARCHIVE SUCCEEDED` às 19:04:29 UTC, `Upload succeeded` e `EXPORT SUCCEEDED` às 19:05:43 UTC. Código assinado do commit `65d946d897b9088d310f12ce5d06907b2fae97e9`.
- Apple build `85cd67e9-97d4-4651-acfc-ad79cc36cdb0`, versão 1.0 (3), estado `VALID` e `IN_BETA_TESTING`; grupo `ENERGETICO Validacao` com o único tester autorizado confirmado. Conformidade de criptografia mantida para algoritmos padrão e teste sem distribuição na França, sem mudar territórios públicos.
- Política de domínio publicada na VM às 18:53 UTC: membros Microsoft Graph com UPN exatamente `@energeticabr.com`; convidados e domínios externos rejeitados. Identidade canônica e conversas isoladas por usuário.
- Hash do `channel_bridge.py` publicado: `fb1653d800a90c711f48e579e2bea85f77e95518a8b292e52cafb20932ea1b24`. Backup anterior conservado; somente `energetica-channel-bridge.service` reiniciado. Oito testes de domínio passaram na VM, saúde confirmada e rotas sem autenticação rejeitadas com HTTP 401, incluindo a URL pública.
- Credenciais antigas do Atalho sem os dados corporativos verificados exigem nova emissão após login. Isso não altera a autenticação Microsoft nativa da extensão de compartilhamento.
- Ainda pendentes: login físico, compartilhamento de Fotos/WhatsApp/Mail e teste com outro membro autorizado. Nenhum outro aplicativo Apple foi alterado.

## Atualização candidata publicada no TestFlight — 08/09/2026

- Commit `512b5bd2c9cf0c007a4dff87f2357411e35ea3cf`, incluindo a correção de escopos do commit `389a475`.
- 243 testes locais aprovados, pacote Vite e verificação iOS aprovados.
- GitHub Actions `34262470530`: testes, compilação Simulator e distribuição assinada concluídos com sucesso.
- `ARCHIVE SUCCEEDED`, `Upload succeeded` e `EXPORT SUCCEEDED`; envio concluído às 18:28 UTC.
- Build Apple `88814c05-c43e-45bd-b3f1-26a93300e45b`, versão 1.0 (2), processamento `VALID`, estado interno `IN_BETA_TESTING`.
- Associação ao grupo `ENERGETICO Validacao` confirmada na interface da Apple. Mesmo teste restrito ao usuário autorizado, sem alteração de outros aplicativos.
- Repetir o login Microsoft no iPhone após atualizar pelo TestFlight. Este resultado ainda não comprova autenticação bem-sucedida nem funcionamento dos fluxos.

## Correção candidata de login — 08/09/2026

- Configuração real passava `openid` e `profile` à chamada nativa de aquisição de token.
- MSAL 2.14.1 acrescenta esses escopos automaticamente; `MSIDRequestParameters` no IdentityCore vinculado à versão rejeita a interseção com escopos reservados antes de iniciar a autenticação.
- O serviço nativo agora remove `openid`, `profile` e `offline_access` na fronteira com o SDK, preservando permissões da API e a configuração usada no navegador.
- Regressão com a configuração real falhou antes da correção; após a correção, os 242 testes passaram, incluindo os testes do login web. Isso não prova que não existam outras falhas de configuração Microsoft ou que o login físico já funcione.
- Segunda causa confirmada no código do SDK vinculado: `MSALPublicClientApplication` valida `LSApplicationQueriesSchemes` na inicialização com broker automático. O Info.plist não declarava `msauthv2` nem `msauthv3`, fazendo `MSIDRedirectUriVerifier` rejeitar a configuração antes do login. Ambos foram adicionados. Teste que interpreta o plist falhou antes e passou depois da alteração.

## Evidência atual — 08/09/2026

- Git: `d768301dcf5a0098ac7dc2d791f5dfc1b7a427a5`, branch `main`.
- GitHub Actions: execução `34258747371`, todos os três jobs concluídos com sucesso.
- Testes locais: 240 aprovados, zero falhas; pacote Vite gerado.
- Xcode confirmou `ARCHIVE SUCCEEDED`, `Upload succeeded` e `EXPORT SUCCEEDED` às 17:52 UTC.
- Apple processou o pacote e o grupo `ENERGETICO Validacao` apresenta a versão 1.0 (1) como **Em testes**, com validade de 90 dias.
- Dois perfis App Store exclusivos do ENERGÉTICO, com App Group validado e certificado correspondente; segredos fora do repositório.
- Grupo interno `ENERGETICO Validacao` criado com somente o usuário autorizado. Nenhum outro aplicativo da conta foi alterado.
- Aviso não bloqueante: o upload não incluiu os símbolos dSYM de MSAL.framework. Isso limita a simbolicação de falhas nessa biblioteca; o envio do aplicativo foi aceito.
- Instalação, autenticação Microsoft nativa e testes funcionais em iPhone: pendentes. O redirect URI Microsoft não foi verificado na conta Entra nesta etapa.
- Declaração de criptografia da compilação: algoritmos padrão incluídos no leitor PDF.js, sem distribuição na França nesta etapa de teste para a conta autorizada no Brasil. Reavaliar a declaração antes de ampliar territórios ou alterar a criptografia; não declarar ausência de algoritmos apenas porque a rede usa HTTPS.

## Evidência histórica de compilação — 06/09/2026

- Data: 06/09/2026.
- Git: `bdbb8c625c656ce37ff326213db2e0dbe57295a4` na branch `feat/energetico-ios-chat`.
- GitHub Actions: execução `34010989681` concluída com os jobs web e iOS verdes.
- Ferramentas: Node 24, macOS 26 e Xcode 26.6.
- Resultado: `App.app` compilado sem assinatura, contendo `PlugIns/ShareExtension.appex` e os manifests de privacidade dos dois targets.
- Testes do aplicativo: 62 aprovados, 0 falhas e 0 ignorados.
- Distribuição TestFlight: não executada; o job manual permaneceu desativado.
- Apple Developer: verificação pendente porque `developer.apple.com/account` exige que o usuário conclua o login no Chrome.

Preencher para cada execução:

- Modelo do iPhone:
- Versão do iOS (mínimo 16):
- Versão/build do aplicativo:
- Testador:
- Data:

## Checklist funcional

- [ ] Instala pelo TestFlight e abre como aplicativo próprio, sem barra de navegador e sem shell do portal.
- [ ] Mostra o mascote no ícone, abertura, login e mensagens do assistente.
- [ ] Entra com a conta Microsoft autorizada e restaura a sessão armazenada.
- [ ] Envia `CONTINUAR` ao retomar a conversa da VM sem repetir campos já gravados.
- [ ] Envia texto e recebe resposta confirmada.
- [ ] Responde às opções de enquete.
- [ ] Cria um registro pela conversa.
- [ ] Edita um registro pela conversa.
- [ ] Tira uma foto pela câmera e a envia.
- [ ] Escolhe fotos e documentos pelo seletor do iOS.
- [ ] Abre PDF e imagem devolvidos pela VM e usa a folha nativa para salvar/compartilhar.
- [ ] Recebe itens por **Compartilhar** a partir de Fotos, Arquivos, WhatsApp e Mail.
- [ ] Mantém cada arquivo compartilhado até a confirmação da VM, sem upload duplicado.
- [ ] Com dois anexos, preserva somente o que falhar e permite tentar novamente uma única vez.
- [ ] Durante uma falha de rede no envio de texto, não cria mensagem confirmada e preserva o rascunho.
- [ ] Durante uma falha de rede no upload, preserva o arquivo e a nova tentativa confirma uma única vez.
- [ ] Ao expirar a sessão, pede novo login sem perder rascunho ou anexo pendente.
- [ ] Sai da conta, fecha, reabre e confirma que a sessão foi removida.

Para cada item, registrar `PASS` ou `FAIL` e anexar captura ou gravação quando a interação for visual. Não declarar disponibilidade para download até o App Store Connect mostrar o build processado e o link de instalação tiver sido verificado no iPhone.

Resultados finais permitidos:

- `TESTFLIGHT_READY`: build processado e checklist físico aprovado.
- `BUILD_READY_SIGNING_BLOCKED`: código e CI aprovados; associação Apple ou assinatura indisponível.
- `ACCEPTANCE_FAILED`: cenário exato que falhou e evidência preservada.

Estado intermediário: `TESTFLIGHT_AVAILABLE_DEVICE_ACCEPTANCE_PENDING`, que nunca deve ser apresentado como aceite funcional ou publicação pública.
