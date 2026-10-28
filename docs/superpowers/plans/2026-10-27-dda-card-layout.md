# Galeria DDA — cartões compactos

Pedido: seguir a segunda imagem; vencimento crescente; data com fundo vermelho hoje, laranja amanhã, verde nas demais datas. Fuso Brasília. Sem alterações à coleta, exclusões pontuais ou status bancário.

Implementação: renderizador/CSS exclusivos DDA, faixa lateral de anexos existente, resumo vencimento/valor/status, pares de dados com ícones, códigos completos com copiar, detalhes adicionais expansíveis. Preservar todos os campos e acessibilidade. Data ausente/inválida neutra. Status bancário independente da cor do vencimento. Ordenação crescente já existente, coberta por regressão antes da paginação. Atualizar cores na virada do dia e ao retomar o app, sem refazer consultas.

- [x] Testes de cores/datas, ordenação/paginação, cópia exata e erros, dados adicionais, anexos.
- [x] Implementar renderer/CSS e integração isolada DDA.
- [x] Guard, 66 testes focados/build e visual com dados fictícios em 390/320px. Revisão independente sem bloqueios; fallback de cópia e limpeza do timer também cobertos.
- [ ] Revisão independente, PR, merge e publicação web/Play interno/TestFlight; abrir resultado real.
