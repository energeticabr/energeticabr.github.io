import portalConfig from "../config.js";
import { isSuperAdmin } from "../access/access-model.js";

export function isBootstrapAuthorized(accountEmail) {
  return isSuperAdmin(accountEmail, portalConfig.superAdminEmail);
}
