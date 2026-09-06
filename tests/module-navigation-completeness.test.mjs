import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { ENTITIES, entitiesForModule } from "../portal/catalog/entities.js";
import { MODULES } from "../portal/catalog/modules.js";
import { getPowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { renderModuleLanding } from "../portal/app.js";

function createRoot() {
  return { innerHTML: "" };
}

function entityCommands(html) {
  return [...html.matchAll(/href="#\/entity\/([^"/]+)(\/new)?"/g)].map(match => ({
    entityId: decodeURIComponent(match[1]),
    mode: match[2] ? "create" : "gallery",
  }));
}

const superAdminAccess = buildSuperAdminAccess(
  "bernardonotini@energeticabr.com",
  "Bernardo Notini",
  MODULES,
);

test("cada pagina de modulo inclui uma vez todas as entidades disponiveis e autorizadas do catalogo", () => {
  for (const module of MODULES) {
    const expectedEntities = entitiesForModule(module.id);
    if (!expectedEntities.length) continue;

    const root = createRoot();
    renderModuleLanding(root, module.id, { access: superAdminAccess, can });
    const commands = entityCommands(root.innerHTML);

    for (const entity of expectedEntities) {
      const galleryCount = commands.filter(command => (
        command.entityId === entity.id && command.mode === "gallery"
      )).length;
      assert.equal(galleryCount, entity.galleryAvailable === false ? 0 : 1,
        `${module.id} deve respeitar a existência da galeria Power Apps para ${entity.id}`);
    }
  }
});

test("paginas de modulos nao repetem o mesmo destino e modo", () => {
  for (const module of MODULES) {
    const root = createRoot();
    renderModuleLanding(root, module.id, { access: superAdminAccess, can });
    const routeKeys = entityCommands(root.innerHTML)
      .map(command => `${command.entityId}:${command.mode}`);

    assert.equal(
      new Set(routeKeys).size,
      routeKeys.length,
      `${module.id} contem comandos duplicados: ${routeKeys.filter((key, index) => routeKeys.indexOf(key) !== index).join(", ")}`,
    );
  }
});

test("toda entidade com criacao operacional possui exatamente um Lancamento no seu modulo", () => {
  for (const module of MODULES) {
    const root = createRoot();
    renderModuleLanding(root, module.id, { access: superAdminAccess, can });
    const commands = entityCommands(root.innerHTML);

    for (const entity of entitiesForModule(module.id)) {
      const contract = getPowerAppsUiContract(entity.id, { mode: "create" });
      const operational = entity.capabilities?.create === true
        && contract.hasForm
        && !contract.readOnly
        && !contract.requiresVariantSelection
        && contract.formFields.length > 0;
      const count = commands.filter(command => (
        command.entityId === entity.id && command.mode === "create"
      )).length;
      assert.equal(count, operational ? 1 : 0, `${module.id}:${entity.id} possui comando de criação incoerente`);
    }
  }
});

test("entidades sem permissao de visualizacao nao sao acrescentadas ao modulo", () => {
  const root = createRoot();
  const deniedEntityIds = new Set(ENTITIES.filter(entity => entity.moduleId === "suprimentos").map(entity => entity.id));

  renderModuleLanding(root, "suprimentos", {
    access: {},
    can: (_access, moduleId, action) => !(moduleId === "suprimentos" && action === "view"),
  });

  const renderedIds = new Set(entityCommands(root.innerHTML).map(command => command.entityId));
  for (const entityId of deniedEntityIds) {
    assert.equal(renderedIds.has(entityId), false, `${entityId} nao deveria ser exibida sem acesso`);
  }
});
