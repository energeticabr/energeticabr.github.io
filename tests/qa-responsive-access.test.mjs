import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDefaultAccess } from "../portal/access/access-model.js";
import { MODULES } from "../portal/catalog/modules.js";
import { accessEditorMarkup } from "../portal/ui/access-page.js";

const cssUrl = new URL("../portal/styles/admin.css", import.meta.url);

test("usuarios e acessos empilha os paineis entre tablet e desktop estreito sem mascarar overflow", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /@media\s*\(max-width:\s*1080px\)[\s\S]*?\.access-grid\s*\{[^}]*grid-template-columns:\s*1fr/i);
  assert.match(css, /\.access-container\s*\{[^}]*min-width:\s*0/i);
  assert.match(css, /\.access-users-panel,[\s\S]*?\.access-editor\s*\{[^}]*min-width:\s*0/i);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow-x:\s*hidden/i);
});

test("permissoes viram linhas rotuladas sem rolagem horizontal nas larguras estreitas", async () => {
  const css = await readFile(cssUrl, "utf8");
  const user = buildDefaultAccess("ana@energeticabr.com", "Ana", MODULES);
  const markup = accessEditorMarkup(user, MODULES);

  assert.match(markup, /class="access-permission-cell" data-label="Ver"/);
  assert.match(markup, /class="access-permission-cell" data-label="Aprovar"/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.access-permissions-wrap\s*\{[^}]*overflow:\s*visible/i);
  assert.match(css, /\.access-permission-cell::before\s*\{[^}]*content:\s*attr\(data-label\)/i);
});
