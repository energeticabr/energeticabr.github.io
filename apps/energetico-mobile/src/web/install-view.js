import { escapeHtml } from "../ui/escape-html.js";

const PREPARED_SHORTCUT_URL = "https://163-176-171-217.sslip.io/api/install-shortcut";

export function isStandaloneDisplay({
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  navigatorRef = globalThis.navigator,
} = {}) {
  return Boolean(matchMedia?.("(display-mode: standalone)")?.matches || navigatorRef?.standalone === true);
}

export async function launchPreparedShortcut({
  token,
  shortcutUrl = PREPARED_SHORTCUT_URL,
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
} = {}) {
  const credential = String(token || "").trim();
  if (!credential) throw new Error("Crie a credencial primeiro.");
  if (!navigatorRef?.clipboard?.writeText) throw new Error("Não foi possível copiar a credencial neste navegador.");
  await navigatorRef.clipboard.writeText(credential);
  if (!locationRef?.assign) throw new Error("Não foi possível abrir o Atalho neste navegador.");
  locationRef.assign(shortcutUrl);
}

export function renderInstallMarkup(state = {}) {
  if (!state.open) {
    return '<button class="app-tools-button" type="button" data-tool-action="toggle" aria-label="Instalar e configurar compartilhamento">⚙️</button>';
  }
  const install = state.standalone ? "" : `<section class="setup-section">
    <h3>Instalar no iPhone</h3>
    <p>Abra esta página no <strong>Safari</strong>, toque em Compartilhar e escolha <strong>Adicionar à Tela de Início</strong>.</p>
  </section>`;
  const token = state.token ? `<section class="setup-section setup-secret">
    <h3>Credencial criada</h3>
    <p>Copie agora. Ela aparece somente nesta tela e funciona como uma senha.</p>
    <code data-role="shortcut-token">${escapeHtml(state.token)}</code>
    <button type="button" data-tool-action="copy-token">Copiar credencial</button>
    <h4>Adicione o Atalho pronto</h4>
    <p>Toque no botão abaixo. A credencial será copiada e o iPhone abrirá o Atalho já configurado. Cole a credencial na única pergunta e toque em <strong>Adicionar Atalho</strong>.</p>
    <a class="primary-button setup-link" data-tool-action="install-shortcut" href="${PREPARED_SHORTCUT_URL}">Adicionar Atalho pronto</a>
    <button class="danger-button" type="button" data-tool-action="revoke">Revogar credencial</button>
  </section>` : `<section class="setup-section">
    <h3>Configurar compartilhamento</h3>
    <p>Crie uma credencial exclusiva para encaminhar fotos e arquivos ao Energético pela Folha de Compartilhamento.</p>
    <button class="primary-button" type="button" data-tool-action="issue"${state.ready && !state.busy ? "" : " disabled"}>${state.busy ? "Criando…" : state.ready ? "Criar credencial" : "Entre com a Microsoft primeiro"}</button>
  </section>`;
  return `<div class="setup-backdrop" data-tool-action="close"></div>
    <section class="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <header><h2 id="setup-title">Energético no iPhone</h2><button type="button" data-tool-action="close" aria-label="Fechar">×</button></header>
      ${state.error ? `<p class="error-banner" role="alert">${escapeHtml(state.error)}</p>` : ""}
      ${state.notice ? `<p class="setup-notice" role="status">${escapeHtml(state.notice)}</p>` : ""}
      ${install}${token}
    </section>`;
}

export function createInstallView(root, {
  client,
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  standalone = isStandaloneDisplay({ navigatorRef }),
} = {}) {
  if (!root?.addEventListener || !client) throw new TypeError("O assistente de instalação requer uma raiz e um cliente.");
  let state = { open: !standalone, standalone, ready: false, busy: false, token: "", uploadUrl: "", error: "", notice: "" };

  function render(next = {}) {
    state = { ...state, ...next };
    root.innerHTML = renderInstallMarkup(state);
  }

  async function click(event) {
    const target = event.target?.closest?.("[data-tool-action]");
    if (!target) return;
    const action = target.dataset.toolAction;
    if (action === "toggle") return render({ open: true });
    if (action === "close") return render({ open: false, error: "", notice: "" });
    if (action === "copy-token" && state.token) {
      await navigatorRef.clipboard?.writeText?.(state.token);
      return render({ notice: "Credencial copiada." });
    }
    if (action === "install-shortcut" && state.token) {
      event.preventDefault?.();
      try {
        await launchPreparedShortcut({ token: state.token, navigatorRef, locationRef });
      } catch (error) {
        return render({ error: error?.message || "Não foi possível abrir o Atalho pronto." });
      }
      return;
    }
    if (action === "issue" && state.ready && !state.busy) {
      render({ busy: true, error: "", notice: "", token: "", uploadUrl: "" });
      try {
        const result = await client.issue();
        render({ busy: false, token: result.token, uploadUrl: result.uploadUrl });
      } catch (error) {
        render({ busy: false, error: error?.message || "Não foi possível criar a credencial." });
      }
    }
    if (action === "revoke" && !state.busy) {
      render({ busy: true, error: "", notice: "" });
      try {
        await client.revoke();
        render({ busy: false, token: "", uploadUrl: "", notice: "Credencial revogada." });
      } catch (error) {
        render({ busy: false, error: error?.message || "Não foi possível revogar a credencial." });
      }
    }
  }

  root.addEventListener("click", click);
  render();
  return Object.freeze({
    setReady(ready) { render({ ready: Boolean(ready) }); },
    destroy() { root.removeEventListener("click", click); root.innerHTML = ""; state.token = ""; },
  });
}
