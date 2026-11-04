# Layout de lançamentos imobilizados

Aplicar a Foto 2 à galeria assetLaunches existente: busca com ícone, filtros, contagem e ordenação Nome (A–Z); cartões com título e ID/link, faixa filial/percentual, faixa azul de data/depreciação/residual e rodapé de ID do bem. Manter dados e formatos existentes, vínculos adicionais quando presentes, relatório compartilhado e acessibilidade. Adaptar 320/390/768/1365px sem cortar nomes ou valores. Publicar web/Windows, Android interno e TestFlight usando os fluxos existentes. Implementação direta autorizada pelo usuário, sem etapa de aprovação.

Abordagem: componente de apresentação específico e CSS escopado a assetLaunches, reutilizando ordenação e relatório. CSS sozinho não permite agrupamento semântico; alterar todas as galerias ampliaria desnecessariamente o escopo.
