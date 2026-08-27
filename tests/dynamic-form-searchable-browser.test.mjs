import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const chrome = chromeCandidates.find(candidate => fs.existsSync(candidate));

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function serveProject() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const target = path.resolve(projectRoot, `.${pathname}`);
    if (!target.startsWith(`${projectRoot}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(target), "cache-control": "no-store" });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function dumpDom(chrome, url, userDataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      "--virtual-time-budget=3000",
      "--dump-dom",
      url,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`Chrome encerrou com ${code}: ${stderr}`)));
  });
}

test("seletor do formulario preserva foco e apresenta listbox utilizavel no navegador", { skip: !chrome }, async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const userDataDir = path.join(tempRoot, `chrome-dynamic-form-${process.pid}-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const server = await serveProject();
  try {
    const address = server.address();
    const dom = await dumpDom(chrome, `http://127.0.0.1:${address.port}/tests/fixtures/dynamic-form-searchable-browser.html`, userDataDir);
    assert.match(dom, /data-test-status="passed"/, dom);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (userDataDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
