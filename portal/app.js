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
import { createSharePointRepository } from "./data/sharepoint-repository.js";
import { renderAppShell } from "./ui/app-shell.js";
import { renderLoginView } from "./ui/login-view.js";
import { renderDashboard } from "./ui/dashboard-page.js";
import { renderAuditPage } from "./audit/audit-page.js";
import { createAccessPage } from "./ui/access-page.js";
import { createEntityPage } from "./ui/entity-page.js";
import { createItemDetailPage } from "./ui/item-detail.js";
import { createReportsPage } from "./reports/reports-page.js";
import { canViewAnalyticsPanel } from "./analytics/analytics-access.js";
import { createAnalyticsPage } from "./analytics/analytics-page.js";
import { ANALYTICS_DEFINITIONS, analyticsDefinitionById } from "./analytics/definitions/index.js";
import { getPowerAppsUiContract } from "./catalog/powerapps-ui-contract.js";

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
  const suppliesCommand = (id, create = false) => {
    const entity = entityById(id);
    if (!entity || (create && !canCreateEntity(entity))) return "";
    return `<a class="module-entity-command ${create ? "module-entity-create" : "module-entity-gallery"}" href="#/entity/${encodeURIComponent(id)}${create ? "/new" : ""}">${create ? "Lançamento" : "Galeria"}</a>`;
  };
  const suppliesPair = (id, label, single = false) => entityById(id) ? `<article class="supplies-action-row${single ? " supplies-action-single" : ""}"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, !single)}${suppliesCommand(id)}</div></article>` : "";
  if (moduleId === "suprimentos" && !options.entities) {
    const operations = [["lancamentos", "Novo lançamento"], ["compras", "Pedidos efetuados"], ["novas-cotacoes", "Nova cotação"], ["orcamentos", "Orçamentos"]];
    const support = [["comprovantes-de-pagamento", "Comprovante de pagamento"], ["provisoes-de-pagamento", "Programação de pagamentos"], ["despesas-recorrentes", "Despesas recorrentes"]];
    const registrations = [["contas", "Cadastro conta"], ["fornecedores", "Cadastro fornecedor"], ["familias", "Cadastro família"], ["filiais", "Cadastro filial"], ["subfamilias", "Cadastro subfamília"], ["imoveis", "Cadastro imóvel"], ["produtos", "Cadastro produto"], ["cidades", "Cadastro cidade"], ["unidades-de-medida", "Cadastro unidade de material"], ["tipos-de-material", "Cadastro tipo"]];
    const auxiliary = [["grupos-de-imobilizados", "Cadastro grupo imobilizado"], ["imobilizados", "Cadastro imobilizado"], ["homologacoes-de-fornecedor", "Auditoria e compliance"]];
    container.innerHTML = `<section class="module-page supplies-module-page" aria-labelledby="moduleTitle"><header class="module-heading supplies-module-heading"><div><p class="page-eyebrow">I10 · GERAL SUPRIMENTOS</p><h1 id="moduleTitle">Suprimentos</h1><p class="module-page-intro">Lançamentos, cadastros e consultas organizados no mesmo fluxo operacional.</p></div></header><div class="supplies-workspace"><section class="supplies-column supplies-operations" aria-labelledby="operationsTitle"><div class="supplies-column-heading"><span class="supplies-column-kicker">Operação</span><h2 id="operationsTitle">Lançamentos e acompanhamento</h2><p>Use os botões vermelhos para iniciar um registro e as galerias para consultar ou editar o que já existe.</p></div><div class="supplies-action-list">${operations.map(([id, label]) => suppliesPair(id, label)).join("")}</div><div class="supplies-action-list supplies-action-list-wide">${support.map(([id, label]) => suppliesPair(id, label, true)).join("")}</div></section><section class="supplies-column supplies-catalog" aria-labelledby="catalogTitle"><div class="supplies-column-heading"><span class="supplies-column-kicker">Cadastros</span><h2 id="catalogTitle">Bases de apoio</h2><p>Cada cadastro tem sua entrada e sua galeria lado a lado para facilitar a rotina.</p></div><div class="supplies-paired-grid">${registrations.map(([id, label]) => suppliesPair(id, label)).join("")}</div><div class="supplies-secondary-grid">${auxiliary.map(([id, label]) => suppliesPair(id, label)).join("")}</div></section></div></section>`;
    return;
  }
  if (moduleId === "demandas" && !options.entities) {
    const tasks = [["cadastro-de-tarefas", "Nova tarefa"], ["tarefas-delegadas", "Nova delegação"], ["tarefas-recorrentes", "Tarefas recorrentes"]];
    const communication = [["mensagens-programadas", "E-mail agendado"], ["lancamentos-de-tarefas", "Lançamentos de tarefas"]];
    const pair = ([id, label]) => entityById(id) ? `<article class="demands-action-row"><h3>${escapeHtml(label)}</h3><div class="module-entity-actions">${suppliesCommand(id, true)}${suppliesCommand(id)}</div></article>` : "";
    container.innerHTML = `<section class="module-page demands-module-page" aria-labelledby="moduleTitle"><header class="module-heading demands-module-heading"><div><p class="page-eyebrow">I4 · GERAL TAREFAS</p><h1 id="moduleTitle">Demandas</h1><p class="module-page-intro">Tarefas, delegações e comunicações em um só lugar.</p></div></header><div class="demands-workspace"><section class="demands-column demands-tasks" aria-labelledby="demandsTasksTitle"><div class="demands-column-heading"><span class="demands-column-kicker">Tarefas</span><h2 id="demandsTasksTitle">Planejar e acompanhar</h2><p>Crie novas demandas ou abra a galeria para consultar e editar registros.</p></div><div class="demands-action-list">${tasks.map(pair).join("")}</div></section><section class="demands-column demands-communication" aria-labelledby="demandsCommunicationTitle"><div class="demands-column-heading"><span class="demands-column-kicker">Comunicação</span><h2 id="demandsCommunicationTitle">Agendamentos e acompanhamento</h2><p>Organize mensagens e registros que apoiam a execução das tarefas.</p></div><div class="demands-action-list">${communication.map(pair).join("")}</div></section></div></section>`;
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
