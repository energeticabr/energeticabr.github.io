import { createOrdersGalleryData } from "./orders-gallery-data.js";

// Lista e campos das galerias baseadas nas telas Power Apps.
export const REGISTRATION_GALLERY_MODELS = Object.freeze({
  group: Object.freeze({ title: "GALERIA GRUPO", screen: "G10- HISTÓRICO GRUPO", listName: "CADASTROGRUPO", aliases: ["CADASTROGRUPO", "CADASTRO GRUPO"], fields: ["GRUPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { GRUPO: ["Title"] } }),
  family: Object.freeze({ title: "GALERIA FAMÍLIA", screen: "G8- HISTÓRICO FAMÍLIA", listName: "CADASTRO FAMÍLIA_1", aliases: ["CADASTRO FAMÍLIA_1", "CADASTRO FAMILIA_1"], fields: ["FAMÍLIA", "GRUPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { "FAMÍLIA": ["field_1"], GRUPO: ["Title"] } }),
  subfamily: Object.freeze({ title: "GALERIA SUBFAMÍLIA", screen: "G35- HISTÓRICO SUBFAMÍLIA", listName: "CADASTROSUBFAMÍLIA", aliases: ["CADASTROSUBFAMÍLIA", "CADASTROSUBFAMILIA", "CADASTRO SUBFAMÍLIA", "CADASTRO SUBFAMILIA"], fields: ["SUBFAMÍLIAS CADASTRADAS", "FAMÍLIA", "UNIDADE", "TIPO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { "SUBFAMÍLIAS CADASTRADAS": ["field_1"], "FAMÍLIA": ["Title"], UNIDADE: ["field_2"], TIPO: ["field_3"] } }),
  product: Object.freeze({ title: "GALERIA PRODUTO", screen: "G38- HISTÓRICO PRODUTO", listName: "CADASTROPRODUTO", aliases: ["CADASTROPRODUTO", "CADASTRO PRODUTO"], fields: ["PRODUTO", "SUBFAMÍLIA", "UNIDADE", "TIPO", "TIPODESPESA", "GERADESEMBOLSO", "STATUS", "ID", "Criado por", "Criado", "Modificado", "Modificado por"], fieldAliases: { PRODUTO: ["field_1"], "SUBFAMÍLIA": ["Title"], STATUS: ["SATUS"] } }),
  documents: Object.freeze({
    title: "GALERIA DOCUMENTOS",
    screen: "G47- HISTÓRICO DOCUMENTOS COMERCIAL_1",
    listName: "DOCUMENTOS_1",
    aliases: ["DOCUMENTOS_1"],
    searchPlaceholder: "Pesquisar documento ou ID",
    fields: ["PESSOARELACIONADA", "STATUS", "FILIAL", "IMOVEL", "TIPODOCUMENTO", "TIPOHOMOLOGACAO", "ETAPA", "TIPOMARCO", "OBS", "DATA", "DATAVALIDADE", "DATASUBMETIDO", "ID", "Criado por", "Criado", "Modificado por", "Modificado"],
    filterFields: ["TIPOHOMOLOGACAO", "FILIAL", "IMOVEL", "ETAPA", "ID", "TIPODOCUMENTO", "PESSOARELACIONADA", "STATUS"],
    fieldAliases: { PESSOARELACIONADA: ["PESSOA RELACIONADA"], IMOVEL: ["IMÓVEL"], DATASUBMETIDO: ["DATA SUBMETIDO"] },
    showAttachments: true,
  }),
});

export function createRegistrationGalleryData({ kind, ...options } = {}) {
  const model = REGISTRATION_GALLERY_MODELS[kind];
  if (!model) throw new RangeError("Galeria de cadastro desconhecida.");
  return createOrdersGalleryData({
    ...options,
    listAliases: model.aliases,
    listName: model.listName,
    listMissingCode: `registration_${kind}_list_missing`,
  });
}
