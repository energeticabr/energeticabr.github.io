import assert from "node:assert/strict";
import test from "node:test";
import { ENTITIES } from "../portal/catalog/entities.js";
import { buildDefaultAccess } from "../portal/access/access-model.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import { createSharePointAuthority } from "../portal/security/sharepoint-authority.js";
import { loadPendingProvisionParents } from "../portal/forms/provision-parent-workflow.js";
import { resolveEntityListContracts } from "../portal/catalog/entity-list-contract.js";
import { portalEntityActionMask } from "../portal/security/sharepoint-permissions.js";

const PARENT = "514bf67a-9e76-4bfc-99b7-1f7297ae611a";
const CHILD = "6e5c235e-797a-4a86-8c05-25e0ab6ad870";
const provision = ENTITIES.find(entity => entity.id === "provisoes-de-pagamento");
const text = name => ({ name, displayName: name, text: {} });
const date = name => ({ name, displayName: name, dateTime: {} });
const parentColumns = ["Title", "FILIAL", "FORNECEDOR", "FORMAPGTO", "OBS", "VALORTOTAL"].map(text)
  .concat(["DATAPREVISTOPGTO", "DATAPGTOEFETUADO", "PGTOAGENDADO", "DATAPGTOAGENDADO", "DATAEXECUCAOAGENDAMENTO"].map(date));
const childColumns = ["Title", "QTD", "VALORTOTAL", "FRETE", "DESCRITIVOPROVISAO", "STATUS", "PGTOAGENDADO"].map(text)
  .concat([date("DATAPGTOEFETUADO")]);

function access(grants = { view: true, create: true, edit: true }) {
  const value = buildDefaultAccess("offline@example.test", "Offline", [{ id: "financeiro" }]);
  value.active = true;
  Object.assign(value.permissions.financeiro, grants);
  return value;
}

function fixture({ grants, counterfeit = false, ordinary = false, security } = {}) {
  const calls = [];
  const parentId = counterfeit ? "00000000-0000-0000-0000-000000000001" : PARENT;
  const repository = createSharePointRepository({
    async request(path, options = {}) {
      calls.push({ path, method: options.method || "GET" });
      if (!path.startsWith("/sites/offline-site/")) return { id: "offline-site" };
      if (/\/lists(?:\?|$)/.test(path)) return { value: [
        { id: parentId, displayName: "DESCRITIVOPROVISAO", list: { template: "genericList" } },
        { id: CHILD, displayName: "PROVISÃO PGTOS", list: { template: "genericList" } },
      ] };
      if (path.includes("/columns")) return { value: path.includes(PARENT) ? parentColumns : childColumns };
      if (path.includes("/items")) return { value: path.includes(PARENT) ? [{
        id: "100", eTag: '"1"', fields: { Title: "offline-parent", FORNECEDOR: "Offline supplier",
          FILIAL: "001", VALORTOTAL: "10", DATAPREVISTOPGTO: "2026-10-12",
          DATAPGTOEFETUADO: null, PGTOAGENDADO: null, DATAPGTOAGENDADO: null, DATAEXECUCAOAGENDAMENTO: null },
      }] : [{
        id: "200", fields: { DESCRITIVOPROVISAO: "100", STATUS: "PAGAMENTO PREVISTO",
          PGTOAGENDADO: "PENDENTE", DATAPGTOEFETUADO: null, QTD: "1", VALORTOTAL: "10", FRETE: "0" },
      }] };
      throw new Error("Unexpected offline Graph route: " + path);
    },
  }, { personal: { host: "offline.example.test", path: "/site", readTransport: "graph", writeTransport: "graph" } }, security ? {
    restTransport: { async request(_site, path, options) {
      assert.equal(options.method, "GET");
      assert.ok(path.includes(PARENT));
      calls.push({ path, method: options.method });
      return security;
    } },
  } : {});
  const authority = createSharePointAuthority({
    sharepoint: repository, entities: ENTITIES, getAccess: async () => access(grants),
    isSuperAdminSession: () => !ordinary,
  });
  repository.setAuthorizationProvider(authority);
  return { repository, authority, calls };
}

test("real repository and catalog authorize the pending parent selector without writes", async () => {
  const { repository, calls } = fixture();
  const options = await loadPendingProvisionParents(repository, provision);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, "100");
  assert.ok(calls.some(call => call.path.includes(PARENT) && call.path.includes("/columns")));
  assert.ok(calls.every(call => call.method === "GET"));
});

