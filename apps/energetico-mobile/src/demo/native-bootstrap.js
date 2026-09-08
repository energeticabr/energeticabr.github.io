import { createAppController } from "../app-controller.js";
import { createChatClient } from "../chat/chat-client.js";
import { createConversationStore } from "../chat/conversation-store.js";
import { createChatView, renderPublicLinks } from "../ui/chat-view.js";
import { createRecoveryStorage } from "../web/recovery-storage.js";
import { createDemoSession, createDemoPorts, createDemoRecovery, DEMO_API_ORIGIN } from "./demo-session.js";

export function createNativeBootstrap({ root, auth, native, config, fetchImpl = globalThis.fetch } = {}) {
  let controller = null, activeDemo = null, activeRecovery = null, activeAccount = null;
  let removeForm = null, revision = 0, started = false;

  function stopCurrent() {
    revision++;
    controller?.stop();
    controller = null;
    removeForm?.();
    removeForm = null;
    if (activeAccount) activeRecovery?.clear(activeAccount.homeAccountId);
    activeRecovery = null; activeAccount = null;
  }

  function mount({ sessionAuth, ports, recovery, demo = false }) {
    const mountedRevision = revision;
    const chatView = createChatView(root, demo ? { demo: true, onSignOut: leaveDemo }
      : config.demoAccessEnabled === true ? { onDemoAccess: showDemoForm } : {});
    // Late confirmations may complete after stop; they must never redraw the
    // previous account over the next session's DOM.
    const view = { ...chatView, render(state) { if (mountedRevision === revision) chatView.render(state); } };
    controller = createAppController({ auth: sessionAuth, native: ports, recovery, view,
      store: createConversationStore({ historyMode: "current-step" }),
      client: createChatClient({ apiBaseUrl: demo ? DEMO_API_ORIGIN : config.apiBaseUrl,
        apiPrefix: demo ? "/api/demo" : "/api", fetchImpl, tokenProvider: scopes => sessionAuth.getToken(scopes) }),
    });
    return controller.start();
  }

  function corporateLogin({ restore = false } = {}) {
    stopCurrent();
    // Return to the login screen without signing out or auto-restoring Microsoft.
    const sessionAuth = restore ? auth : { ...auth, initialize: async () => null };
    return mount({ sessionAuth, ports: native, recovery: createRecoveryStorage() });
  }

  async function leaveDemo() {
    const previous = activeDemo;
    activeDemo = null;
    // Clear the token immediately; native inbox restoration must not delay it.
    const revocation = previous?.signOut().catch(() => {});
    await Promise.all([corporateLogin(), revocation]);
  }

  function showDemoForm() {
    if (config.demoAccessEnabled !== true) return;
    stopCurrent();
    const formRevision = revision;
    const session = createDemoSession({ fetchImpl });
    root.innerHTML = `<section class="auth-screen"><div class="auth-card">
      <h1>Acesso de demonstração</h1><p>Ambiente com dados fictícios. Use somente arquivos de teste escolhidos por você.</p>
      <form data-demo-form>
        <label for="demoUsername">Usuário de demonstração</label>
        <input id="demoUsername" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <label for="demoPassword">Senha de demonstração</label>
        <input id="demoPassword" name="password" type="password" autocomplete="off" required>
        <p data-demo-error class="error-banner" role="alert" hidden></p>
        <button class="primary-button" type="submit">Entrar na demonstração</button>
      </form>
      <button type="button" data-demo-back>Voltar ao acesso Microsoft</button>${renderPublicLinks()}
    </div></section>`;
    const form = root.querySelector("[data-demo-form]");
    const back = root.querySelector("[data-demo-back]");
    let pending = false;
    const submit = async event => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      const button = form.querySelector('[type="submit"]');
      const password = form.elements.password;
      const credentials = { username: form.elements.username.value, password: password.value };
      password.value = ""; button.disabled = true;
      const error = form.querySelector("[data-demo-error]");
      error.hidden = true;
      try {
        const account = await session.signIn(credentials);
        if (revision !== formRevision) { await session.signOut().catch(() => {}); return; }
        stopCurrent();
        activeDemo = session; activeAccount = account; activeRecovery = createDemoRecovery();
        await mount({ sessionAuth: session, ports: createDemoPorts(native), recovery: activeRecovery, demo: true });
      } catch (failure) {
        if (revision !== formRevision) return;
        error.textContent = failure?.message || "Não foi possível acessar a demonstração. Tente novamente.";
        error.hidden = false;
      } finally {
        credentials.password = "";
        pending = false; button.disabled = false;
      }
    };
    const cancel = () => { form.elements.password.value = ""; void corporateLogin(); };
    form.addEventListener("submit", submit);
    back.addEventListener("click", cancel);
    removeForm = () => { form.elements.password.value = ""; form.removeEventListener("submit", submit); back.removeEventListener("click", cancel); };
  }

  return Object.freeze({
    start() { if (started) return; started = true; return corporateLogin({ restore: true }); },
    flushRecovery() { controller?.flushRecovery(); },
    stop() { stopCurrent(); const previous = activeDemo; activeDemo = null; void previous?.signOut().catch(() => {}); },
  });
}
