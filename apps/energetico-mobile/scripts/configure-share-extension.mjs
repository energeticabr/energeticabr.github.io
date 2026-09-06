import { readFile } from "node:fs/promises";

const projectUrl = new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url);
const project = await readFile(projectUrl, "utf8");

const checks = [
  ["um target ShareExtension", /E30000000000000000000001 \/\* ShareExtension \*\/ = \{/g, 1],
  ["uma fase Embed App Extensions", /name = "Embed App Extensions";/g, 1],
  ["uma incorporação da extensão", /ShareExtension\.appex in Embed App Extensions \*\/ =/g, 1],
  ["bundle id da extensão", /PRODUCT_BUNDLE_IDENTIFIER = br\.com\.energetica\.energetico\.share;/g, 2],
];

for (const [label, pattern, expected] of checks) {
  const count = (project.match(pattern) || []).length;
  if (count !== expected) {
    throw new Error(`Configuração inválida: esperado ${label} (${expected}), encontrado ${count}.`);
  }
}

process.stdout.write("Share Extension configurada de forma idempotente.\n");
