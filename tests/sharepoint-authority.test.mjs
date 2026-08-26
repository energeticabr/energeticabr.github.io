import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultAccess } from "../portal/access/access-model.js";
import {
  SharePointAuthorityError,
  createSharePointAuthority,
} from "../portal/security/sharepoint-authority.js";

const entity = Object.freeze({
  id: "fornecedores",
  moduleId: "suprimentos",
  siteKey: "company",
  listNames: Object.freeze(["FORNECEDORES"]),
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

  assert.deepEqual(result, {
    allowed: true,
    action: "edit",
    entityId: "fornecedores",
    moduleId: "suprimentos",
  });
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
