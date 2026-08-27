const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const publicFiles = [
  "index.html",
  "admin.html",
  "trabalhe-conosco.html",
  "compliance-lgpd.html",
  "sitemap.xml",
];

const failures = [];

if (fs.existsSync(path.join(root, "cliente.html"))) {
  failures.push("cliente.html ainda existe no site publicado.");
}

for (const file of publicFiles) {
  const content = read(file);
  if (/cliente\.html/i.test(content)) {
    failures.push(`${file} ainda referencia cliente.html.`);
  }
  if (/área do cliente|area do cliente/i.test(content)) {
    failures.push(`${file} ainda promete uma area do cliente removida.`);
  }
  if (/pendências separadas por etapa, com histórico/i.test(content)) {
    failures.push(`${file} ainda promete um historico digital da area do cliente removida.`);
  }
}

const admin = read("admin.html");
if (!/admin\.html/i.test(admin)) {
  failures.push("admin.html deixou de manter a area administrativa.");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("client area removal OK");
