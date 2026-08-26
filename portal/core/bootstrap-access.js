import { normalizeEmail } from "./utils.js";

export const BOOTSTRAP_SUPERADMIN_EMAIL = "bernardonotini@energeticabr.com";

export function isBootstrapAuthorized(accountEmail) {
  return normalizeEmail(accountEmail) === BOOTSTRAP_SUPERADMIN_EMAIL;
}
