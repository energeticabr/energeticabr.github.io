const module = (id, title) => Object.freeze({ id, title });

export const MODULES = Object.freeze([
  module("dashboard", "Painel inicial"),
  module("suprimentos", "Suprimentos"),
  module("demandas", "Demandas"),
  module("comercial", "Comercial"),
  module("financeiro", "Financeiro"),
  module("rh-obras", "Recursos Humanos e Obras"),
  module("patrimonio-locacoes", "Patrimônio e Locações"),
  module("auditoria-compliance", "Auditoria e Compliance"),
  module("usuarios-acessos", "Usuários e Acessos"),
]);

export default MODULES;
