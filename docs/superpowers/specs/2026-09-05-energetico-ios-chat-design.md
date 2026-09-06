# Energético para iPhone — especificação de arquitetura

**Data:** 5 de setembro de 2026  
**Status:** aguardando revisão do documento  
**Produto:** aplicativo iOS dedicado ao chatbot Energético

## Objetivo

Entregar um aplicativo instalável no iPhone pelo TestFlight e, posteriormente, pela App Store. O aplicativo conterá somente a conversa com o Energético e seus recursos associados. Ele não exibirá o portal administrativo, não será um atalho para o site e não carregará uma página remota como interface principal.

O aplicativo deve permitir:

- conversar com o fluxo já executado pela VM;
- criar, consultar e editar registros por meio da conversa existente;
- fotografar com a câmera do iPhone;
- selecionar fotos da biblioteca e documentos do app Arquivos;
- receber fotos e documentos enviados pelo menu Compartilhar de outros aplicativos;
- baixar e visualizar documentos e imagens produzidos pela VM;
- usar o mascote Energético como ícone e identidade visual.

## Limites da primeira versão

A primeira versão terá uma única experiência principal: login e conversa. Não incluirá módulos do portal, painéis administrativos, edição direta de listas, notificações push, funcionamento offline do fluxo da VM ou versão Android.

O aplicativo não fará gravações locais que simulem sucesso. Uma mensagem ou um arquivo só será marcado como enviado depois de a VM devolver uma confirmação válida. Em caso de falha, o conteúdo continuará disponível para nova tentativa.

## Restrições financeiras e de contas

- Nenhuma compra, assinatura, matrícula paga ou outro gasto poderá ser realizado em nome do usuário.
- Cadastros gratuitos necessários ao desenvolvimento podem usar o e-mail autorizado pelo usuário.
- Antes de qualquer etapa que apresente cobrança, o processo deve parar sem confirmar a operação.
- A distribuição por TestFlight e App Store depende de uma associação ativa ao Apple Developer Program. Se não existir uma associação já paga pela empresa, o desenvolvimento poderá continuar, mas a distribuição ficará bloqueada até o usuário decidir como providenciá-la.
- Credenciais, certificados, chaves e tokens não serão gravados no repositório.

## Arquitetura recomendada

### Aplicativo

Será criado um projeto independente chamado `energetico-mobile`, baseado em Capacitor 8 e com alvo mínimo iOS 15. A interface será empacotada dentro do aplicativo e construída com HTML, CSS e JavaScript modular, aproveitando a lógica já validada do chatbot sem incorporar o restante do portal.

O identificador proposto do aplicativo é `br.com.energetica.energetico`, e o nome exibido será `Energético`. Ambos poderão ser ajustados antes do primeiro registro no Apple Developer.

O projeto terá quatro unidades principais:

1. **Interface de conversa:** histórico visual, opções de resposta, campo de mensagem, estado de envio, anexos pendentes e visualização de resultados.
2. **Cliente da VM:** chamadas autenticadas aos endpoints de conversa, upload e mídia, com validação estrita das respostas.
3. **Integrações iOS:** autenticação Microsoft, câmera, biblioteca de fotos, seletor de documentos, downloads e armazenamento temporário.
4. **Extensão de compartilhamento:** recebe itens de outros aplicativos e os entrega ao rascunho da conversa.

### Backend existente

Os endpoints existentes serão reaproveitados:

- `POST /api/portal-chat` para mensagens e escolhas;
- `POST /api/portal-upload` para anexos binários;
- `GET /api/portal-media/<id>` para documentos e imagens devolvidos pela VM.

A VM continuará responsável pelo estado do fluxo e pelas gravações finais. O aplicativo será apenas outro canal autenticado. O backend deverá autorizar explicitamente o canal nativo sem ampliar o acesso anônimo e continuará validando cada token no Microsoft Graph.

## Autenticação e segurança

O login usará a biblioteca MSAL para iOS por meio de uma pequena ponte nativa do Capacitor. O Microsoft Entra receberá uma configuração de plataforma iOS para o identificador do aplicativo e o redirecionamento nativo recomendado pela Microsoft.

O token ficará sob o armazenamento seguro do MSAL/Keychain. Ele não será persistido em `localStorage`, incluído em logs ou enviado a qualquer origem diferente da API e do Microsoft Graph.

O backend continuará limitando os usuários aos e-mails corporativos permitidos. Todas as comunicações usarão HTTPS. O aplicativo bloqueará arquivos executáveis, arquivos vazios e itens acima de 60 MB antes do upload, mantendo a validação equivalente também no servidor.

As permissões de câmera e biblioteca serão solicitadas somente quando o usuário tocar na ação correspondente. O pacote iOS conterá as descrições de privacidade e o manifesto de APIs exigidos pela Apple.

## Fluxos principais

### Entrada e retomada

1. O aplicativo abre na tela do mascote e verifica a sessão Microsoft.
2. Sem sessão, exibe `Entrar com a Microsoft`.
3. Após autenticar, abre a conversa e envia o comando de retomada já usado pelo canal web.
4. A VM responde a partir do estado salvo para aquele usuário, sem reiniciar formulários existentes.

### Mensagem de texto ou escolha

1. O usuário envia texto ou toca em uma opção.
2. A interface preserva o rascunho enquanto a requisição está em andamento.
3. O cliente envia um identificador único e o token Microsoft.
4. A mensagem só entra no histórico confirmado depois de uma resposta HTTP válida.
5. Em falha, o rascunho é preservado e a interface oferece nova tentativa.

### Foto ou documento escolhido no aplicativo

