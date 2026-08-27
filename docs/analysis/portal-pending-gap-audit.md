# Auditoria de lacunas pendentes do portal administrativo

Data da auditoria: 27/08/2026  
Escopo auditado: `D:\CodexData\portal-admin-microsoft`  
Base comparativa: solicitações consolidadas da conversa, `docs/analysis/powerapps-ui-inventory.md` e `docs/portal/powerapps-coverage-matrix.md`.

> Observação: o arquivo solicitado como `docs/analysis/powerapps-coverage-matrix.md` não existe neste repositório. A matriz efetivamente encontrada e usada foi `docs/portal/powerapps-coverage-matrix.md`.

## Conclusão executiva

O portal possui uma base administrativa consistente: login Microsoft, autorização por módulos, leitura e gravação direta no SharePoint, navegação lateral, identidade visual, CRUD genérico, anexos, histórico por versões, relatórios CSV e dashboard operacional. Isso, porém, ainda não equivale ao PowerApps inventariado.

O inventário comprova 128 telas, 183 formulários, 84 galerias, 82 fontes SharePoint, 35 conexões de fluxo, 55 chamadas `.Run(...)` e 65 fórmulas de múltiplos registros (`docs/analysis/powerapps-ui-inventory.md:24-35`). O portal reduziu esse conjunto a páginas genéricas por entidade e só possui contratos específicos para quatro entidades. A matriz também declara expressamente que conexão de fluxo não prova execução pelo portal (`docs/portal/powerapps-coverage-matrix.md:14-18`).

### Achados críticos

1. **O detalhe do registro não é alcançável pelas galerias.** A página de detalhe contém exclusão, exportação, anexos e histórico, mas a linha da galeria oferece somente `Editar` e `Aprovar`. Na utilização normal, essas funções ficam inacessíveis.
2. **Seis dashboards analíticos foram implementados, mas não foram ligados ao aplicativo.** O roteador reconhece `#/analytics/:panelId`, porém `portal/app.js` não autoriza nem renderiza essa rota. Os painéis são código morto no portal publicado.
3. **Nenhum fluxo Power Automate inventariado é executável pelo portal.** Operações de aprovação, geração de documentos, backup antes de excluir, envio de mensagens, diário de obras, pagamentos e rotinas em lote podem aparentar cobertura por existirem na matriz, mas não possuem acionamento equivalente.
4. **A equivalência de Forms e Galleries não foi reproduzida.** Defaults, `Update`, obrigatoriedade, filtros encadeados, visibilidade, efeitos pós-gravação e transações de cada tela foram substituídos, na maior parte, por inferência genérica do esquema SharePoint.
5. **Os formulários ficam expostos ao abrir a página.** Isso contraria a solicitação repetida de só mostrar formulário após `Novo` ou `Editar` e torna páginas extensas menos claras.
6. **A produção permanece fechada para usuários comuns até aplicação manual das ACLs.** O próprio documento de segurança afirma que a implementação não alterou o ambiente Microsoft. Sem executar e validar esse setup, apenas o superadministrador tem caminho operacional comprovado.
7. **O site público ainda promete documentos, pendências e tickets na área do cliente**, embora essa área e os módulos de tickets/comunicações tenham sido removidos por solicitação posterior.

## Tabela de requisitos e lacunas

