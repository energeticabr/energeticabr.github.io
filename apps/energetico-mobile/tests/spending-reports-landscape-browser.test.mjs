import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/usr/bin/chromium-browser"].find(path => path && existsSync(path));

test("relatórios 9 e 10 cabem em 844x390 e 740x360 com texto longo", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chromium/Chrome indisponível neste ambiente");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  const profile = mkdtempSync(join(tmpdir(), "energetico-spending-layout-"));
  let child; let socket;
  const pending = new Map();
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--hide-scrollbars",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 200 && !existsSync(portFile); i++) await delay(100);
    assert.ok(existsSync(portFile), "Chromium não iniciou o protocolo de inspeção");
    const [debugPort, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium: ${method} expirou`)); }, 10_000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    for (const [width, height] of [[844, 390], [740, 360]]) for (const report of [9, 10]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/tests/fixtures/spending-reports-responsive.html?report=${report}` }, sessionId);
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        ready = await evaluate(`document.documentElement.dataset.ready === "true" && Boolean(document.querySelector('.sr-detail-card, .sr-launch-card'))`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Relatório ${report}, ${width}px não carregou`);
      const dimensions = await evaluate(`(() => {
        const root = document.querySelector('.sr-report'); const viewport = document.documentElement.clientWidth;
        const clipped = [...root.querySelectorAll('*')].filter(node => {
          if (node.hidden || getComputedStyle(node).display === 'none') return false;
          const box = node.getBoundingClientRect(); return box.right > viewport + 1 || box.left < -1;
        }).slice(0, 3).map(node => ({ className: node.className, right: node.getBoundingClientRect().right }));
        return { viewport, scrollWidth: document.documentElement.scrollWidth, rootWidth: root.scrollWidth, rootClient: root.clientWidth, clipped };
      })()`);
      assert.ok(dimensions.scrollWidth <= dimensions.viewport, `Documento transborda: ${JSON.stringify({ report, width, dimensions })}`);
      assert.ok(dimensions.rootWidth <= dimensions.rootClient, `Relatório pede rolagem lateral: ${JSON.stringify({ report, width, dimensions })}`);
      assert.deepEqual(dimensions.clipped, [], `Conteúdo cortado: ${JSON.stringify({ report, width, dimensions })}`);
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    await delay(1500);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
    catch (error) {
      if (error?.code !== "EPERM") throw error;
      t.diagnostic(`O Windows manteve o perfil temporário do Chrome bloqueado: ${profile}`);
    }
  }
});
