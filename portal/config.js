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

export const portalConfig = Object.freeze({
  microsoft: Object.freeze({
    tenantId: "0c10f511-7ede-4702-a2d9-bedb26937e0e",
    clientId: "94018e25-f756-4aa6-974e-27b8b43d7fe9",
    authority: "https://login.microsoftonline.com/0c10f511-7ede-4702-a2d9-bedb26937e0e",
    redirectUri: "https://www.energeticabr.com/admin.html",
    scopes: Object.freeze(["User.Read", "Sites.ReadWrite.All"]),
  }),
  superAdminEmail: "bernardonotini@energeticabr.com",
  sharepointSites: SHAREPOINT_SITES,
});

export default portalConfig;
