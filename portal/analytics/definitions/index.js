import auditoria from "./auditoria.js";
import comercial from "./comercial.js";
import etapaObra from "./etapa-obra.js";
import financeiro from "./financeiro.js";
import imobilizado from "./imobilizado.js";
import recursosHumanos from "./recursos-humanos.js";

export const ANALYTICS_DEFINITIONS = Object.freeze([
  comercial,
  financeiro,
  recursosHumanos,
  etapaObra,
  imobilizado,
  auditoria,
]);

export function analyticsDefinitionById(id) {
  return ANALYTICS_DEFINITIONS.find(definition => definition.id === String(id || ""));
}

export default ANALYTICS_DEFINITIONS;
