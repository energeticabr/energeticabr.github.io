# TestFlight 1.0 (6) — 8 de setembro de 2026

- Código: `dd1ace6` (mais as correções anteriores `fc913c9`, `8ca65b3` e `8b5a3de`).
- [Execução GitHub Actions](https://github.com/energeticabr/energeticabr.github.io/actions/runs/34278594684): testes web, compilação iOS/Share Extension e distribuição TestFlight concluídos com sucesso.
- 285 testes JavaScript passaram. Recebimento nativo de arquivos e ativação da extensão passaram no macOS/Xcode 26; o aplicativo e a extensão compilaram para Simulator e dispositivo.
- Archive: `2026-09-08T21:14:33Z`; upload/export: `2026-09-08T21:16:05Z`, ambos confirmados nos logs.
- Apple build ID: `87e08988-2932-4bd2-90fb-0478883e1d58`, versão `6`, processamento `VALID`.
- API confirmou `internalBuildState=IN_BETA_TESTING` e `autoNotifyEnabled=true` depois de adicionar somente o grupo interno preexistente `ENERGETICO Validacao`.
- Conformidade manteve a declaração de algoritmos padrão (PDF.js) da distribuição interna anterior, sem distribuição na França. Não se marcou ausência de algoritmos na primeira pergunta.
- Instruções de teste foram salvas na própria compilação.
- A interface autorizada da App Store Connect selecionou e salvou o build 6 como candidato da versão oficial 1.0. A leitura posterior via API confirmou esse vínculo. Nenhum build anterior foi excluído.

## Publicação oficial ainda bloqueada

A automação de validação executou consultas reais na [execução 34277566458](https://github.com/energeticabr/energeticabr.github.io/actions/runs/34277566458), job `102234362109`. Ela detectou ausência de suporte/privacidade, capturas de iPhone/iPad, copyright/direitos de conteúdo, classificação etária, contato e acesso de demonstração para revisão. O job de validação terminou com erro por essas pendências; a compilação de Simulator redundante dessa execução foi cancelada depois. Não houve submissão à revisão.

Uma tentativa posterior de associar o build 6 pela API oficial recebeu HTTP 403 em `PATCH /v1/appStoreVersions/{id}/relationships/build`. A API de leitura e o upload TestFlight funcionam, mas a permissão de escrita para publicação oficial não está confirmada. O vínculo foi então salvo na interface já autorizada do usuário e verificado por leitura. Não se aumentaram privilégios nem se criaram novas chaves.

Portanto, a automação de submissão foi implementada e testada em fixtures/consulta real, **não comprovada de ponta a ponta na produção**. Antes de executá-la para revisão, resolver a autorização de escrita e as pendências de cadastro. A Apple exige Account Holder, Admin ou App Manager para [enviar um app para revisão](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).

## Teste em aparelho pendente

Atualizar pelo TestFlight e testar WhatsApp → ENERGÉTICO → Adicionar → confirmação → abrir o app. A compilação e as fixtures não substituem a validação no iPhone do usuário. O Share Extension não abre automaticamente o app principal; os pendentes são importados ao abrir/retomar o app. Ver `share-resume-fix.md` e as instruções no TestFlight.
