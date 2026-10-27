# Estrela de visita na opção IN LOCO

No preenchimento de um diário, a pergunta de tipo deve mostrar `1 - ⭐ 🏗️ IN LOCO` quando uma visita em campo estiver confirmada para a data e filial do diário selecionado. Sem confirmação, mantém o texto original. REMOTO e abandono continuam sem indicador.

Reaproveitar a consulta somente de leitura já usada pela casinha na seleção de diários. O ID selecionado vem da linha ID do contexto ativo confirmado pela VM; data e filial vêm do registro SharePoint, sem inferência pelo texto do botão. A tela de tipo também funciona ao retomar a conversa diretamente.

Alternativas consideradas: transportar apenas o resultado da tela anterior deixaria retomadas sem indicador; criar outra regra na VM duplicaria uma consulta existente. A decisão de implementação é estender o decorador atual às opções de tipo, com consulta cancelável e contexto vinculado ao ID selecionado.

O indicador é apenas visual e acessível: não muda ID, label, valor enviado, escolha do usuário, rascunho ou anexos. O prazo de oito segundos e a proteção contra respostas tardias permanecem. Falhas ficam visíveis e não se tornam confirmação de visita.

Publicar a mesma revisão em web/Windows, teste interno Android e TestFlight iOS; preservar os 14 blocos protegidos de assinatura. O usuário já autorizou execução e publicação sem perguntas de aprovação.
