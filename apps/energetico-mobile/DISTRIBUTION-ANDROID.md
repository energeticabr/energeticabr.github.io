# Distribuição gratuita do Energético no Android

O teste Android usa um APK de debug assinado automaticamente pelo Gradle. Ele pode ser instalado diretamente em aparelhos Android, sem cadastro no Google Play Console e sem taxa de publicação.

## Como o APK é gerado

O workflow `Energético Android (APK de teste)` executa os testes JavaScript, gera o pacote web, sincroniza o Capacitor e publica o APK como artefato da execução do GitHub Actions. O artefato fica disponível por 30 dias para download.

Para instalar, baixe `app-debug.apk` no aparelho e autorize a instalação pelo navegador ou pelo gerenciador de arquivos quando o Android solicitar. Um novo APK deve ser instalado manualmente sempre que houver atualização.

## Limites dessa modalidade

- O APK não aparece na Google Play e não recebe atualizações automáticas.
- O teste não tem prazo de expiração imposto pela Conta Google.
- O mesmo APK pode ser usado por quantos testadores forem necessários, desde que o arquivo seja compartilhado com segurança.
- Para publicar na Google Play, será necessário criar um Play Console e pagar a taxa única de registro.
