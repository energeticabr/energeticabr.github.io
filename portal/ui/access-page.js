import { ACTIONS, buildDefaultAccess, isSuperAdmin } from "../access/access-model.js";
import { escapeHtml, formatDateTime, normalizeEmail } from "../core/utils.js";

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
    root.innerHTML = '<main class="access-tool" style="width:100%;max-width:none;padding:32px;color:#173042;background:#edf2f3;min-height:100vh"><section style="max-width:760px;margin:0 auto;padding:28px;border:1px solid #c7d6dc;border-radius:8px;background:#fff"><p style="margin:0 0 8px;color:#a31f1f;font-weight:700;text-transform:uppercase">Acesso restrito</p><h1 style="margin:0">Usuários e acessos</h1><p>Somente o superadministrador configurado pode administrar permissões.</p></section></main>';
    return Object.freeze({ cleanup() {}, ready: Promise.resolve(), reload: async () => undefined, getState: () => ({ restricted: true }) });
  }

  const state = { users: [], search: "", selected: null, message: "", error: "", loading: false, security: null };
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
      <main class="access-tool" aria-labelledby="accessPageTitle" style="width:100%;max-width:none;padding:32px;color:#173042;background:#edf2f3;min-height:100vh">
        <section style="max-width:1440px;margin:0 auto">
          <header style="display:flex;gap:16px;justify-content:space-between;align-items:start;flex-wrap:wrap;margin-bottom:24px">
            <div><p style="margin:0 0 8px;color:#245d70;font-weight:700;text-transform:uppercase">Controle administrativo</p><h1 id="accessPageTitle" style="margin:0">Usuários e acessos</h1><p style="margin:8px 0 0;max-width:660px">Defina exatamente quais áreas cada conta corporativa pode consultar ou operar.</p></div>
            ${onBack ? '<button type="button" data-access-back style="padding:10px 14px;border:1px solid #0b465c;border-radius:6px;background:#fff;color:#0b465c;font-weight:700">Voltar</button>' : ""}
          </header>
          <p role="status" aria-live="polite" style="min-height:24px;color:${state.error ? "#a31f1f" : "#166b42"}">${escapeHtml(state.error || state.message)}</p>
          ${state.security && state.security.status !== "secure" ? `<section data-access-security style="margin:0 0 20px;padding:16px;border:1px solid #e8b04b;border-radius:8px;background:#fff6dd"><strong>Configuração de segurança pendente</strong><p style="margin:8px 0 0">${escapeHtml(state.security.instructions)}</p></section>` : ""}
          <section style="display:grid;grid-template-columns:minmax(280px,0.8fr) minmax(460px,1.2fr);gap:20px;align-items:start">
            <div style="padding:20px;border:1px solid #c7d6dc;border-radius:8px;background:#fff">
              <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><h2 style="margin:0;font-size:20px">Contas</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-access-setup style="padding:10px 14px;border:1px solid #0b465c;border-radius:6px;background:#fff;color:#0b465c;font-weight:700">Configurar lista</button><button type="button" data-access-add style="padding:10px 14px;border:0;border-radius:6px;background:#0b465c;color:#fff;font-weight:700">Adicionar usuário</button></div></div>
              <label style="display:block;margin-top:16px;font-weight:700" for="accessSearch">Pesquisar</label><input id="accessSearch" data-access-search value="${escapeHtml(state.search)}" type="search" placeholder="Nome ou e-mail" style="width:100%;margin-top:6px;padding:10px;border:1px solid #aec2ca;border-radius:6px">
              <div style="overflow:auto;margin-top:16px"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Usuário</th><th style="text-align:left;padding:8px">Status</th></tr></thead><tbody>${users.map(user => `<tr><td style="padding:10px 8px;border-top:1px solid #e3ebee"><button data-access-user="${escapeHtml(user.email)}" type="button" style="padding:0;border:0;background:transparent;color:#0b465c;font-weight:700;text-align:left">${escapeHtml(user.name || user.email)}<br><small style="font-weight:400">${escapeHtml(user.email)}</small></button></td><td style="padding:10px 8px;border-top:1px solid #e3ebee"><span style="display:inline-block;padding:4px 8px;border-radius:999px;background:${user.active ? "#d9f7df" : "#ffe0df"};color:${user.active ? "#166b42" : "#a31f1f"};font-weight:700">${statusLabel(user.active)}</span></td></tr>`).join("") || '<tr><td colspan="2" style="padding:16px 8px">Nenhum usuário encontrado.</td></tr>'}</tbody></table></div>
            </div>
            ${selected ? renderEditor(selected) : '<section style="padding:40px 24px;border:1px dashed #9cb4be;border-radius:8px;background:#f9fcfd"><h2 style="margin-top:0">Selecione um usuário</h2><p>O formulário de permissões aparece apenas quando uma conta é selecionada ou adicionada.</p></section>'}
          </section>
        </section>
      </main>`;
    bind();
  }

  function renderEditor(user) {
    const statusControl = user.id
      ? `<button data-access-status type="button" style="padding:11px 16px;border:0;border-radius:6px;background:${user.active ? "#b42318" : "#166b42"};color:#fff;font-weight:700">${user.active ? "Revogar acesso" : "Ativar acesso"}</button>`
      : '<span style="align-self:center">Salve o novo usuário antes de ativar ou revogar o acesso.</span>';
    return `<section aria-label="Permissões do usuário" style="padding:20px;border:1px solid #c7d6dc;border-radius:8px;background:#fff;overflow:auto"><h2 style="margin-top:0">Permissões</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px"><label>Nome<input data-access-name value="${escapeHtml(user.name)}" style="display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #aec2ca;border-radius:6px"></label><label>E-mail<input data-access-email value="${escapeHtml(user.email)}" ${user.id ? "readonly" : ""} style="display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #aec2ca;border-radius:6px"></label><label>Perfil<input data-access-profile value="${escapeHtml(user.profile)}" style="display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #aec2ca;border-radius:6px"></label><div><strong>Status atual</strong><p style="margin:10px 0"><span style="display:inline-block;padding:5px 9px;border-radius:999px;background:${user.active ? "#d9f7df" : "#ffe0df"};color:${user.active ? "#166b42" : "#a31f1f"};font-weight:700">${statusLabel(user.active)}</span></p></div></div><div style="overflow:auto;margin-top:22px"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Área</th>${ACTIONS.map(action => `<th style="padding:8px;text-align:center">${actionLabel(action)}</th>`).join("")}</tr></thead><tbody>${modules.map(module => `<tr><td style="padding:10px 8px;border-top:1px solid #e3ebee;font-weight:700">${escapeHtml(module.title)}</td>${ACTIONS.map(action => `<td style="padding:10px 8px;border-top:1px solid #e3ebee;text-align:center"><input data-access-toggle="${escapeHtml(module.id)}:${action}" type="checkbox" ${user.permissions?.[module.id]?.[action] ? "checked" : ""} aria-label="${escapeHtml(`${actionLabel(action)} em ${module.title}`)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div><p style="margin:18px 0 0">Última alteração: ${escapeHtml(formatDateTime(user.changedAt))} por ${escapeHtml(user.changedBy || "Não informado")}</p><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:20px"><button data-access-save type="button" style="padding:11px 16px;border:0;border-radius:6px;background:#0b465c;color:#fff;font-weight:700">Salvar permissões</button>${statusControl}</div></section>`;
  }

  function selectedFromForm() {
    const selected = cloneAccess(state.selected);
    selected.name = root.querySelector("[data-access-name]").value.trim();
    selected.email = normalizeEmail(root.querySelector("[data-access-email]").value);
    selected.profile = root.querySelector("[data-access-profile]").value.trim() || "USUARIO";
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
        await repository.setUserActive(state.selected.id, !state.selected.active);
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
