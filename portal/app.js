import portalConfig from "./config.js";
import { createMicrosoftAuth } from "./auth/microsoft-auth.js";
import { can, hasAdministrativeAccess, isSuperAdmin } from "./access/access-model.js";
import { createAccessRepository } from "./access/access-repository.js";
import { ENTITIES, entitiesForModule } from "./catalog/entities.js";
import { MODULES } from "./catalog/modules.js";
import { PORTAL_ROUTES, createRouter } from "./core/router.js";
import { createPageLifecycle } from "./core/page-lifecycle.js";
import { createNavigationFeedback } from "./core/navigation-feedback.js";
import { escapeHtml } from "./core/utils.js";
import { createGraphClient } from "./data/graph-client.js";
import { createSharePointAttachmentTransport } from "./data/attachments.js";
import { createSharePointRepository } from "./data/sharepoint-repository.js?v=20260827-combobox-audit";
import { renderAppShell } from "./ui/app-shell.js";
import { renderLoginView } from "./ui/login-view.js";
import { renderDashboard } from "./ui/dashboard-page.js";
import { renderAuditPage } from "./audit/audit-page.js";
import { createAccessPage } from "./ui/access-page.js";
import { createEntityPage } from "./ui/entity-page.js?v=20260827-remove-receipt";
import { createItemDetailPage } from "./ui/item-detail.js?v=20260827-combobox-audit";
import { createReportsPage } from "./reports/reports-page.js";
import { canViewAnalyticsPanel } from "./analytics/analytics-access.js";
import { createAnalyticsPage } from "./analytics/analytics-page.js";
import { ANALYTICS_DEFINITIONS, analyticsDefinitionById } from "./analytics/definitions/index.js";
import { getPowerAppsUiContract } from "./catalog/powerapps-ui-contract.js?v=20260827-combobox-audit";

const portalRoot = globalThis.document?.getElementById?.("portalRoot") || null;
let microsoftAuthClient;
let loginView;
let accessRepository;
let sharepointRepository;
let portalShell;
let portalRouter;
let unsubscribeRoute;
const pageLifecycle = createPageLifecycle();
const navigationFeedback = createNavigationFeedback();

function accountEmail(account) {
  return account?.username
    || account?.idTokenClaims?.preferred_username
    || account?.idTokenClaims?.email
    || "";
}

function accountIdentity(account) {
  return {
    oid: account?.idTokenClaims?.oid || account?.localAccountId || "",
    email: accountEmail(account),
    name: account?.name || account?.idTokenClaims?.name || "",
  };
}

function showSetupError(account, error) {
  loginView.showUnauthorized(account);
  const status = portalRoot.querySelector("[data-login-status]");
  status.dataset.state = "error";
  status.textContent = error?.message || "Não foi possível verificar o controle de acessos. Somente o superadministrador pode concluir a configuração.";
}

function showAccessDenied(account, access) {
  loginView.showUnauthorized(account);
  if (!access?.security || access.security.status === "secure") return;
  const status = portalRoot.querySelector("[data-login-status]");
  status.dataset.state = "error";
  status.textContent = access.security.instructions;
}

function createPortalAccessRepository() {
  const graph = createGraphClient(scopes => microsoftAuthClient.getToken(scopes));
  const restTransport = createSharePointAttachmentTransport({
    tokenProvider: scopes => microsoftAuthClient.getToken(scopes),
    allowedSites: Object.values(portalConfig.sharepointSites),
  });
  sharepointRepository = createSharePointRepository(graph, portalConfig.sharepointSites, {
    attachmentTransport: restTransport,
    restTransport,
  });
  return createAccessRepository({
    sharepoint: sharepointRepository,
    graph,
    config: portalConfig,
    modules: MODULES,
    getCurrentIdentity: () => accountIdentity(microsoftAuthClient.getAccount()),
  });
}

