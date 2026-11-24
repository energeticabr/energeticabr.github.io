# Layout Yoosee para câmeras — design

## Intenção

Reorganizar a aba Câmeras do Energético para se aproximar das telas do Yoosee enviadas pelo usuário. O uso principal é acompanhar o vídeo ao vivo no celular, alternar entre câmeras, controlar PTZ e localizar trechos gravados sem sair do visualizador.

## Objetivos

- Mostrar uma tela de visualização com cabeçalho da câmera, estado da conexão, vídeo em destaque e controles em uma faixa horizontal.
- Iniciar a reprodução automaticamente ao abrir uma câmera, sem exigir toque no botão de play.
- Em retrato, empilhar duas transmissões, manter os controles logo abaixo do vídeo e oferecer uma gaveta inferior para data, hora e trechos gravados.
- Em paisagem e em janelas largas, usar fundo escuro e posicionar transmissões lado a lado, com controles acessíveis sem cobrir o vídeo.
- Manter a lista de câmeras, a seleção de múltiplos canais, o limite atual de oito canais, HLS, PTZ, busca de gravações, reprodução de um trecho e retorno ao ao vivo.
- Adaptar a interface a iOS, Android e Windows/desktop, respeitando as áreas seguras e o tamanho da janela.

## Fora de escopo e critérios de falha

- Não trocar o gateway, o SDK de Yoosee, credenciais, autenticação, rotas ou o formato dos streams.
- Não representar como operacionais interfone, compra de nuvem, mensagens de alarme, luz ou qualidade de imagem, pois essas operações não fazem parte das APIs atuais do Energético.
- Não deixar o usuário diante de um botão de play nativo sobreposto enquanto a câmera ainda está conectando.
- Não deixar controles decorativos sem comportamento nem inventar estatísticas, datas impressas na imagem ou miniaturas de gravações que o servidor não fornece.
- Não girar à força a tela de câmeras para paisagem. A referência mantém retrato e paisagem conforme a orientação do dispositivo.

## Abordagens consideradas

1. **Mockup sem conexão:** permitiria copiar a aparência rapidamente, mas perderia PTZ, HLS e reprodução já disponíveis.
2. **Substituir a integração de câmera:** exigiria trocar a fonte e repetir autenticação/streaming no app, aumentando o risco e duplicando o gateway já existente.
3. **Redesenhar a view existente:** mantém as APIs atuais e muda a hierarquia visual e o layout responsivo. **Escolhida** porque dá a maior fidelidade possível sem interromper as funções já ligadas.

## Como a view funciona hoje

`src/ui/cameras-view.js` cria um diálogo com a lista de canais, abre vídeo HLS, permite PTZ e consulta gravações por data/hora. `src/chat/chat-client.js` valida os identificadores e expõe essas operações. O visualizador atual usa controles nativos do navegador e `bindReportLandscape`, que força orientação horizontal e gira o conteúdo em retrato. A API de gravações fornece identificador e horários, sem miniatura.

## Decisões de desenho

- Manter a lista e a seleção atuais; a alteração principal é no visualizador e na apresentação dos cartões.
- Usar o nome do canal e estado real do stream no cabeçalho. Exibir “AO VIVO” somente durante vídeo ao vivo conectado e identificar playback como gravação.
- Trocar os controles nativos por uma faixa própria: PTZ (direcional ao abrir), áudio, captura de quadro, gravações e expansão do vídeo. Cada ação deve ser conectada a uma API ou capacidade real do navegador.
- Abrir HLS com reprodução automática, `playsinline` e áudio inicialmente silenciado para atender às políticas de autoplay do iOS, Android e navegadores desktop. A conexão permanece “Conectando…” até o evento de reprodução; se o navegador bloquear o autoplay, mostrar erro específico e uma ação de retomada.
- Colocar filtro de data e hora e os resultados da API numa gaveta expansível. Os trechos aparecem como cartões com horários e ícone de reprodução; sem miniaturas históricas falsas.
- Empilhar os canais em retrato e usar colunas em paisagem. Para mais de quatro canais, ocultar a gaveta e usar a área inteira para manter a grade legível.
- Ao escolher “Controlar” em uma grade, abrir o canal escolhido no visualizador individual e encerrar os outros streams, como a view atual já faz.
- Preservar cancelamento de streams e consultas ao voltar, fechar ou ocultar o app.
- Atualizar as verificações de layout existentes que assumem rotação forçada, mantendo a cobertura de lista, visualizador, grades e controles.

## Restrições e validação de entrega

- Antes da edição móvel, `pnpm guard:signature-gestures` deve confirmar a integridade dos blocos protegidos. Resultado observado nesta sessão: 14 blocos intactos.
- Não tocar nos arquivos do gateway Yoosee que já estavam alterados no worktree.
- Gerar build web/app; validar a renderização em retrato, paisagem, telefone estreito e desktop largo.
- Após as verificações, publicar a revisão nos fluxos existentes de TestFlight e teste interno da Google Play, conforme `AGENTS.md`; cada destino precisa de evidência própria.
