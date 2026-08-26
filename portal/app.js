import portalConfig from "./config.js";

const portalRoot = document.getElementById("portalRoot");
const portalLoading = document.getElementById("portalLoading");
const loginPanel = document.getElementById("loginPanel");
const loginStatus = document.getElementById("loginStatus");
const microsoftLoginBtn = document.getElementById("microsoftLoginBtn");
const sessionPanel = document.getElementById("sessionPanel");
let microsoftAuthClient;

function setStatus(message = "", state = "") {
  loginStatus.textContent = message;
  loginStatus.dataset.state = state;
}

function setReadyState() {
  portalLoading.hidden = true;
  loginPanel.hidden = false;
  portalRoot?.setAttribute("aria-busy", "false");
}

function showSession(account) {
  portalLoading.hidden = true;
  loginPanel.hidden = true;
  sessionPanel.hidden = false;
  sessionPanel.querySelector("[data-session-name]").textContent = account?.name || account?.username || "Administrador";
  portalRoot?.setAttribute("aria-busy", "false");
}

function createMicrosoftClient() {
  const PublicClientApplication = globalThis.msal?.PublicClientApplication;
  if (!PublicClientApplication) return null;

  return new PublicClientApplication({
    auth: {
      clientId: portalConfig.microsoft.clientId,
      authority: portalConfig.microsoft.authority,
      redirectUri: portalConfig.microsoft.redirectUri,
    },
  });
}

export async function handleMicrosoftLogin() {
  if (!microsoftAuthClient) {
    setStatus("O login Microsoft ainda nao esta disponivel.", "error");
    return;
  }

  microsoftLoginBtn.disabled = true;
  setStatus("Abrindo login Microsoft...");
  try {
    await microsoftAuthClient.loginRedirect({ scopes: portalConfig.microsoft.scopes });
  } catch (error) {
    microsoftLoginBtn.disabled = false;
    setStatus("Nao foi possivel entrar com Microsoft agora. Tente novamente.", "error");
    console.error(error);
  }
}

async function initializePortal() {
  microsoftAuthClient = createMicrosoftClient();
  if (!microsoftAuthClient) {
    setReadyState();
    microsoftLoginBtn.disabled = true;
    setStatus("Nao foi possivel carregar o login Microsoft.", "error");
    return;
  }

  try {
    await microsoftAuthClient.initialize?.();
    const redirectResult = await microsoftAuthClient.handleRedirectPromise?.();
    const account = redirectResult?.account
      || microsoftAuthClient.getActiveAccount?.()
      || microsoftAuthClient.getAllAccounts?.()[0];

    if (account) {
      microsoftAuthClient.setActiveAccount?.(account);
      showSession(account);
      return;
    }

    setReadyState();
  } catch (error) {
    setReadyState();
    setStatus("Nao foi possivel carregar o login Microsoft.", "error");
    console.error(error);
  }
}

microsoftLoginBtn.addEventListener("click", handleMicrosoftLogin);
initializePortal();
