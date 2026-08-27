import { escapeHtml, formatDateTime } from "../core/utils.js";
import { mapSharePointColumns } from "../data/column-mapper.js";
import { classifyEntityAvailability, createAttachmentActions } from "../data/attachments.js";
import { resolvePowerAppsUiContract } from "../catalog/powerapps-ui-contract.js?v=20260827-galerias-compactas";
import { buildVisibleItemExport, downloadItemExport } from "../exports/item-export.js";
import { formatGalleryValue } from "../gallery/gallery-model.js";
import { buildItemTimeline, itemTimelineMarkup } from "../history/item-history.js";
import { renderAttachmentsPanel } from "./attachments-panel.js";
import { renderDynamicForm } from "./dynamic-form.js";
import { persistEntityRecordWithAttachments } from "../forms/entity-submit.js";
import { powerAppsFormDeclaresAttachments } from "../forms/form-attachments.js";

export function itemDetailMarkup({ entity, item, columns = [], actions = {}, message = "", error = "", activity = {} } = {}) {
  const fields = item?.fields || {};
  const visibleColumns = columns.filter(column => !column.hidden);
  return `<section class="entity-page item-detail-page" aria-labelledby="itemDetailTitle">
    <header class="entity-heading"><div><p class="page-eyebrow">${escapeHtml(entity?.title || "Registro")}</p><h1 id="itemDetailTitle">Registro #${escapeHtml(item?.id || "")}</h1><p class="entity-meta">Criado ${escapeHtml(formatDateTime(item?.createdDateTime))} · Atualizado ${escapeHtml(formatDateTime(item?.lastModifiedDateTime))}</p></div><div class="entity-actions"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity?.id || "")}">Voltar à lista</a>${actions.export ? '<button class="button-secondary" type="button" data-item-export>Exportar</button>' : ""}${actions.approve ? '<button class="button-primary" type="button" data-item-approve>Aprovar</button>' : ""}${actions.edit ? '<button class="button-primary" type="button" data-item-edit>Editar</button>' : ""}${actions.delete ? `<button class="button-danger" type="button" data-item-delete>${entity?.deletionPolicy === "archive" ? "Arquivar" : "Excluir"}</button>` : ""}</div></header>
    <p class="entity-toast ${error ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(error || message)}</p>
    <section class="item-fields" aria-label="Dados do registro">${visibleColumns.map(column => `<div class="item-field"><span>${escapeHtml(column.label)}</span><strong>${escapeHtml(formatGalleryValue(fields, column))}</strong></div>`).join("") || '<p class="entity-empty">Nenhum campo disponível para exibição.</p>'}</section>
    <section class="item-activity" data-item-activity>${itemTimelineMarkup({ availability: activity.availability, events: activity.history })}</section>
    <section id="attachments" data-item-attachments></section>
  </section>`;
}

export function notifyItemDeleted(entity, onDeleted) {
  onDeleted?.({ entityId: entity?.id, message: "Registro excluído com sucesso." });
}

export function getItemDetailActions(entity, access, can) {
  const allowed = action => entity?.capabilities?.[action] === true && can?.(access, entity.moduleId, action) === true;
  const archiveAllowed = entity?.deletionPolicy !== "archive" || allowed("edit");
  return Object.freeze({
    export: allowed("view"),
    edit: allowed("edit"),
    delete: allowed("delete") && archiveAllowed,
    approve: allowed("approve"),
  });
}

function itemLoadStateMarkup(entity, message, { missing = false } = {}) {
  return `<section class="entity-page item-detail-page"><header class="entity-heading"><div><p class="page-eyebrow">${escapeHtml(entity?.title || "Registro")}</p><h1>${missing ? "Registro indisponível" : "Não foi possível abrir o registro"}</h1></div><div class="entity-actions"><a class="button-secondary" href="#/entity/${encodeURIComponent(entity?.id || "")}">Voltar à lista</a></div></header><div class="entity-state"><p class="entity-${missing ? "empty" : "error"}" role="${missing ? "status" : "alert"}">${escapeHtml(message)}</p><button class="button-secondary" type="button" data-item-retry>Tentar novamente</button></div></section>`;
}

function approvalFields(entity, columns = []) {
  const available = new Set(columns.map(column => column.name));
  const field = (entity?.statusFields || []).find(candidate => available.has(candidate));
  if (!field) throw new Error("Não foi possível identificar o campo de aprovação desta lista.");
  return { [field]: "APROVADO" };
}

