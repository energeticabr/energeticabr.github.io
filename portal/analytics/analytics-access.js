const PANEL_MODULES = Object.freeze({
  comercial: "comercial",
  financeiro: "financeiro",
  "recursos-humanos": "rh-obras",
  "etapa-obra": "rh-obras",
  imobilizado: "patrimonio-locacoes",
  auditoria: "auditoria-compliance",
});

export function analyticsModuleId(panelId) {
  return PANEL_MODULES[String(panelId || "")] || "";
}

export function canViewAnalyticsPanel(panelId, access, can) {
  const moduleId = analyticsModuleId(panelId);
  return Boolean(moduleId && can?.(access, moduleId, "view") === true);
}

export function visibleAnalyticsDefinitions(definitions = [], access, can) {
  return Object.freeze((definitions || []).filter(definition => canViewAnalyticsPanel(definition?.id, access, can)));
}

export function analyticsEntitiesForAccess(entities = [], access, can) {
  return Object.freeze((entities || []).filter(entity => entity?.available !== false
    && can?.(access, entity.moduleId, "view") === true));
}

export default PANEL_MODULES;
