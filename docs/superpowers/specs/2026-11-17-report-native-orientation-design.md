# Orientação nativa dos relatórios

Ao abrir qualquer relatório que usa `bindReportLandscape`, solicitar paisagem no aplicativo Capacitor para que o teclado do sistema acompanhe o formulário mesmo com o aparelho fisicamente em pé. Ao fechar o último relatório, liberar a orientação original do aplicativo. Não abrir o teclado sem o usuário selecionar um campo.

Usar o plugin oficial `@capacitor/screen-orientation` 8.0.2, compatível com Capacitor 8.5.1. A rotação por CSS permanece como fallback para navegador, dispositivos que recusam rotação e versões antigas. Evitar um teclado próprio ou uma ponte nativa duplicada.

Um controlador compartilhado observa visibilidade e conexão dos relatórios ao DOM, mantém paisagem com relatórios sobrepostos e serializa lock/unlock. Falhas nativas não impedem abertura, pesquisa ou fechamento. Não alterar dados, autenticação, gestos protegidos ou estado do relatório durante a rotação. Validar no Windows e nos builds iOS/Android; publicar Pages, Google Play interna e TestFlight na mesma revisão.

Execução direta autorizada pelo usuário: “Programar isso” e instrução de executar sem confirmação.