export function isRouteAllowed(route, session) {
  if (route.name === "dashboard") return true;
  if (route.name === "audit") {
    return ENTITIES.some(entity => entity.available !== false && can(session.access, entity.moduleId, "view"));
  }
  if (route.name === "access") return session.isSuperAdmin;
  if (route.name === "reports") return can(session.access, "relatorios", "view");
  if (route.name === "analytics") {
    const definition = analyticsDefinitionById(route.params.panelId);
    return Boolean(definition && canViewAnalyticsPanel(definition.id, session.access, can));
  }
  if (route.name === "module") {
    return MODULES.some(module => module.id === route.params.moduleId && module.id !== "usuarios-acessos")
      && can(session.access, route.params.moduleId, "view");
  }
  if (["entity", "entity-create", "item"].includes(route.name)) {
    const entity = ENTITIES.find(candidate => candidate.id === route.params.entityId);
    return Boolean(entity && can(session.access, entity.moduleId, "view"));
  }
  return false;
}

export function createReportsRoutePage(container, session, repository = sharepointRepository) {
  return createReportsPage(container, {
    entities: ENTITIES,
    analyticsDefinitions: ANALYTICS_DEFINITIONS,
    repository,
    access: session.access,
    can,
  });
}

export function createAnalyticsRoutePage(container, route, session, repository = sharepointRepository) {
  const definition = analyticsDefinitionById(route.params.panelId);
  if (!definition) return undefined;
  return createAnalyticsPage(container, {
    definition,
    entities: ENTITIES,
    repository,
    access: session.access,
    can,
  });
}

