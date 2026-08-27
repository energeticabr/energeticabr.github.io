import { escapeHtml, formatDateTime } from "../core/utils.js";
import { createAttachmentPresenter } from "../ui/attachments-panel.js";
import { TICKET_VIEW_CONTRACT } from "./ticket-contract.js";
import { createTicketViewService, ticketActionAllowed } from "./ticket-view-service.js";

function bytesLabel(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1) return "Tamanho não informado";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function authorDisplay(ticket) {
  return ticket?.createdBy?.user?.displayName
    || ticket?.createdBy?.user?.email
    || "Não informado";
}

function movementAttachmentsMarkup(movement) {
  if (movement.attachmentsAvailability === "error") {
    return `<p class="ticket-attachment-error" role="status">${escapeHtml(movement.attachmentError || "Não foi possível consultar os anexos.")}</p>`;
  }
  if (!movement.attachments?.length) return "";
  return `<div class="ticket-attachments" aria-label="Anexos desta movimentação">
    ${movement.attachments.map(file => `<div class="ticket-attachment">
      <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(bytesLabel(file.size))}</small></span>
      <span class="ticket-attachment-actions">
        <button type="button" class="button-secondary" data-movement-id="${escapeHtml(movement.id)}" data-ticket-attachment-open="${escapeHtml(file.name)}">Abrir</button>
        <button type="button" class="button-secondary" data-movement-id="${escapeHtml(movement.id)}" data-ticket-attachment-download="${escapeHtml(file.name)}">Baixar</button>
      </span>
    </div>`).join("")}
  </div>`;
}

function movementMarkup(movement, actions) {
  const fields = movement.fields || {};
  const isCustomer = String(fields[TICKET_VIEW_CONTRACT.movement.fields.authorType] || "").trim().toLocaleLowerCase("pt-BR") === "cliente";
  const author = fields[TICKET_VIEW_CONTRACT.movement.fields.authorName] || (isCustomer ? "Cliente" : "Energética");
  const status = fields[TICKET_VIEW_CONTRACT.movement.fields.status] || "";
  return `<article class="ticket-message ${isCustomer ? "is-customer" : "is-company"}" data-movement-id="${escapeHtml(movement.id)}">
    <div class="ticket-message-meta">
      <strong>${escapeHtml(author)}</strong>
      <span>${escapeHtml(formatDateTime(movement.createdDateTime))}${status ? ` · ${escapeHtml(status)}` : ""}</span>
    </div>
    <p class="ticket-message-body">${escapeHtml(fields[TICKET_VIEW_CONTRACT.movement.fields.message] || "Mensagem não informada")}</p>
    ${movementAttachmentsMarkup(movement)}
    ${(actions.edit || actions.delete) ? `<div class="ticket-message-actions">
      ${actions.edit ? `<button type="button" class="button-link" data-movement-edit="${escapeHtml(movement.id)}">Editar movimentação</button>` : ""}
      ${actions.delete ? `<button type="button" class="button-link is-danger" data-movement-delete="${escapeHtml(movement.id)}">Excluir</button>` : ""}
    </div>` : ""}
  </article>`;
}