| Requisito | Estado | Evidência arquivo/linha | Risco | Ação objetiva |
|---|---|---|---|---|
| Portal administrativo como experiência principal, substituindo o administrador antigo | completo | `admin.html:17-32`; `portal/app.js:236-264` | Baixo | Manter o novo ponto de entrada e remover somente resíduos comprovadamente não usados. |
| Remover integralmente a área do cliente | completo | `tests/remove-client-area.test.js:17-24`; ausência de `cliente.html` | Baixo | Manter o teste de regressão. Tratar separadamente o texto público obsoleto descrito abaixo. |
| Remover tickets e comunicações do portal administrativo conforme a instrução mais recente | completo | `tests/removed-customer-admin-screens.test.mjs:6-33`; entidades ausentes de `portal/catalog/entities.js` | Baixo | Preservar a remoção. Marcar requisitos históricos de tickets/comunicações como superados, não como pendência funcional atual. |
| Limpar implementação morta de tickets/comunicações | parcial | `portal/tickets/ticket-contract.js:8`; `portal/tickets/ticket-view-page.js:65-66`; matriz histórica em `docs/portal/powerapps-coverage-matrix.md:239-242` | Médio: código e documentação podem induzir reativação acidental | Remover os módulos mortos e atualizar a matriz gerada ou rotulá-los explicitamente como legado não executável. |
| Login administrativo exclusivamente Microsoft | completo | `admin.html:29`; `portal/ui/login-view.js:33-49`; `portal/auth/microsoft-auth.js:54-59` | Baixo | Manter testes que proíbem senha local e Supabase no `admin.html`. |
| Ao clicar em Administrativo, abrir diretamente o login Microsoft | parcial | `index.html:860`; `admin.html:29`; `portal/ui/login-view.js:37` | Médio: há uma tela intermediária e um segundo clique | Iniciar o redirect Microsoft automaticamente quando não houver sessão, mantendo uma opção de recuperação caso popup/redirect falhe. |
| Superadministrador `bernardonotini@energeticabr.com` | completo | `portal/config.js:44`; `portal/access/access-model.js:31-66` | Baixo | Manter o e-mail em configuração versionada e validar também `oid` Microsoft. |
| Administrador criar, ativar, revogar e atribuir acesso por módulo/ação | parcial | `portal/ui/access-page.js:41-48,207-228`; `docs/security/sharepoint-acl.md:43-67,80-92` | Alto: interface existe, mas ambiente Microsoft não foi configurado por esta entrega | Executar preview, aplicar ACLs, verificar recibo e testar uma conta comum com permissões mínimas. |
| Conceder/retirar permissões em massa por base ou usuário | completo | `portal/ui/access-page.js:41-52,119-166,246-259`; `tests/access-page-bulk-permissions.test.mjs:157-259` | Baixo | Manter proteção do superadministrador e persistência somente após o botão Salvar. |
| Portal fechado por padrão e autorização efetiva no SharePoint | parcial | `docs/security/sharepoint-acl.md:3-24`; `portal/access/access-repository.js:197-245` | Alto: seguro por negação, porém bloqueia produção multiusuário até setup | Concluir o setup real de ACL e documentar evidência de teste por módulo e ação. |
| SharePoint como fonte única, sem base operacional duplicada | completo | `portal/app.js:64-80`; `portal/data/sharepoint-repository.js:350-520`; teste `tests/portal-security.test.mjs:31-32` | Médio: arquivos legados Supabase ainda permanecem no repositório | Separar/arquivar `.github/workflows/supabase-keepalive.yml`, `supabase-*.sql`, `supabase-config.js` e documentação antiga após confirmar que nenhum site legado depende deles. |
| Cobrir as 82 fontes SharePoint inventariadas | parcial | inventário `docs/analysis/powerapps-ui-inventory.md:31`; matriz `docs/portal/powerapps-coverage-matrix.md:37`; indisponíveis em `portal/catalog/entities.js:123,127,138,141` | Alto: quatro fontes não têm tela executável | Definir operações e telas para `REGISTROMENSAL`, `ASSOCIACAOALUGUEL`, `PRODUTOALUGUEL` e `TAREFASALUGUEL`, ou aprovar formalmente sua exclusão do escopo. |
| Cobrir todas as telas PowerApps | parcial | matriz: 103 mapeadas e 25 parciais em `docs/portal/powerapps-coverage-matrix.md:31-40`; inventário de 128 telas em `docs/analysis/powerapps-ui-inventory.md:28` | Alto: mapeamento de fonte não comprova comportamento da tela | Criar uma especificação executável por tela e só considerar completa após teste de paridade dos fluxos principais. |
| Forms e Galleries lado a lado | completo | `portal/ui/entity-page.js:190-203`; `portal/styles/admin.css:457-472` | Baixo | Manter empilhamento responsivo em telas pequenas (`portal/styles/admin.css:602-610`). |
| Mostrar formulário somente após clicar em Novo ou Editar | ausente | `portal/ui/entity-page.js:184-192,266,283-305` | Alto: excesso visual e divergência explícita do requisito | Ocultar o painel por padrão; abrir em estado `create` pelo botão Novo e em estado `edit` pela linha selecionada; preservar a galeria ao fechar/salvar. |
| Reproduzir ordem, obrigatoriedade, default, Update e eventos de cada Form | parcial | critério do inventário em `docs/analysis/powerapps-ui-inventory.md:62455-62461`; implementação genérica em `portal/data/column-mapper.js:88-148` | Crítico: gravações podem perder defaults e regras de negócio do PowerApps | Gerar contratos por Form/tela a partir do inventário e bloquear gravação onde a paridade ainda não estiver comprovada. |
| Reproduzir filtros, ordenação, seleção e colunas de cada Gallery | parcial | critério em `docs/analysis/powerapps-ui-inventory.md:62457-62459`; fallback e limite de 8 colunas em `portal/catalog/powerapps-ui-contract.js:14-21,102-111` | Alto: o usuário pode enxergar conjuntos diferentes do PowerApps | Criar contratos por Gallery com fórmula, filtros default, ordenação, campos e ações; adicionar testes com fixtures por tela. |
| Busca, filtro de status, ordenação e paginação geral | completo | `portal/ui/entity-page.js:38-87,193-203,482-520` | Médio: é cobertura genérica, não igualdade com filtros de cada Gallery | Manter como fallback e substituir por contratos específicos nas telas migradas. |
| CRUD genérico de criação e edição | completo | `portal/ui/entity-page.js:398-438`; `portal/ui/item-detail.js:201-212` | Médio: depende de fidelidade de campos e regras ainda parcial | Testar create/edit por entidade contra tipos reais e efeitos esperados no SharePoint. |
| Abrir detalhe de um registro pela galeria | ausente | ações da linha em `portal/ui/entity-page.js:176`; rota de detalhe em `portal/app.js:161-174` | Crítico: bloqueia acesso normal a exclusão, anexos, exportação e histórico | Adicionar ação/link `Abrir detalhes` em toda linha e teste ponta a ponta galeria → detalhe → volta. |
| Editar e excluir registros | parcial | editar na galeria em `portal/ui/entity-page.js:176,423-438`; excluir somente no detalhe em `portal/ui/item-detail.js:233-256` | Alto: exclusão existe, mas fica inacessível pela navegação normal | Tornar o detalhe acessível; manter confirmação, ETag e política de arquivamento onde aplicável. |
| Aprovações equivalentes ao PowerApps | ausente | matriz comprova zero `approve` em `docs/portal/powerapps-coverage-matrix.md:14-18`; fluxos de aprovação em `docs/portal/powerapps-coverage-matrix.md:288` | Alto: processos de negócio ficam interrompidos | Mapear cada aprovação real, campos alterados, segregação de função e fluxo; não habilitar botão genérico antes disso. |
| Controles específicos para Choices, lookup, Pessoa e anexos | parcial | inventário `docs/analysis/powerapps-ui-inventory.md:54129-54143`; mapeamento em `portal/data/column-mapper.js:20-43` | Alto: lookups encadeados e defaults por tela não estão integralmente preservados | Completar contratos de relacionamento, múltipla seleção, pessoa e dependências entre campos; validar gravação no tipo interno correto. |
| Registros em caixa alta, exceto mensagens | parcial | normalização em `portal/data/column-mapper.js:103,143`; somente campos declarados em `portal/catalog/entities.js:18,60,81,88,110` | Médio: o requisito global não é aplicado a todas as colunas | Classificar todos os campos textuais por entidade como cadastro ou mensagem e testar o payload final enviado ao SharePoint. |
| Anexar, visualizar, baixar e remover arquivos | parcial | `portal/ui/attachments-panel.js:237-353`; montagem no detalhe em `portal/ui/item-detail.js:102-147` | Alto: recurso implementado, mas detalhe não é alcançável pela galeria | Corrigir navegação ao detalhe e testar PDF, imagem, upload, download, exclusão e permissão por perfil. |
| Exportar um registro | parcial | botão no detalhe em `portal/ui/item-detail.js:13,154-155`; CSV em `portal/exports/item-export.js:20-36` | Médio: inacessível pela galeria e exporta metadados dos anexos, não seus arquivos | Expor o detalhe e oferecer pacote ZIP quando o caso exigir campos mais anexos. |
| Relatórios com filtros e exportação | completo | `portal/reports/reports-page.js:128-163,224-261` | Médio: exportação é CSV e impressão do navegador | Manter CSV; rotular impressão como impressão, não como PDF gerado. |
| Geração de PDF/documentos com layout empresarial | ausente | 949 ocorrências documentais no inventário em `docs/analysis/powerapps-ui-inventory.md:55420-55433`; `LANCAMENTOSHTML` em `docs/portal/powerapps-coverage-matrix.md:310` | Alto: comprovantes, contratos, diários e medições deixam de ser emitidos | Reproduzir templates prioritários e integrar execução segura do fluxo ou geração server-side; validar visualmente cada documento. |
| Histórico por registro com antes/depois | parcial | versões e timeline em `portal/ui/item-detail.js:131-147`; diferenças em `portal/history/item-history.js:70-149` | Alto: inacessível pela galeria; exclusões e remoções de anexo não têm tombstone garantido | Expor detalhe; registrar eventos de exclusão/remoção em lista de auditoria imutável e ligar registros relacionados reais. |
| Auditoria global | parcial | `portal/audit/audit-model.js:44-76`; `portal/audit/audit-page.js:102-138` | Médio: contabiliza criação/edição do recorte carregado, não todas as ações históricas | Incluir exclusões, aprovações, anexos, falhas e eventos de acesso; declarar claramente período e completude da carga. |
| Múltiplos lançamentos | parcial | quatro contratos em `portal/catalog/powerapps-ui-contract.js:35,38-40`; fila em `portal/forms/multi-entry.js:78-85`; envio em `portal/ui/entity-page.js:308-345` | Alto: o inventário contém 65 fórmulas múltiplas, mas só quatro filas genéricas foram modeladas | Mapear as 65 fórmulas; reproduzir relações entre listas, confirmação, idempotência, compensação e erro por item. |
| Transação lógica em ForAll, múltiplos Patch, RemoveIf e fluxos | ausente | exigência em `docs/analysis/powerapps-ui-inventory.md:57800-57820,62460`; criação independente em `portal/ui/entity-page.js:330-345` | Crítico: falha parcial pode deixar dados inconsistentes | Implementar orquestrações específicas e idempotentes; registrar correlação, sucesso/falha por item e compensação. |
| Executar fluxos Power Automate comprovados | ausente | inventário em `docs/analysis/powerapps-ui-inventory.md:56376-56395`; matriz em `docs/portal/powerapps-coverage-matrix.md:282-321` | Crítico: várias operações essenciais só existem fora do portal | Criar uma camada segura de execução, contratos de entrada/saída e acompanhamento de cada execução; não chamar URLs secretas diretamente do navegador. |
| Sidebar por módulos, recolhível e responsiva | completo | `portal/ui/app-shell.js:67-145`; `portal/styles/admin.css:214-370,623-690` | Baixo | Manter teste visual desktop/mobile e ocultação por permissão. |
| Identidade da empresa, logo e mascote no login e portal | completo | `admin.html:19-21`; `portal/ui/login-view.js:13-47`; `portal/ui/app-shell.js:71-89` | Baixo | Verificar carregamento das imagens na publicação e manter textos alternativos adequados. |
| Dashboard inicial com indicadores e informações relevantes | completo | 11 métricas em `portal/dashboard/dashboard-model.js:26-38`; UI em `portal/ui/dashboard-page.js:98-124` | Médio: carrega fontes selecionadas, não o universo inteiro | Indicar fonte/período/completude de cada indicador e adicionar links para o recorte que originou o número. |
| Dashboards analíticos detalhados | ausente | rota declarada em `portal/core/router.js:8`; sem autorização/renderização em `portal/app.js:83-98,113-184`; seis definições em `portal/analytics/definitions/index.js` | Crítico: telas implementadas não podem ser abertas | Importar e montar `createAnalyticsPage`, autorizar por módulo, criar links no menu e testar cada painel com dados e estado vazio. |
| Incorporar páginas Power BI no portal | ausente | não há referência Power BI fora do inventário; busca no portal não encontra embed/iframe Power BI | Médio: solicitação de visualização Power BI não foi entregue | Definir estratégia segura (Embed for organization com autenticação Microsoft) e licença aplicável; não usar Publish to web para dados internos. |
| Relatórios analíticos sem custo adicional | parcial | relatórios e gráficos próprios em `portal/reports/reports-page.js:128-153`; `portal/ui/dashboard-page.js:114-123` | Baixo: alternativa existe, mas não substitui todos os relatórios Power BI/PowerApps | Priorizar painéis próprios para os casos sem licença e documentar diferenças. |
| Site público com WhatsApp | completo | `index.html:894,1113-1121,1137`; `assets/public-contact.js:3-35`; `trabalhe-conosco.html:385-436` | Baixo | Manter links e testar número/mensagem em dispositivos móveis. |
| Site público sem cadastro e sem área do cliente | parcial | contato sem cadastro em `index.html:1118-1121`; texto contraditório em `index.html:1032` | Alto: promete uma área removida e confunde o visitante | Remover/reformular imediatamente a promessa de documentos, pendências e tickets no portal do cliente. |
| Exibir conta Microsoft no site público quando já houver sessão | completo | `assets/public-account.js:28-100`; hosts em `index.html:871-876` e `trabalhe-conosco.html:364-369` | Baixo | Manter como informação de sessão; não tratar isso como autorização administrativa. |
| Não expor segredos no navegador | completo | `tests/portal-security.test.mjs:31-32`; `admin.html:7-12` | Médio: arquivos legados contêm URL/chave anônima do Supabase, embora não carregados pelo admin | Retirar artefatos legados do deploy público depois de validar dependências. Rotacionar qualquer segredo previamente divulgado em conversa ou histórico. |
| Domínio público/HTTPS/SEO | parcial | `CNAME:1`; `robots.txt:1-3`; `sitemap.xml:1-40`; metadados em `index.html:4-20` | Médio: arquivos estáticos não comprovam certificado, DNS ou indexação ao vivo | Validar externamente certificado, redirecionamento raiz/www, Search Console e indexação; manter isso fora da alegação de paridade do portal. |

