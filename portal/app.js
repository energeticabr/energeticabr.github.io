import portalConfig from "./config.js";
import { createMicrosoftAuth } from "./auth/microsoft-auth.js";
import { isBootstrapAuthorized } from "./core/bootstrap-access.js";
import { renderLoginView } from "./ui/login-view.js";

const portalRoot = document.getElementById("portalRoot");
let microsoftAuthClient;
let loginView;

function accountEmail(account) {
  return account?.username
    || account?.idTokenClaims?.preferred_username
    || account?.idTokenClaims?.email
    || "";
}

function showAuthorizedSession(account) {
  loginView.showSession(account);
}

export async function handleMicrosoftLogin() {
  if (!microsoftAuthClient) {
    throw new Error("O login Microsoft ainda nao esta disponivel.");
  }

  return microsoftAuthClient.signIn();
}

export async function initializePortal() {
  loginView = renderLoginView(portalRoot, { onSignIn: handleMicrosoftLogin });

  try {
    microsoftAuthClient = createMicrosoftAuth(portalConfig.microsoft);
    const account = await microsoftAuthClient.initialize();

    if (!account) {
      loginView.setReady();
      return;
    }

    if (!isBootstrapAuthorized(accountEmail(account))) {
      microsoftAuthClient.clearAccount();
      loginView.showUnauthorized(account);
      return;
    }

    showAuthorizedSession(account);
  } catch (error) {
    loginView.setError("Não foi possível carregar o login Microsoft.");
    console.error(error);
  }
}

initializePortal();
