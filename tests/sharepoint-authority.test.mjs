import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultAccess, can } from "../portal/access/access-model.js";
import {
  SharePointAuthorityError,
  createSharePointAuthority,
} from "../portal/security/sharepoint-authority.js";
import {
  PERMISSION_KINDS,
  portalActionMask,
} from "../portal/security/sharepoint-permissions.js";

const entity = Object.freeze({
  id: "fornecedores",
  moduleId: "suprimentos",
  siteKey: "company",
  listNames: Object.freeze(["FORNECEDORES"]),
  capabilities: Object.freeze({ view: true, create: true, edit: true, delete: true, approve: true }),
  listCapabilityEvidence: Object.freeze([Object.freeze({
    listName: "FORNECEDORES",
    capabilities: Object.freeze({ view: true, create: true, edit: true, delete: true, approve: true }),
  })]),
});

function permissionMask(...permissionKinds) {
  const mask = permissionKinds.reduce((value, kind) => value | (1n << BigInt(kind - 1)), 0n);
  return {
    High: String((mask >> 32n) & 0xffffffffn),
    Low: String(mask & 0xffffffffn),
  };
}

function portalPermissionMask(...permissionKinds) {
  return permissionMask(1, 6, 7, 13, 17, 18, 28, 37, 38, ...permissionKinds);
}

function accessWith(grants = {}) {
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana", [{ id: "suprimentos" }]);
  access.active = true;
  Object.assign(access.permissions.suprimentos, grants);
  return access;
}

function createSharePointFake({
  unique = true,
  permissions = portalPermissionMask(),
} = {}) {
  const calls = [];
  return {
    calls,
    async resolveList(siteKey, aliases) {
      calls.push(["resolveList", siteKey, aliases]);
      return { status: "resolved", id: "11111111-1111-1111-1111-111111111111", displayName: "FORNECEDORES" };
    },
    async getListEffectivePermissions(siteKey, listId) {
      calls.push(["getListEffectivePermissions", siteKey, listId]);
      return { HasUniqueRoleAssignments: unique, EffectiveBasePermissions: permissions };
    },
  };
}

test("nega uma acao quando a lista ainda herda permissoes amplas do site", async () => {
  const sharepoint = createSharePointFake({ unique: false, permissions: permissionMask(1, 2, 3, 4, 5) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true, edit: true }),
  });

  await assert.rejects(
    authority.authorize({ siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "edit" }),
    error => error instanceof SharePointAuthorityError && error.code === "inherited_permissions",
  );
});

test("nega todo o modulo quando a permissao efetiva e mais ampla que o cadastro", async () => {
  const sharepoint = createSharePointFake({ permissions: portalPermissionMask(2, 3) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true, edit: true }),
  });

  await assert.rejects(
    authority.authorize({ siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "edit" }),
    error => error instanceof SharePointAuthorityError
      && error.code === "permission_mismatch"
      && error.details.extraActions.includes("create"),
  );
});

test("nega direitos perigosos fora das cinco acoes do portal", async () => {
  const sharepoint = createSharePointFake({ permissions: portalPermissionMask(12) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true }),
  });

  await assert.rejects(
    authority.authorize({ siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "view" }),
    error => error instanceof SharePointAuthorityError
      && error.code === "permission_mismatch"
      && error.details.unexpectedPermissionKinds.includes(12),
  );
});

test("nega o bit reservado 64 mesmo quando todos os demais direitos coincidem", async () => {
  const sharepoint = createSharePointFake({ permissions: portalPermissionMask(64) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true }),
  });

  await assert.rejects(
    authority.authorize({ siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "view" }),
    error => error instanceof SharePointAuthorityError
      && error.code === "permission_mismatch"
      && error.details.unexpectedPermissionKinds.includes(64),
  );
});

test("nega mascara efetiva incompleta mesmo quando a acao principal esta presente", async () => {
  const sharepoint = createSharePointFake({ permissions: permissionMask(1, 3) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true, edit: true }),
  });

  await assert.rejects(
    authority.authorize({ siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "edit" }),
    error => error instanceof SharePointAuthorityError
      && error.code === "permission_mismatch"
      && error.details.missingPermissionKinds.includes(37),
  );
});

