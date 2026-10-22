# Acrescentar páginas ao anexo da bandeja

No visualizador aberto pela bandeja, um botão + no cabeçalho oferece `📎 ADICIONAR ANEXOS` e `📷 FOTO/ ESCANEAR`. Arquivos selecionados e fotos/escaneamentos são acrescentados após as páginas atuais, na ordem selecionada. O arquivo final é sempre PDF: uma imagem original torna-se a primeira página. Uma sessão de escaneamento já agrupada em PDF é acrescentada como um único conjunto de páginas.

O resultado substitui apenas o anexo aberto, não cria anexos avulsos e não responde/avança a pergunta atual da conversa. Cancelar não muda nada. O original permanece disponível até a geração e a confirmação persistente da substituição. O envio usa um identificador idempotente e compara o hash do original, evitando duplicações e troca de arquivos homônimos. Troca de conta, fechamento da prévia antes do envio e alteração concorrente impedem uma mutação obsoleta.

Reutilizar os seletores e captura existentes. PDFs e imagens são entradas de mesclagem; formatos que não podem virar páginas devem produzir erro claro sem descartar arquivos. PDFs criptografados ou assinados digitalmente não serão alterados silenciosamente. Manter a aparência de formulários preenchidos. Respeitar 60 MB, limitar páginas e manter gestos de assinatura protegidos. A ação não aparece em relatórios/galerias somente leitura.

Publicar web/Windows, Google Play interno e TestFlight, sem envio às lojas públicas. Validar os arquivos reais e a interface em 320/390 px e desktop, sem usar registros financeiros reais.
