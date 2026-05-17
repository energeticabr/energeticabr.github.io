(() => {
  if (window.__energeticaImovelHistoryPatch) return;
  window.__energeticaImovelHistoryPatch = true;

  const state = { apontamentos: [], loaded: false };

  function normalized(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("pt-BR");
  }

  function field(record, ...keys) {
    const raw = record?.raw && typeof record.raw === "object" ? record.raw : {};
    for (const key of keys) {
      const value = record?.[key] ?? record?.[key.toLowerCase?.()] ?? raw?.[key] ?? raw?.[key.toLowerCase?.()];
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  }

  function apontamentoFilial(item) {
    return field(item, "filial", "FILIAL");
  }

  function apontamentoImovel(item) {
    return field(item, "imovel", "IMOVEL");
  }

  function apontamentoTitulo(item) {
    return field(item, "tipo_marco", "TIPOMARCO", "titulo", "Title") || "Apontamento comercial";
  }

  function apontamentoStatus(item) {
    return field(item, "status", "STATUS") || "Nao informado";
  }

  function apontamentoDescricao(item) {
    return field(item, "descricao", "DESCRICAO");
  }

  function apontamentoNome(item) {
    return field(item, "nome", "NOME", "comprador", "COMPRADOR");
  }

  function apontamentoContrato(item) {
    return field(item, "idcontrato", "IDCONTRATO", "id_contrato");
  }

  function apontamentoInicio(item) {
    return field(item, "data_inicio", "DATAINICIO");
  }

  function apontamentoFim(item) {
    return field(item, "data_fim", "DATAFIM");
  }

  function apontamentoFatal(item) {
    return field(item, "data_fatal", "DATAFATAL");
  }

  function filialMatches(apontamentoFilialTexto, filialTexto) {
    const apontamento = normalized(apontamentoFilialTexto);
    const filial = normalized(filialTexto);
    const filialPrefix = normalized((String(filialTexto || "").match(/^\d+/) || [""])[0]);
    return Boolean(apontamento) && Boolean(filial) && (
      apontamento === filial ||
      (filialPrefix && apontamento.startsWith(filialPrefix))
    );
  }

  function historicoDoImovel(filialTexto, imovelTexto) {
    const imovel = normalized(imovelTexto);
    return state.apontamentos
      .filter((item) => filialMatches(apontamentoFilial(item), filialTexto) && normalized(apontamentoImovel(item)) === imovel)
      .sort((a, b) => new Date(apontamentoInicio(b) || b.updated_at || b.created_at || 0) - new Date(apontamentoInicio(a) || a.updated_at || a.created_at || 0));
  }

  async function loadApontamentos() {
    if (state.loaded) return;
    state.loaded = true;
    try {
      const response = await fetch("apontamentos-comerciais-seed.json", { cache: "no-store" });
      if (response.ok) {
        const rows = await response.json();
        state.apontamentos = Array.isArray(rows) ? rows : [];
      }
    } catch (error) {
      console.warn("Nao foi possivel carregar apontamentos comerciais:", error.message);
    }
  }

  function installStyles() {
    if (document.getElementById("imovel-comercial-patch-style")) return;
    const style = document.createElement("style");
    style.id = "imovel-comercial-patch-style";
    style.textContent = `
      .imovel-item[data-open-imovel-comercial]{cursor:pointer;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease}
      .imovel-item[data-open-imovel-comercial]:hover,.imovel-item[data-open-imovel-comercial]:focus{border-color:#38bdf8;box-shadow:0 12px 28px rgba(15,95,143,.16);outline:none;transform:translateY(-1px)}
      .imovel-select-hint{color:#0f5f8f;font-size:.85rem;font-weight:900;margin-top:8px}
      .commercial-history-card{margin-bottom:18px;padding:20px}
      .commercial-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px}
      .commercial-history-head h2{color:#071b2f;font-size:26px}
      .commercial-history-head p{color:#64748b;margin-top:4px}
      .commercial-history-list{display:grid;gap:12px}
      .commercial-history-item{border:1px solid #d8e1ea;border-radius:8px;background:#fff;padding:14px}
      .commercial-history-item.status-open{border-left:6px solid #0f766e;background:#f0fdfa}
      .commercial-history-item.status-done{border-left:6px solid #166534;background:#f0fdf4}
      .commercial-history-item h3{color:#071b2f;font-size:1rem;margin:8px 0}
      .commercial-history-meta{display:grid;gap:6px;color:#64748b;font-size:.9rem}
      .commercial-history-meta strong{color:#1f2937}
      .commercial-history-description{margin-top:10px;padding:10px 12px;background:#f8fbff;border:1px solid #d9e5ef;border-radius:8px;white-space:pre-wrap}
    `;
    document.head.appendChild(style);
  }

  function ensureView() {
    let view = document.querySelector('[data-admin-view="imovel-comercial"]');
    if (view) return view;
    view = document.createElement("section");
    view.className = "admin-view";
    view.dataset.adminView = "imovel-comercial";
    view.hidden = true;
    view.innerHTML = `
      <div class="admin-workspace-header">
        <div>
          <span>Historico comercial</span>
          <h1>Historico do imovel</h1>
          <p class="subtitle">Dados importados da lista APONTAMENTOSCOMERCIAIS do SharePoint. Esta area e somente consulta.</p>
        </div>
        <button class="mini-btn" type="button" data-back-filiais>Voltar para filiais</button>
      </div>
      <section class="card commercial-history-card" aria-labelledby="imovelComercialTitle">
        <div id="imovelComercialDetail"></div>
      </section>
    `;
    const clientesView = document.querySelector('[data-admin-view="clientes"]');
    const adminPanel = document.getElementById("adminPanel") || document.querySelector("main") || document.body;
    if (clientesView?.parentElement) {
      clientesView.parentElement.insertBefore(view, clientesView);
    } else {
      adminPanel.appendChild(view);
    }
    return view;
  }

  function showImovelView() {
    document.querySelectorAll(".admin-view").forEach((section) => {
      section.hidden = section.dataset.adminView !== "imovel-comercial";
    });
    document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.remove("active"));
  }

  function voltarFiliais() {
    if (typeof window.showAdminView === "function") {
      window.showAdminView("filiais");
      return;
    }
    document.querySelectorAll(".admin-view").forEach((section) => {
      section.hidden = section.dataset.adminView !== "filiais";
    });
    document.querySelector('[data-admin-tab="filiais"]')?.classList.add("active");
  }

  function renderItem(item) {
    const status = apontamentoStatus(item);
    const done = normalized(status).includes("finalizada") || normalized(status).includes("finalizado") || normalized(status).includes("concluido");
    const contrato = apontamentoContrato(item);
    const nome = apontamentoNome(item);
    const descricao = apontamentoDescricao(item);
    return `
      <article class="commercial-history-item ${done ? "status-done" : "status-open"}">
        <div class="imovel-status-line">
          <span class="pill ${done ? "status-active" : ""}">${escapeHtml(status)}</span>
          ${contrato ? `<span class="pill">Contrato ${escapeHtml(contrato)}</span>` : ""}
        </div>
        <h3>${escapeHtml(apontamentoTitulo(item))}</h3>
        <div class="commercial-history-meta">
          ${nome ? `<span><strong>Nome:</strong> ${escapeHtml(nome.toLocaleUpperCase("pt-BR"))}</span>` : ""}
          ${apontamentoInicio(item) ? `<span><strong>Inicio:</strong> ${escapeHtml(formatDate(apontamentoInicio(item)))}</span>` : ""}
          ${apontamentoFim(item) ? `<span><strong>Fim:</strong> ${escapeHtml(formatDate(apontamentoFim(item)))}</span>` : ""}
          ${apontamentoFatal(item) ? `<span><strong>Data fatal:</strong> ${escapeHtml(formatDate(apontamentoFatal(item)))}</span>` : ""}
        </div>
        ${descricao ? `<div class="commercial-history-description">${escapeHtml(descricao)}</div>` : ""}
      </article>
    `;
  }

  async function openHistory(card) {
    await loadApontamentos();
    const filialCard = card.closest(".filial-item");
    const filial = card.dataset.filial || filialCard?.querySelector("h3")?.textContent || "";
    const imovel = card.dataset.imovel || card.querySelector("h4")?.textContent || "";
    const historico = historicoDoImovel(filial, imovel);
    const view = ensureView();
    const detail = view.querySelector("#imovelComercialDetail");
    detail.innerHTML = `
      <div class="commercial-history-head">
        <div>
          <h2 id="imovelComercialTitle">${escapeHtml(imovel || "Imovel")}</h2>
          <p>${escapeHtml(filial || "Filial nao informada")} - ${historico.length} apontamento${historico.length === 1 ? "" : "s"} comercial${historico.length === 1 ? "" : "is"}</p>
        </div>
        <button class="mini-btn" type="button" data-back-filiais>Voltar</button>
      </div>
      <div class="commercial-history-list">
        ${historico.length ? historico.map(renderItem).join("") : '<div class="empty">Nenhum apontamento comercial encontrado para este imovel.</div>'}
      </div>
    `;
    showImovelView();
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function patchCard(card) {
    if (card.dataset.imovelHistoryReady) return;
    const imovel = card.querySelector("h4")?.textContent?.trim() || "";
    const filial = card.closest(".filial-item")?.querySelector("h3")?.textContent?.trim() || "";
    if (!imovel) return;
    card.dataset.imovelHistoryReady = "1";
    card.dataset.openImovelComercial = "1";
    card.dataset.imovel = imovel;
    card.dataset.filial = filial;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Abrir historico comercial do imovel ${imovel}`);
    if (!card.querySelector(".imovel-select-hint")) {
      const hint = document.createElement("div");
      hint.className = "imovel-select-hint";
      hint.textContent = "Clique no imovel para abrir o historico comercial.";
      card.appendChild(hint);
    }
    const button = card.querySelector("[data-open-imovel-comercial]") || document.createElement("button");
    if (!button.parentElement) {
      const actions = card.querySelector(".imovel-actions") || document.createElement("div");
      actions.className = "imovel-actions";
      button.className = "mini-btn";
      button.type = "button";
      button.textContent = "Historico comercial";
      actions.appendChild(button);
      card.appendChild(actions);
    }
    button.dataset.openImovelComercial = "1";
    button.dataset.imovel = imovel;
    button.dataset.filial = filial;
  }

  function patchCards() {
    document.querySelectorAll(".imovel-item").forEach(patchCard);
  }

  function installListeners() {
    document.addEventListener("click", (event) => {
      const back = event.target.closest("[data-back-filiais]");
      if (back) {
        event.preventDefault();
        voltarFiliais();
        return;
      }
      const trigger = event.target.closest("[data-open-imovel-comercial], .imovel-item[data-imovel-history-ready]");
      if (!trigger) return;
      const card = trigger.classList.contains("imovel-item") ? trigger : trigger.closest(".imovel-item");
      if (!card) return;
      event.preventDefault();
      openHistory(card);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".imovel-item[data-imovel-history-ready]");
      if (!card) return;
      event.preventDefault();
      openHistory(card);
    });
  }

  function boot() {
    installStyles();
    ensureView();
    installListeners();
    patchCards();
    const observer = new MutationObserver(patchCards);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setInterval(patchCards, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