export function createItemDetailPage(root, context = {}) {
  if (!root) throw new TypeError("O detalhe requer um elemento raiz.");
  const { entity, itemId, repository, access, can } = context;
  let disposed = false;
  let generation = 0;
  let list;
  let columns = [];
  let formColumns = [];
  let uiContract = Object.freeze({ hasForm: false, readOnly: true });
  let item;
  let formController;
  let attachmentsController;
  const state = {
    message: "", error: "", editing: false, formValues: null, formRelationshipLabels: {}, formVariantId: "", conflict: null,
    attachments: { availability: "missing", files: [], diagnostic: "" },
    activity: { availability: "available", history: [] },
    versions: [],
  };

  const current = value => !disposed && value === generation;
  const actions = () => {
    const available = getItemDetailActions(entity, access, can);
    return uiContract.hasForm === true
      && (uiContract.readOnly !== true || uiContract.requiresVariantSelection === true)
      ? available
      : Object.freeze({ ...available, edit: false });
  };
  const attachmentActions = () => createAttachmentActions({ repository, entity, access, can, listId: list?.id, itemId: item?.id, isSuperAdmin: context.isSuperAdmin === true });

  function render() {
    if (disposed || !item) return;
    formController?.cleanup?.();
    attachmentsController?.cleanup?.();
    if (state.editing) {
      uiContract = resolvePowerAppsUiContract(entity, columns, { mode: "edit", formVariantId: state.formVariantId });
      formColumns = uiContract.formColumns;
      state.formVariantId = uiContract.formVariant?.id || "";
      root.innerHTML = '<section class="entity-page"><div data-item-form></div></section>';
      formController = renderDynamicForm(root.querySelector("[data-item-form]"), {
        entity, columns: formColumns, mode: "edit", values: state.formValues || item.fields || {}, relationshipLabels: state.formRelationshipLabels, error: state.error, conflict: state.conflict,
        relationshipDebounceMs: context.relationshipDebounceMs,
        relationshipSearch: (column, term, options) => {
          if (typeof repository.searchRelationshipOptions !== "function") throw new Error("A pesquisa relacional do SharePoint não está disponível.");
          return repository.searchRelationshipOptions(entity.siteKey, list.id, column.relation, term, options);
        },
        powerAppsOptionDebounceMs: context.powerAppsOptionDebounceMs,
        powerAppsOptionSearch: (_column, source, term, dependencies, options) => {
          if (typeof repository.searchPowerAppsOptions !== "function") throw new Error("A origem Power Apps do SharePoint não está disponível.");
          return repository.searchPowerAppsOptions(entity.siteKey, source, term, dependencies, options);
        },
        attachments: {
          enabled: powerAppsFormDeclaresAttachments(uiContract),
          canView: powerAppsFormDeclaresAttachments(uiContract)
            && state.attachments.availability === "available"
            && attachmentActions().canView(),
          canEdit: powerAppsFormDeclaresAttachments(uiContract)
            && state.attachments.availability === "available"
            && attachmentActions().canEdit(),
          existingFiles: state.attachments.availability === "available" ? state.attachments.files : [],
          readExisting: file => repository.downloadAttachment(entity.siteKey, list.id, item.id, file?.name),
        },
        onCancel: () => { state.editing = false; state.formValues = null; state.formRelationshipLabels = {}; state.conflict = null; render(); },
        onReloadConflict: () => {
          if (!state.conflict?.serverItem) return;
          item = state.conflict.serverItem;
          state.formValues = { ...(item.fields || {}) };
          state.formRelationshipLabels = {};
          state.conflict = null;
          state.error = "";
          render();
        },
        onSubmit: save,
      });
      return;
    }
    root.innerHTML = itemDetailMarkup({ entity, item, columns, actions: actions(), activity: state.activity, ...state });
    root.querySelector("[data-item-edit]")?.addEventListener("click", () => {
      if (actions().edit) { state.editing = true; state.formRelationshipLabels = {}; state.conflict = null; render(); }
    });
    root.querySelector("[data-item-delete]")?.addEventListener("click", remove);
    root.querySelector("[data-item-approve]")?.addEventListener("click", approve);
    root.querySelector("[data-item-export]")?.addEventListener("click", exportRecord);
    attachmentsController = renderAttachmentsPanel(root.querySelector("[data-item-attachments]"), {
      availability: state.attachments.availability,
      files: state.attachments.files,
      actions: attachmentActions(),
      onChanged: refreshAttachments,
      diagnostic: state.attachments.diagnostic,
      showDiagnostics: context.isSuperAdmin === true,
    });
  }

  async function refreshAttachments() {
    if (!list || !item || typeof repository.listAttachments !== "function") return;
    const token = generation;
    try {
      const files = await attachmentActions().listAttachments();
      if (!current(token)) return;
      state.attachments = { availability: "available", files, diagnostic: "" };
      state.activity = {
        ...state.activity,
        history: buildDetailTimeline(files),
      };
      render();
    } catch (error) {
      if (!current(token)) return;
      state.attachments = { availability: classifyEntityAvailability(error), files: [], diagnostic: error?.message || "" };
      render();
    }
  }

  async function loadSupplemental(token) {
    const attachmentLoad = typeof repository.listAttachments === "function"
      ? attachmentActions().listAttachments()
      : Promise.resolve(undefined);
    const versionsLoad = typeof repository.getItemVersions === "function"
      ? repository.getItemVersions(entity.siteKey, list.id, item.id)
      : Promise.resolve([]);
    const [attachments, versions] = await Promise.allSettled([attachmentLoad, versionsLoad]);
    if (!current(token)) return;
    const attachmentFiles = attachments.status === "fulfilled" && attachments.value !== undefined ? attachments.value : [];
    state.attachments = attachments.status === "fulfilled" && attachments.value !== undefined
      ? { availability: "available", files: attachmentFiles, diagnostic: "" }
      : { availability: attachments.status === "rejected" ? classifyEntityAvailability(attachments.reason) : "missing", files: [], diagnostic: attachments.reason?.message || "" };
    state.versions = versions.status === "fulfilled" ? versions.value : [];
    state.activity = {
      availability: versions.status === "rejected" ? classifyEntityAvailability(versions.reason) : "available",
      history: buildDetailTimeline(attachmentFiles),
    };
  }

  function shortDateFields(fields = {}) {
    const formatted = { ...fields };
    for (const column of columns) {
      if (!["date", "datetime-local"].includes(column.control) || !Object.hasOwn(formatted, column.name)) continue;
      formatted[column.name] = formatGalleryValue(formatted, column);
    }
    return formatted;
  }

  function timelineRecord(record = {}) {
    return record?.fields ? { ...record, fields: shortDateFields(record.fields) } : record;
  }

  function buildDetailTimeline(attachments = []) {
    return buildItemTimeline({
      item: timelineRecord(item),
      versions: state.versions.map(timelineRecord),
      attachments,
      relatedRecords: context.relatedRecords || [],
      columns,
    });
  }

  function exportRecord() {
    if (!actions().export || !item) return;
    try {
      const artifact = buildVisibleItemExport({ entity, item, columns, attachments: state.attachments.files, access, can });
      (context.exportDownloader || downloadItemExport)(artifact, context.exportOptions);
      state.message = "Exportação do registro preparada com sucesso.";
      state.error = "";
      render();
    } catch (error) {
      state.error = error?.message || "Não foi possível exportar este registro.";
      render();
    }
  }

  async function load() {
    const token = ++generation;
    root.innerHTML = '<section class="entity-page" aria-busy="true"><p class="entity-loading">Carregando registro...</p></section>';
    try {
      list = await repository.resolveList(entity.siteKey, entity.listNames);
      if (!current(token)) return;
      if (list.status !== "resolved") {
        root.innerHTML = itemLoadStateMarkup(entity, "A lista desta área ainda não foi localizada no SharePoint.", { missing: true });
        root.querySelector("[data-item-retry]")?.addEventListener("click", load);
        return;
      }
      [columns, item] = await Promise.all([
        repository.getColumns(entity.siteKey, list.id),
        typeof repository.getItem === "function"
          ? repository.getItem(entity.siteKey, list.id, itemId, "$expand=fields")
          : repository.getItems(entity.siteKey, list.id, "$expand=fields").then(items => items.find(candidate => String(candidate.id) === String(itemId))),
      ]);
      if (!current(token)) return;
      if (!item) {
        root.innerHTML = itemLoadStateMarkup(entity, "Este registro não foi encontrado ou não está mais disponível.", { missing: true });
        root.querySelector("[data-item-retry]")?.addEventListener("click", load);
        return;
      }
      columns = mapSharePointColumns(columns, entity);
      uiContract = resolvePowerAppsUiContract(entity, columns, { mode: "edit" });
      formColumns = uiContract.formColumns;
      state.formVariantId = uiContract.formVariant?.id || "";
      await loadSupplemental(token);
      if (!current(token)) return;
      render();
    } catch (error) {
      if (current(token)) {
        root.innerHTML = itemLoadStateMarkup(entity, `Não foi possível abrir o registro: ${error?.message || "erro desconhecido"}`);
        root.querySelector("[data-item-retry]")?.addEventListener("click", load);
      }
    }
  }

  async function save(fields, rawValues = {}, relationshipLabels = {}, attachments = {}) {
    if (!actions().edit || !list || !item) return;
    const token = ++generation;
    try {
      await persistEntityRecordWithAttachments(repository, entity, list, {
        mode: "edit",
        item,
        fields,
        attachments,
      });
      if (!current(token)) return;
      state.message = "Registro atualizado com sucesso.";
      state.error = "";
      state.editing = false;
      state.formValues = null;
      state.formRelationshipLabels = {};
      state.conflict = null;
      await load();
    } catch (error) {
      if (!current(token)) return;
      state.error = error?.message || "Não foi possível atualizar o registro.";
      state.editing = true;
      state.formValues = rawValues;
      state.formRelationshipLabels = relationshipLabels;
      if (error?.code === "concurrent_change" && typeof repository.getItem === "function") {
        try {
          const serverItem = await repository.getItem(entity.siteKey, list.id, item.id, "$expand=fields");
          if (!current(token)) return;
          state.conflict = { message: error.message, serverItem, serverFields: serverItem?.fields || {} };
        } catch {
          state.conflict = { message: error.message, serverItem: null, serverFields: {} };
        }
      }
      render();
    }
  }

  async function remove() {
    if (!actions().delete || !list || !item) return;
    const archives = entity?.deletionPolicy === "archive";
    const confirmed = context.confirmDelete
      ? context.confirmDelete(item)
      : globalThis.confirm?.(archives ? "Arquivar este registro e preservar todo o histórico?" : "Excluir este registro? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    const token = ++generation;
    try {
      if (archives) {
        const field = String(entity.archiveField || "").trim();
        if (!field) throw new Error("A política de arquivamento não possui campo de status configurado.");
        const archived = await repository.updateItem(entity.siteKey, list.id, item.id, {
          [field]: entity.archiveValue || "INATIVO",
        }, { eTag: item.eTag || item["@odata.etag"] });
        if (!current(token)) return;
        item = archived?.fields
          ? archived
          : { ...item, fields: { ...(item.fields || {}), [field]: entity.archiveValue || "INATIVO" } };
        state.message = "Registro arquivado com sucesso. O histórico foi preservado.";
        state.error = "";
        render();
        return;
      }
      await repository.deleteItem(entity.siteKey, list.id, item.id, { eTag: item.eTag || item["@odata.etag"] });
      if (!current(token)) return;
      notifyItemDeleted(entity, context.onDeleted);
    } catch (error) {
      if (!current(token)) return;
      state.error = error?.message || "Não foi possível excluir o registro.";
      render();
    }
  }

  async function approve() {
    if (!actions().approve || !list || !item) return;
    const confirmed = context.confirmApprove
      ? await context.confirmApprove(item)
      : globalThis.confirm?.("Aprovar este registro?");
    if (!confirmed) return;
    if (typeof repository.approveItem !== "function") {
      state.error = "A aprovação requer repository.approveItem(siteKey, listId, itemId, fields, { eTag }).";
      render();
      return;
    }
    const token = ++generation;
    try {
      const fields = approvalFields(entity, columns);
      const approvedItem = await repository.approveItem(entity.siteKey, list.id, item.id, fields, { eTag: item.eTag || item["@odata.etag"] });
      if (!current(token)) return;
      item = approvedItem?.fields ? approvedItem : { ...item, fields: { ...(item.fields || {}), ...fields } };
      state.message = "Registro aprovado com sucesso.";
      state.error = "";
      render();
    } catch (error) {
      if (!current(token)) return;
      state.error = error?.message || "Não foi possível aprovar o registro.";
      render();
    }
  }

  const ready = load();
  return Object.freeze({ ready, refresh: load, cleanup: () => { disposed = true; generation += 1; formController?.cleanup?.(); attachmentsController?.cleanup?.(); } });
}
