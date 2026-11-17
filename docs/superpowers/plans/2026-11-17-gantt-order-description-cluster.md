# Ordem cronológica e destaque do descritivo no Gantt

Execução direta autorizada pelo usuário. Preservar as datas nas pontas e a duração das barras.

Diagnóstico: fotos mostram etapas em ordem alfabética e atividades sem início antes das iniciadas, além da ausência dos rótulos de data nas barras. Código e arquivos públicos atuais contêm a ordenação crescente por início. A consulta atual das listas LANCAMENTOOBRA (94 registros) e DEMONSTRATIVOETAPA (110 registros, duas páginas completas) confirmou FUNDAÇÃO 26/05/2026 antes de ALVENARIA 10/08/2026; atividade VERIFICAÇÃO GABARITO sem início por último. O aplicativo nativo usa arquivos locais e precisa receber a build atualizada. Não inverter o comparador correto nem alterar os registros.

1. Criar verificação de DOM com as situações das fotos: etapas mais antigas primeiro, atividades sem início no final e ordem mantida ao atualizar/trocar filial.
2. Renderizar os nomes de etapa e descritivo como strong em cluster de alto contraste, sem truncar nomes longos nem misturar com o fornecedor.
3. Conferir em Chromium/WebKit a 320/390/844/1365 px e com o snapshot real em artefato local fora do repositório. Verificar negrito, contraste, ordem, expansão, datas e duração.
4. Executar verificações e revisão; publicar web, Play interno e TestFlight na revisão correta. Informar os números das novas versões para identificar a entrega no dispositivo.
