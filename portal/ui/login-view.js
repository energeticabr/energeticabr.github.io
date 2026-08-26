function accountLabel(account) {
  return account?.name || account?.username || "Administrador";
}

function accountEmail(account) {
  return account?.username
    || account?.idTokenClaims?.preferred_username
    || account?.idTokenClaims?.email
    || "esta conta";
}

export function renderLoginView(root, handlers = {}) {
  const logoSrc = root.dataset.logoSrc || "assets/logo-energetica-oficial.png";
  const mascotSrc = root.dataset.mascotSrc || "assets/mascote-energetica-transparente.png";

  root.innerHTML = `
    <div class="portal-frame">
      <aside class="portal-identity" aria-label="Energética Construções">
        <img class="portal-logo" src="${logoSrc}" alt="Energética Construtora">
        <div class="portal-identity-copy">
          <p class="portal-kicker">Ambiente de trabalho</p>
          <p class="portal-identity-title">Gestão que sustenta boas obras.</p>
        </div>
        <img class="portal-mascot" src="${mascotSrc}" alt="">
      </aside>
      <section class="portal-login" aria-labelledby="portalTitle">
        <p class="portal-kicker">Acesso administrativo</p>
        <h1 id="portalTitle">Portal administrativo</h1>
        <p class="portal-description">Use sua conta corporativa Microsoft para continuar.</p>
        <p class="portal-loading" data-login-loading role="status" aria-live="polite">Verificando acesso Microsoft...</p>
        <div data-login-actions>
          <button class="microsoft-login-button" data-microsoft-login-action type="button">
            Entrar com Microsoft
          </button>
        </div>
        <p class="portal-status" data-login-status role="status" aria-live="polite" aria-atomic="true"></p>
        <section class="portal-session" data-login-session hidden aria-labelledby="sessionTitle">
          <h2 id="sessionTitle">Sessão Microsoft ativa</h2>
          <p>Conta conectada: <strong data-session-name></strong></p>
        </section>
        <section class="portal-unauthorized" data-login-unauthorized hidden aria-labelledby="unauthorizedTitle">
          <h2 id="unauthorizedTitle">Acesso não autorizado</h2>
          <p>A conta <strong data-unauthorized-email></strong> não possui acesso administrativo.</p>
        </section>
      </section>
    </div>`;

  const button = root.querySelector("[data-microsoft-login-action]");
  const actions = root.querySelector("[data-login-actions]");
  const loading = root.querySelector("[data-login-loading]");
  const status = root.querySelector("[data-login-status]");
  const session = root.querySelector("[data-login-session]");
  const unauthorized = root.querySelector("[data-login-unauthorized]");

  function resetPanels() {
    session.hidden = true;
    unauthorized.hidden = true;
  }

  function setReady(message = "") {
    root.setAttribute("aria-busy", "false");
    loading.hidden = true;
    actions.hidden = false;
    button.disabled = false;
    resetPanels();
    status.dataset.state = "";
    status.textContent = message;
  }

  function setLoading(message) {
    root.setAttribute("aria-busy", "true");
    loading.hidden = false;
    loading.textContent = message;
    button.disabled = true;
    resetPanels();
    status.dataset.state = "";
    status.textContent = "";
  }

  function setError(message) {
    setReady();
    status.dataset.state = "error";
    status.textContent = message;
  }

  function showSession(account) {
    root.setAttribute("aria-busy", "false");
    loading.hidden = true;
    actions.hidden = true;
    status.textContent = "";
    unauthorized.hidden = true;
    session.hidden = false;
    session.querySelector("[data-session-name]").textContent = accountLabel(account);
  }

  function showUnauthorized(account) {
    root.setAttribute("aria-busy", "false");
    loading.hidden = true;
    actions.hidden = true;
    status.textContent = "";
    session.hidden = true;
    unauthorized.hidden = false;
    unauthorized.querySelector("[data-unauthorized-email]").textContent = accountEmail(account);
  }

  button.addEventListener("click", async () => {
    setLoading("Abrindo login Microsoft...");
    try {
      await handlers.onSignIn?.();
    } catch (error) {
      setError("Não foi possível entrar com Microsoft agora. Tente novamente.");
      console.error(error);
    }
  });

  return Object.freeze({ setReady, setLoading, setError, showSession, showUnauthorized });
}
