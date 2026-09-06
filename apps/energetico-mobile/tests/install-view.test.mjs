import test from "node:test";
import assert from "node:assert/strict";

import { isStandaloneDisplay, renderInstallMarkup } from "../src/web/install-view.js";

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
  assert.match(markup, /shortcuts:\/\/create-shortcut/);
  assert.match(markup, /Authorization/);
  assert.equal(markup.includes(`href="${secret}`), false);
  assert.equal(markup.includes(`shortcut-upload?token=${secret}`), false);
});
