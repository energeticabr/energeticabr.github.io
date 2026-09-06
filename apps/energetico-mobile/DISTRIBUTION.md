# Distribuição do Energético no iPhone

O projeto produz um aplicativo iOS nativo com interface própria. O conteúdo do chat é empacotado no aplicativo; ele não é um atalho para o portal nem abre o site dentro de um navegador.

## O que é gratuito e já está automatizado

- Testes JavaScript e geração do pacote web local.
- Verificação estrutural do projeto iOS, dos ícones, do mascote e dos manifests de privacidade.
- Compilação sem assinatura do aplicativo e da Share Extension no iPhone Simulator por GitHub Actions.
- Artefato de Simulator mantido por sete dias para diagnóstico técnico.

O artefato do Simulator não instala em um iPhone físico. A Apple exige assinatura válida para executar o aplicativo no aparelho e exige uma associação Apple Developer ativa para distribuir pelo TestFlight.

## Pré-requisitos que precisam já existir

1. Associação Apple Developer ativa da organização, sem iniciar nova cobrança.
2. Acesso ao App Store Connect com permissão para criar e enviar builds.
3. App IDs `br.com.energetica.energetico` e `br.com.energetica.energetico.share`.
4. App Group `group.br.com.energetica.energetico` ligado aos dois App IDs.
5. Certificado Apple Distribution exportado em P12 e chave de API do App Store Connect.
6. Redirect URI iOS `msauth.br.com.energetica.energetico://auth` registrado no aplicativo Microsoft existente.

Esta automação não compra, renova nem confirma pagamento de Apple Developer. Se a conta pedir pagamento, o processo deve parar.

## Segredos do ambiente protegido

O ambiente GitHub `app-store-connect` deve exigir aprovação manual e conter somente estes segredos:

- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_PRIVATE_KEY_B64`
- `APPLE_TEAM_ID`
- `APPLE_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`

Nenhuma chave, certificado, perfil ou token pode ser salvo no repositório. O verificador `pnpm secrets:verify` interrompe o CI quando encontra um desses artefatos.

## Caminho até o TestFlight

1. Confirmar que o workflow `Energético iOS` está verde nos jobs de web e Simulator.
2. Confirmar, sem alteração, a associação Apple Developer e as permissões no App Store Connect.
3. Criar apenas os identificadores gratuitos faltantes e configurar o App Group.
4. Inserir as credenciais já existentes no ambiente protegido do GitHub.
5. Executar manualmente `Energético iOS`, marcando `distribute=true`.
6. Aguardar o App Store Connect processar o build antes de chamar o aplicativo de disponível.
7. Adicionar o usuário autorizado como testador interno e verificar a instalação no iPhone pelo aplicativo TestFlight.

O job de distribuição nunca roda em `push` ou em `pull_request`. Sem todas as credenciais preexistentes, ele falha antes de arquivar ou enviar qualquer build.
