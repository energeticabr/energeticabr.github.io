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

No Energético instalado, toque na engrenagem e em **Configurar compartilhamento**:

1. Toque em **Criar credencial**.
2. Toque em **Adicionar Atalho pronto**. O portal copia a credencial e abre o arquivo assinado do Atalho.
3. Na única pergunta de configuração da Apple, cole a credencial e toque em **Adicionar Atalho**. O nome do novo atalho é **ENERGÉTICO**; se o iPhone perguntar, substitua a versão antiga.

Não é necessário montar ações, cabeçalhos ou URLs manualmente. Para usar, abra uma foto, documento, anexo do Mail ou arquivo recebido no WhatsApp, toque em Compartilhar e escolha **ENERGÉTICO**. Se selecionar vários itens, o Atalho envia cada um separadamente.

O mesmo Atalho também funciona sem anexos: basta tocá-lo no aplicativo Atalhos ou adicioná-lo à Tela de Início para abrir diretamente o chatbot. Depois de um compartilhamento, ele abre a mesma conversa ao terminar o lote. O Atalho não contém cópias das regras de negócio; textos, etapas, tratamento de anexos e expiração por inatividade continuam sendo executados pela VM. Por isso, atualizações futuras da VM aparecem automaticamente sem reinstalar o Atalho.

Se a credencial for revogada, remova o Atalho antigo e repita os três passos para instalar uma cópia configurada com a nova credencial.

## Segurança

- A credencial dá acesso apenas ao envio de arquivos para sua própria conversa.
- A VM armazena somente o hash da credencial.
- Criar outra credencial invalida a anterior.
- Arquivos executáveis e itens acima de 60 MB são bloqueados.
- Uma resposta sem confirmação da VM é tratada como falha.
