const ASSET_ROOT = "portal/assets/powerapps-home";

function freezeList(values) {
  return Object.freeze(values.map(value => Object.freeze({ ...value })));
}

export const POWERAPPS_HOME_SOURCE = Object.freeze({
  appId: "3501f99a-e612-44b6-8ce7-8c8caa74fad7",
  screen: "TELA INICIAL",
  artifact: "TELA INICIAL.pa.yaml",
  sha256: "CC91C0EDA65F0995D53A4A1359DA57E3A25DEA5AA613114D2FCCBC53645124FB",
  width: 1366,
  height: 768,
});

export const POWERAPPS_HOME_ASSETS = Object.freeze({
  background: `${ASSET_ROOT}/powerapps-home-background.jpg`,
  logo: `${ASSET_ROOT}/powerapps-home-logo.png`,
});

export const POWERAPPS_HOME_TILES = freezeList([
  {
    moduleId: "suprimentos",
    label: "SUPRIMENTOS",
    href: "#/module/suprimentos",
    color: "rgb(0, 13, 75)",
    image: `${ASSET_ROOT}/module-supplies.png`,
    x: 115, y: 133, width: 562, height: 135,
    imageX: 115, imageY: 135, imageWidth: 140, imageHeight: 132,
  },
  {
    moduleId: "demandas",
    label: "DEMANDAS",
    href: "#/module/demandas",
    color: "rgb(99, 139, 44)",
    image: `${ASSET_ROOT}/module-demands.png`,
    x: 701, y: 133, width: 562, height: 135,
    imageX: 715, imageY: 137, imageWidth: 109, imageHeight: 132,
  },
  {
    moduleId: "financeiro",
    label: "FINANCEIRO",
    href: "#/module/financeiro",
    color: "rgb(77, 77, 77)",
    image: `${ASSET_ROOT}/module-financial.png`,
    x: 116, y: 294, width: 562, height: 135,
    imageX: 122, imageY: 294, imageWidth: 119, imageHeight: 135,
  },
  {
    moduleId: "comercial",
    label: "COMERCIAL",
    href: "#/module/comercial",
    color: "rgb(172, 62, 11)",
    image: `${ASSET_ROOT}/module-commercial.png`,
    x: 701, y: 293, width: 562, height: 135,
    imageX: 720, imageY: 293, imageWidth: 109, imageHeight: 138,
  },
  {
    moduleId: "rh-obras",
    label: "RECURSOS HUMANOS E ACOMP. OBRA",
    href: "#/module/rh-obras",
    color: "rgb(203, 102, 102)",
    image: `${ASSET_ROOT}/module-rh.png`,
    x: 115, y: 450, width: 562, height: 135,
    imageX: 118, imageY: 447, imageWidth: 113, imageHeight: 146,
  },
  {
    moduleId: "patrimonio-locacoes",
    label: "NOTINI MOREIRA",
    href: "#/module/patrimonio-locacoes",
    color: "rgb(251, 188, 159)",
    image: `${ASSET_ROOT}/company-mark.png`,
    x: 701, y: 450, width: 562, height: 135,
    imageX: 713, imageY: 453, imageWidth: 131, imageHeight: 132,
  },
  {
    moduleId: "auditoria-compliance",
    label: "AUDITORIA E COMPLIANCE",
    href: "#/module/auditoria-compliance",
    color: "rgb(136, 160, 209)",
    image: `${ASSET_ROOT}/module-audit.png`,
    x: 115, y: 611, width: 562, height: 135,
    imageX: 117, imageY: 606, imageWidth: 119, imageHeight: 144,
  },
]);

