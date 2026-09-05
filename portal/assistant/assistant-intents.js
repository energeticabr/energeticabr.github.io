const CREATE_WORDS = /\b(novo|nova|criar|cadastrar|adicionar|lancar|registrar|fazer)\b/;
const EDIT_WORDS = /\b(editar|alterar|corrigir|atualizar)\b/;
const VIEW_WORDS = /\b(abrir|ver|consultar|listar|galeria|mostrar|acessar)\b/;

const ENTITY_ALIASES = Object.freeze({
  lancamentos: ["lancamento", "lancamentos", "novo lancamento"],
  "descricoes-de-presenca": ["descricao de presenca", "descricoes de presenca", "descritivo presenca", "descritivos de presenca"],
  presencas: ["presenca", "presencas", "apontamento de presenca", "apontamentos de presenca"],
  "diarios-de-obras": ["diario de obra", "diario de obras", "diarios de obra", "diarios de obras"],
  "provisoes-de-pagamento": ["provisao de pagamento", "provisoes de pagamento", "programacao de pagamento", "programacao de pagamentos"],
  "apontamentos-de-funcionarios": ["apontamento de funcionario", "apontamentos de funcionarios"],
});

export function normalizeAssistantText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function singularForms(value) {
  const normalized = normalizeAssistantText(value);
  const forms = new Set([normalized]);
  if (normalized.endsWith("oes")) forms.add(`${normalized.slice(0, -3)}ao`);
  if (normalized.endsWith("ais")) forms.add(`${normalized.slice(0, -3)}al`);
  if (normalized.endsWith("s")) forms.add(normalized.slice(0, -1));
  return [...forms].filter(Boolean);
}

function entityAliases(entity) {
  const configured = ENTITY_ALIASES[entity.id] || [];
  return [...new Set([
    ...configured,
    entity.id.replace(/-/g, " "),
    ...singularForms(entity.title),
    ...entity.listNames.flatMap(singularForms),
  ].map(normalizeAssistantText).filter(Boolean))];
}

function matchEntity(text, entities = []) {
  const matches = entities
    .filter(entity => entity.available !== false)
    .flatMap(entity => entityAliases(entity)
      .filter(alias => text.includes(alias))
      .map(alias => ({ entity, score: alias.length })));
  return matches.sort((left, right) => right.score - left.score)[0]?.entity;
}

function matchModule(text, modules = []) {
  return modules
    .map(module => ({ module, aliases: [normalizeAssistantText(module.title), normalizeAssistantText(module.id.replace(/-/g, " "))] }))
    .flatMap(({ module, aliases }) => aliases.filter(alias => text.includes(alias)).map(alias => ({ module, score: alias.length })))
    .sort((left, right) => right.score - left.score)[0]?.module;
}

function allowed(context, moduleId, action) {
  if (moduleId === "dashboard" && action === "view") return true;
  if (moduleId === "usuarios-acessos" && action === "view") return context.isSuperAdmin === true;
  return context.can?.(context.access, moduleId, action) === true;
}

function moduleRoute(module) {
  if (module.id === "dashboard") return { name: "dashboard", params: {} };
  if (module.id === "usuarios-acessos") return { name: "access", params: {} };
  if (module.id === "relatorios") return { name: "reports", params: {} };
  return { name: "module", params: { moduleId: module.id } };
}

function entityPermission(entity, context, action) {
  return entity?.capabilities?.[action] === true && allowed(context, entity.moduleId, action);
}

function deniedMessage(action, title) {
  const labels = { create: "criar", edit: "editar", view: "consultar" };
  return `Sua conta não possui permissão para ${labels[action] || action} ${title}.`;
}

function navigationResult(entity, routeName, params, message) {
  return Object.freeze({ type: "navigate", entityId: entity.id, route: Object.freeze({ name: routeName, params: Object.freeze(params) }), message });
}

export function assistantMenuItems(context = {}) {
  return Object.freeze((context.modules || []).filter(module => {
    if (module.id === "dashboard") return true;
    if (module.id === "usuarios-acessos") return context.isSuperAdmin === true;
    return allowed(context, module.id, "view");
  }).map(module => Object.freeze({
    moduleId: module.id,
    label: module.title,
    route: Object.freeze({
      name: module.id === "dashboard" ? "dashboard"
        : module.id === "usuarios-acessos" ? "access"
          : module.id === "relatorios" ? "reports" : "module",
      params: module.id === "dashboard" || module.id === "usuarios-acessos" || module.id === "relatorios"
        ? Object.freeze({}) : Object.freeze({ moduleId: module.id }),
    }),
  })));
}