export function ticketConversationMarkup(view, actions = {}, state = {}) {
  const ticketFields = view?.ticket?.fields || {};
  const ticketActions = actions.ticket || {};
  const movementActions = actions.movement || {};
  const code = ticketFields[TICKET_VIEW_CONTRACT.ticket.fields.code] || view?.ticketCode || "Não informado";
  const customer = ticketFields[TICKET_VIEW_CONTRACT.ticket.fields.customer] || "Não informado";
  const status = ticketFields[TICKET_VIEW_CONTRACT.ticket.fields.status] || "Não informado";
  return `<section class="ticket-view-page" aria-labelledby="ticketViewTitle">
    <header class="ticket-view-heading">
      <div>
        <a class="button-secondary ticket-back" href="#/entity/tickets-clientes">Voltar aos tickets</a>
        <p class="page-eyebrow">Central de tickets</p>
        <h1 id="ticketViewTitle">Ticket ${escapeHtml(code)}</h1>
      </div>
      ${(ticketActions.edit || ticketActions.delete) ? `<div class="ticket-header-actions">
        ${ticketActions.edit ? '<button type="button" class="button-secondary" data-ticket-edit>Editar ticket</button>' : ""}
        ${ticketActions.delete ? '<button type="button" class="button-danger" data-ticket-delete>Arquivar ticket</button>' : ""}
      </div>` : ""}
    </header>
    <dl class="ticket-summary">
      <div><dt>Cliente</dt><dd>${escapeHtml(customer)}</dd></div>
      <div><dt>Status</dt><dd><span class="ticket-status">${escapeHtml(status)}</span></dd></div>
      <div><dt>Criado em</dt><dd>${escapeHtml(formatDateTime(view?.ticket?.createdDateTime))}</dd></div>
      <div><dt>Criador</dt><dd>${escapeHtml(authorDisplay(view?.ticket))}</dd></div>
    </dl>
    <p class="entity-toast ${state.error ? "is-error" : ""}" data-ticket-status role="status" aria-live="polite">${escapeHtml(state.error || state.message || "")}</p>
    <section class="ticket-conversation" aria-label="Movimentações do ticket">
      <div class="ticket-conversation-heading"><div><p class="page-eyebrow">Histórico</p><h2>Conversa</h2></div><span>${view?.movements?.length || 0} movimentação${view?.movements?.length === 1 ? "" : "ões"}</span></div>
      <div class="ticket-message-list">
        ${view?.movements?.length ? view.movements.map(movement => movementMarkup(movement, movementActions)).join("") : '<p class="ticket-empty">Este ticket ainda não possui movimentações.</p>'}
      </div>
    </section>
  </section>`;
}

