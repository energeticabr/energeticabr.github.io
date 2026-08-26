import { ACTIONS, can, isSuperAdmin, sanitizeModuleId } from "../access/access-model.js";
import { normalizeEmail } from "../core/utils.js";
import {
  PERMISSION_KINDS,
  PORTAL_BASE_PERMISSIONS,
  FULL_CONTROL_MASK,
  maskForPermissionNames,
  permissionMaskValue,
  permissionMaskSignature,
  portalActionMask,
} from "./sharepoint-permissions.js";

export const SECURITY_APPLY_CONFIRMATION = "APLICAR SEGURANCA SHAREPOINT";

function roleDefinition(name, action) {
  return Object.freeze({ name, permissions: Object.freeze(action === "view" ? [...PORTAL_BASE_PERMISSIONS] : [...PORTAL_BASE_PERMISSIONS, action]) });
}

const ROLE_DEFINITIONS = Object.freeze({
  view: roleDefinition("ENERGETICA PORTAL - LEITURA", "view"),
  create: roleDefinition("ENERGETICA PORTAL - CRIACAO", "create"),
  edit: roleDefinition("ENERGETICA PORTAL - EDICAO", "edit"),
  delete: roleDefinition("ENERGETICA PORTAL - EXCLUSAO", "delete"),
  approve: roleDefinition("ENERGETICA PORTAL - APROVACAO", "approve"),
});

