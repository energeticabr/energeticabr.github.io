import { portalConfig } from "../portal/config.js";

function cleanPageUrl(locationHref) {
  try {
    const url = new URL(locationHref);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "https://www.energeticabr.com/";
  }
}

function accountEmail(account) {
  return String(
    account?.username
      || account?.idTokenClaims?.preferred_username
      || account?.idTokenClaims?.email
      || "",
  ).trim();
}

function accountName(account, email) {
  const statedName = String(account?.name || account?.idTokenClaims?.name || "").trim();
  return statedName || email.split("@")[0] || "Conta Microsoft";
}

export function createPublicAccountController({
  root,
  msal = globalThis.msal,
  microsoftConfig = portalConfig.microsoft,
  locationHref = globalThis.location?.href,
} = {}) {
  const nameElement = root?.querySelector?.("[data-public-account-name]");
  const emailElement = root?.querySelector?.("[data-public-account-email]");
  const signOutButton = root?.querySelector?.("[data-public-account-signout]");
  let client = null;
  let account = null;
  let signOutBound = false;

  async function signOut() {
    if (!client || !account) return;
    if (signOutButton) signOutButton.disabled = true;

    try {
      await client.logoutRedirect({
        account,
        postLogoutRedirectUri: cleanPageUrl(locationHref),
      });
    } catch {
      if (signOutButton) signOutButton.disabled = false;
    }
  }

  return Object.freeze({
    async initialize() {
      if (root) root.hidden = true;
      const PublicClientApplication = msal?.PublicClientApplication;
      if (!root || !PublicClientApplication || !microsoftConfig?.clientId) return null;

      try {
        client = new PublicClientApplication({
          auth: {
            clientId: microsoftConfig.clientId,
            authority: microsoftConfig.authority,
            redirectUri: microsoftConfig.redirectUri,
          },
          cache: {
            cacheLocation: "sessionStorage",
            storeAuthStateInCookie: false,
          },
        });
        await client.initialize?.();
        account = client.getActiveAccount?.() || client.getAllAccounts?.()[0] || null;
        if (!account) return null;

        client.setActiveAccount?.(account);
        const email = accountEmail(account);
        if (nameElement) nameElement.textContent = accountName(account, email);
        if (emailElement) emailElement.textContent = email;
        if (signOutButton && !signOutBound) {
          signOutButton.addEventListener("click", signOut);
          signOutBound = true;
        }
        root.hidden = false;
        return account;
      } catch {
        account = null;
        client = null;
        root.hidden = true;
        return null;
      }
    },
  });
}

async function initializePublicAccount() {
  const root = document.querySelector("[data-public-account]");
  if (!root) return;
  await createPublicAccountController({ root }).initialize();
}

if (typeof document !== "undefined") {
  initializePublicAccount();
}
