const personalSite = Object.freeze({
  host: "energeticaltda-my.sharepoint.com",
  path: "/personal/bernardonotini_energeticabr_com",
});

const companySite = Object.freeze({
  host: "energeticaltda.sharepoint.com",
  path: "/sites/energetica",
});

export const SHAREPOINT_SITES = Object.freeze({
  personal: personalSite,
  company: companySite,
});

export const MICROSOFT_REDIRECT_URIS = Object.freeze({
  production: "https://www.energeticabr.com/admin.html",
  githubPreview: "https://energeticabr.github.io/admin.html",
  localPreview: "http://localhost:4173/admin.html",
  localPreviewIp: "http://127.0.0.1:4173/admin.html",
});

const MICROSOFT_REDIRECT_ALLOWLIST = new Set(Object.values(MICROSOFT_REDIRECT_URIS));

export function resolveMicrosoftRedirectUri(locationLike = globalThis.window?.location) {
  const href = typeof locationLike === "string" ? locationLike : locationLike?.href;
  if (!href) return MICROSOFT_REDIRECT_URIS.production;

  try {
    const current = new URL(href);
    current.search = "";
    current.hash = "";
    return MICROSOFT_REDIRECT_ALLOWLIST.has(current.href)
      ? current.href
      : MICROSOFT_REDIRECT_URIS.production;
  } catch {
    return MICROSOFT_REDIRECT_URIS.production;
  }
}

export const portalConfig = Object.freeze({
  microsoft: Object.freeze({
    tenantId: "0c10f511-7ede-4702-a2d9-bedb26937e0e",
    clientId: "94018e25-f756-4aa6-974e-27b8b43d7fe9",
    authority: "https://login.microsoftonline.com/0c10f511-7ede-4702-a2d9-bedb26937e0e",
    redirectUri: resolveMicrosoftRedirectUri(),
    scopes: Object.freeze(["openid", "profile", "email", "User.Read"]),
  }),
  superAdminEmail: "bernardonotini@energeticabr.com",
  sharepointSites: SHAREPOINT_SITES,
});

export default portalConfig;
