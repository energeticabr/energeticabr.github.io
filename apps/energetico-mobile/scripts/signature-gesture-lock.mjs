import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const START_PREFIX = "SIGNATURE_GESTURE_LOCK_START: ";
const END_PREFIX = "SIGNATURE_GESTURE_LOCK_END: ";
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(DEFAULT_ROOT, "signature-gesture-lock.json");

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function extractLockedBlock(source, id) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const startMarker = `${START_PREFIX}${id}`;
  const endMarker = `${END_PREFIX}${id}`;
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === `// ${startMarker}` || trimmed === `/* ${startMarker} */`) starts.push(index);
    if (trimmed === `// ${endMarker}` || trimmed === `/* ${endMarker} */`) ends.push(index);
  });
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
    throw new Error(`O bloco ${id} deve conter exatamente um bloco de marcadores válido.`);
  }
  return `${lines.slice(starts[0] + 1, ends[0]).join("\n")}\n`;
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest?.blocks) || !manifest.blocks.length) {
    throw new Error("Manifesto da trava de gestos inválido.");
  }
  const ids = new Set();
  for (const block of manifest.blocks) {
    if (!block?.id || !block?.path || !/^[a-f0-9]{64}$/.test(String(block?.sha256 || ""))) {
      throw new Error("Manifesto da trava de gestos contém bloco inválido.");
    }
    if (ids.has(block.id)) throw new Error(`Bloco duplicado no manifesto: ${block.id}.`);
    ids.add(block.id);
  }
  return manifest;
}

async function readManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  validateManifest(manifest);
  return manifest;
}

async function currentHashes(root, blocks) {
  const entries = [];
  for (const block of blocks) {
    const source = await readFile(path.resolve(root, block.path), "utf8");
    const body = extractLockedBlock(source, block.id);
    entries.push([block.id, sha256(body)]);
  }
  return Object.fromEntries(entries);
}

export function verifyManifestTransition(previous, manifest, hashes) {
  validateManifest(manifest);
  const previousBlocks = Array.isArray(previous?.blocks) ? previous.blocks : [];
  for (const oldBlock of previousBlocks) {
    const current = manifest.blocks.find(block => block.id === oldBlock.id);
    if (!current) throw new Error(`O bloco protegido ${oldBlock.id} foi removido do manifesto.`);
    if (current.path !== oldBlock.path) throw new Error(`O caminho do bloco protegido ${oldBlock.id} não pode ser alterado.`);
  }
  const normalized = blocks => blocks
    .map(({ id, path: filePath, sha256: hash }) => ({ id, path: filePath, sha256: hash }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const before = normalized(previousBlocks);
  const after = normalized(manifest.blocks);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  throw new Error(
    "A trava dos gestos da assinatura é permanente: somente intervenção manual do usuário pode alterar blocos protegidos; alterações de agentes e autorizações textuais são rejeitadas.",
  );
}

export async function verifySignatureGestureLock({ root = DEFAULT_ROOT, manifestPath = DEFAULT_MANIFEST } = {}) {
  const manifest = await readManifest(manifestPath);
  const hashes = await currentHashes(root, manifest.blocks);
  const mismatches = manifest.blocks.filter(block => hashes[block.id] !== block.sha256);
  if (mismatches.length) {
    const list = mismatches.map(block => `${block.id} (${block.path})`).join(", ");
    throw new Error(`Impressão digital divergente em bloco protegido: ${list}.`);
  }
  if (manifest.lastAuthorizedChange) {
    throw new Error(
      "O manifesto contém autorização textual para os gestos da assinatura. A trava é permanente e somente o usuário pode registrar uma alteração manual.",
    );
  }
  return { manifest, hashes };
}

export async function updateSignatureGestureLock() {
  throw new Error(
    "A trava dos gestos da assinatura é permanente: somente intervenção manual do usuário pode alterar a impressão digital; o Codex e o CI não podem atualizá-la.",
  );
}

function resolveGitRef(baseRef, cwd) {
  const candidates = [baseRef];
  if (!String(baseRef).startsWith("origin/") && /^[A-Za-z0-9._/-]+$/.test(String(baseRef))) {
    candidates.push(`origin/${baseRef}`);
  }
  for (const candidate of candidates) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], {
        cwd,
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // A checkout do Actions mantém a branch padrão em origin/<nome>.
    }
  }
  throw new Error(`A revisão-base da trava não existe ou não foi baixada: ${baseRef}.`);
}

function gitShow(baseRef, repositoryPath) {
  const cwd = path.resolve(DEFAULT_ROOT, "../..");
  const resolvedRef = resolveGitRef(baseRef, cwd);
  try {
    return execFileSync("git", ["show", `${resolvedRef}:${repositoryPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    try {
      execFileSync("git", ["cat-file", "-e", `${resolvedRef}:${repositoryPath}`], { cwd, stdio: "ignore" });
    } catch {
      return null;
    }
    throw new Error(`Não foi possível ler o manifesto da revisão-base ${baseRef}.`);
  }
}

async function verifyAuthorizationChangedFromBase(baseRef, manifest, hashes) {
  if (!baseRef || /^0+$/.test(baseRef)) return;
  const previousText = gitShow(baseRef, "apps/energetico-mobile/signature-gesture-lock.json");
  if (!previousText) {
    throw new Error("A revisão-base não contém o manifesto da trava; a verificação não pode autorizar alterações de agentes.");
  }
  const previous = JSON.parse(previousText);
  verifyManifestTransition(previous, manifest, hashes);
}

function parseArgs(argv) {
  const parsed = { update: false, authorization: "", baseRef: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--update") parsed.update = true;
    else if (arg === "--authorization") parsed.authorization = argv[++index] || "";
    else if (arg === "--base-ref") parsed.baseRef = argv[++index] || "";
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.update) {
    await updateSignatureGestureLock({ authorization: args.authorization });
    process.stdout.write("Impressões digitais atualizadas com autorização explícita registrada.\n");
    return;
  }
  if (process.env.CI && (!args.baseRef || /^0+$/.test(args.baseRef))) {
    throw new Error("O CI deve informar uma revisão-base válida para verificar a trava.");
  }
  const { manifest, hashes } = await verifySignatureGestureLock();
  await verifyAuthorizationChangedFromBase(args.baseRef, manifest, hashes);
  process.stdout.write(`Trava de gestos verificada: ${manifest.blocks.length} blocos intactos.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
