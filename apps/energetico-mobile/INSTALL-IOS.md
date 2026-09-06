# Instalar o Energético no iPhone sem expiração

Esta versão não usa assinatura Apple, App Store ou TestFlight. Ela é instalada uma vez pela Tela de Início e recebe atualizações automaticamente. Não há renovação a cada sete dias.

## Instalar o chat

1. No iPhone, abra `https://www.energeticabr.com/energetico/` no Safari.
2. Toque no botão Compartilhar do Safari.
3. Toque em **Adicionar à Tela de Início**.
4. Confirme o nome **Energético** e toque em **Adicionar**.
5. Abra o ícone do mascote e entre com sua conta Microsoft da Energética.

O ícone abre somente o chatbot. Câmera e clipe permitem tirar foto ou escolher documentos dentro da conversa.

## Receber arquivos pelo menu Compartilhar

No Energético instalado, toque na engrenagem e em **Configurar compartilhamento**. Crie e copie a credencial. Ela aparece somente naquele momento, não deve ser enviada a terceiros e pode ser revogada pelo mesmo painel.

Crie uma vez o Atalho **Enviar ao Energético**:

1. Abra Atalhos e crie um novo atalho com esse nome.
2. Nos detalhes, ative **Mostrar na Folha de Compartilhamento** e aceite **Arquivos** e **Imagens**.
3. Adicione **Repetir com Cada Item** da Entrada do Atalho.
4. Dentro da repetição, adicione **Obter Nome** do Item Repetido.
5. Adicione **Codificar URL** ao Nome obtido.
6. Adicione **Obter Conteúdo de URL** com:
   - URL: `https://163-176-171-217.sslip.io/api/shortcut-upload`
   - método: `POST`
   - corpo da solicitação: `Arquivo`, usando o Item Repetido
   - cabeçalho `Authorization`: `Bearer ` seguido da credencial copiada
   - cabeçalho `Content-Type`: `application/octet-stream`
   - cabeçalho `X-Portal-File-Name`: resultado de **Codificar URL**
7. Depois da repetição, adicione **Mostrar Notificação** com “Arquivo enviado ao Energético”.

Para usar, abra uma foto, documento, anexo do Mail ou arquivo recebido no WhatsApp, toque em Compartilhar e escolha **Enviar ao Energético**. Se a credencial for revogada ou trocada, edite somente o cabeçalho `Authorization` do Atalho com a nova credencial.

## Segurança

- A credencial dá acesso apenas ao envio de arquivos para sua própria conversa.
- A VM armazena somente o hash da credencial.
- Criar outra credencial invalida a anterior.
- Arquivos executáveis e itens acima de 60 MB são bloqueados.
- Uma resposta sem confirmação da VM é tratada como falha.
