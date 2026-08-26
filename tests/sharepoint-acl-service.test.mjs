import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { buildDefaultAccess } from "../portal/access/access-model.js";
import {
  SECURITY_APPLY_CONFIRMATION,
  ROLE_DEFINITIONS,
  createSharePointAclService,
  portalGroupName,
} from "../portal/security/sharepoint-acl-service.js";

const modules = Object.freeze([{ id: "suprimentos", title: "Suprimentos" }]);
const entities = Object.freeze([{
  id: "fornecedores",
  moduleId: "suprimentos",
  title: "Fornecedores",
  siteKey: "company",
  listNames: Object.freeze(["FORNECEDORES"]),
}]);

function administrativeAcl() {
  return {
    HasUniqueRoleAssignments: true,
    RoleAssignments: [{
      Member: { PrincipalType: 1, Email: portalConfig.superAdminEmail },
      RoleDefinitionBindings: [{ Name: "Full Control", RoleTypeKind: 5 }],
    }],
  };
}

function createSharePointFake() {
  const mutations = [];
  const aclByList = new Map();
  return {
    mutations,
    async resolveList(_siteKey, aliases) {
      const names = Array.isArray(aliases) ? aliases : [aliases];
      if (names.some(name => String(name).includes("PORTAL"))) {
        return { status: "resolved", id: "11111111-1111-1111-1111-111111111111", displayName: "PORTAL_ACESSOS" };
      }
      if (names.includes("FORNECEDORES")) {
        return { status: "resolved", id: "22222222-2222-2222-2222-222222222222", displayName: "FORNECEDORES" };
      }
      return { status: "missing" };
    },
    async getListAdministrativeSecurity(_siteKey, listId) {
      return aclByList.get(String(listId)) || administrativeAcl();
    },
    async ensurePortalRoleDefinition(siteKey, definition) {
      mutations.push(["ensurePortalRoleDefinition", siteKey, definition]);
      return { id: definition.name };
    },
    async ensurePortalGroup(siteKey, definition) {
      mutations.push(["ensurePortalGroup", siteKey, definition]);
      return { id: mutations.length + 100, title: definition.title };
    },
    async ensureSiteUser(siteKey, email) {
      mutations.push(["ensureSiteUser", siteKey, email]);
      return { id: 7, loginName: `i:0#.f|membership|${email}` };
    },
    async configureListRoleAssignments(siteKey, listId, assignments) {
      mutations.push(["configureListRoleAssignments", siteKey, listId, assignments]);
      aclByList.set(String(listId), {
        HasUniqueRoleAssignments: true,
        RoleAssignments: assignments.map(assignment => ({
          Member: assignment.principal.email
            ? { PrincipalType: 1, Email: assignment.principal.email }
            : { PrincipalType: 8, Title: assignment.principal.groupName },
          RoleDefinitionBindings: [{
            Name: assignment.role === "FULL_CONTROL" ? "Full Control" : assignment.role,
            RoleTypeKind: assignment.role === "FULL_CONTROL" ? 5 : 0,
          }],
        })),
      });
      return { configured: true };
    },
    async syncPortalGroupMemberships(siteKey, user, desiredGroups, managedGroups) {
      mutations.push(["syncPortalGroupMemberships", siteKey, user, desiredGroups, managedGroups]);
    },
    async getUserListEffectivePermissions(_siteKey, _listId, _loginName) {
      return { HasUniqueRoleAssignments: true, EffectiveBasePermissions: { High: "0", Low: "5" } };
    },
  };
}

function service(sharepoint = createSharePointFake()) {
  return {
    sharepoint,
    value: createSharePointAclService({
      sharepoint,
      entities,
      modules,
      config: portalConfig,
      getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }),
    }),
  };
}

test("as funcoes customizadas incluem os direitos basicos necessarios para acesso remoto", () => {
  for (const definition of Object.values(ROLE_DEFINITIONS)) {
    assert.equal(definition.permissions.includes("view"), true);
    assert.equal(definition.permissions.includes("open"), true);
    assert.equal(definition.permissions.includes("viewFormPages"), true);
    assert.equal(definition.permissions.includes("browseUserInfo"), true);
    assert.equal(definition.permissions.includes("useRemoteAPIs"), true);
  }
});

test("a pre-visualizacao e somente leitura e limita o plano as listas catalogadas", async () => {
  const { sharepoint, value } = service();

  const plan = await value.previewSecuritySetup();

  assert.equal(sharepoint.mutations.length, 0);
  assert.equal(plan.mode, "preview");
  assert.match(plan.planHash, /^[a-f0-9]{8}$/);
  assert.deepEqual(plan.lists.map(list => list.displayName).sort(), ["FORNECEDORES", "PORTAL_ACESSOS"]);
  assert.equal(plan.lists.some(list => list.displayName === "LISTA FORA DO CATALOGO"), false);
  assert.equal(plan.groups.some(group => group.name === portalGroupName("suprimentos", "edit")), true);
});

