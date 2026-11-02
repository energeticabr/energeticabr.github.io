# Acionamento local sob demanda

Os pedidos manuais de DDA e de sincronização fiscal devem acordar o Windows quando houver trabalho. As buscas automáticas, reenvios e recuperação programada permanecem com seus horários atuais.

Usar as filas autenticadas existentes: uma conexão SSH persistente do Windows executa um observador no servidor. O observador recebe mudanças dos arquivos das filas pelo inotify e emite somente o nome fixo da fila elegível. O agente silencioso do Windows inicia a tarefa existente correspondente. Preservar autorizações, recibos, leases, limites fiscais e bloqueios existentes. Heartbeats mantêm a indicação de disponibilidade; reconexão e leitura inicial recuperam avisos perdidos. Repetir avisos somente enquanto houver trabalho elegível; respeitar os horários de nova tentativa.

Alternativas consideradas: aumentar os intervalos manteria a espera e a consulta periódica; um novo endpoint SignalR acrescentaria infraestrutura e uma nova autenticação. O canal SSH já autenticado permite avisos por evento sem novos endpoints públicos nem alterações nos aplicativos. Esta é a escolha de implementação do agente para a abordagem aprovada pelo usuário.

Remover os gatilhos de um minuto somente das duas tarefas manuais após validar o agente instalado. Manter execução sem janela, IgnoreNew, cópias para reversão, partida ao login e reconexão automática. Não efetuar consultas fiscais nem enviar mensagens nos testes: usar filas e tarefas isoladas. Publicar o componente compartilhado no servidor; nenhum binário móvel é modificado.
