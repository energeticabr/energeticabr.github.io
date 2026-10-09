import { spawn, execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Use an isolated test browser, an exact viewport, and the fixture's readiness
// marker. A fixed virtual-time budget can capture an unfinished module/image load.
export async function runBrowserLayout(browser, { width, height, url, safeAreaInsets, maxBuffer = 2_000_000, readyTimeoutMs = 30_000, startupTimeoutMs = 10_000 }) {
  const temporaryRoot = resolve(tmpdir());
  const profile = await mkdtemp(join(temporaryRoot, "energetico-layout-"));
  const pending = new Map();
  let child, socket, sequence = 0, sessionId, onLoaded, spawnError, browserStderr = '';
  try {
    child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--disable-dev-shm-usage", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.on("error", error => { spawnError = error; });
    child.stderr?.on('data', chunk => { browserStderr = (browserStderr + String(chunk)).slice(-2000); });
    let endpoint, lastEndpointContents;
    const startupDiagnostic = () => `Navegador: ${browser}. Último endpoint: ${JSON.stringify(lastEndpointContents ?? 'arquivo indisponível')}. ${browserStderr.trim()}`;
    const startupAttempts = Math.ceil(Math.max(1000, Math.min(30_000, Number(startupTimeoutMs) || 10_000)) / 100);
    for (let attempt = 0; attempt < startupAttempts; attempt += 1) {
      if (spawnError) throw spawnError;
      try {
        lastEndpointContents = await readFile(join(profile, "DevToolsActivePort"), "utf8");
        const [port, path] = lastEndpointContents.trim().split(/\r?\n/);
        // File creation precedes completion of Chrome's two-line endpoint.
        if (/^\d+$/.test(port || "") && Number(port) >= 1 && Number(port) <= 65535
          && /^\/devtools\/browser\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(path || "")) {
          endpoint = `ws://127.0.0.1:${port}${path}`;
          break;
        }
      } catch (error) {
        // Chrome can briefly lock this startup file while writing it on Windows.
        // Keep the existing bounded wait; other read and cleanup errors still fail.
        if (error.code !== "ENOENT" && !(process.platform === "win32" && error.code === "EBUSY")) throw error;
      }
      if (child.exitCode !== null) throw new Error(`O navegador de testes encerrou antes de iniciar. ${startupDiagnostic()}`);
      await delay(100);
    }
    if (!endpoint) throw new Error(`O navegador de testes não iniciou. ${startupDiagnostic()}`);
    socket = new WebSocket(endpoint);
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("Conexão com o navegador de testes expirou.")), 30_000);
      socket.addEventListener("open", () => { clearTimeout(timer); done(); }, { once: true });
      socket.addEventListener("error", error => { clearTimeout(timer); fail(error); }, { once: true });
    });
    socket.addEventListener("message", event => {
      const reply = JSON.parse(event.data);
      if (reply.method) {
        if (reply.method === "Page.loadEventFired" && reply.sessionId === sessionId) onLoaded?.();
        return;
      }
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      reply.error ? request.fail(new Error(reply.error.message)) : request.done(reply.result);
    });
    const send = (method, params = {}, targetSession) => new Promise((done, fail) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`${method}: medição não concluída.`));
      }, 35_000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId: targetSession }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    if (safeAreaInsets) await send("Emulation.setSafeAreaInsetsOverride", { insets: safeAreaInsets }, sessionId);
    let loadTimer;
    const loaded = new Promise((done, fail) => {
      onLoaded = () => { clearTimeout(loadTimer); done(); };
      loadTimer = setTimeout(() => fail(new Error("A página de testes não terminou de carregar.")), 30_000);
    });
    try {
      await Promise.all([send("Page.navigate", { url }, sessionId), loaded]);
    } finally {
      clearTimeout(loadTimer);
      onLoaded = undefined;
    }
    const result = await send("Runtime.evaluate", {
      expression: `new Promise((resolve, reject) => {
        let observer, timer;
        const read = () => {
          if (!document.documentElement.dataset.layout) return;
          observer?.disconnect();
          clearTimeout(timer);
          resolve(document.documentElement.outerHTML);
        };
        observer = new MutationObserver(read);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] });
        timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('A fixture não disponibilizou a medição de layout.'));
        }, ${Math.max(1000, Math.min(90000, Number(readyTimeoutMs) || 30000))});
        read();
      })`,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    if (typeof result.result?.value !== "string") throw new Error("Medição de layout inválida.");
    const stdout = "<!doctype html>" + result.result.value;
    if (Buffer.byteLength(stdout) > maxBuffer) throw new RangeError("A medição de layout excedeu o limite de saída.");
    return { stdout, stderr: "" };
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && !spawnError && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(done => child.once("exit", () => done(true)));
      if (process.platform === "win32") {
        // Chrome owns child processes: terminate only this uniquely spawned tree.
        if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error("PID do navegador de testes inválido.");
        await new Promise(done => execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, timeout: 5000 }, () => done()));
      } else {
        child.kill();
      }
      let stopped = await Promise.race([exited, delay(3000, false)]);
      if (!stopped) {
        child.kill("SIGKILL");
        stopped = await Promise.race([exited, delay(3000, false)]);
      }
      if (!stopped) throw new Error("O navegador de testes não encerrou; limpeza não concluída.");
    }
    // Remove only the exact profile uniquely created above, never a shared root.
    if (dirname(resolve(profile)) !== temporaryRoot || !basename(profile).startsWith("energetico-layout-")) {
      throw new Error("Perfil temporário fora do diretório autorizado.");
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
}