test("supporting parent has exact physical identity and only view/create/edit capabilities", async () => {
  const { repository, authority } = fixture();
  const contracts = (await resolveEntityListContracts(repository, provision)).contracts;
  assert.ok(contracts.some(contract => contract.listId === CHILD));
  const parent = contracts.find(contract => contract.listId === PARENT);
  assert.ok(parent, "the parent list must have its own physical contract");
  assert.equal(parent.entityId, provision.id);
  assert.deepEqual(parent.capabilities, { view: true, create: true, edit: true, delete: false, approve: false });
  for (const action of ["view", "create", "edit"]) {
    const result = await authority.authorize({ siteKey: "personal", listId: PARENT, action });
    assert.equal(result.allowed, true);
    assert.equal(result.moduleId, "financeiro");
  }
  for (const action of ["delete", "approve"]) await assert.rejects(
    authority.authorize({ siteKey: "personal", listId: PARENT, action }),
    error => error.code === "entity_capability_denied");
});

test("the provision form still resolves the child, never the supporting parent", async () => {
  const { repository } = fixture();
  assert.equal((await repository.resolveList(provision.siteKey, provision.listNames)).id, CHILD);
  assert.ok(!provision.listNames.includes("DESCRITIVOPROVISAO"));
});

test("a same-name parent at another GUID and any unlisted list remain blocked", async () => {
  const { authority } = fixture({ counterfeit: true });
  for (const listId of ["00000000-0000-0000-0000-000000000001", "unknown-list"]) await assert.rejects(
    authority.authorize({ siteKey: "personal", listId, action: "view" }),
    error => error.code === "target_not_allowlisted");
});

test("parent support cannot bypass the existing module grants or ACL checks", async () => {
  const denied = fixture({ grants: { view: false, create: false, edit: false } });
  await assert.rejects(denied.authority.authorize({ siteKey: "personal", listId: PARENT, action: "view" }),
    error => error.code === "portal_grant_denied");
  const viewer = fixture({ grants: { view: true, create: false, edit: false } });
  await assert.rejects(viewer.authority.authorize({ siteKey: "personal", listId: PARENT, action: "create" }),
    error => error.code === "portal_grant_denied");
  const ordinary = fixture({ ordinary: true });
  await assert.rejects(ordinary.authority.authorize({ siteKey: "personal", listId: PARENT, action: "view" }),
    error => error.code !== "target_not_allowlisted" && /REST|transport/i.test(error.message));
});

test("ordinary parent access requires the exact existing effective ACL and rejects inherited/broader rights", async () => {
  const mask = portalEntityActionMask(access(), "financeiro", { view: true, create: true, edit: true });
  const bits = value => ({ High: String((value >> 32n) & 0xffffffffn), Low: String(value & 0xffffffffn) });
  const accepted = fixture({ ordinary: true, security: {
    HasUniqueRoleAssignments: true, EffectiveBasePermissions: bits(mask),
  } });
  for (const action of ["view", "create", "edit"]) assert.equal(
    (await accepted.authority.authorize({ siteKey: "personal", listId: PARENT, action })).allowed, true);
  assert.ok(accepted.calls.every(call => call.method === "GET"), "ACL checks never change permissions");
  const inherited = fixture({ ordinary: true, security: {
    HasUniqueRoleAssignments: false, EffectiveBasePermissions: bits(mask),
  } });
  await assert.rejects(inherited.authority.authorize({ siteKey: "personal", listId: PARENT, action: "view" }),
    error => error.code === "inherited_permissions");
  const broader = fixture({ ordinary: true, security: {
    HasUniqueRoleAssignments: true, EffectiveBasePermissions: bits(mask | (1n << 3n)),
  } });
  await assert.rejects(broader.authority.authorize({ siteKey: "personal", listId: PARENT, action: "view" }),
    error => error.code === "permission_mismatch");
});

test("disabled, invalid or colliding supporting contracts cannot introduce another authority target", async () => {
  const { repository } = fixture();
  const disabled = await resolveEntityListContracts(repository, { ...provision, available: false });
  assert.ok(Object.values(disabled.contracts.find(contract => contract.listId === PARENT).capabilities)
    .every(value => value === false));
  const support = provision.supportingLists[0];
  for (const supportingLists of [
    [{ ...support, listId: "invalid" }],
    [{ ...support, listId: "-".repeat(36) }],
    [support, support],
    [{ ...support, listId: CHILD }],
  ]) await assert.rejects(resolveEntityListContracts(repository, { ...provision, supportingLists }), TypeError);
});
