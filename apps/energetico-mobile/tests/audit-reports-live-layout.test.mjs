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
const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
  .find(path => path && existsSync(path));

test("relatórios 11–13 cabem em 844×390 e 740×360 sem rolagem lateral ou cortes", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chrome/Edge indisponível");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(appRoot, "../..")] } }, logLevel: "silent" });
  const profile = mkdtempSync(join(tmpdir(), "audit-reports-live-layout-"));
  let child, socket;
  const pending = new Map();
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    let startupOutput = '', startupError;
    child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on('data', chunk => { startupOutput = (startupOutput + chunk.toString()).slice(-8000); });
    child.on('error', error => { startupError = error; });
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 200 && !existsSync(portFile) && child.exitCode === null && !startupError; i++) await delay(100);
    assert.ok(existsSync(portFile), `Chrome não iniciou protocolo de inspeção: exit=${child.exitCode}, signal=${child.signalCode}, erro=${startupError?.message || 'nenhum'}\n${startupOutput}`);
    const [debugPort, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let sequence = 0;
    socket.addEventListener("message", event => {
      const response = JSON.parse(event.data), request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      response.error ? request.reject(new Error(response.error.message)) : request.resolve(response.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} expirou`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async expression => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    for (const [width, height] of [[844, 390], [740, 360]]) for (const report of [11, 12, 13]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/tests/fixtures/audit-reports-live-responsive.html?report=${report}` }, sessionId);
      let ready = false;
      for (let i = 0; i < 120 && !ready; i++) {
        ready = await evaluate(`location.search === '?report=${report}' && document.documentElement?.dataset.ready === 'true' && Boolean(document.querySelector('${report === 12 ? ".ar-group" : ".ar-card"}'))`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Relatório ${report}, ${width}px não carregou`);
      const size = await evaluate(`(() => {
        const root = document.querySelector('.ar-report');
        const clipped = [...root.querySelectorAll('*')].filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width && (rect.right > innerWidth + 1 || rect.left < -1);
        }).map(node => node.className || node.tagName);
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, reportWidth: root.scrollWidth, reportClientWidth: root.clientWidth, clipped: clipped.slice(0, 5) };
      })()`);
      assert.ok(size.documentWidth <= width && size.reportWidth <= size.reportClientWidth && size.clipped.length === 0,
        `Relatório ${report}, ${width}×${height}: ${JSON.stringify(size)}`);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ar-desktop-table')).display`), "none", `Tabela ${report} deve dar lugar aos cartões no telefone`);
      const cue = await evaluate(`(() => {
        if (${report} === 11) return { labelLayout: getComputedStyle(document.querySelector('.ar-quotation-facts .ar-field')).display,
          labelBackground: getComputedStyle(document.querySelector('.ar-quotation-facts dt')).backgroundColor };
        if (${report} === 12) return { branchBackground: getComputedStyle(document.querySelector('.ar-branch-heading')).backgroundColor,
          periodAboveMetrics: document.querySelector('.ar-subtitle').getBoundingClientRect().bottom <= document.querySelector('.ar-metrics').getBoundingClientRect().top };
        return { documentCardAccent: getComputedStyle(document.querySelector('.ar-content > .ar-card')).borderLeftWidth,
          documentCardColor: getComputedStyle(document.querySelector('.ar-content > .ar-card')).borderLeftColor };
      })()`);
      if (report === 11) {
        assert.deepEqual(cue, { labelLayout: "grid", labelBackground: "rgb(240, 242, 246)" }, `R11: ${JSON.stringify(cue)}`);
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ar-brand')).display`), "none", "R11 deve começar pelo painel de título, como no Power Apps");
      }
      if (report === 12) assert.deepEqual(cue, { branchBackground: "rgb(6, 54, 102)", periodAboveMetrics: true }, `R12: ${JSON.stringify(cue)}`);
      if (report === 13) assert.deepEqual(cue, { documentCardAccent: "3px", documentCardColor: "rgb(157, 0, 0)" }, `R13: ${JSON.stringify(cue)}`);
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
    for (const report of [11, 12, 13]) {
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/tests/fixtures/audit-reports-live-responsive.html?report=${report}` }, sessionId);
      let ready = false;
      for (let i = 0; i < 120 && !ready; i++) {
        ready = await evaluate(`location.search === '?report=${report}' && document.documentElement?.dataset.ready === 'true' && Boolean(document.querySelector('.ar-desktop-table')) && document.querySelector('.ar-brand img')?.complete`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Relatório ${report} não carregou no desktop`);
      const presentation = await evaluate(`(() => ({
        logoLoaded: document.querySelector('.ar-brand img').naturalWidth > 0,
        tableDisplay: getComputedStyle(document.querySelector('.ar-desktop-table')).display,
        cardVisible: document.querySelector('${report === 13 ? ".ar-card" : ".ar-subcard"}')?.getClientRects().length > 0,
        logoSrc: document.querySelector('.ar-brand img')?.src,
        width: document.documentElement.scrollWidth,
      }))()`);
      assert.ok(presentation.logoLoaded && presentation.tableDisplay === "table" && !presentation.cardVisible && presentation.width <= 1365,
        `Relatório ${report} no desktop: ${JSON.stringify(presentation)}`);
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    let removed = false;
    for (let attempt = 0; attempt < 12 && !removed; attempt++) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); removed = true; }
      catch (error) { if (error.code !== "EPERM" && error.code !== "EBUSY") throw error; await delay(300); }
    }
    if (!removed) t.diagnostic(`Chrome ainda mantinha o perfil temporário aberto: ${profile}`);
  }
});