function assertSuperAdmin(identity, configuredEmail) {
  if (!isSuperAdmin(identity?.email, configuredEmail)) {
    throw new Error("Somente o superadministrador pode configurar a seguranca SharePoint.");
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

async function stableHash(value) {
  if (!globalThis.crypto?.subtle) throw new Error("A prova criptografica da configuracao nao esta disponivel.");
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(value)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function portalGroupName(moduleId, action) {
  const moduleName = sanitizeModuleId(moduleId);
  const normalizedAction = String(action || "").trim().toUpperCase();
  if (!moduleName || !ACTIONS.includes(normalizedAction.toLowerCase())) {
    throw new RangeError("Modulo ou acao invalido para grupo SharePoint.");
  }
  return `ENERGETICA_PORTAL_${moduleName}_${normalizedAction}`;
}

function accessReadGroup() {
  return Object.freeze({
    name: portalGroupName("access", "view"),
    moduleId: "access",
    action: "view",
    title: "Acessos do portal - leitura",
  });
}

function moduleGroups(modules) {
  return modules.flatMap(module => ACTIONS.map(action => Object.freeze({
    name: portalGroupName(module.id, action),
    moduleId: module.id,
    action,
    title: `${module.title} - ${action}`,
  })));
}

function resolvedList(list) {
  return list?.status === "resolved" && list?.id;
}

function plannedAssignments(list, groups, superAdminEmail) {
  const assignments = [{ principal: { email: superAdminEmail }, role: "FULL_CONTROL" }];
  for (const group of groups.filter(candidate => list.groupNames.includes(candidate.name))) {
    assignments.push({ principal: { groupName: group.name }, role: ROLE_DEFINITIONS[group.action].name });
  }
  return assignments;
}

function assignmentPrincipal(assignment) {
  const member = assignment?.Member || {};
  const principalType = Number(member.PrincipalType);
  return principalType === 1
    ? `user:${normalizeEmail(member.Email || member.UserPrincipalName)}`
    : principalType === 8
      ? `group:${String(member.Title || "").trim()}`
      : "";
}

function aclAssignmentKey(assignment, expectedRoles) {
  const principal = assignmentPrincipal(assignment);
  const bindings = assignment?.RoleDefinitionBindings?.results || assignment?.RoleDefinitionBindings;
  if (!principal || !Array.isArray(bindings) || bindings.length !== 1) return "";
  const binding = bindings[0];
  if (principal.startsWith("user:") && Number(binding?.RoleTypeKind) === 5) {
    return permissionMaskValue(binding?.BasePermissions) === FULL_CONTROL_MASK
      ? `${principal}|FULL_CONTROL`
      : `${principal}|INVALID_BASE_PERMISSIONS`;
  }
  const expected = expectedRoles.get(principal);
  if (!expected || Number(binding?.RoleTypeKind) !== 0) return "";
  const actualMask = permissionMaskSignature(binding?.BasePermissions);
  return actualMask && actualMask === expected.mask ? `${principal}|${expected.key}` : `${principal}|INVALID_BASE_PERMISSIONS`;
}

function expectedAssignmentKeys(list, allGroups, superAdminEmail) {
  return new Set(plannedAssignments(list, allGroups, superAdminEmail).map(assignment => {
    const principal = assignment.principal.email
      ? `user:${normalizeEmail(assignment.principal.email)}`
      : `group:${assignment.principal.groupName}`;
    const role = assignment.role === "FULL_CONTROL" ? "FULL_CONTROL" : assignment.role.toUpperCase();
    return `${principal}|${role}`;
  }));
}

function expectedRoleContract(list, allGroups, superAdminEmail) {
  const roles = new Map([[`user:${normalizeEmail(superAdminEmail)}`, Object.freeze({ key: "FULL_CONTROL", mask: "" })]]);
  for (const group of allGroups.filter(candidate => list.groupNames.includes(candidate.name))) {
    const definition = ROLE_DEFINITIONS[group.action];
    roles.set(`group:${group.name}`, Object.freeze({
      key: definition.name.toUpperCase(),
      mask: permissionMaskSignature(maskForPermissionNames(definition.permissions)),
    }));
  }
  return roles;
}

function canonicalSecurity(security) {
  return {
    unique: security?.HasUniqueRoleAssignments === true,
    assignments: (security?.RoleAssignments || []).map(assignment => ({
      principal: assignmentPrincipal(assignment),
      bindings: (assignment?.RoleDefinitionBindings?.results || assignment?.RoleDefinitionBindings || []).map(binding => ({
        id: Number(binding?.Id || 0),
        roleTypeKind: Number(binding?.RoleTypeKind),
        basePermissions: permissionMaskSignature(binding?.BasePermissions),
      })).sort((left, right) => left.id - right.id || left.roleTypeKind - right.roleTypeKind),
    })).sort((left, right) => left.principal.localeCompare(right.principal)),
  };
}

export function createSharePointAclService({
  sharepoint,
  entities = [],
  modules = [],
  config,
  getCurrentIdentity = () => ({}),
} = {}) {
  if (!sharepoint?.resolveList || !sharepoint?.getListAdministrativeSecurity) {
    throw new TypeError("O servico de ACL requer o repositorio SharePoint administrativo.");
  }
  const superAdminEmail = normalizeEmail(config?.superAdminEmail);
  const groups = Object.freeze([accessReadGroup(), ...moduleGroups(modules)]);

  async function buildSecurityPlan(requireSuperAdmin = true) {
    if (requireSuperAdmin) assertSuperAdmin(getCurrentIdentity(), superAdminEmail);
    const plannedLists = [];
    const missing = [];
    const seen = new Set();

    const accessList = await sharepoint.resolveList("company", ["PORTAL_ACESSOS", "PORTAL ACESSOS"]);
    if (resolvedList(accessList)) {
      seen.add(`company:${accessList.id}`);
      plannedLists.push({
        siteKey: "company",
        id: String(accessList.id),
        displayName: accessList.displayName || "PORTAL_ACESSOS",
        moduleId: "access",
        groupNames: [portalGroupName("access", "view")],
        currentSecurity: await sharepoint.getListAdministrativeSecurity("company", accessList.id),
      });
    } else {
      missing.push("PORTAL_ACESSOS");
    }

    for (const entity of entities) {
      const list = await sharepoint.resolveList(entity.siteKey, entity.listNames);
      if (!resolvedList(list)) {
        missing.push(entity.title || entity.id);
        continue;
      }
      const key = `${entity.siteKey}:${list.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plannedLists.push({
        siteKey: entity.siteKey,
        id: String(list.id),
        displayName: list.displayName || entity.title || entity.id,
        moduleId: entity.moduleId,
        groupNames: ACTIONS.map(action => portalGroupName(entity.moduleId, action)),
        currentSecurity: await sharepoint.getListAdministrativeSecurity(entity.siteKey, list.id),
      });
    }

    const serializable = {
      version: 2,
      superAdminEmail,
      groups: groups.map(({ name, moduleId, action, title }) => ({ name, moduleId, action, title })),
      lists: plannedLists.map(({ siteKey, id, displayName, moduleId, groupNames, currentSecurity }) => ({
        siteKey,
        id,
        displayName,
        moduleId,
        groupNames,
        currentSecurity: canonicalSecurity(currentSecurity),
      })),
      missing: [...new Set(missing)].sort(),
    };
    return Object.freeze({
      mode: "preview",
      ...serializable,
      groups,
      lists: Object.freeze(plannedLists.map(list => Object.freeze({ ...list, groupNames: Object.freeze([...list.groupNames]) }))),
      missing: Object.freeze(serializable.missing),
      planHash: await stableHash(serializable),
    });
  }

  async function previewSecuritySetup() {
    return buildSecurityPlan(true);
  }

  async function applySecuritySetup({ planHash, confirmation } = {}) {
    assertSuperAdmin(getCurrentIdentity(), superAdminEmail);
    if (confirmation !== SECURITY_APPLY_CONFIRMATION) {
      throw new Error(`A confirmacao obrigatoria e: ${SECURITY_APPLY_CONFIRMATION}.`);
    }
    const currentPlan = await previewSecuritySetup();
    if (!planHash || planHash !== currentPlan.planHash) {
      throw new Error("A pre-visualizacao mudou. Gere um novo plano antes de aplicar.");
    }
    const touched = [];
    try {
      const siteKeys = [...new Set(currentPlan.lists.map(list => list.siteKey))];
      const userBySite = new Map();
      const roleBySiteAndAction = new Map();
      const groupBySiteAndName = new Map();
      for (const siteKey of siteKeys) {
        userBySite.set(siteKey, await sharepoint.ensureSiteUser(siteKey, superAdminEmail));
        const groupNames = new Set(currentPlan.lists.filter(list => list.siteKey === siteKey).flatMap(list => list.groupNames));
        const actions = new Set(currentPlan.groups.filter(group => groupNames.has(group.name)).map(group => group.action));
        for (const action of actions) {
          roleBySiteAndAction.set(`${siteKey}:${action}`, await sharepoint.ensurePortalRoleDefinition(siteKey, ROLE_DEFINITIONS[action]));
        }
        for (const group of currentPlan.groups.filter(candidate => groupNames.has(candidate.name))) {
          groupBySiteAndName.set(`${siteKey}:${group.name}`, await sharepoint.ensurePortalGroup(siteKey, { title: group.name, description: group.title }));
        }
      }
      for (const list of currentPlan.lists) {
        const user = userBySite.get(list.siteKey);
        const assignments = plannedAssignments(list, currentPlan.groups, superAdminEmail).map(assignment => {
          if (assignment.principal.email) return { ...assignment, principal: { ...assignment.principal, id: user.id } };
          const group = groupBySiteAndName.get(`${list.siteKey}:${assignment.principal.groupName}`);
          const action = currentPlan.groups.find(candidate => candidate.name === assignment.principal.groupName)?.action;
          return {
            ...assignment,
            principal: { ...assignment.principal, id: group?.id },
            roleId: roleBySiteAndAction.get(`${list.siteKey}:${action}`)?.id,
          };
        });
        touched.push(list);
        await sharepoint.configureListRoleAssignments(list.siteKey, list.id, assignments);
      }
      const verification = await verifySecuritySetup();
      if (!verification.verified) {
        throw Object.assign(new Error("A configuracao foi enviada, mas a ACL resultante nao foi comprovada. O portal permanece fechado."), {
          code: "security_setup_unverified",
          verification,
        });
      }
      return Object.freeze({
        status: "verified",
        planHash: verification.planHash,
        previewPlanHash: currentPlan.planHash,
        listsConfigured: currentPlan.lists.length,
      });
    } catch (cause) {
      const restored = [];
      const failures = [];
      for (const list of [...touched].reverse()) {
        try {
          await sharepoint.restoreListRoleAssignments(list.siteKey, list.id, list.currentSecurity);
          restored.push(Object.freeze({ siteKey: list.siteKey, listId: list.id }));
        } catch (error) {
          failures.push(Object.freeze({ siteKey: list.siteKey, listId: list.id, error }));
        }
      }
      const rollback = Object.freeze({
        complete: failures.length === 0,
        restored: Object.freeze(restored),
        failures: Object.freeze(failures),
      });
      const message = rollback.complete
        ? "A configuracao falhou e as ACLs anteriores foram restauradas. O portal permanece fechado."
        : "A configuracao falhou e o rollback ficou incompleto. O portal permanece fechado.";
      throw Object.assign(new Error(message, { cause }), {
        code: rollback.complete ? "security_setup_rolled_back" : "security_setup_partial_failure",
        rollback,
      });
    }
  }

  async function verifySecuritySetup() {
    const plan = await buildSecurityPlan(false);
    const reasons = [];
    for (const list of plan.lists) {
      if (list.currentSecurity?.HasUniqueRoleAssignments !== true) {
        reasons.push(`${list.displayName}: heranca de permissoes ainda ativa.`);
        continue;
      }
      const expected = expectedAssignmentKeys(list, plan.groups, superAdminEmail);
      const expectedRoles = expectedRoleContract(list, plan.groups, superAdminEmail);
      const actual = new Set();
      for (const assignment of list.currentSecurity?.RoleAssignments || []) {
        const key = aclAssignmentKey(assignment, expectedRoles);
        if (!key) {
          reasons.push(`${list.displayName}: atribuicao de funcao nao reconhecida.`);
          continue;
        }
        if (key.endsWith("|INVALID_BASE_PERMISSIONS")) {
          reasons.push(`${list.displayName}: BasePermissions da funcao nao corresponde ao contrato.`);
          continue;
        }
        actual.add(key);
      }
      for (const key of expected) if (!actual.has(key)) reasons.push(`${list.displayName}: atribuicao obrigatoria ausente (${key}).`);
      for (const key of actual) if (!expected.has(key)) reasons.push(`${list.displayName}: atribuicao nao permitida (${key}).`);
    }
    return Object.freeze({
      verified: reasons.length === 0,
      reasons: Object.freeze(reasons),
      warnings: Object.freeze(plan.missing.map(name => `${name}: fonte ainda indisponivel e mantida fechada.`)),
      planHash: plan.planHash,
      proof: reasons.length === 0 ? plan.planHash : "",
    });
  }

  function desiredGroupNames(access) {
    if (!access?.active) return [];
    const desired = [portalGroupName("access", "view")];
    for (const module of modules) {
      for (const action of ACTIONS) {
        if (can(access, module.id, action)) desired.push(portalGroupName(module.id, action));
      }
    }
    return desired;
  }

  async function reconcileUserAccess(access) {
    assertSuperAdmin(getCurrentIdentity(), superAdminEmail);
    const email = normalizeEmail(access?.email);
    if (!email || !access?.oid) throw new Error("O acesso precisa de e-mail e identificador Microsoft antes da reconciliacao.");
    const resolvedEntities = [];
    for (const entity of entities) {
      const list = await sharepoint.resolveList(entity.siteKey, entity.listNames);
      if (!resolvedList(list)) throw new Error(`A lista ${entity.title || entity.id} nao foi localizada durante a verificacao.`);
      resolvedEntities.push({ entity, list });
    }
    const userBySite = new Map();
    for (const siteKey of new Set(resolvedEntities.map(({ entity }) => entity.siteKey))) {
      const user = await sharepoint.ensureSiteUser(siteKey, email);
      userBySite.set(siteKey, user);
      const moduleIds = new Set(resolvedEntities.filter(({ entity }) => entity.siteKey === siteKey).map(({ entity }) => entity.moduleId));
      const managed = groups.filter(group => moduleIds.has(group.moduleId) || (siteKey === "company" && group.moduleId === "access")).map(group => group.name);
      const desired = desiredGroupNames(access).filter(name => managed.includes(name));
      await sharepoint.syncPortalGroupMemberships(siteKey, user, desired, managed);
    }

    for (const { entity, list } of resolvedEntities) {
      const user = userBySite.get(entity.siteKey);
      const security = await sharepoint.getUserListEffectivePermissions(entity.siteKey, list.id, user.loginName || email);
      if (security?.HasUniqueRoleAssignments !== true) throw new Error(`A lista ${entity.title || entity.id} ainda herda permissoes.`);
      const actualMask = permissionMaskValue(security.EffectiveBasePermissions);
      if (actualMask === undefined) throw new Error(`As permissoes de ${entity.title || entity.id} nao puderam ser comprovadas.`);
      const expectedMask = portalActionMask(access, entity.moduleId);
      if (actualMask !== expectedMask) throw new Error(`As permissoes de ${entity.title || entity.id} contem direitos fora do contrato ou uma concessao esperada nao foi reconciliada.`);
    }
    return Object.freeze({ status: "verified", email, desiredGroups: Object.freeze(desiredGroupNames(access)) });
  }

  async function denyUser(access) {
    const denied = {
      ...access,
      active: false,
      permissions: Object.fromEntries(Object.entries(access?.permissions || {}).map(([moduleId, permissions]) => [
        moduleId,
        { ...permissions },
      ])),
    };
    for (const module of modules) {
      denied.permissions[module.id] = Object.fromEntries(ACTIONS.map(action => [action, false]));
    }
    assertSuperAdmin(getCurrentIdentity(), superAdminEmail);
    const email = normalizeEmail(denied.email);
    if (!email || !denied.oid) throw new Error("O acesso precisa de e-mail e identificador Microsoft antes da revogacao.");
    const siteKeys = [...new Set(["company", ...entities.map(entity => entity.siteKey)])].sort();
    const failures = [];
    for (const siteKey of siteKeys) {
      try {
        const user = await sharepoint.ensureSiteUser(siteKey, email);
        const moduleIds = new Set(entities.filter(entity => entity.siteKey === siteKey).map(entity => entity.moduleId));
        const managed = groups
          .filter(group => moduleIds.has(group.moduleId) || (siteKey === "company" && group.moduleId === "access"))
          .map(group => group.name);
        await sharepoint.syncPortalGroupMemberships(siteKey, user, [], managed);
      } catch (error) {
        failures.push(Object.freeze({ siteKey, error }));
      }
    }
    if (failures.length) {
      throw Object.assign(new AggregateError(failures.map(failure => failure.error), "A revogacao de grupos ficou incompleta."), {
        code: "group_revocation_incomplete",
        failures: Object.freeze(failures),
      });
    }
    return Object.freeze({ status: "verified", email, desiredGroups: Object.freeze([]) });
  }

  return Object.freeze({
    previewSecuritySetup,
    applySecuritySetup,
    verifySecuritySetup,
    reconcileUserAccess,
    denyUser,
    desiredGroupNames,
  });
}

export { ROLE_DEFINITIONS };
