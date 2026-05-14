window.ENERGETICA_SUPABASE = {
  url: "https://cnbkllzbymyhpkcfnvsm.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNuYmtsbHpieW15aHBrY2ZudnNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTc1ODEsImV4cCI6MjA5MzQ5MzU4MX0.6b8P10Xx4GMFQRyh6-GFKrEB7AxOi8SBorJtSJtd7Rc",
  bucket: "obras"
};

window.ENERGETICA_SHAREPOINT_TICKETS = {
  enabled: true,
  tempFileExpiresInSeconds: 86400
};

window.ENERGETICA_SHAREPOINT_COMUNICACOES = {
  enabled: true,
  tempFileExpiresInSeconds: 86400
};


(() => {
    function formatEmailName(value, fallback = "Cliente") {
          const text = String(value || "").trim();
          if (!text) return fallback;
          return text.includes("@") ? text.toLowerCase() : text.toLocaleUpperCase("pt-BR");
    }

   function stripTema(value) {
         return String(value || "").replace(/^\s*Tema\s*:\s*.+(?:\r?\n){1,2}/i, "").trim();
   }

   function enrichEmailPayload(record, kind) {
         const next = { ...(record || {}) };
         const payload = { ...(next.payload || {}) };
         const index = payload.email_index
           || (kind === "ticket" ? next.ticket_codigo : next.comunicacao_codigo)
           || next.sharepoint_ticket_item_id
           || next.sharepoint_comunicacao_item_id
           || next.id
           || "Aguardando indice";
         const sender = payload.email_sender_name
           || next.autor_nome
           || (next.autor_tipo === "empresa" ? "ENERGETICA" : next.cliente_nome)
           || "Cliente";
         const theme = payload.email_theme
           || payload.tema
           || next.assunto
           || next.titulo
           || (kind === "ticket" ? "Ticket" : "Comunicacao");
         const message = payload.email_message
           || stripTema(next.mensagem || next.descricao)
           || "Sem conteudo informado.";
         const subject = payload.email_subject
           || next.titulo
           || next.assunto
           || `${kind === "ticket" ? "Ticket" : "Comunicacao"} (${index}) do Cliente ${formatEmailName(next.cliente_nome || next.cliente_email || "CLIENTE", "CLIENTE")}`;

      next.payload = {
              ...payload,
              email_subject: subject,
              email_index: index,
              email_sender_name: formatEmailName(sender, "Cliente"),
              email_theme: theme,
              email_message: message,
              email_kind: kind,
              email_layout_version: "energetica-atendimento-v2"
      };
         return next;
   }

   function wrapOutbox(name, kind) {
         const original = window[name];
         if (typeof original !== "function" || original.__energeticaEmailPatch) return;
         window[name] = function patchedOutbox(record, files) {
                 return original.call(this, enrichEmailPayload(record, kind), files);
         };
         window[name].__energeticaEmailPatch = true;
   }

   function installEmailPatch() {
         wrapOutbox("createSharepointTicketOutbox", "ticket");
         wrapOutbox("createAdminSharepointTicketOutbox", "ticket");
         wrapOutbox("createSharepointCommunicationOutbox", "comunicacao");
         wrapOutbox("createAdminSharepointCommunicationOutbox", "comunicacao");
   }

   window.addEventListener("load", installEmailPatch);
    window.setTimeout(installEmailPatch, 0);
})();

(() => {
    function normalizeText(value) {
          return String(value || "").trim();
    }

    function buildInlineEmailMessage(record, kind) {
          const payload = record?.payload || {};
          const index = normalizeText(payload.email_index)
            || normalizeText(kind === "ticket" ? record?.ticket_codigo : record?.comunicacao_codigo)
            || "Aguardando indice";
          const sender = normalizeText(payload.email_sender_name)
            || normalizeText(record?.autor_nome)
            || normalizeText(record?.cliente_nome)
            || "Nao informado";
          const theme = normalizeText(payload.email_theme)
            || normalizeText(payload.tema)
            || normalizeText(record?.assunto)
            || normalizeText(record?.titulo)
            || "Sem tema informado";
          const message = normalizeText(payload.email_message)
            || normalizeText(record?.mensagem)
            || normalizeText(record?.descricao)
            || "Sem conteudo informado.";
          return `Indice: ${index}\nEnviado por: ${sender}\nTema: ${theme}\n\nConteudo da mensagem:\n${message}`;
    }

    function wrapInlineMessage(name, kind) {
          const original = window[name];
          if (typeof original !== "function" || original.__energeticaEmailInlinePatch) return;
          window[name] = function patchedInlineMessage(record, files) {
                  const next = { ...(record || {}) };
                  next.mensagem = buildInlineEmailMessage(next, kind);
                  return original.call(this, next, files);
          };
          window[name].__energeticaEmailInlinePatch = true;
    }

    function installInlineEmailPatch() {
          wrapInlineMessage("createSharepointTicketOutbox", "ticket");
          wrapInlineMessage("createAdminSharepointTicketOutbox", "ticket");
          wrapInlineMessage("createSharepointCommunicationOutbox", "comunicacao");
          wrapInlineMessage("createAdminSharepointCommunicationOutbox", "comunicacao");
    }

    window.addEventListener("load", installInlineEmailPatch);
    window.setTimeout(installInlineEmailPatch, 0);
})();