test("a aplicacao exige comando separado e rejeita uma pre-visualizacao obsoleta", async () => {
  const { sharepoint, value } = service();
  const plan = await value.previewSecuritySetup();

  await assert.rejects(value.applySecuritySetup({ planHash: plan.planHash, confirmation: "SIM" }), /confirmacao/i);
  await assert.rejects(value.applySecuritySetup({ planHash: "00000000", confirmation: SECURITY_APPLY_CONFIRMATION }), /mudou/i);
  assert.equal(sharepoint.mutations.length, 0);
});

test("a aplicacao preserva o superadministrador e configura grupos e listas de forma declarativa", async () => {
  const { sharepoint, value } = service();
  const plan = await value.previewSecuritySetup();

  const result = await value.applySecuritySetup({
    planHash: plan.planHash,
    confirmation: SECURITY_APPLY_CONFIRMATION,
  });

  assert.equal(result.status, "verified");
  const listCalls = sharepoint.mutations.filter(([name]) => name === "configureListRoleAssignments");
  assert.equal(listCalls.length, 2);
  for (const call of listCalls) {
    assert.equal(call[3].some(assignment => assignment.principal.email === portalConfig.superAdminEmail && assignment.role === "FULL_CONTROL"), true);
  }
  assert.equal((await value.verifySecuritySetup()).verified, true);
});

test("a reconciliacao sincroniza os grupos desejados e confirma a permissao efetiva", async () => {
  const { sharepoint, value } = service();
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana", modules);
  access.oid = "11111111-2222-4333-8444-555555555555";
  access.active = true;
  access.permissions.suprimentos.view = true;
  access.permissions.suprimentos.edit = true;

  const result = await value.reconcileUserAccess(access);

  assert.equal(result.status, "verified");
  const sync = sharepoint.mutations.find(([name]) => name === "syncPortalGroupMemberships");
  assert.deepEqual(sync[3].sort(), [
    portalGroupName("access", "view"),
    portalGroupName("suprimentos", "edit"),
    portalGroupName("suprimentos", "view"),
  ].sort());
});

test("a revogacao nao altera o objeto de permissoes que veio da interface", async () => {
  const sharepoint = createSharePointFake();
  sharepoint.getUserListEffectivePermissions = async () => ({
    HasUniqueRoleAssignments: true,
    EffectiveBasePermissions: { High: "0", Low: "0" },
  });
  const value = service(sharepoint).value;
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana", modules);
  access.oid = "11111111-2222-4333-8444-555555555555";
  access.active = true;
  access.permissions.suprimentos.view = true;

  await value.denyUser(access);

  assert.equal(access.active, true);
  assert.equal(access.permissions.suprimentos.view, true);
  const sync = sharepoint.mutations.find(([name]) => name === "syncPortalGroupMemberships");
  assert.deepEqual(sync[3], []);
});

test("grupos funcoes e usuarios sao provisionados separadamente em cada site SharePoint", async () => {
  const sharepoint = createSharePointFake();
  const originalResolve = sharepoint.resolveList;
  sharepoint.resolveList = async (siteKey, aliases) => {
    if (siteKey === "personal" && aliases.includes("NOTAS PENDENTES")) {
      return { status: "resolved", id: "33333333-3333-3333-3333-333333333333", displayName: "NOTAS PENDENTES" };
    }
    return originalResolve(siteKey, aliases);
  };
  const value = createSharePointAclService({
    sharepoint,
    entities: [...entities, {
      id: "notas-pendentes",
      moduleId: "suprimentos",
      title: "Notas pendentes",
      siteKey: "personal",
      listNames: ["NOTAS PENDENTES"],
    }],
    modules,
    config: portalConfig,
    getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }),
  });
  const plan = await value.previewSecuritySetup();

  await value.applySecuritySetup({ planHash: plan.planHash, confirmation: SECURITY_APPLY_CONFIRMATION });

  const groupSites = new Set(sharepoint.mutations
    .filter(([name]) => name === "ensurePortalGroup")
    .map(([, siteKey]) => siteKey));
  const userSites = new Set(sharepoint.mutations
    .filter(([name]) => name === "ensureSiteUser")
    .map(([, siteKey]) => siteKey));
  assert.deepEqual([...groupSites].sort(), ["company", "personal"]);
  assert.deepEqual([...userSites].sort(), ["company", "personal"]);
});

test("fontes catalogadas ainda ausentes ficam indisponiveis sem bloquear as listas existentes", async () => {
  const sharepoint = createSharePointFake();
  const value = createSharePointAclService({
    sharepoint,
    entities: [...entities, {
      id: "fonte-futura",
      moduleId: "suprimentos",
      title: "Fonte futura",
      siteKey: "company",
      listNames: ["FONTE FUTURA"],
    }],
    modules,
    config: portalConfig,
    getCurrentIdentity: () => ({ email: portalConfig.superAdminEmail }),
  });
  const plan = await value.previewSecuritySetup();

  const result = await value.applySecuritySetup({ planHash: plan.planHash, confirmation: SECURITY_APPLY_CONFIRMATION });

  assert.equal(result.status, "verified");
  assert.deepEqual(plan.missing, ["Fonte futura"]);
});