## Recursos PowerApps comprovados e ainda não executáveis

### Fluxos

A matriz registra 34 conexões de fluxo (`docs/portal/powerapps-coverage-matrix.md:282-321`), enquanto o inventário bruto registra 35 serviços conectados (`docs/analysis/powerapps-ui-inventory.md:31-35`). Nenhum possui acionamento funcional no portal. Os recursos afetados incluem:

- aprovação agrupada de lançamentos (`APROVARLANCAMENTOSPORAGRUPAR`);
- pagamentos e provisões (`BOTAOPAGAMENTOS`, `CRIARPREVISAOPGTO`, `CRIARPROVISAOPGTOSPOWERAPPS`);
- contratos e medições (`CONTRATOS`, `FORMULÁRIOMEDIÇÃO`, `SUBMETERHTMLCONTRATO`);
- diário de obras (`EMISSÃODIÁRIODEOBRAS`);
- tarefas recorrentes e delegadas;
- geração HTML/PDF e comprovantes (`LANCAMENTOSHTML`, `ENVIOHTML`, `COMPROVANTEPGTO`);
- mensagem programada, mensagem com imagem e push notification;
- presença, relatório de presença e descritivos;
- atualização de BI (`ATUALIZARBI`);
- backup antes de excluir (`ExcluirLancamentosComBackup`);
- submissão em lote JSON (`SUBMETERLANCAMENTOSJSON`);
- criação/conversão de arquivo e inclusão como anexo.

