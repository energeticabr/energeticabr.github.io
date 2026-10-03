function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const ASSET_PAIRS = Object.freeze([
  { primary: "action_register_fixed_asset_product", primaryLabel: "cadastrar produto imobilizado", id: "action_asset_product_gallery", label: "GALERIA DE PRODUTO IMOBILIZADO" },
  { primary: "action_register_fixed_asset_group", primaryLabel: "cadastrar grupo imobilizado", id: "action_asset_group_gallery", label: "GALERIA DE GRUPO IMOBILIZADO" },
  { primary: "action_register_fixed_asset", primaryLabel: "cadastrar imobilizado", id: "action_asset_gallery", label: "GALERIA DE IMOBILIZADO" },
  { primary: "action_register_fixed_asset_function", primaryLabel: "cadastrar funcao do imobilizado", id: "action_asset_function_gallery", label: "GALERIA DE FUNÇÃO DO IMOBILIZADO" },
]);
const DIARY_PAIRS = Object.freeze([
  { primary: "action_construction_diary_section", primaryLabel: "diario de obras", id: "action_work_diary_gallery", label: "GALERIA DE DIÁRIO DE OBRAS" },
]);
const CONTRACT_PAIRS = Object.freeze([
  { primary: "action_register_contractor_contract", primaryLabel: "cadastrar contrato de empreiteiro", id: "action_contract_gallery", label: "GALERIA DE CONTRATOS" },
  { primary: "action_register_contract_line", primaryLabel: "cadastrar linha contrato", id: "action_contract_line_gallery", label: "GALERIA DE LINHAS DE CONTRATO" },
  { primary: "action_register_measurement", primaryLabel: "cadastrar medicao", id: "action_measurement_gallery", label: "GALERIA DE MEDIÇÕES" },
  { primary: "action_register_measurement_line", primaryLabel: "cadastrar linha medicao", id: "action_measurement_line_gallery", label: "GALERIA DE LINHAS DE MEDIÇÃO" },
]);
const STAGE_PAIRS = Object.freeze([
  { primary: "action_create_construction_stage_demonstrative", primaryLabel: "criar demonstrativo de etapa", id: "action_stage_demonstrative_gallery", label: "GALERIA DE DEMONSTRATIVO ETAPA" },
  { primary: "action_register_construction_stage", primaryLabel: "cadastro de etapa obra", id: "action_construction_stage_gallery", label: "GALERIA DE ETAPA OBRA" },
]);
const TASK_PAIRS = Object.freeze([
  { primary: "action_task", primaryLabel: "adicionar uma nova tarefa", primaryLabels: ["adicionar nova tarefa"], id: "action_tasks_gallery", label: "GALERIA TAREFAS" },
  { primary: "action_recurring_task_registration", primaryLabel: "cadastrar tarefa recorrente", primaryLabels: ["tarefas recorrentes", "cadastro de tarefas recorrentes"], id: "action_recurring_tasks_gallery", label: "GALERIA DE TAREFAS RECORRENTES" },
]);

export function galleryPairForOption(option, pairs) {
  const id = String(option?.reply || option?.id || "").trim().toLowerCase();
  return pairs.find(pair => pair.primary === id)
    || pairs.find(pair => [pair.primaryLabel, ...(pair.primaryLabels || [])].includes(normalized(option?.label || option?.title)));
}

export function pairedGalleryMenu(message) {
  if (message?.type !== "poll") return null;
  const headings = String(message.question || message.prompt || message.text || "").split(/\r?\n/).map(normalized);
  const options = Array.isArray(message.options) ? message.options : [];
  if (headings.includes("demandas") && options.some(option => galleryPairForOption(option, TASK_PAIRS))) {
    return { kind: "demand", pairs: TASK_PAIRS };
  }
  if (headings.some(heading => /^imobilizados?$/.test(heading))
    && options.some(option => galleryPairForOption(option, ASSET_PAIRS))) {
    return { kind: "asset", pairs: ASSET_PAIRS };
  }
  if (headings.some(heading => /^(?:etapa obra|etapa da obra)$/.test(heading))
    && options.some(option => galleryPairForOption(option, DIARY_PAIRS))) {
    return { kind: "construction", pairs: DIARY_PAIRS };
  }
  if (headings.includes("contrato")
    && options.some(option => galleryPairForOption(option, CONTRACT_PAIRS))) {
    return { kind: "contract", pairs: CONTRACT_PAIRS };
  }
  if (headings.includes("etapa obra e demonstrativo etapa")
    && options.some(option => galleryPairForOption(option, STAGE_PAIRS))) {
    return { kind: "construction-stage", pairs: STAGE_PAIRS };
  }
  return null;
}
