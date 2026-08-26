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

function accessWith(grants = {}) {
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana", [{ id: "suprimentos" }]);
  access.active = true;
  Object.assign(access.permissions.suprimentos, grants);
  return access;
}

function createSharePointFake({
  unique = true,
  permissions = permissionMask(1),
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
  const sharepoint = createSharePointFake({ permissions: permissionMask(1, 2, 3) });
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

test("autoriza somente a acao presente no cadastro e na ACL exclusiva", async () => {
  const sharepoint = createSharePointFake({ permissions: permissionMask(1, 3) });
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
  const sharepoint = createSharePointFake({ permissions: permissionMask(1) });
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
