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
const browser = [
  process.env.CHROME_BIN,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));

test(
  "Relatórios 1 e 2 não exigem rolagem lateral em telefone horizontal, mesmo com texto longo",
  { timeout: 90_000 },
  async (t) => {
    if (!browser) return t.skip("Chromium/Chrome indisponível neste ambiente");
    const server = await createServer({
      root: appRoot,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      logLevel: "silent",
    });
    const profile = mkdtempSync(join(tmpdir(), "energetico-report-layout-"));
    let child, socket;
    const pending = new Map();
    try {
      await server.listen();
      const port = server.httpServer.address().port;
      child = spawn(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-sandbox",
          "--hide-scrollbars",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdio: "ignore" },
      );
      let startError;
      child.on("error", (error) => {
        startError = error;
      });
      const portFile = join(profile, "DevToolsActivePort");
      for (let i = 0; i < 200 && !existsSync(portFile) && !startError; i++)
        await delay(100);
      if (startError) throw startError;
      assert.ok(
        existsSync(portFile),
        "Chromium não iniciou o protocolo de inspeção",
      );
      const [debugPort, path] = readFileSync(portFile, "utf8")
        .trim()
        .split(/\r?\n/);
      socket = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Chromium não conectou")),
          10_000,
        );
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("Falha na conexão Chromium"));
          },
          { once: true },
        );
      });
      let sequence = 0;
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        message.error
          ? request.reject(new Error(message.error.message))
          : request.resolve(message.result);
      });
      const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Chromium: ${method} expirou`));
          }, 10_000);
          pending.set(id, { resolve, reject, timer });
          socket.send(JSON.stringify({ id, method, params, sessionId }));
        });
      const { targetId } = await send("Target.createTarget", {
        url: "about:blank",
      });
      const { sessionId } = await send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const evaluate = async (expression) => {
        const response = await send(
          "Runtime.evaluate",
          { expression, returnByValue: true },
          sessionId,
        );
        assert.ok(
          !response.exceptionDetails,
          JSON.stringify(response.exceptionDetails),
        );
        return response.result.value;
      };
      for (const width of [667, 844])
        for (const report of ["1", "2"]) {
          await send(
            "Emulation.setDeviceMetricsOverride",
            { width, height: 390, deviceScaleFactor: 1, mobile: false },
            sessionId,
          );
          await send(
            "Page.navigate",
            {
              url: `http://127.0.0.1:${port}/tests/fixtures/report-responsive.html?report=${report}&long=1`,
            },
            sessionId,
          );
          let ready = false;
          for (let i = 0; i < 200 && !ready; i++) {
            ready = await evaluate(
              `location.search.includes("report=${report}") && document.documentElement?.dataset.viewportWidth === "${width}" && Boolean(document.querySelector('${report === "1" ? ".cr-main-table" : ".pp-order-card"}'))`,
            );
            if (!ready) await delay(100);
          }
          assert.ok(
            ready,
            `Relatório ${report}, ${width}px: prévia não carregou`,
          );
          const dimensions = await evaluate(
            "({...document.documentElement.dataset})",
          );
          assert.ok(
            Number(dimensions.scrollWidth) <= Number(dimensions.viewportWidth),
            `Relatório ${report}, ${width}px: documento transborda ${JSON.stringify(dimensions)}`,
          );
          assert.ok(
            Number(dimensions.reportWidth) <= Number(dimensions.contentWidth),
            `Relatório ${report}, ${width}px: conteúdo pede rolagem lateral ${JSON.stringify(dimensions)}`,
          );
        }
    } finally {
      for (const request of pending.values()) clearTimeout(request.timer);
      socket?.close();
      if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await Promise.race([exited, delay(3000)]);
      }
      await server.close();
      rmSync(profile, { recursive: true, force: true });
    }
  },
);
