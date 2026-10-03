import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browser = [process.env.CHROME_BIN, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(path => path && existsSync(path));

test("G28 mantém o cartão de provisão legível a 390px, 320px e no desktop", { timeout: 90_000 }, async t => {
  if (!browser) return t.skip("Chrome/Edge indisponível");
  const server = await createServer({ root: appRoot, server: { host: "127.0.0.1", port: 0,
    fs: { allow: [resolve(appRoot, "../..")], }, }, logLevel: "silent" });
  const profile = mkdtempSync(join(tmpdir(), "payment-gallery-layout-"));
  const pending = new Map();
  let child, socket;
  try {
    await server.listen();
    child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let attempt = 0; attempt < 200 && !existsSync(portFile); attempt++) await delay(100);
    assert.ok(existsSync(portFile), "Chrome não iniciou inspeção remota");
    const [debugPort, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${debugPort}${path}`);
    await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
    let sequence = 0;
    socket.addEventListener("message", event => {
      const response = JSON.parse(event.data), request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      response.error ? request.fail(new Error(response.error.message)) : request.done(response.result);
    });
    const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} expirou`)); }, 10_000);
      pending.set(id, { done, fail, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async expression => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const port = server.httpServer.address().port;
    for (const [width, height, expectedColumns] of [[390, 844, 3], [320, 740, 2], [1365, 768, 3]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/tests/fixtures/payment-programming-gallery-responsive.html?width=${width}` }, sessionId);
      let ready = false;
      for (let attempt = 0; attempt < 120 && !ready; attempt++) {
        ready = await evaluate(`location.search === '?width=${width}' && document.documentElement?.dataset.ready === 'true' && document.querySelectorAll('.pg-card').length === 3`);
        if (!ready) await delay(100);
      }
      assert.ok(ready, `Galeria G28 não carregou em ${width}px`);
      const layout = await evaluate(`(() => {
        const card = document.querySelector('.pg-card[data-item-id="300"]');
        const attached = document.querySelector('.pg-card[data-item-id="301"]');
        const fields = [...card.querySelectorAll('.pg-card-grid .pg-card-field')];
        const actions = [...card.querySelectorAll('.gallery-record-actions > button')].map(button => button.getBoundingClientRect());
        const grid = getComputedStyle(card.querySelector('.pg-card-grid'));
        const cardRect = card.getBoundingClientRect();
        const attachedRect = attached.getBoundingClientRect();
        const attachedChildrenOutside = [...attached.querySelectorAll('*')].filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width && (rect.left < attachedRect.left - 1 || rect.right > attachedRect.right + 1);
        }).map(node => node.className || node.tagName).slice(0, 5);
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          contentOverflow: document.querySelector('.og-content').scrollWidth > document.querySelector('.og-content').clientWidth + 1,
          cardRight: cardRect.right,
          cardOverflow: card.scrollWidth > card.clientWidth + 1,
          attachedCardOverflow: attached.scrollWidth > attached.clientWidth + 1,
          attachedChildrenOutside,
          fieldColumns: grid.gridTemplateColumns.split(' ').length,
          fieldCount: fields.length,
          actionsSideBySide: actions.length === 2 && Math.abs(actions[0].top - actions[1].top) < 1,
          descriptionAboveFields: card.querySelector('.pg-description').getBoundingClientRect().bottom <= fields[0].getBoundingClientRect().top,
          emptyRail: Boolean(card.querySelector('.pg-attachment-rail')),
          attachedRail: Boolean(attached.querySelector('.pg-attachment-rail')),
          headerOverlap: card.querySelector('.pg-card-heading h2').getBoundingClientRect().right > actions[0].left + 1,
        };
      })()`);
      assert.ok(layout.documentWidth <= width && layout.cardRight <= width + 1 &&
        !layout.contentOverflow && !layout.cardOverflow && !layout.attachedCardOverflow && layout.attachedChildrenOutside.length === 0,
        `G28 extrapola a tela ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.fieldColumns, expectedColumns, `grade de ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.fieldCount, 6);
      assert.ok(layout.actionsSideBySide && layout.descriptionAboveFields && !layout.emptyRail && layout.attachedRail && !layout.headerOverlap,
        `composição de ${width}px: ${JSON.stringify(layout)}`);
      if (width === 390 && process.env.PAYMENT_GALLERY_SCREENSHOT) {
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
        writeFileSync(process.env.PAYMENT_GALLERY_SCREENSHOT, Buffer.from(shot.data, "base64"));
      }
    }
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    if (child && child.exitCode === null) { const exited = new Promise(done => child.once("exit", done)); child.kill(); await Promise.race([exited, delay(3000)]); }
    await server.close();
    let removed = false;
    for (let attempt = 0; attempt < 12 && !removed; attempt++) {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); removed = true; }
      catch (error) { if (error.code !== "EPERM" && error.code !== "EBUSY") throw error; await delay(300); }
    }
    if (!removed) t.diagnostic(`Chrome ainda mantinha o perfil temporário aberto: ${profile}`);
  }
});