export function createTicketViewPage(root, context = {}) {
  if (!root) throw new TypeError("A visualização de ticket requer um elemento raiz.");
  const { repository, entities, access, can, itemId } = context;
  const service = createTicketViewService({ repository, entities });
  const presenter = createAttachmentPresenter(context.attachmentPresenterOptions);
  let disposed = false;
  let generation = 0;
  let view;
  const state = { message: "", error: "" };

  const current = token => !disposed && token === generation;
  const actions = () => ({
    ticket: {
      edit: ticketActionAllowed({ entity: view?.ticketEntity, access, can, action: "edit" }),
      delete: ticketActionAllowed({ entity: view?.ticketEntity, access, can, action: "delete" })
        && ticketActionAllowed({ entity: view?.ticketEntity, access, can, action: "edit" }),
    },
    movement: {
      edit: ticketActionAllowed({ entity: view?.movementEntity, access, can, action: "edit" }),
      delete: ticketActionAllowed({ entity: view?.movementEntity, access, can, action: "delete" }),
    },
  });

  function setFailure(error, fallback) {
    state.error = error?.message || fallback;
    state.message = "";
    render();
  }

  async function presentFile(movementId, fileName, mode, reservation) {
    const token = generation;
    try {
      const bytes = await repository.downloadAttachment(
        view.movementEntity.siteKey,
        view.movementListId,
        movementId,
        fileName,
      );
      if (!current(token)) {
        reservation?.close?.();
        return;
      }
      const file = view.movements.find(item => String(item.id) === String(movementId))?.attachments
        ?.find(item => item.name === fileName);
      presenter.present({ bytes, name: fileName, type: file?.type, mode, reservation });
    } catch (error) {
      reservation?.close?.();
      if (current(token)) setFailure(error, "Não foi possível abrir o anexo.");
    }
  }

  async function removeMovement(movementId) {
    if (!actions().movement.delete) return;
    const movement = view.movements.find(item => String(item.id) === String(movementId));
    if (!movement) return;
    const confirmed = context.confirmDelete
      ? await context.confirmDelete("movement", movement)
      : globalThis.confirm?.("Excluir esta movimentação? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    try {
      await repository.deleteItem(view.movementEntity.siteKey, view.movementListId, movement.id, {
        eTag: movement.eTag || movement["@odata.etag"],
      });
      state.message = "Movimentação excluída com sucesso.";
      state.error = "";
      await load();
    } catch (error) {
      setFailure(error, "Não foi possível excluir a movimentação.");
    }
  }

  async function removeTicket() {
    if (!actions().ticket.delete) return;
    const confirmed = context.confirmDelete
      ? await context.confirmDelete("ticket", view.ticket)
      : globalThis.confirm?.("Arquivar este ticket? O histórico e os anexos serão preservados.");
    if (!confirmed) return;
    try {
      const archived = await repository.updateItem(view.ticketEntity.siteKey, view.ticketListId, view.ticket.id, {
        [TICKET_VIEW_CONTRACT.ticket.fields.status]: "INATIVO",
      }, {
        eTag: view.ticket.eTag || view.ticket["@odata.etag"],
      });
      view = Object.freeze({
        ...view,
        ticket: archived?.fields
          ? archived
          : { ...view.ticket, fields: { ...(view.ticket.fields || {}), [TICKET_VIEW_CONTRACT.ticket.fields.status]: "INATIVO" } },
      });
      state.message = "Ticket arquivado com sucesso. O histórico e os anexos foram preservados.";
      state.error = "";
      render();
    } catch (error) {
      setFailure(error, "Não foi possível arquivar o ticket.");
    }
  }

  function render() {
    if (disposed || !view) return;
    root.innerHTML = ticketConversationMarkup(view, actions(), state);
    root.querySelector("[data-ticket-edit]")?.addEventListener("click", () => {
      if (actions().ticket.edit) context.onEditItem?.(view.ticketEntity, view.ticket.id);
    });
    root.querySelector("[data-ticket-delete]")?.addEventListener("click", removeTicket);
    root.querySelectorAll("[data-movement-edit]").forEach(button => button.addEventListener("click", () => {
      if (actions().movement.edit) context.onEditItem?.(view.movementEntity, button.dataset.movementEdit);
    }));
    root.querySelectorAll("[data-movement-delete]").forEach(button => button.addEventListener("click", () => removeMovement(button.dataset.movementDelete)));
    root.querySelectorAll("[data-ticket-attachment-open]").forEach(button => button.addEventListener("click", () => {
      const reservation = presenter.reserveOpenWindow();
      if (!reservation) {
        setFailure(null, "O navegador bloqueou a nova aba. Permita pop-ups e tente novamente.");
        return;
      }
      presentFile(button.dataset.movementId, button.dataset.ticketAttachmentOpen, "open", reservation);
    }));
    root.querySelectorAll("[data-ticket-attachment-download]").forEach(button => button.addEventListener("click", () => {
      presentFile(button.dataset.movementId, button.dataset.ticketAttachmentDownload, "download");
    }));
  }

  async function load() {
    const token = ++generation;
    root.innerHTML = '<section class="ticket-view-page" aria-busy="true"><p class="entity-loading">Carregando ticket e movimentações...</p></section>';
    try {
      view = await service.load(itemId, { signal: context.signal });
      if (!current(token)) return;
      render();
    } catch (error) {
      if (!current(token)) return;
      root.innerHTML = `<section class="ticket-view-page"><a class="button-secondary ticket-back" href="#/entity/tickets-clientes">Voltar aos tickets</a><div class="entity-state"><p class="entity-error" role="alert">${escapeHtml(error?.message || "Não foi possível carregar o ticket.")}</p><button class="button-secondary" type="button" data-ticket-retry>Tentar novamente</button></div></section>`;
      root.querySelector("[data-ticket-retry]")?.addEventListener("click", load);
    }
  }

  const ready = load();
  return Object.freeze({
    ready,
    refresh: load,
    cleanup() {
      disposed = true;
      generation += 1;
      presenter.cleanup();
    },
  });
}
