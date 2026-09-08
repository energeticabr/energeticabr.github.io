# Aceitação do Energético no iPhone

Status atual: `TESTFLIGHT_AVAILABLE_DEVICE_ACCEPTANCE_PENDING`. A Apple processou a versão 1.0 (1), adicionada ao grupo interno com status **Em testes**. O checklist em iPhone físico ainda não foi executado. Isso não equivale a aplicativo funcional nem publicado publicamente na App Store.

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
