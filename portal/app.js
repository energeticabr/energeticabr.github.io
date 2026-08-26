import portalConfig from "./config.js";
import { createMicrosoftAuth } from "./auth/microsoft-auth.js";
import { hasAdministrativeAccess } from "./access/access-model.js";
import { createAccessRepository } from "./access/access-repository.js";
import { MODULES } from "./catalog/modules.js";
import { createGraphClient } from "./data/graph-client.js";
import { createSharePointRepository } from "./data/sharepoint-repository.js";
import { renderLoginView } from "./ui/login-view.js";

const portalRoot = document.getElementById("portalRoot");
let microsoftAuthClient;
let loginView;
let accessRepository;

function accountEmail(account) {
  return account?.username
    || account?.idTokenClaims?.preferred_username
    || account?.idTokenClaims?.email
    || "";
}

function showAuthorizedSession(account) {
  loginView.showSession(account);
}

function showSetupError(account, error) {
  loginView.showUnauthorized(account);
  const status = portalRoot.querySelector("[data-login-status]");
  status.dataset.state = "error";
  status.textContent = error?.message || "Não foi possível verificar o controle de acessos. Somente o superadministrador pode concluir a configuração.";
}

function createPortalAccessRepository() {
  const graph = createGraphClient(scopes => microsoftAuthClient.getToken(scopes));
  const sharepoint = createSharePointRepository(graph, portalConfig.sharepointSites);
  return createAccessRepository({
    sharepoint,
    graph,
    config: portalConfig,
    modules: MODULES,
    getCurrentEmail: () => accountEmail(microsoftAuthClient.getAccount()),
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
    const access = await accessRepository.getCurrentAccess(accountEmail(account));
    if (!hasAdministrativeAccess(access)) {
      microsoftAuthClient.clearAccount();
      loginView.showUnauthorized(account);
      return;
    }

    showAuthorizedSession(account);
  } catch (error) {
    const account = microsoftAuthClient?.getAccount?.();
    if (account) showSetupError(account, error);
    else loginView.setError("Não foi possível carregar o login Microsoft.");
    console.error(error);
  }
}

initializePortal();
