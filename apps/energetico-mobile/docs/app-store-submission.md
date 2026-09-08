# Envio do Energético à revisão da App Store

O workflow `Energético iOS` pode validar ou enviar uma versão já processada da Apple à revisão. O alvo é fixo: app `6809887853`, bundle `br.com.energetica.energetico`. O envio ao TestFlight continua independente pelo campo `distribute`.

No `workflow_dispatch`, informe `app_store_version` e `app_store_build`. Marque `validate_app_store` para consultar requisitos sem alterar a Apple. Marque `submit_app_store` somente para executar o envio solicitado. Deixe `distribute` desmarcado ao utilizar um build existente; um novo upload ainda leva tempo para ser processado e não é aguardado por este job.

O job usa o ambiente protegido existente `app-store-connect` e suas três credenciais API: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID` e `APPLE_API_PRIVATE_KEY_B64`. Não utiliza Apple ID, senha pessoal, certificados de distribuição ou sessão de navegador para enviar à revisão. Os resultados não imprimem respostas brutas, tokens ou credenciais da conta de demonstração.

## Requisitos verificados

- Identidade do app, versão iOS, build correspondente, processamento concluído e export compliance.
- Descrição, palavras-chave, suporte HTTPS, copyright e política de privacidade HTTPS.
- Capturas processadas de iPhone 6,5/6,9 e iPad 13 em cada localização cadastrada. A família iPad é necessária porque o aplicativo atual suporta iPad.
- Respostas do questionário etário e declaração de direitos do conteúdo existentes na Apple.
- Nome, sobrenome, telefone e email do contato da revisão, com uma conta de demonstração dedicada e válida. Não use credenciais corporativas de produção.
- Ausência de outra submissão iOS pendente e manutenção da opção existente `AFTER_APPROVAL`.

As respostas de **App Privacy** são diferentes da URL da política e dos manifestos `PrivacyInfo.xcprivacy`. A documentação pública consultada descreve a publicação dessas respostas pela interface do App Store Connect; esta automação não inventa um endpoint privado para alterá-las. Após conferir as respostas já publicadas para o comportamento do build selecionado, registre no ambiente GitHub `app-store-connect` a variável `APPLE_APP_PRIVACY_VERIFIED_FOR` com `versão:build`, por exemplo `1.0:6`. Esse registro é evidência manual de conferência, não uma leitura automática da Apple. Não o preencha antes da conferência e atualize-o apenas após conferir cada novo build.

O script agrega as pendências e falha antes de qualquer escrita quando falta algum requisito. Ele não preenche declarações legais, não fabrica dados de contato, não cria contas e não altera metadados de marketing. Capturas devem mostrar o aplicativo real com dados fictícios de demonstração e não informações corporativas sensíveis.

## Efeito do envio explícito

Depois da validação, o script associa o build exato à versão, cria a submissão iOS deste aplicativo, adiciona somente essa versão e solicita o envio. Em seguida lê o estado retornado pela Apple. `WAITING_FOR_REVIEW` confirma a fila de revisão; não significa publicação. A aprovação é uma decisão da Apple, e a opção já existente `AFTER_APPROVAL` controla a liberação posterior.

Se uma operação falhar depois de criar a submissão, o estado parcial fica disponível na Apple. Uma nova execução detecta a submissão existente e para para evitar duplicação ou mistura de itens. Inspecione a submissão antes de tentar novamente. Não há cancelamento nem exclusão automática.

## Validação local

Execute `node --test tests/app-store-submission.test.mjs`. Para consulta real, configure as variáveis de credenciais em ambiente protegido, `APP_STORE_VERSION` e `APP_STORE_BUILD`, mantenha `SUBMIT_APP_STORE` ausente ou `false`, e execute `node scripts/app-store-submission.mjs`. O teste não acessa a Apple.

## Referências oficiais

- [Review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
- [Create a review submission item](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems)
- [Modify a review submission](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_)
- [App Store review details](https://developer.apple.com/documentation/appstoreconnectapi/app-store-review-details)
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Read age rating declaration](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-ageratingdeclaration)

Referências consultadas em 8 de setembro de 2026. Requisitos adicionais e mudanças de API podem ser rejeitados pela Apple mesmo após a validação local.