export function assistantQuickActions(context = {}) {
  const definitions = [
    { label: "Novo lançamento", command: "novo lançamento", entityId: "lancamentos", action: "create" },
    { label: "Editar lançamento", command: "editar lançamento", entityId: "lancamentos", action: "edit" },
    { label: "Validar presença", command: "validar presença de hoje", entityId: "descricoes-de-presenca", action: "view" },
    { label: "Descrição de presença", command: "criar descrição de presença", entityId: "descricoes-de-presenca", action: "create" },
    { label: "Diário de obras", command: "criar diário de obras", entityId: "diarios-de-obras", action: "create" },
  ];
  return Object.freeze(definitions.filter(definition => {
    const entity = (context.entities || []).find(candidate => candidate.id === definition.entityId);
    return definition.action === "view"
      ? Boolean(entity && allowed(context, entity.moduleId, "view"))
      : entityPermission(entity, context, definition.action);
  }).map(definition => Object.freeze({ label: definition.label, command: definition.command })));
}

export function resolveAssistantCommand(input, context = {}) {
  const text = normalizeAssistantText(input);
  if (!text || /^(oi|ola|ajuda|menu|inicio|comecar)$/.test(text) || text.includes("menu principal")) {
    return Object.freeze({ type: "help", message: "Escolha uma área ou diga o que você precisa fazer." });
  }

  if (/\b(validar|conferir|auditar|verificar)\b/.test(text) && text.includes("presenca")) {
    const entity = (context.entities || []).find(candidate => candidate.id === "descricoes-de-presenca");
    if (!entity || !allowed(context, entity.moduleId, "view")) {
      return Object.freeze({ type: "denied", message: deniedMessage("view", "as presenças") });
    }
    return Object.freeze({ type: "presence-validation", entityId: entity.id, message: "Conferindo os registros de presença no SharePoint..." });
  }

  const entity = matchEntity(text, context.entities || []);
  const module = matchModule(text, context.modules || []);
  const itemId = text.match(/\b(?:id\s*)?(\d+)\b/)?.[1];

  if (EDIT_WORDS.test(text)) {
    if (!entity) return Object.freeze({ type: "needs-input", message: "Informe a base e o ID do registro que deseja editar." });
    if (!itemId) return Object.freeze({ type: "needs-input", message: `Informe o ID de ${entity.title} que deseja editar.`, pending: Object.freeze({ action: "edit", entityId: entity.id }) });
    if (!entityPermission(entity, context, "edit")) return Object.freeze({ type: "denied", message: deniedMessage("edit", entity.title) });
    return navigationResult(entity, "item", { entityId: entity.id, itemId }, `Abrindo ${entity.title}, registro ${itemId}.`);
  }

  if (CREATE_WORDS.test(text) && entity) {
    if (!entityPermission(entity, context, "create")) return Object.freeze({ type: "denied", message: deniedMessage("create", entity.title) });
    return navigationResult(entity, "entity-create", { entityId: entity.id }, `Abrindo o formulário de ${entity.title}.`);
  }

  if (module && (VIEW_WORDS.test(text) || text === normalizeAssistantText(module.title))) {
    if (!allowed(context, module.id, "view")) return Object.freeze({ type: "denied", message: deniedMessage("view", module.title) });
    const route = moduleRoute(module);
    return Object.freeze({ type: "navigate", route: Object.freeze({ name: route.name, params: Object.freeze(route.params) }), message: `Abrindo ${module.title}.` });
  }

  if (entity && (VIEW_WORDS.test(text) || text === normalizeAssistantText(entity.title))) {
    if (!allowed(context, entity.moduleId, "view")) return Object.freeze({ type: "denied", message: deniedMessage("view", entity.title) });
    return navigationResult(entity, "entity", { entityId: entity.id }, `Abrindo a galeria de ${entity.title}.`);
  }

  return Object.freeze({
    type: "unknown",
    message: "Não identifiquei essa operação. Você pode pedir para criar, consultar ou editar um registro, informar um ID, ou abrir uma área do menu.",
  });
}
