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
  const markup = renderInstallMarkup({ open: true, standalone: false, ready: false });

  assert.match(markup, /Instalar no iPhone/);
  assert.match(markup, /Safari/);
  assert.match(markup, /Adicionar à Tela de Início/);
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
  assert.match(markup, /href="\/energetico\/Enviar-ao-Energetico\.shortcut"/);
  assert.doesNotMatch(markup, /shortcuts:\/\/create-shortcut/);
  assert.equal(markup.includes(`href="${secret}`), false);
  assert.equal(markup.includes(`shortcut-upload?token=${secret}`), false);
});

test("copia a credencial antes de abrir o Atalho pronto", async () => {
  const copied = [];
  const opened = [];

  assert.equal(typeof installView.launchPreparedShortcut, "function", "o instalador automático precisa existir");
  await installView.launchPreparedShortcut({
    token: "credencial-secreta",
    shortcutUrl: "/energetico/Enviar-ao-Energetico.shortcut",
    navigatorRef: { clipboard: { writeText: async (value) => copied.push(value) } },
    locationRef: { assign: (value) => opened.push(value) },
  });

  assert.deepEqual(copied, ["credencial-secreta"]);
  assert.deepEqual(opened, ["/energetico/Enviar-ao-Energetico.shortcut"]);
});
