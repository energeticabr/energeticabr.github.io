const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const thisTest = "tests/no-hardcoded-credentials.test.js";
const maxTextFileSize = 5 * 1024 * 1024;
const passwordLiteral = /(?:["'`])?[\w$]*(?:password|passwd|pwd|senha)[\w$]*(?:["'`])?\s*[:=]\s*(["'`])([^"'`\r\n]+)\1/gi;

const trackedAndUntracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
).toString("utf8").split("\0").filter(Boolean);

const findings = [];

for (const relativePath of trackedAndUntracked) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (normalizedPath === thisTest) continue;

  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size > maxTextFileSize) continue;

  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) continue;

  const content = buffer.toString("utf8");
  for (const match of content.matchAll(passwordLiteral)) {
    const value = match[2].trim();
    const isRuntimeReference = /^\$\{(?:\{|)[^}]+\}(?:\}|)$/.test(value);
    if (!value || isRuntimeReference) continue;

    const line = content.slice(0, match.index).split("\n").length;
    findings.push(`${normalizedPath}:${line}`);
  }
}

if (findings.length) {
  console.error(`Hard-coded credential assignments found:\n${findings.join("\n")}`);
  process.exit(1);
}

console.log("hard-coded credential scan OK");
