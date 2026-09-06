# Aceitação do Energético no iPhone

Status atual: `BUILD_READY_SIGNING_BLOCKED` até que a compilação macOS esteja verde e a associação/assinatura Apple preexistente seja confirmada.

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
