# Aceitação do Energético no iPhone

Status atual: `BUILD_READY_SIGNING_BLOCKED`. O código e a compilação macOS estão aprovados; falta confirmar uma associação/assinatura Apple preexistente e executar o checklist em um iPhone físico.

## Evidência de compilação

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
