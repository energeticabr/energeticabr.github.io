import { ACTIONS, buildDefaultAccess, isSuperAdmin } from "../access/access-model.js";
import { escapeHtml, formatDateTime, normalizeEmail } from "../core/utils.js";
import { SECURITY_APPLY_CONFIRMATION } from "../security/sharepoint-acl-service.js";

function statusLabel(active) {
  return active ? "ATIVO" : "INATIVO";
}

function actionLabel(action) {
  return ({
    view: "Ver",
    create: "Criar",
    edit: "Editar",
    delete: "Excluir",
    approve: "Aprovar",
  })[action];
}

function cloneAccess(access) {
  return {
    ...access,
    permissions: Object.fromEntries(Object.entries(access.permissions || {})
      .map(([moduleId, permissions]) => [moduleId, { ...permissions }])),
  };
}

export function securityPlanMarkup(plan) {
  if (!plan) return '<p class="access-status-hint">Gere uma pré-visualização para conferir grupos, listas e alterações antes de aplicar.</p>';
  const missing = plan.missing?.length
    ? `<p class="access-message is-error">Listas indisponíveis: ${escapeHtml(plan.missing.join(", "))}</p>`
    : '<p class="access-message">Todas as listas catalogadas foram localizadas.</p>';
  return `<div class="access-security-plan" data-access-security-plan>
    <p><strong>${plan.lists?.length || 0} listas</strong> e <strong>${plan.groups?.length || 0} grupos</strong> serão configurados.</p>
    <p>Identificador da prévia: <code>${escapeHtml(plan.planHash || "")}</code></p>
    ${missing}
    <label>Confirmação para aplicar<input data-access-security-confirmation autocomplete="off" placeholder="${escapeHtml(SECURITY_APPLY_CONFIRMATION)}"></label>
    <button class="button-primary" data-access-security-apply type="button">Aplicar configuração de segurança</button>
  </div>`;
}

