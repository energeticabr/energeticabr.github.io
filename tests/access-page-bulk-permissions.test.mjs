import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { createAccessPage } from "../portal/ui/access-page.js";

const REQUIRED_ACTIONS = ["view", "create", "edit", "delete", "approve"];
const MODULES = [
  { id: "suprimentos", title: "Suprimentos" },
  { id: "demandas", title: "Demandas" },
];

function blankPermissions() {
  return Object.fromEntries(MODULES.map(module => [
    module.id,
    Object.fromEntries(REQUIRED_ACTIONS.map(action => [action, false])),
  ]));
}

function userFixture(overrides = {}) {
  return {
    id: "12",
    oid: "11111111-2222-4333-8444-555555555555",
    name: "ANA SILVA",
    email: "ana@energeticabr.com",
    profile: "USUARIO",
    active: true,
    changedAt: "2026-08-27T10:00:00Z",
    changedBy: portalConfig.superAdminEmail,
    permissions: blankPermissions(),
    ...overrides,
  };
}

function decodeAttribute(value = "") {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

class TestElement {
  constructor(attributes = {}, content = "") {
    this.attributes = attributes;
    this.dataset = {};
    this.listeners = new Map();
    this.checked = Object.hasOwn(attributes, "checked");
    this.disabled = Object.hasOwn(attributes, "disabled");
    this.value = decodeAttribute(attributes.value || "");
    this.textContent = content.replace(/<[^>]+>/g, "").trim();
    this.className = attributes.class || "";
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach(name => classes.add(name));
        this.className = [...classes].join(" ");
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className.split(/\s+/).filter(name => name && !removed.has(name)).join(" ");
      },
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (!name.startsWith("data-")) continue;
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = decodeAttribute(value);
    }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async trigger(type) {
    if (this.disabled) return;
    const event = { target: this, preventDefault() {} };
    await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
  }
}

class TestRoot {
  constructor() {
    this.html = "";
    this.elements = [];
  }

  set innerHTML(value) {
    this.html = value;
    this.elements = [];
    const tagPattern = /<(button|input|p)\b([^>]*?)(?:>([\s\S]*?)<\/\1>)?>/gi;
    for (const match of value.matchAll(tagPattern)) {
      const attributes = {};
      const attributePattern = /([:\w-]+)(?:="([^"]*)")?/g;
      for (const attribute of match[2].matchAll(attributePattern)) {
        attributes[attribute[1]] = attribute[2] ?? "";
      }
      this.elements.push(new TestElement(attributes, match[3] || ""));
    }
  }

  get innerHTML() {
    return this.html;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const attribute = selector.match(/^\[([^\]=]+)\]$/)?.[1];
    if (!attribute) return [];
    return this.elements.filter(element => Object.hasOwn(element.attributes, attribute));
  }
}

function repositoryFixture(users) {
  const calls = [];
  return {
    calls,
    async listUsers() {
      return users;
    },
    async getAccessListSecurity() {
      return { status: "secure", instructions: "" };
    },
    async saveUserAccess(access) {
      calls.push(["saveUserAccess", access]);
      return { ...access, id: access.id || "created" };
    },
    async setUserActive() {},
    async ensureList() {},
  };
}

function findByDataset(root, selector, key, value) {
  return root.querySelectorAll(selector).find(element => element.dataset[key] === value);
}

function toggle(root, moduleId, action) {
  return findByDataset(root, "[data-access-toggle]", "accessToggle", `${moduleId}:${action}`);
}

async function openExistingUser(root, repository) {
  const page = createAccessPage(root, {
    repository,
    modules: MODULES,
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
  });
  await page.ready;
  await root.querySelector("[data-access-user]").trigger("click");
  return page;
}

