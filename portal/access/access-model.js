import { MODULES } from "../catalog/modules.js";
import { normalizeEmail } from "../core/utils.js";

export const ACTIONS = Object.freeze(["view", "create", "edit", "delete", "approve"]);

export function sanitizeModuleId(moduleId) {
  return String(moduleId || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function permissionField(moduleId, action) {
  const sanitizedModuleId = sanitizeModuleId(moduleId);
  const normalizedAction = String(action || "").trim().toUpperCase();
  if (!sanitizedModuleId || !ACTIONS.includes(normalizedAction.toLowerCase())) {
    throw new RangeError("Modulo ou acao de permissao invalido.");
  }
  return `MODULO_${sanitizedModuleId}_${normalizedAction}`;
}

function permissionMap(modules, granted = false) {
  return Object.fromEntries(modules.map(({ id }) => [
    id,
    Object.fromEntries(ACTIONS.map(action => [action, granted])),
  ]));
}

export function isSuperAdmin(email, configuredEmail) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedConfiguredEmail = normalizeEmail(configuredEmail);
  return Boolean(normalizedEmail && normalizedConfiguredEmail && normalizedEmail === normalizedConfiguredEmail);
}

export function buildDefaultAccess(email, name = "", modules = MODULES) {
  return {
    id: undefined,
    email: normalizeEmail(email),
    name: String(name || "").trim(),
    active: false,
    profile: "USUARIO",
    changedAt: undefined,
    changedBy: "",
    permissions: permissionMap(modules),
  };
}

export function buildSuperAdminAccess(email, name = "", modules = MODULES) {
  return {
    ...buildDefaultAccess(email, name, modules),
    active: true,
    profile: "SUPERADMIN",
    permissions: permissionMap(modules, true),
  };
}

export function can(accessRecord, moduleId, action) {
  if (!accessRecord || accessRecord.active !== true || !ACTIONS.includes(action)) return false;
  return accessRecord.permissions?.[moduleId]?.[action] === true;
}

export function hasAdministrativeAccess(accessRecord) {
  return Boolean(accessRecord?.active) && Object.values(accessRecord.permissions || {})
    .some(modulePermissions => ACTIONS.some(action => modulePermissions?.[action] === true));
}