export function accessEditorMarkup(user, modules = []) {
  const statusControl = user.id
    ? `<button class="access-status-control ${user.active ? "is-revoke" : "is-activate"}" data-access-status type="button">${user.active ? "Revogar acesso" : "Ativar acesso"}</button>`
    : '<span class="access-status-hint">Salve o novo usuário antes de ativar ou revogar o acesso.</span>';
  const legacyMigration = user.id && !user.oid
    ? '<label class="access-identity-migration"><input data-access-migrate-identity type="checkbox"> Vincular explicitamente este cadastro legado à conta Microsoft encontrada pelo e-mail</label>'
    : "";
  return `<section class="access-editor" aria-label="Permissões do usuário"><h2>Permissões</h2><div class="access-editor-grid"><label>Nome<input data-access-name value="${escapeHtml(user.name)}"></label><label>E-mail<input data-access-email value="${escapeHtml(user.email)}" ${user.id ? "readonly" : ""}></label><label>Perfil<input data-access-profile value="${escapeHtml(user.profile)}"></label><div><strong>Status atual</strong><p class="access-current-status"><span class="access-status-badge ${user.active ? "is-active" : "is-inactive"}">${statusLabel(user.active)}</span></p></div></div>${legacyMigration}<div class="access-permissions-wrap"><table class="access-table"><thead><tr><th>Área</th>${ACTIONS.map(action => `<th>${actionLabel(action)}</th>`).join("")}</tr></thead><tbody>${modules.map(module => `<tr><td class="access-module-name">${escapeHtml(module.title)}</td>${ACTIONS.map(action => `<td class="access-permission-cell"><input data-access-toggle="${escapeHtml(module.id)}:${action}" type="checkbox" ${user.permissions?.[module.id]?.[action] ? "checked" : ""} aria-label="${escapeHtml(`${actionLabel(action)} em ${module.title}`)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="access-change-meta">Última alteração: ${escapeHtml(formatDateTime(user.changedAt))} por ${escapeHtml(user.changedBy || "Não informado")}</p><div class="access-editor-actions"><button class="button-primary" data-access-save type="button">Salvar permissões</button>${statusControl}</div></section>`;
}

export function createAccessPage(root, {
  repository,
  modules = [],
  actorEmail = "",
  config,
  onBack,
} = {}) {
  if (!root) throw new TypeError("A pagina de acessos requer um elemento raiz.");
  if (!repository) throw new TypeError("A pagina de acessos requer um repositorio.");
  if (!isSuperAdmin(actorEmail, config?.superAdminEmail)) {
    root.innerHTML = '<main class="access-tool"><section class="access-restricted-panel"><p class="access-eyebrow is-error">Acesso restrito</p><h1>Usuários e acessos</h1><p>Somente o superadministrador configurado pode administrar permissões.</p></section></main>';
    return Object.freeze({ cleanup() {}, ready: Promise.resolve(), reload: async () => undefined, getState: () => ({ restricted: true }) });
  }

  const state = { users: [], search: "", selected: null, message: "", error: "", loading: false, security: null, securityPlan: null };
  let disposed = false;
  let requestGeneration = 0;

  function isCurrent(generation) {
    return !disposed && generation === requestGeneration;
  }

  function filteredUsers() {
    const needle = state.search.trim().toLocaleLowerCase("pt-BR");
    return state.users.filter(user => !needle || `${user.name} ${user.email}`.toLocaleLowerCase("pt-BR").includes(needle));
  }

  function render() {
    if (disposed) return;
    const selected = state.selected;
    const users = filteredUsers();
    root.innerHTML = `
      <main class="access-tool" aria-labelledby="accessPageTitle">
        <section class="access-container">
          <header class="access-header">
            <div class="access-heading"><p class="access-eyebrow">Controle administrativo</p><h1 id="accessPageTitle">Usuários e acessos</h1><p class="access-description">Defina exatamente quais áreas cada conta corporativa pode consultar ou operar.</p></div>
            ${onBack ? '<button class="button-secondary" type="button" data-access-back>Voltar</button>' : ""}
          </header>
          <p class="access-message${state.error ? " is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.error || state.message)}</p>
          ${state.security && state.security.status !== "secure" ? `<section class="access-security" data-access-security><strong>Configuração de segurança pendente</strong><p>${escapeHtml(state.security.instructions)}</p></section>` : ""}
          <section class="access-security" aria-labelledby="accessSecurityTitle">
            <div class="access-panel-heading"><div><h2 id="accessSecurityTitle">Segurança SharePoint</h2><p>Confira o plano antes de qualquer alteração nas ACLs.</p></div><button class="button-secondary" data-access-security-preview type="button">Pré-visualizar configuração</button></div>
            ${securityPlanMarkup(state.securityPlan)}
          </section>
          <section class="access-grid">
            <div class="access-users-panel">
              <div class="access-panel-heading"><h2>Contas</h2><div class="access-panel-actions"><button class="button-secondary" type="button" data-access-setup>Configurar lista</button><button class="button-primary" type="button" data-access-add>Adicionar usuário</button></div></div>
              <label class="access-search-label" for="accessSearch">Pesquisar</label><input class="access-search" id="accessSearch" data-access-search value="${escapeHtml(state.search)}" type="search" placeholder="Nome ou e-mail">
              <div class="access-table-wrap"><table class="access-table"><thead><tr><th>Usuário</th><th>Status</th></tr></thead><tbody>${users.map(user => `<tr><td><button class="access-user-button" data-access-user="${escapeHtml(user.email)}" type="button">${escapeHtml(user.name || user.email)}<br><small>${escapeHtml(user.email)}</small></button></td><td><span class="access-status-badge ${user.active ? "is-active" : "is-inactive"}">${statusLabel(user.active)}</span></td></tr>`).join("") || '<tr><td colspan="2">Nenhum usuário encontrado.</td></tr>'}</tbody></table></div>
            </div>
            ${selected ? accessEditorMarkup(selected, modules) : '<section class="access-empty"><h2>Selecione um usuário</h2><p>O formulário de permissões aparece apenas quando uma conta é selecionada ou adicionada.</p></section>'}
          </section>
        </section>
      </main>`;
    bind();
  }

  function selectedFromForm() {
    const selected = cloneAccess(state.selected);
    selected.name = root.querySelector("[data-access-name]").value.trim();
    selected.email = normalizeEmail(root.querySelector("[data-access-email]").value);
    selected.profile = root.querySelector("[data-access-profile]").value.trim() || "USUARIO";
    selected.migrateLegacyIdentity = root.querySelector("[data-access-migrate-identity]")?.checked === true;
    root.querySelectorAll("[data-access-toggle]").forEach(toggle => {
      const [moduleId, action] = toggle.dataset.accessToggle.split(":");
      selected.permissions[moduleId][action] = toggle.checked;
    });
    return selected;
  }

  async function loadUsers() {
    const generation = ++requestGeneration;
    state.loading = true;
    try {
      const users = await repository.listUsers();
      const security = await repository.getAccessListSecurity?.() || null;
      if (!isCurrent(generation)) return undefined;
      state.users = users;
      state.security = security;
      state.error = "";
    } catch (error) {
      if (!isCurrent(generation)) return undefined;
      state.error = error?.message || "Não foi possível carregar os usuários.";
    } finally {
      if (!isCurrent(generation)) return undefined;
      state.loading = false;
      render();
    }
    return state.users;
  }

  function bind() {
    root.querySelector("[data-access-back]")?.addEventListener("click", () => onBack());
    root.querySelector("[data-access-search]")?.addEventListener("input", event => {
      state.search = event.target.value;
      render();
    });
    root.querySelector("[data-access-add]")?.addEventListener("click", () => {
      state.selected = buildDefaultAccess("", "", modules);
      state.message = "Preencha os dados e escolha as permissões do novo usuário.";
      state.error = "";
      render();
    });
    root.querySelector("[data-access-security-preview]")?.addEventListener("click", async () => {
      const generation = ++requestGeneration;
      try {
        const plan = await repository.previewSecuritySetup();
        if (!isCurrent(generation)) return;
        state.securityPlan = plan;
        state.message = "Pré-visualização concluída. Nenhuma permissão foi alterada.";
        state.error = "";
      } catch (error) {
        if (!isCurrent(generation)) return;
        state.error = error?.message || "Não foi possível pré-visualizar a segurança.";
      }
      render();
    });
    root.querySelector("[data-access-security-apply]")?.addEventListener("click", async () => {
      const generation = ++requestGeneration;
      try {
        const confirmation = root.querySelector("[data-access-security-confirmation]")?.value || "";
        await repository.applySecuritySetup({ planHash: state.securityPlan?.planHash, confirmation });
        if (!isCurrent(generation)) return;
        state.securityPlan = null;
        state.security = await repository.getAccessListSecurity?.() || state.security;
        state.message = "Configuração aplicada e verificada no SharePoint.";
        state.error = "";
      } catch (error) {
        if (!isCurrent(generation)) return;
        state.error = error?.message || "Não foi possível aplicar a configuração de segurança.";
      }
      render();
    });
    root.querySelector("[data-access-setup]")?.addEventListener("click", async () => {
      const generation = ++requestGeneration;
      try {
        const result = await repository.ensureList();
        if (!isCurrent(generation)) return;
        state.security = result?.security || state.security;
        state.message = state.security?.status === "secure"
          ? "Lista de acessos configurada com sucesso."
          : "Lista criada. Conclua as permissões exclusivas no SharePoint antes de liberar usuários comuns.";
        state.error = "";
        await loadUsers();
      } catch (error) {
        if (!isCurrent(generation)) return;
        state.error = error?.message || "Não foi possível configurar a lista de acessos.";
        render();
      }
    });
    root.querySelectorAll("[data-access-user]").forEach(button => button.addEventListener("click", () => {
      state.selected = cloneAccess(state.users.find(user => user.email === button.dataset.accessUser));
      state.message = "";
      state.error = "";
      render();
    }));
    root.querySelector("[data-access-save]")?.addEventListener("click", async () => {
      const generation = ++requestGeneration;
      try {
        const saved = await repository.saveUserAccess(selectedFromForm());
        if (!isCurrent(generation)) return;
        state.selected = saved;
        state.message = "Permissões salvas com sucesso.";
        state.error = "";
        await loadUsers();
      } catch (error) {
        if (!isCurrent(generation)) return;
        state.error = error?.message || "Não foi possível salvar as permissões.";
        render();
      }
    });
    root.querySelector("[data-access-status]")?.addEventListener("click", async () => {
      const generation = ++requestGeneration;
      try {
        await repository.setUserActive(state.selected, !state.selected.active);
        if (!isCurrent(generation)) return;
        state.selected.active = !state.selected.active;
        state.message = `Acesso ${state.selected.active ? "ativado" : "revogado"} com sucesso.`;
        state.error = "";
        await loadUsers();
      } catch (error) {
        if (!isCurrent(generation)) return;
        state.error = error?.message || "Não foi possível alterar o status.";
        render();
      }
    });
  }

  render();
  const ready = loadUsers();
  return Object.freeze({
    cleanup() {
      disposed = true;
      requestGeneration += 1;
    },
    ready,
    reload: () => (disposed ? Promise.resolve(undefined) : loadUsers()),
    getState: () => ({ ...state, actorEmail, disposed }),
  });
}

export const renderAccessPage = createAccessPage;