test("concede e retira todas as permissoes de uma base sem salvar antecipadamente", async () => {
  const root = new TestRoot();
  const repository = repositoryFixture([userFixture()]);
  const page = await openExistingUser(root, repository);
  const grant = findByDataset(root, "[data-access-grant-module]", "accessGrantModule", "suprimentos");
  const revoke = findByDataset(root, "[data-access-revoke-module]", "accessRevokeModule", "suprimentos");

  assert.ok(grant, "cada base deve oferecer o comando Conceder todos");
  assert.ok(revoke, "cada base deve oferecer o comando Retirar todos");
  assert.equal(grant.attributes.type, "button");
  assert.match(grant.attributes["aria-label"], /conceder todas.*suprimentos/i);

  await grant.trigger("click");

  for (const action of REQUIRED_ACTIONS) {
    assert.equal(toggle(root, "suprimentos", action).checked, true);
    assert.equal(page.getState().selected.permissions.suprimentos[action], true);
    assert.equal(toggle(root, "demandas", action).checked, false);
  }
  assert.equal(repository.calls.length, 0, "a gravacao continua exclusiva do botao Salvar");
  assert.match(root.querySelector("[data-access-feedback]").textContent, /todos os acessos.*suprimentos.*concedidos/i);

  await revoke.trigger("click");

  for (const action of REQUIRED_ACTIONS) {
    assert.equal(toggle(root, "suprimentos", action).checked, false);
    assert.equal(page.getState().selected.permissions.suprimentos[action], false);
  }

  await root.querySelector("[data-access-save]").trigger("click");
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0][0], "saveUserAccess");
  assert.deepEqual(repository.calls[0][1].permissions.suprimentos, {
    view: false,
    create: false,
    edit: false,
    delete: false,
    approve: false,
  });
});

test("os comandos globais atualizam todas as bases de um usuario novo e anunciam confirmacao", async () => {
  const root = new TestRoot();
  const repository = repositoryFixture([]);
  const page = createAccessPage(root, {
    repository,
    modules: MODULES,
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
  });
  await page.ready;
  await root.querySelector("[data-access-add]").trigger("click");

  const grantAll = root.querySelector("[data-access-grant-all]");
  const revokeAll = root.querySelector("[data-access-revoke-all]");
  const feedback = root.querySelector("[data-access-feedback]");
  assert.ok(grantAll);
  assert.ok(revokeAll);
  assert.equal(feedback.attributes.role, "status");
  assert.equal(feedback.attributes["aria-live"], "polite");

  await grantAll.trigger("click");

  for (const module of MODULES) {
    for (const action of REQUIRED_ACTIONS) {
      assert.equal(toggle(root, module.id, action).checked, true);
      assert.equal(page.getState().selected.permissions[module.id][action], true);
    }
  }
  assert.match(feedback.textContent, /todos os acessos foram concedidos/i);

  await revokeAll.trigger("click");
  for (const module of MODULES) {
    for (const action of REQUIRED_ACTIONS) assert.equal(toggle(root, module.id, action).checked, false);
  }
  assert.match(feedback.textContent, /todos os acessos foram retirados/i);
});

test("os comandos em massa nao alteram o superadministrador", async () => {
  const superAdmin = userFixture({
    id: "1",
    oid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    name: "BERNARDO NOTINI",
    email: portalConfig.superAdminEmail,
  });
  const root = new TestRoot();
  await openExistingUser(root, repositoryFixture([superAdmin]));

  assert.equal(root.querySelector("[data-access-grant-all]").disabled, true);
  assert.equal(root.querySelector("[data-access-revoke-all]").disabled, true);
  for (const button of root.querySelectorAll("[data-access-grant-module]")) assert.equal(button.disabled, true);
  for (const button of root.querySelectorAll("[data-access-revoke-module]")) assert.equal(button.disabled, true);

  const newRoot = new TestRoot();
  const page = createAccessPage(newRoot, {
    repository: repositoryFixture([]),
    modules: MODULES,
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
  });
  await page.ready;
  await newRoot.querySelector("[data-access-add]").trigger("click");
  newRoot.querySelector("[data-access-email]").value = portalConfig.superAdminEmail;

  await newRoot.querySelector("[data-access-grant-all]").trigger("click");

  for (const module of MODULES) {
    for (const action of REQUIRED_ACTIONS) assert.equal(page.getState().selected.permissions[module.id][action], false);
  }
  assert.match(newRoot.querySelector("[data-access-feedback]").textContent, /superadministrador.*n[aã]o podem ser alteradas/i);
});
