# Datas nas extremidades das barras Gantt

Execução direta autorizada pelo usuário. Manter ordem, duração, expansão e detalhes existentes.

1. Cobrir nos testes as datas completas: início verde à esquerda e término vermelho à direita; barras em andamento sem término mostram Até hoje com a data da ponta.
2. Medir as duas datas e a duração. Usar datas dentro somente quando as três informações couberem sem sobreposição. Caso contrário, colocar datas abaixo, em duas linhas quando necessário, reservando altura na própria linha do gráfico e espaço horizontal para as últimas barras.
3. Conferir expansão, redimensionamento e clique nos detalhes; validar a 320/390/844/1365 px em Chromium e WebKit, executar builds e trava de assinatura.
4. Revisar, integrar e acompanhar validação completa e publicação no PC/web, Google Play interno e TestFlight, verificando a revisão e os artefatos.

Arquivos: stage-gantt-view.js, stage-gantt.css, testes da visualização, fixture e testes browser de duração. Preservar os arquivos não rastreados já existentes neste checkout.