export function renderModuleLanding(container, moduleId, options = {}) {
  const module = MODULES.find(candidate => candidate.id === moduleId);
  const entities = options.entities || entitiesForModule(moduleId);
  const access = options.access;
  const permissionCheck = options.can || can;
  const canCreateEntity = options.canCreateEntity || (entity => {
    const form = getPowerAppsUiContract(entity.id, { mode: "create" });
    return entity.available !== false
      && entity.capabilities?.create === true
      && permissionCheck(access, entity.moduleId, "create")
      && form.hasForm === true
      && (form.readOnly !== true || form.requiresVariantSelection === true);
  });
  const entityById = id => entities.find(entity => entity.id === id);
  const suppliesCommand = (id, create = false, targetId = id) => {
    const entity = entityById(targetId);
    if (!entity || (create && !canCreateEntity(entity))) return "";
    return `<a class="module-entity-command ${create ? "module-entity-create" : "module-entity-gallery"}" href="#/entity/${encodeURIComponent(targetId)}${create ? "/new" : ""}">${create ? "Lançamento" : "Galeria"}</a>`;
  };
  const suppliesPair = (id, label, createOnly = false, launchTarget = id) => entityById(id) ? `<article class="supplies-action-row${createOnly ? " supplies-action-single" : ""}"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true, launchTarget)}${createOnly ? "" : suppliesCommand(id)}</div></article>` : "";
  if (moduleId === "suprimentos" && !options.entities) {
    const operations = [["lancamentos", "Novo lançamento"], ["compras", "Pedidos efetuados"], ["novas-cotacoes", "Nova cotação"], ["orcamentos", "Orçamentos"]];
    const support = [["provisoes-de-pagamento", "Programação de pagamentos"], ["despesas-recorrentes", "Despesas recorrentes"]];
    const registrations = [["contas", "Cadastro conta"], ["fornecedores", "Cadastro fornecedor"], ["familias", "Cadastro família"], ["filiais", "Cadastro filial"], ["subfamilias", "Cadastro subfamília"], ["imoveis", "Cadastro imóvel"], ["produtos", "Cadastro produto"], ["cidades", "Cadastro cidade"], ["unidades-de-medida", "Cadastro unidade de material"], ["tipos-de-material", "Cadastro tipo"]];
    const auxiliary = [["grupos-de-imobilizados", "Cadastro grupo imobilizado"], ["imobilizados", "Cadastro imobilizado"], ["homologacoes-de-fornecedor", "Auditoria e compliance"]];
    container.innerHTML = `<section class="module-page supplies-module-page" aria-labelledby="moduleTitle"><header class="module-heading supplies-module-heading"><div><p class="page-eyebrow">I10 · GERAL SUPRIMENTOS</p><h1 id="moduleTitle">Suprimentos</h1><p class="module-page-intro">Lançamentos, cadastros e consultas organizados no mesmo fluxo operacional.</p></div></header><div class="supplies-workspace"><section class="supplies-column supplies-operations" aria-labelledby="operationsTitle"><div class="supplies-column-heading"><span class="supplies-column-kicker">Operação</span><h2 id="operationsTitle">Lançamentos e acompanhamento</h2><p>Use os botões vermelhos para iniciar um registro e as galerias para consultar ou editar o que já existe.</p></div><div class="supplies-action-list">${operations.map(([id, label]) => suppliesPair(id, label)).join("")}</div><div class="supplies-action-list supplies-action-list-wide">${support.map(([id, label, createOnly, launchTarget]) => suppliesPair(id, label, createOnly, launchTarget)).join("")}</div></section><section class="supplies-column supplies-catalog" aria-labelledby="catalogTitle"><div class="supplies-column-heading"><span class="supplies-column-kicker">Cadastros</span><h2 id="catalogTitle">Bases de apoio</h2><p>Cada cadastro tem sua entrada e sua galeria lado a lado para facilitar a rotina.</p></div><div class="supplies-paired-grid">${registrations.map(([id, label]) => suppliesPair(id, label)).join("")}</div><div class="supplies-secondary-grid">${auxiliary.map(([id, label]) => suppliesPair(id, label)).join("")}</div></section></div></section>`;
    return;
  }
  if (moduleId === "demandas" && !options.entities) {
    const tasks = [["lancamentos-de-tarefas", "Nova tarefa"], ["tarefas-delegadas", "Nova delegação"], ["tarefas-recorrentes", "Tarefas recorrentes"]];
    const communication = [["mensagens-programadas", "E-mail agendado"], ["lancamentos-de-tarefas", "Lançamentos de tarefas"]];
    const pair = ([id, label]) => entityById(id) ? `<article class="demands-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    container.innerHTML = `<section class="module-page demands-module-page" aria-labelledby="moduleTitle"><header class="module-heading demands-module-heading"><div><p class="page-eyebrow">I4 · GERAL TAREFAS</p><h1 id="moduleTitle">Demandas</h1><p class="module-page-intro">Tarefas, delegações e comunicações em um só lugar.</p></div></header><div class="demands-workspace"><section class="demands-column demands-tasks" aria-labelledby="demandsTasksTitle"><div class="demands-column-heading"><span class="demands-column-kicker">Tarefas</span><h2 id="demandsTasksTitle">Planejar e acompanhar</h2><p>Crie novas demandas ou abra a galeria para consultar e editar registros.</p></div><div class="demands-action-list">${tasks.map(pair).join("")}</div></section><section class="demands-column demands-communication" aria-labelledby="demandsCommunicationTitle"><div class="demands-column-heading"><span class="demands-column-kicker">Comunicação</span><h2 id="demandsCommunicationTitle">Agendamentos e acompanhamento</h2><p>Organize mensagens e registros que apoiam a execução das tarefas.</p></div><div class="demands-action-list">${communication.map(pair).join("")}</div></section></div></section>`;
    return;
  }
  if (moduleId === "comercial" && !options.entities) {
    const registrations = [["clientes", "Cadastro cliente"], ["imoveis", "Cadastro imóvel"], ["corretores", "Cadastro corretor"], ["tipos-de-marco", "Cadastro tipo marco"], ["tipos-de-patologia", "Cadastro tipo patologia"]];
    const operations = [["receitas", "Lançamento receita"], ["apontamentos-comerciais", "Apontamentos comerciais"], ["patologias-sac", "SAC"]];
    const homologation = ["homologacao-comercial", "Cadastro de homologação comercial"];
    const pair = ([id, label]) => entityById(id) ? `<article class="commercial-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    container.innerHTML = `<section class="module-page commercial-module-page" aria-labelledby="moduleTitle"><header class="module-heading commercial-module-heading"><div><p class="page-eyebrow">I7 · GERAL COMERCIAL</p><h1 id="moduleTitle">Comercial</h1><p class="module-page-intro">Cadastros, receitas e atendimento comercial em um fluxo simples.</p></div></header><div class="commercial-workspace"><section class="commercial-column commercial-catalog" aria-labelledby="commercialCatalogTitle"><div class="commercial-column-heading"><span class="commercial-column-kicker">Cadastros</span><h2 id="commercialCatalogTitle">Bases comerciais</h2><p>Cadastre e consulte clientes, imóveis, corretores e classificações.</p></div><div class="commercial-action-list">${registrations.map(entry => pair(entry)).join("")}</div></section><section class="commercial-column commercial-operations" aria-labelledby="commercialOperationsTitle"><div class="commercial-column-heading"><span class="commercial-column-kicker">Operação</span><h2 id="commercialOperationsTitle">Receitas e atendimento</h2><p>Registre receitas e acompanhe apontamentos comerciais e solicitações do SAC.</p></div><div class="commercial-action-list">${operations.map(entry => pair(entry)).join("")}</div><div class="commercial-homologation">${pair(homologation)}</div></section></div></section>`;
    return;
  }
  if (moduleId === "rh-obras" && !options.entities) {
    const people = [["empreiteiros", "Cadastro fornecedor"], ["atividades-executadas", "Cadastrar atividade executada"], ["profissoes", "Cadastro profissão"], ["descricoes-de-presenca", "Lançamento descritivo presença"], ["demonstrativos-de-etapa", "Cadastro etapa obra"]];
    const operations = [["presencas", "Presença semanal"], ["tarefas-delegadas", "Nova delegação"], ["inconsistencias", "Apontamento inconsistências"], ["diarios-de-obras", "Cadastro diário de obras"]];
    const contracts = [["linhas-de-contrato", "Cadastro contrato"], ["linhas-de-medicao", "Cadastro linha contrato"], ["descricoes-de-medicao", "Cadastrar nova medição"], ["linhas-de-medicao", "Adicionar linha medição"]];
    const pair = ([id, label]) => entityById(id) ? `<article class="hr-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    container.innerHTML = `<section class="module-page hr-module-page" aria-labelledby="moduleTitle"><header class="module-heading hr-module-heading"><div><p class="page-eyebrow">I6 · GERAL RH</p><h1 id="moduleTitle">Recursos Humanos e Obras</h1><p class="module-page-intro">Pessoas, presença, tarefas e acompanhamento da execução.</p></div></header><div class="hr-workspace"><section class="hr-column hr-people" aria-labelledby="hrPeopleTitle"><div class="hr-column-heading"><span class="hr-column-kicker">Cadastros</span><h2 id="hrPeopleTitle">Pessoas e registros</h2><p>Cadastre informações de apoio e consulte os registros já existentes.</p></div><div class="hr-action-list">${people.map(pair).join("")}</div></section><section class="hr-column hr-operations" aria-labelledby="hrOperationsTitle"><div class="hr-column-heading"><span class="hr-column-kicker">Execução</span><h2 id="hrOperationsTitle">Presença, tarefas e obras</h2><p>Registre atividades e acompanhe a rotina da obra.</p></div><div class="hr-action-list">${operations.map(pair).join("")}</div><div class="hr-contracts"><h2>Contratos e medições</h2><div class="hr-action-list">${contracts.map(pair).join("")}</div></div></section></div></section>`;
    return;
  }
  if (moduleId === "patrimonio-locacoes" && !options.entities) {
    const operations = [["homologacao-de-documentos", "Homologar documentos"], ["provisoes-de-pagamento", "Programação de pagamentos"], ["despesas-recorrentes", "Despesas recorrentes"]];
    const registrations = [["grupos-de-imoveis", "Cadastro grupo imóvel"], ["imoveis", "Cadastro imóvel"], ["inquilinos", "Cadastrar inquilino"], ["cadastros-de-aluguel", "Cadastrar contrato"], ["tipos-de-homologacao-de-locacao", "Cadastro tipo homologação"], ["fornecedores-de-locacao", "Cadastrar fornecedor"], ["produtos-de-aluguel", "Cadastro produto"]];
    const pair = ([id, label]) => entityById(id) ? `<article class="property-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    container.innerHTML = `<section class="module-page property-module-page" aria-labelledby="moduleTitle"><header class="module-heading property-module-heading"><div><p class="page-eyebrow">SCREEN1 · PATRIMÔNIO E LOCAÇÕES</p><h1 id="moduleTitle">Patrimônio e Locações</h1><p class="module-page-intro">Imóveis, contratos, pagamentos e documentação organizados em um só lugar.</p></div></header><div class="property-workspace"><section class="property-column property-operations" aria-labelledby="propertyOperationsTitle"><div class="property-column-heading"><span class="property-column-kicker">Operação</span><h2 id="propertyOperationsTitle">Pagamentos e homologações</h2><p>Trate pendências e consulte as galerias correspondentes.</p></div><div class="property-action-list">${operations.map(pair).join("")}</div></section><section class="property-column property-catalog" aria-labelledby="propertyCatalogTitle"><div class="property-column-heading"><span class="property-column-kicker">Cadastros</span><h2 id="propertyCatalogTitle">Imóveis e locações</h2><p>Cadastre e consulte os registros usados na administração patrimonial.</p></div><div class="property-action-list">${registrations.map(pair).join("")}</div></section></div></section>`;
    return;
  }
  if (moduleId === "auditoria-compliance" && !options.entities) {
    const registrations = [["grupos-de-documentos-por-filial", "Cadastrar grupo documento"], ["tipos-de-documento", "Cadastro tipo documento"], ["tipos-de-auditoria", "Cadastro tipo auditoria"]];
    const audits = [["documentos-operacionais", "Cadastro documentos"], ["grupos-de-documentos-por-filial", "Auditoria por filial"]];
    const pair = ([id, label]) => entityById(id) ? `<article class="audit-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    const auditGallery = entityById("auditorias") ? `<article class="audit-action-row"><h3>Galeria auditoria</h3><div class="module-entity-actions">${suppliesCommand("auditorias")}</div></article>` : "";
    container.innerHTML = `<section class="module-page audit-module-page" aria-labelledby="moduleTitle"><header class="module-heading audit-module-heading"><div><p class="page-eyebrow">I8 · GERAL AUDITORIA</p><h1 id="moduleTitle">Auditoria e Compliance</h1><p class="module-page-intro">Documentos, auditorias e grupos de controle organizados para consulta rápida.</p></div></header><div class="audit-workspace"><section class="audit-column audit-catalog" aria-labelledby="auditCatalogTitle"><div class="audit-column-heading"><span class="audit-column-kicker">Cadastros</span><h2 id="auditCatalogTitle">Cadastros</h2><p>Configure os tipos e grupos utilizados nas auditorias.</p></div><div class="audit-action-list">${registrations.map(pair).join("")}</div></section><section class="audit-column audit-operations" aria-labelledby="auditOperationsTitle"><div class="audit-column-heading"><span class="audit-column-kicker">Controle</span><h2 id="auditOperationsTitle">Auditoria e documentos</h2><p>Registre documentos e consulte as galerias de controle.</p></div><div class="audit-action-list">${auditGallery}${audits.map(pair).join("")}</div></section></div></section>`;
    return;
  }
  container.innerHTML = `
    <section class="module-page" aria-labelledby="moduleTitle">
      <header class="module-heading"><p class="page-eyebrow">${escapeHtml(module?.title || "Área administrativa")}</p><h1 id="moduleTitle">${escapeHtml(module?.title || "Área administrativa")}</h1></header>
      <div class="module-entity-list">
        ${entities.map(entity => `<article class="module-entity-card"><h2>${escapeHtml(entity.title)}</h2><div class="module-entity-actions"><a class="module-entity-command module-entity-gallery" href="#/entity/${encodeURIComponent(entity.id)}">Galeria</a>${canCreateEntity(entity) ? `<a class="module-entity-command module-entity-create" href="#/entity/${encodeURIComponent(entity.id)}/new">Lançamento</a>` : ""}</div></article>`).join("") || '<p class="dashboard-empty">Nenhuma fonte foi configurada nesta área.</p>'}
      </div>
    </section>`;
}

function renderRoute(route, session) {
  portalShell?.setActiveRoute(route);
  if (!portalShell?.content) return;
  pageLifecycle.replace(() => {
    if (route.name === "dashboard") {
      return renderDashboard(portalShell.content, {
        access: session.access,
        modules: MODULES,
        entities: ENTITIES,
        can,
        repository: sharepointRepository,
        isSuperAdmin: session.isSuperAdmin,
      });
    }

    if (route.name === "audit") {
      return renderAuditPage(portalShell.content, {
        access: session.access,
        entities: ENTITIES,
        can,
        repository: sharepointRepository,
      });
    }

    if (route.name === "access") {
      return createAccessPage(portalShell.content, {
        repository: accessRepository,
        modules: MODULES,
        actorEmail: session.email,
        config: portalConfig,
        onBack: () => portalRouter.navigate("dashboard"),
      });
    }

    if (route.name === "reports") {
      return createReportsRoutePage(portalShell.content, session);
    }

    if (route.name === "analytics") {
      return createAnalyticsRoutePage(portalShell.content, route, session);
    }

    if (route.name === "module") {
      renderModuleLanding(portalShell.content, route.params.moduleId, {
        access: session.access,
        can,
      });
      return undefined;
    }

    const entity = ENTITIES.find(candidate => candidate.id === route.params.entityId);
    if (route.name === "item") {
      return createItemDetailPage(portalShell.content, {
        entity,
        itemId: route.params.itemId,
        repository: sharepointRepository,
        access: session.access,
        can,
        isSuperAdmin: session.isSuperAdmin,
        onDeleted: feedback => {
          navigationFeedback.set(feedback);
          portalRouter.navigate("entity", { entityId: entity.id });
        },
      });
    }
    const feedback = navigationFeedback.consume(entity.id);
    return createEntityPage(portalShell.content, {
      entity,
      repository: sharepointRepository,
      access: session.access,
      can,
      initialMessage: feedback?.message,
      initialFormOpen: route.name === "entity-create",
    });
  });
}

async function signOutPortal() {
  pageLifecycle.dispose();
  sharepointRepository?.clearCache?.();
  await microsoftAuthClient?.signOut?.();
}

function mountAuthorizedPortal(account, access) {
  unsubscribeRoute?.();
  pageLifecycle.dispose();
  portalShell?.cleanup?.();
  const session = {
    account,
    access,
    email: accountEmail(account),
    modules: MODULES,
    entities: ENTITIES,
    can,
    isSuperAdmin: isSuperAdmin(accountEmail(account), portalConfig.superAdminEmail),
    onLogout: signOutPortal,
  };
  portalShell = renderAppShell(portalRoot, session);
  portalRouter = createRouter(PORTAL_ROUTES, {
    canRoute: route => isRouteAllowed(route, session),
  });
  unsubscribeRoute = portalRouter.subscribe(route => {
    if (route.fallback && globalThis.window?.location?.hash !== route.hash) {
      portalRouter.navigate(route.name, route.params);
      return;
    }
    renderRoute(route, session);
  });
}

export async function handleMicrosoftLogin() {
  if (!microsoftAuthClient) {
    throw new Error("O login Microsoft ainda nao esta disponivel.");
  }

  return microsoftAuthClient.signIn();
}

export async function switchMicrosoftAccount() {
  if (!microsoftAuthClient) {
    throw new Error("O login Microsoft ainda nao esta disponivel.");
  }

  return microsoftAuthClient.switchAccount();
}

export async function resolveMicrosoftLogin(account, authClient = microsoftAuthClient, view = loginView) {
  if (account) {
    authClient.clearAutomaticLoginGuard();
    return account;
  }

  if (!authClient.claimAutomaticLogin()) {
    view.setReady("O login Microsoft não foi concluído. Tente novamente.");
    return null;
  }

  view.setLoading("Abrindo login Microsoft...");
  try {
    await authClient.signIn();
  } catch (error) {
    view.setError("Não foi possível entrar com Microsoft agora. Tente novamente.");
    console.error(error);
  }
  return null;
}

export async function initializePortal() {
  loginView = renderLoginView(portalRoot, {
    onSignIn: handleMicrosoftLogin,
    onSwitchAccount: switchMicrosoftAccount,
  });

  try {
    microsoftAuthClient = createMicrosoftAuth(portalConfig.microsoft);
    const account = await microsoftAuthClient.initialize();

    if (!await resolveMicrosoftLogin(account)) return;
    // Confirma a permissão de leitura antes de montar qualquer tela. Se o
    // consentimento for necessário, o MSAL redireciona e esta execução para;
    // ao retornar, os painéis não são renderizados com fontes vazias.
    if (!await microsoftAuthClient.getToken(["Sites.Read.All"])) return;

    accessRepository = createPortalAccessRepository();
    const access = await accessRepository.getCurrentAccess(accountIdentity(account));
    if (!hasAdministrativeAccess(access)) {
      microsoftAuthClient.clearAccount();
      showAccessDenied(account, access);
      return;
    }

    mountAuthorizedPortal(account, access);
  } catch (error) {
    const account = microsoftAuthClient?.getAccount?.();
    if (account) showSetupError(account, error);
    else loginView.setError("Não foi possível carregar o login Microsoft.");
    console.error(error);
  }
}

if (portalRoot) initializePortal();
