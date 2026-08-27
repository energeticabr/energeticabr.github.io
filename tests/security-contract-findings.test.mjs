import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultAccess } from "../portal/access/access-model.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { createSharePointRepository } from "../portal/data/sharepoint-repository.js";
import { createSharePointAclService, portalGroupName } from "../portal/security/sharepoint-acl-service.js";
import { SharePointAuthorityError, createSharePointAuthority } from "../portal/security/sharepoint-authority.js";
import { permissionMaskObject, portalActionMask } from "../portal/security/sharepoint-permissions.js";

const superAdminEmail = "bernardonotini@energeticabr.com";
const urgencyListId = "11111111-1111-1111-1111-111111111111";

function accessWith(moduleId, grants = {}) {
  const access = buildDefaultAccess("ana@energeticabr.com", "Ana", [{ id: moduleId }]);
  access.active = true;
  Object.assign(access.permissions[moduleId], grants);
  return access;
}

function effectivePermissionsFor(access, moduleId) {
  return {
    HasUniqueRoleAssignments: true,
    EffectiveBasePermissions: permissionMaskObject(portalActionMask(access, moduleId)),
  };
}

test("urgencias create=false bloqueia Graph mesmo com modulo e ACL permitindo criacao", async () => {
  const urgency = ENTITIES.find(entity => entity.id === "urgencias");
  assert.ok(urgency);
  assert.equal(urgency.capabilities.create, false);
  const access = accessWith("suprimentos", { view: true, create: true });
  const authoritySharePoint = {
    async resolveList() {
      return { status: "resolved", id: urgencyListId, displayName: "CADASTROURGÊNCIA" };
    },
    async getListEffectivePermissions() {
      return effectivePermissionsFor(access, "suprimentos");
    },
  };
  const authority = createSharePointAuthority({
    sharepoint: authoritySharePoint,
    entities: [urgency],
    getAccess: async () => access,
  });
  const graphCalls = [];
  const repository = createSharePointRepository({
    async request(...args) {
      graphCalls.push(args);
      throw new Error("Graph não deve receber a criação negada pela matriz.");
    },
  }, { personal: { host: "energeticaltda-my.sharepoint.com", path: "/personal/bernardonotini_energeticabr_com" } });
  repository.setAuthorizationProvider(authority);

  await assert.rejects(
    repository.createItem("personal", urgencyListId, { Title: "URGENTE" }),
    error => error instanceof SharePointAuthorityError && error.code === "entity_capability_denied",
  );
  assert.equal(graphCalls.length, 0);
});

test("provisionamento não atribui CREATE à lista de urgências sem essa capacidade", async () => {
  const urgency = ENTITIES.find(entity => entity.id === "urgencias");
  const sharepoint = {
    async resolveList(_siteKey, aliases) {
      const names = Array.isArray(aliases) ? aliases : [aliases];
      if (names.some(name => String(name).includes("PORTAL"))) {
        return { status: "resolved", id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", displayName: "PORTAL_ACESSOS" };
      }
      return { status: "resolved", id: urgencyListId, displayName: "CADASTROURGÊNCIA" };
    },
    async getListAdministrativeSecurity() {
      return { HasUniqueRoleAssignments: true, RoleAssignments: [] };
    },
  };
  const service = createSharePointAclService({
    sharepoint,
    entities: [urgency],
    modules: [{ id: "suprimentos", title: "Suprimentos" }],
    config: { superAdminEmail },
    getCurrentIdentity: () => ({ email: superAdminEmail }),
  });

  const plan = await service.previewSecuritySetup();
  const plannedUrgency = plan.lists.find(list => list.id === urgencyListId);
  assert.ok(plannedUrgency);
  assert.deepEqual(plannedUrgency.groupNames, [portalGroupName("suprimentos", "view")]);
});

test("102 pares de aliases fisicamente distintos não agregam capacidade entre nomes", async () => {
  const moduleId = "suprimentos";
  const access = accessWith(moduleId, { view: true, create: true });
  const entities = Array.from({ length: 102 }, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    const source = `FONTE_${suffix}`;
    const alias = `ALIAS_${suffix}`;
    return Object.freeze({
      id: `entidade-${suffix}`,
      moduleId,
      siteKey: "personal",
      listNames: Object.freeze([source, alias]),
      capabilities: Object.freeze({ view: true, create: true, edit: false, delete: false, approve: false }),
      listCapabilityEvidence: Object.freeze([
        Object.freeze({ listName: source, capabilities: Object.freeze({ view: true, create: true, edit: false, delete: false, approve: false }) }),
        Object.freeze({ listName: alias, capabilities: Object.freeze({ view: true, create: false, edit: false, delete: false, approve: false }) }),
      ]),
    });
  });
  const sharepoint = {
    async resolveList(_siteKey, aliases) {
      const names = Array.isArray(aliases) ? aliases : [aliases];
      const selected = names.at(-1);
      const match = /_(\d{3})$/.exec(selected);
      return { status: "resolved", id: `physical-${selected.toLowerCase()}`, displayName: selected, pair: match?.[1] };
    },
    async getListEffectivePermissions() {
      return effectivePermissionsFor(access, moduleId);
    },
  };
  const authority = createSharePointAuthority({ sharepoint, entities, getAccess: async () => access });

  for (const entity of entities) {
    const alias = entity.listNames[1];
    await assert.rejects(
      authority.authorize({ siteKey: "personal", listId: `physical-${alias.toLowerCase()}`, action: "create" }),
      error => error instanceof SharePointAuthorityError && error.code === "entity_capability_denied",
      entity.id,
    );
  }
});

test("aliases só compartilham evidência quando ambos resolvem o mesmo ID físico", async () => {
  const moduleId = "suprimentos";
  const access = accessWith(moduleId, { view: true, create: true });
  const physicalId = "physical-shared";
  const entity = Object.freeze({
    id: "fonte-compartilhada",
    moduleId,
    siteKey: "personal",
    listNames: Object.freeze(["FONTE", "ALIAS"]),
    capabilities: Object.freeze({ view: true, create: true, edit: false, delete: false, approve: false }),
    listCapabilityEvidence: Object.freeze([
      Object.freeze({ listName: "FONTE", capabilities: Object.freeze({ view: true, create: true, edit: false, delete: false, approve: false }) }),
      Object.freeze({ listName: "ALIAS", capabilities: Object.freeze({ view: true, create: false, edit: false, delete: false, approve: false }) }),
    ]),
  });
  const sharepoint = {
    async resolveList() { return { status: "resolved", id: physicalId, displayName: "FONTE" }; },
    async getListEffectivePermissions() { return effectivePermissionsFor(access, moduleId); },
  };
  const authority = createSharePointAuthority({ sharepoint, entities: [entity], getAccess: async () => access });

  const result = await authority.authorize({ siteKey: "personal", listId: physicalId, action: "create" });
  assert.equal(result.allowed, true);
  assert.equal(result.capabilityEvidence.some(evidence => evidence.listName === "FONTE" && evidence.listId === physicalId), true);
});
