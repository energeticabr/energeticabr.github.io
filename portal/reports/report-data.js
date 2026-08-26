import { classifyEntityAvailability } from "../data/attachments.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { detectReportDimensions } from "./report-model.js";

function emptyResult(state, extra = {}) {
  return Object.freeze({
    state,
    list: extra.list,
    error: extra.error,
    columns: Object.freeze([]),
    rawColumns: Object.freeze([]),
    items: Object.freeze([]),
    dimensions: detectReportDimensions([], extra.entity),
  });
}

export async function loadReportSource(repository, entity) {
  if (!repository || !entity) throw new TypeError("O relatorio requer repositorio e fonte SharePoint.");
  try {
    const list = await repository.resolveList(entity.siteKey, entity.listNames);
    if (list.status !== "resolved") return emptyResult("missing", { list, entity });
    const [rawColumns, items] = await Promise.all([
      repository.getColumns(entity.siteKey, list.id),
      repository.getItems(entity.siteKey, list.id, "$expand=fields"),
    ]);
    return Object.freeze({
      state: "ready",
      list,
      rawColumns: Object.freeze([...(rawColumns || [])]),
      columns: mapSharePointColumns(rawColumns, entity),
      items: Object.freeze([...(items || [])]),
      dimensions: detectReportDimensions(rawColumns, entity),
    });
  } catch (error) {
    const availability = classifyEntityAvailability(error);
    return emptyResult(availability, { error, entity });
  }
}
