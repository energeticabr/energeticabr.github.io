import test from "node:test";
import assert from "node:assert/strict";

import * as installView from "../src/web/install-view.js";

const { isStandaloneDisplay, renderInstallMarkup } = installView;

test("detecta instalação tanto pelo padrão Web quanto pelo sinal do iOS", () => {
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: true }), navigatorRef: {} }), true);
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigatorRef: { standalone: true } }), true);
  assert.equal(isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigatorRef: {} }), false);
});

test("fora do aplicativo ensina a instalar no Safari", () => {
  const markup = renderInstallMarkup({ open: true, standalone: false, ready: true, token: "não-exibir" });

  assert.match(markup, /Instalar o aplicativo no iPhone/);
  assert.match(markup, /Safari/);
  assert.match(markup, /Adicionar à Tela de Início/);
  assert.doesNotMatch(markup, /data-tool-action="issue"/);
  assert.doesNotMatch(markup, /data-tool-action="install-shortcut"/);
  assert.doesNotMatch(markup, /não-exibir/);
});

test("aplicativo instalado não repete instrução de Tela de Início", () => {
  const markup = renderInstallMarkup({ open: true, standalone: true, ready: true });

  assert.doesNotMatch(markup, /Adicionar à Tela de Início/);
  assert.match(markup, /Configurar compartilhamento/);
});

test("mostra o segredo uma vez sem incluí-lo em links ou URL de upload", () => {
  const secret = "segredo-<não-vazar>";
  const markup = renderInstallMarkup({
    open: true,
    standalone: true,
    ready: true,
    token: secret,
    uploadUrl: "https://163-176-171-217.sslip.io/api/shortcut-upload",
  });

  assert.match(markup, /segredo-&lt;não-vazar&gt;/);
  assert.match(markup, /data-tool-action="install-shortcut"/);
  assert.match(markup, /href="https:\/\/163-176-171-217\.sslip\.io\/api\/install-shortcut\?v=4663F165"/);
  assert.doesNotMatch(markup, /shortcuts:\/\/create-shortcut/);
  assert.equal(markup.includes(`href="${secret}`), false);
  assert.equal(markup.includes(`shortcut-upload?token=${secret}`), false);
});

test("separa o aplicativo do Atalho usado somente para compartilhar vários anexos", () => {
  const markup = renderInstallMarkup({
    open: true,
    standalone: true,
    ready: true,
    token: "segredo",
  });

  assert.match(markup, /ícone <strong>ENERGÉTICO<\/strong> com o mascote abre o chatbot/);
  assert.match(markup, /não adicione este Atalho à Tela de Início/i);
  assert.match(markup, /somente para aparecer na <strong>Folha de Compartilhamento<\/strong>/i);
  assert.match(markup, /várias fotos ou arquivos/);
  assert.match(markup, /substitua a versão antiga/);
});

test("copia a credencial antes de abrir o Atalho pronto", async () => {
  const copied = [];
  const opened = [];

  assert.equal(typeof installView.launchPreparedShortcut, "function", "o instalador automático precisa existir");
  await installView.launchPreparedShortcut({
    token: "credencial-secreta",
    shortcutUrl: "/energetico/ENERG%C3%89TICO.shortcut",
    navigatorRef: { clipboard: { writeText: async (value) => copied.push(value) } },
    locationRef: { assign: (value) => opened.push(value) },
  });

  assert.deepEqual(copied, ["credencial-secreta"]);
  assert.deepEqual(opened, ["/energetico/ENERG%C3%89TICO.shortcut"]);
});

test("não reabre automaticamente a mensagem de instalação depois que ela foi fechada", async () => {
  const listeners = new Map();
  const root = {
    innerHTML: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const stored = new Map();
  const storageRef = {
    getItem(key) { return stored.get(key) || null; },
    setItem(key, value) { stored.set(key, value); },
  };
  const options = {
    client: {},
    standalone: false,
    storageRef,
    navigatorRef: {},
    locationRef: {},
  };

  const first = installView.createInstallView(root, options);
  assert.match(root.innerHTML, /Instalar o aplicativo no iPhone/);
  await listeners.get("click")({ target: { closest: () => ({ dataset: { toolAction: "close" } }) } });
  assert.doesNotMatch(root.innerHTML, /Instalar o aplicativo no iPhone/);
  first.destroy();

  installView.createInstallView(root, options);
  assert.doesNotMatch(root.innerHTML, /Instalar o aplicativo no iPhone/);
  assert.match(root.innerHTML, /data-tool-action="toggle"/);
});
