import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find(candidate => fs.existsSync(candidate));

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
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

function dumpDom(executable, url, userDataDir, width, height) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      "--virtual-time-budget=180000",
      "--dump-dom",
      url,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`Navegador encerrou com ${code}: ${stderr}`)));
  });
}

test("as 18 duplas de Suprimentos funcionam no navegador em desktop e celular", { skip: !browser, timeout: 90000 }, async () => {
  const server = await serveProject();
  const tempRoot = path.resolve(os.tmpdir());
  try {
    const address = server.address();
    for (const [viewport, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
      for (const chunk of [0, 1]) {
        const userDataDir = path.join(tempRoot, `energetica-suprimentos-${viewport}-${chunk}-${process.pid}-${Date.now()}`);
        fs.mkdirSync(userDataDir, { recursive: true });
        try {
          const dom = await dumpDom(browser, `http://127.0.0.1:${address.port}/tests/fixtures/powerapps-suprimentos-surfaces-browser.html?chunk=${chunk}`, userDataDir, width, height);
          const diagnostic = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] || "diagnóstico ausente";
          assert.match(dom, /data-test-status="passed"/, `${viewport}, lote ${chunk + 1}: ${diagnostic}`);
          assert.match(dom, /data-entities="9"/, `${viewport}, lote ${chunk + 1}`);
          assert.match(dom, new RegExp(`data-chunk="${chunk}"`), `${viewport}, lote ${chunk + 1}`);
          assert.match(dom, new RegExp(`data-viewport="${viewport}"`), `${viewport}, lote ${chunk + 1}`);
        } finally {
          if (userDataDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
