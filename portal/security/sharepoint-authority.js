import { ACTIONS, can } from "../access/access-model.js";
import {
  PERMISSION_KINDS,
  FULL_CONTROL_MASK,
  missingPermissionKinds,
  permissionMaskValue,
  portalActionMask,
  unexpectedPermissionKinds,
} from "./sharepoint-permissions.js";

export class SharePointAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SharePointAuthorityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function hasPermission(mask, kind) {
  return (mask & (1n << BigInt(kind - 1))) !== 0n;
}

function effectiveActions(value) {
  const mask = permissionMaskValue(value);
  if (mask === undefined) return undefined;
  return Object.fromEntries(ACTIONS.map(action => [action, hasPermission(mask, PERMISSION_KINDS[action])]));
}

function resolvedListId(list) {
  return list?.status === "resolved" ? String(list.id || "") : "";
}

export function createSharePointAuthority({
  sharepoint,
  entities = [],
  getAccess,
  now = () => Date.now(),
  cacheTtlMs = 15_000,
  isRecoveryAdmin = () => false,
} = {}) {
  if (!sharepoint?.resolveList || !sharepoint?.getListEffectivePermissions) {
    throw new TypeError("A autoridade requer consultas de listas e permissoes efetivas do SharePoint.");
  }
  if (typeof getAccess !== "function") throw new TypeError("A autoridade requer o acesso atual do portal.");

  const targetCache = new Map();
  const permissionCache = new Map();

  async function resolveTarget(siteKey, listId) {
    const key = `${siteKey}:${listId}`;
    if (targetCache.has(key)) return targetCache.get(key);
    const candidates = entities.filter(entity => entity.siteKey === siteKey);
    for (const candidate of candidates) {
      const list = await sharepoint.resolveList(siteKey, candidate.listNames);
      if (resolvedListId(list) === String(listId)) {
        const target = Object.freeze({ entityId: candidate.id, moduleId: candidate.moduleId });
        targetCache.set(key, target);
        return target;
      }
    }
    throw new SharePointAuthorityError(
      "target_not_allowlisted",
      "A lista solicitada nao pertence ao catalogo permitido do portal.",
      { siteKey, listId },
    );
  }

  async function getEffectiveSecurity(siteKey, listId) {
    const key = `${siteKey}:${listId}`;
    const cached = permissionCache.get(key);
    const timestamp = Number(now());
    if (cached && timestamp - cached.at < cacheTtlMs) return cached.value;
    const value = await sharepoint.getListEffectivePermissions(siteKey, listId);
    permissionCache.set(key, { at: timestamp, value });
    return value;
  }

  async function authorize({ siteKey, listId, action } = {}) {
    if (!ACTIONS.includes(action)) {
      throw new SharePointAuthorityError("unknown_action", "A acao solicitada nao pertence ao contrato de seguranca.", { action });
    }
    const target = await resolveTarget(siteKey, listId);
    const access = await getAccess();
    if (!access || access.active !== true || !can(access, target.moduleId, action)) {
      throw new SharePointAuthorityError(
        "portal_grant_denied",
        "O cadastro do portal nao concede esta acao.",
        { ...target, action },
      );
    }

    const security = await getEffectiveSecurity(siteKey, listId);
    if (security?.HasUniqueRoleAssignments !== true) {
      throw new SharePointAuthorityError(
        security?.HasUniqueRoleAssignments === false ? "inherited_permissions" : "unknown_acl_shape",
        "A lista nao possui uma ACL exclusiva comprovada; a operacao foi bloqueada.",
        { ...target, action },
      );
    }
    const serverActions = effectiveActions(security?.EffectiveBasePermissions);
    const serverMask = permissionMaskValue(security?.EffectiveBasePermissions);
    if (!serverActions || serverMask === undefined) {
      throw new SharePointAuthorityError(
        "unknown_effective_permissions",
        "O SharePoint nao retornou permissoes efetivas em formato comprovavel.",
        { ...target, action },
      );
    }
    const expectedMask = isRecoveryAdmin(access) ? FULL_CONTROL_MASK : portalActionMask(access, target.moduleId);
    const unexpectedKinds = unexpectedPermissionKinds(serverMask, expectedMask);
    const missingKinds = missingPermissionKinds(serverMask, expectedMask);
    if (unexpectedKinds.length || missingKinds.length) {
      const extraActions = ACTIONS.filter(candidate => serverActions[candidate] && !can(access, target.moduleId, candidate));
      throw new SharePointAuthorityError(
        "permission_mismatch",
        "A permissao efetiva do SharePoint contem direitos fora do contrato do portal.",
        {
          ...target,
          action,
          unexpectedPermissionKinds: unexpectedKinds,
          missingPermissionKinds: missingKinds,
          extraActions: Object.freeze(extraActions),
        },
      );
    }
    const extraActions = ACTIONS.filter(candidate => serverActions[candidate] && !can(access, target.moduleId, candidate));
    if (extraActions.length) {
      throw new SharePointAuthorityError(
        "permission_mismatch",
        "A permissao efetiva do SharePoint e mais ampla que o cadastro do portal.",
        { ...target, action, extraActions: Object.freeze(extraActions) },
      );
    }
    if (!serverActions[action]) {
      throw new SharePointAuthorityError(
        "sharepoint_grant_denied",
        "O SharePoint nao concede esta acao ao usuario conectado.",
        { ...target, action },
      );
    }
    return Object.freeze({ allowed: true, action, ...target });
  }

  function invalidate() {
    permissionCache.clear();
    targetCache.clear();
  }

  return Object.freeze({ authorize, invalidate, resolveTarget });
}

export { PERMISSION_KINDS, effectiveActions };