### Telas, formulários e galerias

- 25 telas permanecem explicitamente parciais na própria matriz (`docs/portal/powerapps-coverage-matrix.md:33-40`).
- Os 183 Forms e 84 Galleries não possuem contratos individuais no portal; só `lancamentos`, `compras`, `linhas-de-contrato` e `linhas-de-medicao` têm customização explícita (`portal/catalog/powerapps-ui-contract.js:23-41`).
- Dependências de campos demonstradas no inventário, como filial → cliente → imóvel (`docs/analysis/powerapps-ui-inventory.md:54137-54143`), não são reproduzidas por tela.
- Os 949 usos de anexos/documentos incluem assinaturas, comprovantes e HTML formatado, muito além do painel genérico de anexos (`docs/analysis/powerapps-ui-inventory.md:55420-55433`).
- As 65 fórmulas de múltiplos registros incluem `ForAll`, `Concurrent`, `RemoveIf` e múltiplos `Patch`; a fila genérica atual não preserva automaticamente essas relações (`docs/analysis/powerapps-ui-inventory.md:57800-57820`).
- Regras globais do `App.OnStart`, notificações e estados de tela não foram convertidos em contratos executáveis por processo.

### Fontes sem tela operacional

As quatro fontes abaixo existem no inventário, mas estão deliberadamente indisponíveis no catálogo do portal (`portal/catalog/entities.js:123,127,138,141`):

