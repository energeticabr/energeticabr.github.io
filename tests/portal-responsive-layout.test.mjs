import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o portal separa cadastro e galeria e mantem filas, graficos e auditoria responsivos", async () => {
  const css = await readFile(new URL("../portal/styles/admin.css", import.meta.url), "utf8");

  assert.match(css, /\.dashboard-page,\s*\.module-page\s*\{[^}]*width:\s*min\(100%,\s*1920px\)/i);
  assert.match(css, /@media\s*\(min-width:\s*1440px\)[\s\S]*?\.entity-toolbar\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/i);
  assert.match(css, /\.entity-split-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*\.8fr\)\s+minmax\(0,\s*1\.6fr\)/i);
  assert.match(css, /\.entity-form-panel\s*\{[^}]*border-top:\s*4px\s+solid\s+var\(--module-accent\)/i);
  assert.match(css, /\.entity-gallery-panel\s*\{[^}]*border-top:\s*4px\s+solid\s+#1776a8/i);
  assert.match(css, /\.multi-entry-row\.is-error\s*\{[^}]*border-color:\s*#c7382d/i);
  assert.match(css, /\.dashboard-chart\s+g\[role="button"\]:focus-visible/i);
  assert.match(css, /@media\s*\(max-width:\s*1080px\)[\s\S]*?\.entity-split-workspace\s*\{[^}]*grid-template-columns:\s*1fr/i);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.entity-pagination\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*stretch/i);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.entity-pagination\s*>\s*div\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/i);
});
