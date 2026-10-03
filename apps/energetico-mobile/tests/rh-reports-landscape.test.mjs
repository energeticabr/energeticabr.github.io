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
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "/usr/bin/google-chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(path => path && existsSync(path));

test("relatórios de RH cabem em 844×390 e 740×360 sem rolagem lateral nem texto cortado", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chromium/Chrome indisponível");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0,
    fs: { allow: [resolve(appRoot, "../..")] } }, logLevel: "silent" });
  const profile = mkdtempSync(join(tmpdir(), "energetico-rh-layout-"));
  let child, socket, closeBrowser; const pending = new Map();
  try {
    await server.listen();
    child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let index = 0; index < 200 && !existsSync(portFile); index++) await delay(100);
    assert.ok(existsSync(portFile), "Chromium não iniciou o protocolo de inspeção");
    const [port, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data); const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence; const timer = setTimeout(() => reject(new Error(`Chromium: ${method} expirou`)), 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    closeBrowser = () => socket.send(JSON.stringify({ id: ++sequence, method: "Browser.close" }));
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async expression => {
      const answer = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      assert.ok(!answer.exceptionDetails, JSON.stringify(answer.exceptionDetails));
      return answer.result.value;
    };
    for (const [width, height] of [[844, 390], [740, 360]]) for (const report of [3, 4, 5]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/rh-reports-responsive.html?report=${report}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?report=${report}' && window.reportReady === ${report}`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Relatório ${report}: prévia não carregou`);
      const sizes = await evaluate(`(() => {
        const root = document.querySelector('.rh-reports');
        const viewport = document.documentElement.clientWidth;
        const clipped = [...root.querySelectorAll('*')].filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width && (rect.left < -1 || rect.right > viewport + 1);
        }).map(node => node.className || node.tagName);
        return { viewport, scroll: document.documentElement.scrollWidth, rootScroll: root.scrollWidth,
          rootClient: root.clientWidth, clipped: clipped.slice(0, 5) };
      })()`);
      assert.ok(sizes.scroll <= sizes.viewport && sizes.rootScroll <= sizes.rootClient && sizes.clipped.length === 0,
        `Relatório ${report}, ${width}×${height}: ${JSON.stringify(sizes)}`);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await evaluate(`document.querySelector('.rh-reports-brand img')?.complete`)) break;
        await delay(100);
      }
      const visual = await evaluate(`(() => {
        const root = document.querySelector('.rh-reports');
        const css = selector => getComputedStyle(root.querySelector(selector)).backgroundColor;
        const logo = root.querySelector('.rh-reports-brand img');
        return { logoLoaded: logo.complete && logo.naturalWidth > 0, logoSrc: logo.src, logoWidth: logo.naturalWidth,
          color: css(${JSON.stringify(report === 3 ? ".rh-reports-branch > h3" : report === 4 ? '.rh-reports-metric[data-tone="pending"]' : ".rh-reports-block > h3")}) };
      })()`);
      assert.equal(visual.logoLoaded, true, `Relatório ${report}: logo oficial não carregou (${visual.logoSrc}, ${visual.logoWidth}px)`);
      const expectedColors = { 3: "rgb(227, 242, 253)", 4: "rgb(255, 243, 224)", 5: "rgb(255, 243, 224)" };
      assert.equal(visual.color, expectedColors[report], `Relatório ${report}: paleta visual do Power Apps`);
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    if (socket?.readyState === WebSocket.OPEN) {
      try { closeBrowser?.(); } catch { /* Processo já encerrado. */ }
    }
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      const graceful = await Promise.race([exited.then(() => true), delay(3000).then(() => false)]);
      if (!graceful && child.exitCode === null) { child.kill(); await Promise.race([exited, delay(3000)]); }
    }
    socket?.close();
    await server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
