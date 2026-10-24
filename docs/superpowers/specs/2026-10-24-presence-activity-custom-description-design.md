# Descrição livre da atividade na validação de presenças

O usuário quer que a pergunta “QUAL É A DESCRIÇÃO DA ATIVIDADE EXECUTADA?” explique e aceite uma descrição digitada fora das opções. A autorização permanente dispensa perguntas de aprovação e inclui publicação nos canais existentes.

Abordagens: desabilitar a busca e usar apenas o texto direto seria menor, mas perderia a filtragem; criar outro formulário duplicaria o fluxo. Escolha do implementador: manter o seletor, a busca automática e os botões, distinguindo explicitamente busca e envio.

Somente `construction_stage_demonstrative_create_flow.steps[atividade_demonstrativo_etapa]` habilita texto livre para `ATIVIDADEEXECUTADA`. Reutilizar a persistência, normalização em maiúsculas e avanço existentes. Não cadastrar uma nova atividade no catálogo implicitamente. Não alterar IDs descritivos, fornecedores ou registros reais para QA.

A mensagem será: “SE PREFERIR, DIGITE SUA PRÓPRIA DESCRIÇÃO E CLIQUE EM ENVIAR PARA USÁ-LA COMO DESCRIÇÃO DA ATIVIDADE. VOCÊ TAMBÉM PODE FILTRAR E SELECIONAR UMA DAS OPÇÕES.” O compositor indicará “Filtre ou digite sua descrição…”. Digitação continua usando `filter_query`; Enviar transmite texto sem esse marcador somente quando o servidor autorizar `acceptsCustomText: true`. Botões mantêm seus identificadores.

Catálogo vazio não encerra o fluxo: a descrição pode ser digitada. Texto vazio não avança. Os demais seletores mantêm o comportamento anterior. Preservar todos os blocos protegidos de assinatura, sessões e dados. Instalar mudanças backend com hashes por arquivo, backup e rollback; app Android interno, TestFlight e Windows/web com a mesma revisão validada.
