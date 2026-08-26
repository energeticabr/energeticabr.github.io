import { escapeHtml, formatDateTime } from "../core/utils.js";
import { displayColumnValue, mapSharePointColumns } from "../data/column-mapper.js";
import { renderDynamicForm } from "./dynamic-form.js";

export function itemDetailMarkup({ entity, item, columns = [], actions = {}, message = "", error = "" } = {}) {
  const fields = item?.fields || {};
  const visibleColumns = columns.filter(column => !column.hidden);
  return `<section class="entity-page item-detail-page" aria-labelledby="itemDetailTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">${escapeHtml(entity?.title || "Registro")}</p><h1 id="itemDetailTitle">Registro #${escapeHtml(item?.id || "")}</h1><p class="entity-meta">Criado ${escapeHtml(formatDateTime(item?.createdDateTime))} · Atualizado ${escapeHtml(formatDateTime(item?.lastModifiedDateTime))}</p></div><div class="entity-actions"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity?.id || "")}">Voltar à lista</a>${actions.edit ? '<button class="button-primary" type="button" data-item-edit>Editar</button>' : ""}${actions.delete ? '<button class="button-danger" type="button" data-item-delete>Excluir</button>' : ""}</div></header>
    <p class="entity-toast ${error ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(error || message)}</p>
    <section class="item-fields" aria-label="Dados do registro">${visibleColumns.map(column => `<div class="item-field"><span>${escapeHtml(column.label)}</span><strong>${escapeHtml(displayColumnValue(fields, column))}</strong></div>`).join("") || '<p class="entity-empty">Nenhum campo disponível para exibição.</p>'}</section>
    <section class="item-activity" data-item-activity aria-labelledby="itemActivityTitle"><div><p class="page-eyebrow">Acompanhamento</p><h2 id="itemActivityTitle">Atividades e anexos</h2></div><p>O histórico e os anexos deste registro aparecerão aqui.</p></section>
  </section>`;
}

export function notifyItemDeleted(entity, onDeleted) {
  onDeleted?.({ entityId: entity?.id, message: "Registro excluído com sucesso." });
}

export function createItemDetailPage(root, context = {}) {
  if (!root) throw new TypeError("O detalhe requer um elemento raiz.");
  const { entity, itemId, repository, access, can } = context;
  let disposed = false;
  let generation = 0;
  let list;
  let columns = [];
  let item;
  let formController;
  const state = { message: "", error: "", editing: false, formValues: null };

  const current = value => !disposed && value === generation;
  const actions = () => ({
    edit: entity?.capabilities?.edit === true && can?.(access, entity.moduleId, "edit") === true,
    delete: entity?.capabilities?.delete === true && can?.(access, entity.moduleId, "delete") === true,
  });

  function render() {
    if (disposed || !item) return;
    formController?.cleanup?.();
    if (state.editing) {
      root.innerHTML = '<section class="entity-page"><div data-item-form></div></section>';
      formController = renderDynamicForm(root.querySelector("[data-item-form]"), {
        entity, columns, mode: "edit", values: state.formValues || item.fields || {}, error: state.error,
        onCancel: () => { state.editing = false; state.formValues = null; render(); },
        onSubmit: save,
      });
      return;
    }
    root.innerHTML = itemDetailMarkup({ entity, item, columns, actions: actions(), ...state });
    root.querySelector("[data-item-edit]")?.addEventListener("click", () => {
      if (actions().edit) { state.editing = true; render(); }
    });
    root.querySelector("[data-item-delete]")?.addEventListener("click", remove);
  }

  async function load() {
    const token = ++generation;
    root.innerHTML = '<section class="entity-page" aria-busy="true"><p class="entity-loading">Carregando registro...</p></section>';
    try {
      list = await repository.resolveList(entity.siteKey, entity.listNames);
      if (!current(token)) return;
      if (list.status !== "resolved") {
        root.innerHTML = `<section class="entity-page"><h1>${escapeHtml(entity.title)}</h1><p class="entity-empty">A lista desta área ainda não foi localizada no SharePoint.</p></section>`;
        return;
      }
      [columns, item] = await Promise.all([
        repository.getColumns(entity.siteKey, list.id),
        repository.getItems(entity.siteKey, list.id, "$expand=fields"),
      ]).then(([rawColumns, items]) => [rawColumns, items.find(candidate => String(candidate.id) === String(itemId))]);
      if (!current(token)) return;
      if (!item) {
        root.innerHTML = `<section class="entity-page"><h1>${escapeHtml(entity.title)}</h1><p class="entity-empty">Este registro não foi encontrado ou não está mais disponível.</p></section>`;
        return;
      }
      columns = mapSharePointColumns(columns, entity);
      render();
    } catch (error) {
      if (current(token)) root.innerHTML = `<section class="entity-page"><h1>${escapeHtml(entity.title)}</h1><p class="entity-error" role="alert">Não foi possível abrir o registro: ${escapeHtml(error?.message || "erro desconhecido")}</p></section>`;
    }
  }

  async function save(fields, rawValues = {}) {
    if (!actions().edit || !list || !item) return;
    const token = ++generation;
    try {
      await repository.updateItem(entity.siteKey, list.id, item.id, fields);
      if (!current(token)) return;
      state.message = "Registro atualizado com sucesso.";
      state.error = "";
      state.editing = false;
      state.formValues = null;
      await load();
    } catch (error) {
      if (!current(token)) return;
      state.error = error?.message || "Não foi possível atualizar o registro.";
      state.editing = true;
      state.formValues = rawValues;
      render();
    }
  }

  async function remove() {
    if (!actions().delete || !list || !item) return;
    const confirmed = context.confirmDelete ? context.confirmDelete(item) : globalThis.confirm?.("Excluir este registro? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    const token = ++generation;
    try {
      await repository.deleteItem(entity.siteKey, list.id, item.id);
      if (!current(token)) return;
      notifyItemDeleted(entity, context.onDeleted);
    } catch (error) {
      if (!current(token)) return;
      state.error = error?.message || "Não foi possível excluir o registro.";
      render();
    }
  }

  const ready = load();
  return Object.freeze({ ready, cleanup: () => { disposed = true; generation += 1; formController?.cleanup?.(); } });
}
