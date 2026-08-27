import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

test("o modulo inicial nao importa paginas pesadas nem o catalogo Power Apps estaticamente", async () => {
  const source = await readFile(resolve(ROOT, "portal", "app.js"), "utf8");
  const forbidden = [
    "./catalog/powerapps-ui-contract.js",
    "./ui/entity-page.js",
    "./ui/item-detail.js",
    "./audit/audit-page.js",
    "./reports/reports-page.js",
    "./analytics/analytics-page.js",
    "./ui/access-page.js",
  ];

  for (const path of forbidden) {
    assert.doesNotMatch(source, new RegExp(`^import[^;]+${path.replaceAll(".", "\\.")}`, "m"));
  }
});

test("cada pagina pesada possui importacao dinamica limitada a sua rota", async () => {
  const source = await readFile(resolve(ROOT, "portal", "app.js"), "utf8");
  for (const path of [
    "./ui/entity-page.js",
    "./ui/item-detail.js",
    "./audit/audit-page.js",
    "./reports/reports-page.js",
    "./analytics/analytics-page.js",
    "./ui/access-page.js",
  ]) {
    assert.match(source, new RegExp(`import\\(\\\"${path.replaceAll(".", "\\.")}[^\"]*\\\"\\)`));
  }
});