1. O usuário abre câmera, fotos ou documentos.
2. O aplicativo cria um item pendente e valida nome, tamanho e tipo.
3. O item é enviado como corpo binário para o endpoint atual.
4. Somente a resposta com `status: processed` e uma lista válida de mensagens confirma o envio.
5. Se houver falha, o arquivo permanece pendente e não é exibido como processado.

### Arquivo compartilhado de outro aplicativo

1. A extensão iOS recebe a foto ou o documento pelo menu Compartilhar.
2. Ela copia o item para uma área temporária compartilhada do App Group e abre o Energético.
3. O aplicativo mostra o item como rascunho; não o envia automaticamente.
4. Após confirmação do usuário, executa o mesmo fluxo de upload.
5. O arquivo temporário é removido apenas depois da confirmação da VM ou por descarte explícito do usuário. Falhas preservam o arquivo para nova tentativa.

### Documento produzido pela VM

1. A resposta da VM fornece uma referência opaca de mídia.
2. O aplicativo baixa o conteúdo com o token Microsoft.
3. Imagens e PDFs são visualizados no aplicativo.
4. A folha de compartilhamento do iOS permite salvar ou encaminhar o resultado.

## Tratamento de erros

- Sessão expirada: renovar silenciosamente quando possível; caso contrário, solicitar novo login sem perder o rascunho.
- Sem rede ou timeout: preservar mensagem e anexos pendentes e permitir nova tentativa.
- Resposta inválida ou truncada: tratar como falha, mesmo com HTTP 2xx.
- Falha parcial em vários arquivos: remover da fila somente os arquivos individualmente confirmados; manter os restantes.
- Arquivo rejeitado: mostrar a causa antes do envio ou a mensagem devolvida pela VM.
- Falha ao abrir mídia: manter a conversa e oferecer nova tentativa do download.
- Arquivo recebido pela extensão: nunca apagar silenciosamente antes da confirmação ou do descarte explícito.

## Interface

A tela será desenhada para uso com uma mão e terá:

- cabeçalho compacto com mascote, nome Energético e estado de conexão;
- histórico ocupando a maior parte da tela;
- opções da VM como botões grandes;
- compositor fixo com câmera, anexo, texto e envio;
- fila visual de anexos com remoção e estado individual;
- indicadores claros de enviando, confirmado e falhou;
- suporte a modo claro, modo escuro, teclado e tamanhos de fonte do iOS.

Não haverá navegação para o portal. Links externos serão abertos no navegador do sistema.

## Distribuição e infraestrutura de build

O código poderá ser desenvolvido e testado no Windows. A compilação e assinatura finais do iOS exigem macOS com Xcode 26 ou superior. Será usado um executor macOS controlado no pipeline do repositório ou um Mac já disponível, sem contratar serviço pago.

O primeiro canal de entrega será o TestFlight. Depois dos testes no aparelho, o mesmo aplicativo poderá ser submetido à App Store. O pipeline nunca publicará automaticamente uma versão de produção sem uma etapa deliberada de distribuição.

## Estratégia de testes

### Automatizados

- testes unitários do cliente da VM, validação de respostas e arquivos;
- testes de estado da conversa, retomada e fila de anexos;
- testes que comprovem que falhas não produzem confirmação visual nem removem rascunhos;
- testes de contrato dos três endpoints existentes;
- testes Swift da ponte de autenticação e da extensão de compartilhamento;
- testes de interface no simulador para login, conversa, opções, anexos e erros.

### Em aparelho

- login Microsoft e renovação de sessão;
- câmera, biblioteca, app Arquivos e permissões negadas;
- compartilhamento recebido de Fotos, Arquivos, WhatsApp e Mail;
- uploads próximos ao limite e falhas de conexão;
- visualização, download e compartilhamento de PDF e imagem;
- retomada de um fluxo existente sem perda de dados.

## Critérios de aceitação

O primeiro beta estará pronto quando:

1. for instalado no iPhone pelo TestFlight como aplicativo independente;
2. abrir somente o chatbot, sem interface do portal ou barras de navegador;
3. autenticar uma conta corporativa autorizada;
4. retomar e concluir os fluxos existentes da VM;
5. tirar foto, escolher fotos e anexar documentos;
6. receber um arquivo pelo menu Compartilhar do iPhone;
7. preservar mensagem ou arquivo quando a VM não confirmar a gravação;
8. visualizar e compartilhar os resultados devolvidos pela VM;
9. usar o mascote fornecido como ícone e dentro da conversa;
10. passar pelos testes automatizados e pela validação em um iPhone real.

## Riscos e decisões

- **Apple Developer:** é a única dependência externa inevitável para TestFlight/App Store. Nenhum pagamento será iniciado pelo projeto.
- **Revisão da App Store:** a interface local e as integrações nativas de câmera, documentos e compartilhamento evitam que o produto seja apenas um site empacotado.
- **Extensão de compartilhamento:** requer uma pequena parte em Swift e um App Group, mas é necessária para receber arquivos de outros aplicativos de forma confiável.
- **Compatibilidade:** o alvo iOS 15+ cobre o requisito atual do Capacitor 8; aparelhos anteriores ficam fora da primeira versão.
- **Backend:** mudanças serão limitadas à autorização segura do novo canal e não alterarão a lógica transacional dos fluxos existentes.

## Fora de escopo

- compras dentro do aplicativo;
- assinaturas ou serviços pagos;
- publicação Android nesta etapa;
- acesso ao portal administrativo pelo aplicativo;
- envio automático de anexos sem confirmação;
- armazenamento permanente de documentos no aparelho;
- mudanças funcionais nos formulários e regras de negócio da VM.
