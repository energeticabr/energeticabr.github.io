import { escapeHtml } from "../ui/escape-html.js";

export function isStandaloneDisplay({
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  navigatorRef = globalThis.navigator,
} = {}) {
  return Boolean(matchMedia?.("(display-mode: standalone)")?.matches || navigatorRef?.standalone === true);
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
    <h4>Monte o Atalho uma única vez</h4>
    <ol>
      <li>Abra o editor e nomeie o atalho <strong>Enviar ao Energético</strong>.</li>
      <li>Ative <strong>Mostrar na Folha de Compartilhamento</strong> para Arquivos e Imagens.</li>
      <li>Em <strong>Obter Conteúdo de URL</strong>, use método POST e corpo Arquivo com a Entrada do Atalho.</li>
      <li>Use a URL <code>${escapeHtml(state.uploadUrl)}</code>.</li>
      <li>Adicione o cabeçalho <strong>Authorization</strong> com <code>Bearer </code> seguido da credencial copiada.</li>
      <li>Use <strong>Codificar URL</strong> no Nome da Entrada e coloque o resultado em <strong>X-Portal-File-Name</strong>. Adicione <strong>Content-Type</strong> com <code>application/octet-stream</code>.</li>
    </ol>
    <a class="primary-button setup-link" href="shortcuts://create-shortcut">Abrir Atalhos</a>
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
