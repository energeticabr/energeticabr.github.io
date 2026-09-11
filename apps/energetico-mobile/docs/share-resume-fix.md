# Compartilhamento e retomada — 8 de setembro de 2026

## Correções

- Depois que todos os arquivos são confirmados, a extensão fecha automaticamente. Não há botão para abrir o Energético nem um segundo toque de continuação; os arquivos confirmados permanecem na caixa compartilhada.
- MSAL da extensão é exclusivamente silencioso, sem broker. Usa o URI já registrado do app principal e `bypassRedirectURIValidation` apenas na extensão. O SDK 2.14.1 rejeitava o URI `msauth` porque o bundle `.share` é diferente. A configuração pública permite acesso ao cache compartilhado; não altera validação Entra, MFA, tenant, domínio ou autorização da VM. O login interativo principal mantém validação normal.
- O app observa o retorno ao primeiro plano desde a inicialização, importa novos itens e só remove a origem depois da confirmação. Retornos durante um upload geram uma nova leitura. Logout/stop invalidam leituras e erros atrasados.
- Seleções ainda em `staged`, antes de **Adicionar**, não são enviadas. `pagehide` transitório não encerra o controlador. A prévia local usa o mesmo armazenamento do app web, por conta, e é gravada antes de ocultar a página. Só restaura texto depois de reconciliar a pergunta atual com a VM.
- Durante o envio, os detalhes de arquivos rejeitados ficam desabilitados para não sobrepor/impedir o alerta final.

## Evidência

285 testes JavaScript passaram, incluindo regressões RED→GREEN para retomada, concorrência, troca de conta, inicialização, gravação/restauração real da prévia e a configuração silenciosa. Pacote Vite, verificação do projeto iOS e verificação de segredos passaram. A compilação iOS e o teste em aparelho precisam ser registrados na evidência da nova distribuição; testes de contrato Swift não substituem login real.

A VM recebeu apenas `worker/workflow.py` e `channel_bridge.py`, com hashes conferidos antes/depois, backup e health check. 18 testes focados passaram contra o candidato exato de workflow: anexos na confirmação, regeneração do resumo, múltiplas linhas, diário, compactação e preservação dos bytes usados por rascunhos. A suíte antiga de workflow mantém falhas de baseline; não foi declarada integralmente verde.

## Limite do iOS

A extensão não tenta abrir o Energético. Depois do envio confirmado, a caixa compartilhada mantém a confirmação para o aplicativo importar na próxima abertura. Falhas parciais continuam sendo informadas para que o usuário possa fechar e tentar novamente pelo aplicativo.

## Referências de diagnóstico

- [MSALPublicClientApplicationConfig](https://azuread.github.io/microsoft-authentication-library-for-objc/Classes/MSALPublicClientApplicationConfig.html): configuração pública `bypassRedirectURIValidation`.
- [MSAL 2.14.1 initialization](https://github.com/AzureAD/microsoft-authentication-library-for-objc/blob/2.14.1/MSAL/src/MSALPublicClientApplication.m): exige URI broker-capable quando a validação local está habilitada.
- [IdentityCore MSIDRedirectUri](https://github.com/AzureAD/microsoft-authentication-library-common-for-objc/blob/c7f6ebeea293f3b411ef837b0a050d13f494b65e/IdentityCore/src/util/MSIDRedirectUri.m): compara o URI com `NSBundle.mainBundle.bundleIdentifier`.
- [Apple NSExtensionContext.open](https://developer.apple.com/documentation/foundation/nsextensioncontext/open(_:completionhandler:)): suporte depende do ponto de extensão; não é disponibilizado para Share Extensions.