export const POWERAPPS_HOME_QUICK_ACTIONS = freezeList([
  { id: "resumo-geral", sourceControl: "Image4_10", sourceHtmlControl: "HtmlText27", powerFx: "Set(VERRESUMOGERAL,true);Set(RESUMOGERAL,true)", label: "Resumo geral", report: "resumo-geral", moduleId: "dashboard", image: `${ASSET_ROOT}/company-mark.png`, fill: "rgb(242, 242, 208)", x: 1277, y: 33, width: 79, height: 76 },
  { id: "patologias", sourceControl: "Image7_7", sourceHtmlControl: "HtmlText29", powerFx: "Set(VERPATOLOGIAS,true);Set(HTMLCOMERCIALVER,true)", label: "Acompanhamento de patologias", href: "#/entity/patologias-sac", moduleId: "comercial", image: `${ASSET_ROOT}/quick-pathologies.png`, fill: "rgb(172, 62, 11)", x: 1277, y: 410, width: 79, height: 76 },
  { id: "cotacoes", sourceControl: "Image21_4", sourceHtmlControl: "HtmlText26", powerFx: "Set(HTMLNOVACOTAÇÃO,true)", label: "Cotações e orçamentos", href: "#/entity/novas-cotacoes", moduleId: "suprimentos", image: `${ASSET_ROOT}/quick-quotations.png`, fill: "rgb(0, 16, 96)", x: 0, y: 445, width: 79, height: 76 },
  { id: "contratos", sourceControl: "Image23_79", sourceHtmlControl: "HtmlText25", powerFx: "Set(VINCULOCONTRATO,true);Set(HTMLRH,true)", label: "Controle de empreiteiros", href: "#/entity/empreiteiros", moduleId: "rh-obras", image: `${ASSET_ROOT}/quick-contracts.png`, fill: "rgb(203, 102, 102)", x: 466, y: 31, width: 79, height: 76 },
  { id: "imoveis", sourceControl: "Image7_5", sourceHtmlControl: "HtmlText20", powerFx: "Set(DETALHARIMOVEL,true);Set(HTMLCOMERCIALVER,true)", label: "Detalhamento de imóveis", href: "#/entity/imoveis", moduleId: "patrimonio-locacoes", image: `${ASSET_ROOT}/quick-properties.png`, fill: "rgb(172, 62, 11)", x: 1277, y: 320, width: 79, height: 76 },
  { id: "presenca-semanal", sourceControl: "Image23_41", sourceHtmlControl: "HtmlText10_10", powerFx: "Set(HTMLRH,true);Set(PRESENCASEMANAL,true)", label: "Presença semanal", href: "#/analytics/recursos-humanos", moduleId: "rh-obras", image: `${ASSET_ROOT}/quick-weekly-presence.png`, fill: "rgb(203, 102, 102)", x: 735, y: 30, width: 79, height: 74 },
  { id: "pagamentos-presenca", sourceControl: "Image23_78", sourceHtmlControl: "HtmlText17", powerFx: "Set(VINCULOIDPGTO,true);Set(HTMLRH,true)", label: "Pagamentos vinculados às presenças", href: "#/entity/lancamentos", moduleId: "suprimentos", image: `${ASSET_ROOT}/quick-payment-links.png`, fill: "rgb(203, 102, 102)", x: 555, y: 30, width: 79, height: 76 },
  { id: "auditoria-pedidos", sourceControl: "Image21_19", sourceHtmlControl: "HtmlText11", powerFx: "Set(AUDITORIAPEDIDO,true);Set(CARREGARGASTOS,true)", label: "Controle de depreciação de imobilizados", href: "#/analytics/imobilizado", moduleId: "patrimonio-locacoes", image: `${ASSET_ROOT}/quick-order-audit.png`, fill: "rgb(149, 149, 149)", x: 0, y: 535, width: 79, height: 78 },
  { id: "pedidos", sourceControl: "Image21", sourceHtmlControl: "HtmlText15", powerFx: "Set(GERALPEDIDOS,true);Set(CARREGARGASTOS,true)", label: "Pedidos para baixa", href: "#/entity/notas-pendentes", moduleId: "suprimentos", image: `${ASSET_ROOT}/module-financial.png`, fill: "rgb(0, 18, 107)", x: 0, y: 350, width: 79, height: 76 },
  { id: "lancamentos", sourceControl: "Image23_77", sourceHtmlControl: "HtmlText10_19", powerFx: "Set(VERHTML,true);Set(CARREGARGASTOS,true)", label: "Análise de lançamentos", href: "#/analytics/financeiro", moduleId: "financeiro", image: `${ASSET_ROOT}/module-supplies.png`, fill: "rgb(0, 13, 75)", x: 0, y: 94, width: 79, height: 76 },
  { id: "despesas-recorrentes", sourceControl: "Image4_4", sourceHtmlControl: "HtmlText2_5", powerFx: "Set(DESPESASRECORRENTES12,true);Set(CARREGARGASTOS,true)", label: "Despesas recorrentes", href: "#/entity/despesas-recorrentes", moduleId: "suprimentos", image: `${ASSET_ROOT}/company-mark.png`, fill: "rgb(0, 13, 75)", x: 0, y: 264, width: 79, height: 76 },
  { id: "apontamentos-funcionarios", sourceControl: "Image23_76", sourceHtmlControl: "HtmlText24_28", powerFx: "Set(atual,true);Set(HTMLRH,true)", label: "Apontamentos de funcionários", href: "#/analytics/recursos-humanos", moduleId: "rh-obras", image: `${ASSET_ROOT}/module-rh.png`, fill: "rgb(203, 102, 102)", x: 645, y: 30, width: 79, height: 76 },
  { id: "diario-obras", sourceControl: "Image20_55", sourceHtmlControl: "HtmlText24_27", powerFx: "Set(VERDIARIOOBRAS,true);Set(HTMLRH,true)", label: "Diários de obras", href: "#/entity/diarios-de-obras", moduleId: "rh-obras", image: `${ASSET_ROOT}/quick-diary.png`, fill: "rgb(203, 102, 102)", x: 1000, y: 31, width: 79, height: 76 },
  { id: "provisoes", sourceControl: "Image23_74", sourceHtmlControl: "HtmlText5", powerFx: "Set(VERNOVOHTML,true);Set(VERHTML,false);Set(CARREGARGASTOS,true)", label: "Medições de lançamentos", href: "#/analytics/financeiro", moduleId: "financeiro", image: `${ASSET_ROOT}/quick-provisions.png`, fill: "rgb(0, 16, 96)", x: 0, y: 179, width: 79, height: 76 },
  { id: "previsoes-locacao", sourceControl: "Image20_53", sourceHtmlControl: "HtmlText10_22", powerFx: "Set(PREVLOCACOESVER,true);Set(HTMLPESSOAIS,true)", label: "Previsões de locação", href: "#/entity/previsoes-de-locacao", moduleId: "patrimonio-locacoes", image: `${ASSET_ROOT}/module-demands.png`, fill: "rgb(251, 188, 159)", x: 1277, y: 497, width: 79, height: 76 },
  { id: "tarefas", sourceControl: "Image20_49", sourceHtmlControl: "HtmlText10_21", powerFx: "Set(TAREFAS,true);Set(TAREFASPESSOAISHTML,true)", label: "Tarefas delegadas", href: "#/entity/tarefas-delegadas", moduleId: "demandas", image: `${ASSET_ROOT}/quick-tasks.png`, fill: "rgb(99, 139, 44)", x: 1090, y: 31, width: 79, height: 77 },
  { id: "apontamentos-comerciais", sourceControl: "Image7", sourceHtmlControl: "HtmlText24_26", powerFx: "Set(APONTAMENTOSCOMERCIAISVOLTAR,true);Set(HTMLCOMERCIALVER,true)", label: "Apontamentos comerciais", href: "#/entity/apontamentos-comerciais", moduleId: "comercial", image: `${ASSET_ROOT}/quick-commercial.png`, fill: "rgb(172, 62, 11)", x: 1277, y: 230, width: 79, height: 76 },
  { id: "homologacao-locacao", sourceControl: "Image4_6", sourceHtmlControl: "HtmlText10_6", powerFx: "Set(HOMOLOGACAOLOCACOES,true);Set(HTMLPESSOAIS,true)", label: "Homologação de locação", href: "#/entity/homologacoes-de-locacao", moduleId: "patrimonio-locacoes", image: `${ASSET_ROOT}/module-audit.png`, fill: "rgb(251, 188, 159)", x: 1277, y: 585, width: 79, height: 76 },
  { id: "alugueis", sourceControl: "Image4_5", sourceHtmlControl: "HtmlText2_4", powerFx: "Set(VALORMENSAL,true);Set(HTMLPESSOAIS,true)", label: "Valores mensais de locação", href: "#/entity/lancamentos-de-aluguel", moduleId: "patrimonio-locacoes", image: `${ASSET_ROOT}/quick-rent.png`, fill: "rgb(251, 188, 159)", x: 1277, y: 674, width: 79, height: 76 },
  { id: "receitas", sourceControl: "Image23_13", sourceHtmlControl: "HtmlText24_13", powerFx: "Set(VERHTMLCOMERCIAL,true);Set(HTMLCOMERCIALVER,true)", label: "Indicadores comerciais", href: "#/analytics/comercial", moduleId: "comercial", image: `${ASSET_ROOT}/module-commercial.png`, fill: "rgb(172, 62, 11)", x: 1277, y: 140, width: 79, height: 76 },
  { id: "documentos", sourceControl: "Image23_42", sourceHtmlControl: "HtmlText10_5", powerFx: "Set(DOCUMENTOS,true);Set(TAREFASPESSOAISHTML,true);Set(VERDOCUMENTOS,true)", label: "Documentos operacionais", href: "#/entity/documentos-operacionais", moduleId: "auditoria-compliance", image: `${ASSET_ROOT}/module-audit.png`, fill: "rgb(136, 160, 209)", x: 0, y: 625, width: 79, height: 76 },
  { id: "presencas", sourceControl: "Image23_39", sourceHtmlControl: "HtmlText10_4", powerFx: "Set(verpresentes2,true);Set(HTMLRH,true)", label: "Resumo de presenças", href: "#/analytics/recursos-humanos", moduleId: "rh-obras", image: `${ASSET_ROOT}/quick-presences.png`, fill: "rgb(203, 102, 102)", x: 820, y: 31, width: 79, height: 74 },
  { id: "etapas", sourceControl: "Image21_7", sourceHtmlControl: "HtmlText24_19", powerFx: "Set(htmletapa,true);Set(htmlcorreto,HtmlText24_9.HtmlText);Set(HTMLRH,true)", label: "Demonstrativo de etapas", href: "#/analytics/etapa-obra", moduleId: "rh-obras", image: `${ASSET_ROOT}/company-mark.png`, fill: "rgb(203, 102, 102)", x: 910, y: 31, width: 79, height: 76 },
  { id: "relatorio-tarefas", sourceControl: "Image20_30", sourceHtmlControl: "HtmlText10_14", powerFx: "Set(verpresentes,true);Set(TAREFASPESSOAISHTML,true)", label: "Resumo de tarefas", href: "#/entity/lancamentos-de-tarefas", moduleId: "demandas", image: `${ASSET_ROOT}/module-demands.png`, fill: "rgb(99, 139, 44)", x: 1180, y: 31, width: 79, height: 76 },
].map(action => ({ ...action, report: action.id })));

export default Object.freeze({
  source: POWERAPPS_HOME_SOURCE,
  assets: POWERAPPS_HOME_ASSETS,
  tiles: POWERAPPS_HOME_TILES,
  quickActions: POWERAPPS_HOME_QUICK_ACTIONS,
});
