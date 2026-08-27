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

const portalRoot = document.getElementById("portalRoot");
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

function isRouteAllowed(route, session) {
  if (route.name === "dashboard") return true;
  if (route.name === "audit") {
    return ENTITIES.some(entity => entity.available !== false && can(session.access, entity.moduleId, "view"));
  }
  if (route.name === "access") return session.isSuperAdmin;
  if (route.name === "reports") return can(session.access, "relatorios", "view");
  if (route.name === "module") {
    return MODULES.some(module => module.id === route.params.moduleId && module.id !== "usuarios-acessos")
      && can(session.access, route.params.moduleId, "view");
  }
  if (["entity", "item"].includes(route.name)) {
    const entity = ENTITIES.find(candidate => candidate.id === route.params.entityId);
    return Boolean(entity && can(session.access, entity.moduleId, "view"));
  }
  return false;
}

function renderModuleLanding(container, moduleId) {
  const module = MODULES.find(candidate => candidate.id === moduleId);
  const entities = entitiesForModule(moduleId);
  container.innerHTML = `
    <section class="module-page" aria-labelledby="moduleTitle">
      <header class="module-heading"><p class="page-eyebrow">${escapeHtml(module?.title || "Área administrativa")}</p><h1 id="moduleTitle">${escapeHtml(module?.title || "Área administrativa")}</h1></header>
      <div class="module-entity-list">
        ${entities.map(entity => `<a class="module-entity-link" href="#/entity/${encodeURIComponent(entity.id)}"><span>${escapeHtml(entity.title)}</span><span aria-hidden="true">›</span></a>`).join("") || '<p class="dashboard-empty">Nenhuma fonte foi configurada nesta área.</p>'}
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
      return createReportsPage(portalShell.content, {
        entities: ENTITIES,
        repository: sharepointRepository,
        access: session.access,
        can,
      });
    }

    if (route.name === "module") {
      renderModuleLanding(portalShell.content, route.params.moduleId);
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

export async function initializePortal() {
  loginView = renderLoginView(portalRoot, {
    onSignIn: handleMicrosoftLogin,
    onSwitchAccount: switchMicrosoftAccount,
  });

  try {
    microsoftAuthClient = createMicrosoftAuth(portalConfig.microsoft);
    const account = await microsoftAuthClient.initialize();

    if (!account) {
      loginView.setReady();
      return;
    }

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

initializePortal();
