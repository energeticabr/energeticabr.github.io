# Energético permanente no iPhone — design aprovado

## Objetivo

Entregar o chatbot Energético como um aplicativo Web instalável e independente no iPhone, sem App Store, assinatura Apple ou renovação semanal. O aplicativo deve conter somente a conversa, usar o mascote existente, tirar fotos, escolher arquivos e receber arquivos encaminhados pela Folha de Compartilhamento do iOS.

## Solução

O aplicativo principal será uma PWA publicada em `https://www.energeticabr.com/energetico/`. Ela reutiliza o controlador, a tela de conversa, a política de arquivos e o cliente transacional do aplicativo Capacitor existente. A versão Web substitui somente as portas nativas: autenticação via MSAL Browser, câmera e documentos via seletores HTML, e exportação via Web Share ou download.

O manifesto terá escopo e URL inicial exclusivos em `/energetico/`, modo `standalone`, nome `Energético` e ícones do mascote. Assim, o ícone da Tela de Início abre apenas o chat, sem menu do portal. O service worker armazena apenas o shell estático; requisições da VM e da Microsoft nunca entram no cache.

Como o iOS ainda não oferece Web Share Target para PWAs, o recebimento vindo de Fotos, Arquivos, WhatsApp e Mail será feito por um Atalho do iOS chamado `Enviar ao Energético`. O atalho envia o arquivo bruto à VM e aparece na Folha de Compartilhamento. Ele é criado uma única vez e não expira semanalmente.

## Segurança do atalho

A PWA autenticada por Microsoft emite uma credencial aleatória exclusiva do dispositivo. A VM grava somente o SHA-256 da credencial, ligado ao `oid`, e devolve o segredo uma única vez. Emitir outra credencial revoga a anterior; o usuário também pode revogá-la explicitamente.

A credencial permite somente `POST /api/shortcut-upload`. Ela não abre chat, mídias, SharePoint nem outras rotas. O upload segue o mesmo limite de 60 MB, bloqueio de executáveis, staging e confirmação transacional do canal Microsoft. Arquivo rejeitado ou processamento sem confirmação não é tratado como enviado.

## Experiência de instalação

Quando aberta fora do modo instalado, a PWA explica: abrir no Safari, tocar em Compartilhar e escolher Adicionar à Tela de Início. Depois do login, `Configurar compartilhamento` mostra um assistente para criar o Atalho, copiar a credencial e testar um arquivo. A credencial é tratada como senha e nunca é incluída no repositório, logs ou URL.

## Limites

- Nenhuma compra ou assinatura será iniciada.
- A instalação final na Tela de Início e a criação do Atalho exigem os toques do usuário no iPhone.
- A PWA funciona como aplicativo instalado, mas tecnicamente continua sendo uma Web App; isso é o que elimina assinatura e expiração de sete dias.
- Alterar a redirect URI do aplicativo Microsoft pode exigir autenticação/2FA do administrador, mas não gera custo.

## Critérios de aceite

1. O ícone do mascote abre somente o chat em modo standalone.
2. Login Microsoft, texto, escolhas, criação/edição, foto e arquivo usam a VM existente.
3. Falha de texto preserva o rascunho; falha de upload preserva o arquivo.
4. A PWA recebe atualizações sem reinstalação e não expira.
5. O Atalho encaminha arquivo ao mesmo usuário da conversa e uma credencial revogada falha com 401.
6. Nenhum endpoint novo usa CORS curinga ou acesso anônimo.
