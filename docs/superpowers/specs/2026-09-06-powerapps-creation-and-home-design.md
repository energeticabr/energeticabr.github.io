# Tela inicial e formulários de criação com paridade Power Apps

## Fonte de verdade

- Aplicativo publicado: `ENERGÉTICA`, app id `3501f99a-e612-44b6-8ce7-8c8caa74fad7`.
- Ambiente: `Ambiente do Bernardo notini` (`https://orgef6aa71f.crm2.dynamics.com/`).
- Download auditado em 06/09/2026 por `pac canvas download`.
- Tela: `Src/TELA INICIAL.pa.yaml`.
- SHA-256 da tela: `CC91C0EDA65F0995D53A4A1359DA57E3A25DEA5AA613114D2FCCBC53645124FB`.
- Canvas original: `1366 x 768`.

## Objetivo

Reproduzir a tela inicial publicada dentro do portal administrativo sem incorporar o Power Apps. A fotografia, a logomarca, os personagens, as cores, a ordem, as proporções e os destinos são preservados. A navegação e os relatórios usam as rotas e consultas nativas do portal, sempre ligadas ao SharePoint.

Os formulários de criação continuam derivados dos Forms publicados. Tickets, Clientes e Movimentações permanecem fora do escopo conforme orientação do usuário.

## Composição

A tela inicial usa um canvas responsivo com a mesma razão `1366 / 768`. Em telas largas, os sete blocos mantêm as coordenadas relativas do Power Apps. Em telas estreitas, os mesmos blocos são reorganizados em uma coluna legível, sem perda de comandos.

Os blocos principais são:

1. Suprimentos.
2. Demandas.
3. Financeiro.
4. Comercial.
5. Recursos Humanos e Acompanhamento de Obra.
6. Notini Moreira, correspondente a Patrimônio e Locações no portal.
7. Auditoria e Compliance.

Os atalhos laterais e superiores do Power Apps são reproduzidos com os mesmos arquivos de imagem. Como no aplicativo publicado, cada atalho abre um painel sobre a tela inicial. O resumo geral usa os clusters consolidados; os demais painéis carregam sob demanda a galeria SharePoint correspondente, com pesquisa, filtros e comandos nativos do portal. Cada painel também oferece acesso à visualização em tela inteira e nunca incorpora o Power Apps.

## Dados e segurança

- A tela não duplica bases nem conserva dados de negócio no navegador.
- Métricas e relatórios são calculados a partir do repositório SharePoint já autenticado.
- A visibilidade de blocos e atalhos respeita `can(access, moduleId, "view")`.
- Formulários só aparecem quando a entidade possui permissão de criação e contrato de Form comprovado.
- Uma coleção visual só muda depois que a gravação SharePoint termina com sucesso.

## Estados

- Carregamento do resumo: indicador dentro do painel sobreposto.
- Falha parcial: diagnóstico da fonte dentro do resumo, sem bloquear a navegação principal.
- Sem permissão: o bloco ou atalho não é renderizado.
- Teclado: todos os comandos são links ou botões nativos, com foco visível e rótulo acessível.
- Modal: fecha pelo botão, pela tecla `Escape` e pelo clique no fundo externo.

## Aceitação

- Sete blocos principais com rótulos, cores, imagens, rotas e coordenadas comprovadas.
- Vinte e quatro atalhos funcionais reproduzidos, sem comando inerte.
- Fotografia e imagens vêm do pacote publicado atual.
- Tela responsiva sem sobreposição em desktop e celular.
- Nenhum destino para Tickets, Clientes ou Movimentações.
- Suite automatizada integral sem regressão.
- Auditoria visual local em `1366 x 768`, desktop largo e celular.