1. `REGISTROMENSAL`;
2. `ASSOCIACAOALUGUEL`;
3. `PRODUTOALUGUEL`;
4. `TAREFASALUGUEL`.

## Ordem recomendada de correção

1. Tornar o detalhe acessível e, com isso, liberar de fato anexos, histórico, exportação e exclusão.
2. Ocultar formulários até ação explícita de Novo/Editar.
3. Ligar os seis dashboards analíticos ao roteamento, autorização e menu.
4. Executar e validar o setup real de ACLs para usuários comuns.
5. Bloquear mutações de telas sem contrato específico até reproduzir Forms/Galleries e efeitos de negócio.
6. Migrar os fluxos prioritários: backup/exclusão, documentos/PDF, pagamentos, contratos/medições e múltiplos lançamentos.
7. Corrigir o texto público que ainda promete a área do cliente.
8. Decidir formalmente o destino das quatro fontes indisponíveis e dos 25 mapeamentos parciais.
9. Remover artefatos Supabase e módulos de tickets/comunicações mortos do deploy após validação de dependências.

## Limites desta auditoria

- A auditoria é estática e não alterou SharePoint, Entra ID, PowerApps, Power Automate, Power BI, DNS ou produção.
- A presença de código e de testes foi tratada separadamente da possibilidade de o usuário alcançar e executar o recurso.
- Requisitos históricos de tickets, comunicações e área do cliente foram considerados superados pela instrução posterior de removê-los integralmente e manter apenas a área administrativa.
- A própria fonte de inventário alerta que não executa o PowerApps nem contém a implementação interna dos fluxos (`docs/analysis/powerapps-ui-inventory.md:62442-62453`).

## Verificação executada

- Estrutura do relatório: 44 requisitos classificados, todos com um dos estados permitidos (`completo`, `parcial` ou `ausente`) e as cinco colunas solicitadas.
- Suíte automatizada: **431 testes aprovados, 0 falhos**.
- Nenhuma mudança de código foi feita durante esta auditoria e nenhum commit foi criado.
