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
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
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
      "--virtual-time-budget=5000",
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

test("a tela inicial clica e abre os 24 HTMLs em desktop e celular", { skip: !browser }, async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const server = await serveProject();
  try {
    const address = server.address();
    for (const [label, expectedViewport, width, height] of [
      ["powerapps-canvas", "desktop", 1366, 768],
      ["desktop", "desktop", 1440, 900],
      ["mobile", "mobile", 390, 844],
    ]) {
      const userDataDir = path.join(tempRoot, `energetica-home-${label}-${process.pid}-${Date.now()}`);
      fs.mkdirSync(userDataDir, { recursive: true });
      try {
        const dom = await dumpDom(browser, `http://127.0.0.1:${address.port}/tests/fixtures/powerapps-home-browser.html`, userDataDir, width, height);
        assert.match(dom, /data-test-status="passed"/, `${label}: ${dom}`);
        assert.match(dom, new RegExp(`data-viewport="${expectedViewport}"`), label);
        assert.match(dom, /data-tiles="0"/);
        assert.match(dom, /data-shortcuts="24"/);
        assert.match(dom, /data-metrics="12"/);
        assert.match(dom, /data-groups="5"/);
        assert.match(dom, /data-images-loaded="true"/);
        assert.match(dom, /data-entity-panel="true"/);
        assert.match(dom, /data-analytics-panel="true"/);
        assert.match(dom, /data-panels="24"/);
        assert.match(dom, /data-mobile-labels-fit="true"/);
        assert.match(dom, /data-loading-close-focus="true"/);
      } finally {
        if (userDataDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
