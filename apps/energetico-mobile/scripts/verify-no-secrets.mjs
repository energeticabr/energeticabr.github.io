import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const output = execFileSync(
  "git",
  ["ls-files", "-z", "--", "apps/energetico-mobile", ".github/workflows/energetico-ios.yml"],
  { cwd: repository, encoding: "utf8" },
);
const tracked = output.split("\0").filter(Boolean);

const forbiddenFiles = /(?:^|\/)(?:\.env(?:\..*)?|AuthKey_[^/]+\.p8|[^/]+\.(?:p12|mobileprovision|cer|key|pem))$/i;
const textFiles = /\.(?:css|entitlements|html|js|json|md|mjs|pbxproj|plist|sh|swift|xcprivacy|xml|ya?ml)$/i;
const privateKeyPattern = new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?", "PRIVATE KEY-----"].join(""));
const credentialPatterns = [
  ["chave privada", privateKeyPattern],
  ["token GitHub", /\bgh[opsu]_[A-Za-z0-9]{20,}\b/],
  ["token bearer", /\bBearer\s+eyJ[A-Za-z0-9._-]{20,}/i],
  ["segredo Microsoft", /(?:client_secret|clientSecret)\s*[:=]\s*["'][^$<{][^"']{7,}["']/i],
  ["ID privado da App Store Connect", /(?:APPLE_API_(?:KEY|ISSUER)_ID|APP_STORE_CONNECT_(?:KEY|ISSUER)_ID)\s*[:=]\s*["']?[A-Za-z0-9-]{8,}/],
];

const failures = [];
for (const relative of tracked) {
  const normalized = relative.replaceAll("\\", "/");
  if (forbiddenFiles.test(normalized)) {
    failures.push(`${normalized}: tipo de arquivo confidencial não permitido`);
    continue;
  }
  if (!textFiles.test(normalized)) continue;
  const content = await readFile(resolve(repository, relative), "utf8");
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(content)) failures.push(`${normalized}: possível ${label}`);
  }
}

if (failures.length) {
  throw new Error(`Arquivos confidenciais detectados:\n${failures.map(item => `- ${item}`).join("\n")}`);
}

process.stdout.write(`Nenhum segredo ou artefato de assinatura encontrado em ${tracked.length} arquivos rastreados.\n`);
