import { NB_APP_NAME, NB_BUNDLE_ID, NB_PORTAL_APP } from "./nb-participacoes.js";

const nb = import.meta.env?.MODE === NB_PORTAL_APP;

export const APP_CONFIG = Object.freeze({
  appName: nb ? NB_APP_NAME : "Energético",
  // Dedicated synthetic account; /api/demo has no company database/network access.
  demoAccessEnabled: !nb,
  allowedEmailDomain: "energeticabr.com",
  bundleId: nb ? NB_BUNDLE_ID : "br.com.energetica.energetico",
  appGroup: nb ? `group.${NB_BUNDLE_ID}` : "group.br.com.energetica.energetico",
  ...(nb ? { portalApp: NB_PORTAL_APP } : {}),
  apiBaseUrl: "https://163-176-171-217.sslip.io",
  tenantId: "0c10f511-7ede-4702-a2d9-bedb26937e0e",
  clientId: "94018e25-f756-4aa6-974e-27b8b43d7fe9",
  webRedirectUri: "https://www.energeticabr.com/energetico/",
  scopes: Object.freeze(["openid", "profile", "email", "User.Read"]),
});