test("aceita a mascara Full Control somente para o perfil de recuperacao superadmin", async () => {
  const access = accessWith(Object.fromEntries(["view", "create", "edit", "delete", "approve"].map(action => [action, true])));
  access.profile = "SUPERADMIN";
  const sharepoint = createSharePointFake({
    permissions: { High: "2147483647", Low: "4294967295" },
  });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => access,
    isRecoveryAdmin: candidate => candidate.email === access.email,
  });

  const result = await authority.authorize({
    siteKey: "company",
    listId: "11111111-1111-1111-1111-111111111111",
    action: "delete",
  });

  assert.equal(result.allowed, true);
});

test("superadministrador recupera listas legadas com permissao herdada comprovada", async () => {
  const access = accessWith(Object.fromEntries(["view", "create", "edit", "delete", "approve"].map(action => [action, true])));
  access.profile = "SUPERADMIN";
  const sharepoint = createSharePointFake({
    unique: false,
    permissions: { High: "2147483647", Low: "4294967295" },
  });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => access,
    isRecoveryAdmin: candidate => candidate.email === access.email,
  });

  const result = await authority.authorize({
    siteKey: "company",
    listId: "11111111-1111-1111-1111-111111111111",
    action: "view",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, "view");
});

test("autoriza somente a acao presente no cadastro e na ACL exclusiva", async () => {
  const sharepoint = createSharePointFake({ permissions: portalPermissionMask(3) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true, edit: true }),
  });

  const result = await authority.authorize({
    siteKey: "company",
    listId: "11111111-1111-1111-1111-111111111111",
    action: "edit",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, "edit");
  assert.equal(result.entityId, "fornecedores");
  assert.equal(result.moduleId, "suprimentos");
  assert.equal(result.listId, "11111111-1111-1111-1111-111111111111");
  assert.deepEqual(result.capabilityEvidence.map(evidence => evidence.listName), ["FORNECEDORES"]);
});

test("approve aceita os direitos tecnicos de edicao sem liberar a acao edit no portal", async () => {
  const access = accessWith({ view: true, approve: true, edit: false });
  const expectedMask = portalActionMask(access, "suprimentos");
  const editBit = 1n << BigInt(PERMISSION_KINDS.edit - 1);
  const approveBit = 1n << BigInt(PERMISSION_KINDS.approve - 1);

  assert.equal((expectedMask & editBit) !== 0n, true);
  assert.equal((expectedMask & approveBit) !== 0n, true);
  assert.equal(can(access, "suprimentos", "edit"), false, "a UI deve continuar sem a acao de edicao");

  const sharepoint = createSharePointFake({ permissions: portalPermissionMask(3, 5) });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => access,
  });

  const approved = await authority.authorize({
    siteKey: "company",
    listId: "11111111-1111-1111-1111-111111111111",
    action: "approve",
  });
  assert.equal(approved.allowed, true);
  await assert.rejects(
    authority.authorize({
      siteKey: "company",
      listId: "11111111-1111-1111-1111-111111111111",
      action: "edit",
    }),
    error => error instanceof SharePointAuthorityError && error.code === "portal_grant_denied",
  );
});

test("cacheia por poucos segundos e permite invalidacao explicita", async () => {
  let currentTime = 1_000;
  const sharepoint = createSharePointFake({ permissions: portalPermissionMask() });
  const authority = createSharePointAuthority({
    sharepoint,
    entities: [entity],
    getAccess: async () => accessWith({ view: true }),
    now: () => currentTime,
    cacheTtlMs: 5_000,
  });
  const request = { siteKey: "company", listId: "11111111-1111-1111-1111-111111111111", action: "view" };

  await authority.authorize(request);
  await authority.authorize(request);
  assert.equal(sharepoint.calls.filter(([name]) => name === "getListEffectivePermissions").length, 1);

  authority.invalidate();
  currentTime += 1;
  await authority.authorize(request);
  assert.equal(sharepoint.calls.filter(([name]) => name === "getListEffectivePermissions").length, 2);
});
