import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createChatClient } from "../src/chat/chat-client.js";
import { renderChatMarkup } from "../src/ui/chat-view.js";
import { runBrowserLayout } from "./helpers/browser-layout-runner.mjs";

const portalApp = "nb-participacoes";
const area = (id, label) => ({ id, reply: id, label });
const state = {
  sessionStatus: "authenticated",
  account: { name: "Conta de teste" },
  messages: [{
    role: "assistant",
    type: "poll",
    question: "QUAL ÁREA VOCÊ DESEJA ACESSAR?",
    options: [
      area("group_nb_participacoes", "NB PARTICIPAÇÕES"),
      area("group_personal_expenses", "GASTOS PESSOAIS"),
      area("group_financial", "FINANCEIRO"),
      area("group_pending", "PENDÊNCIAS"),
      area("action_rhid_attendance_report", "RELATÓRIO RHID"),
    ],
  }],
};

test("NB has its own Microsoft login and only shows its two home areas", () => {
  assert.match(renderChatMarkup({}, { portalApp }), /<h1>NBPAR<\/h1>[\s\S]*Entrar com a Microsoft/);
  const markup = renderChatMarkup(state, { portalApp });
  assert.match(markup, /data-reply-id="group_nb_participacoes"/);
  assert.match(markup, /data-reply-id="group_personal_expenses"/);
  assert.doesNotMatch(markup, /group_financial|action_powerbi_dashboard|open-rhid-attendance-today|open-general-summary-report|open-cargos-table|open-rhid-mascot-report|open-stage-progress|open-trancid-report/);
  assert.match(renderChatMarkup(state), /action_powerbi_dashboard/);
});

test("NB never displays Energético reminders or report shortcuts from a restored state", () => {
  const restored = { ...state, pendingNotes: { rows: [{ id: "123" }] } };
  const markup = renderChatMarkup(restored, { portalApp });
  const document = new JSDOM(markup).window.document;
  assert.equal(document.querySelector("[class*='chat-main-'][class*='shortcut'], [data-pending-notes-dialog], [data-reply-id='action_rhid_attendance_report']"), null);
  document.defaultView.close();
  assert.match(renderChatMarkup(restored), /data-pending-notes-dialog/);
});

test("NB centers its stacked home buttons when opening and returning to the menu", { timeout: 120_000 }, async t => {
  const browser = [
    process.env.CHROME_BIN, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(path => path && existsSync(path));
  if (!browser) return t.skip("Chrome unavailable");

  const styles = await Promise.all(["../src/styles.css", "../src/ui/nb-participacoes.css"]
    .map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const server = createServer((request, response) => {
    const messages = request.url.includes("return")
      ? [{ type: "text", role: "assistant", text: "Lançamento concluído." }, ...state.messages]
      : state.messages;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${styles.join("\n").replace(/^@import[^\n]*$/gm, "")}</style>
      ${renderChatMarkup({ ...state, messages }, { portalApp })}
      <script type="module">
        const transcript = document.querySelector(".chat-transcript");
        transcript.scrollTop = transcript.scrollHeight;
        const buttons = [...transcript.querySelectorAll('[data-reply-id], [data-action="open-rentals-report"]')].map(button => {
          const { left, right, top, bottom } = button.getBoundingClientRect();
          return { id: button.dataset.replyId ?? button.dataset.action, left, right, top, bottom };
        });
        const { left, right, top, bottom } = transcript.getBoundingClientRect();
        document.documentElement.dataset.layout = JSON.stringify({ buttons, left, right, top, bottom });
      </script>`);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  t.after(() => server.close());

  for (const [width, height, mode] of [[320, 568, "open"], [393, 852, "return"], [1366, 768, "open"]]) {
    const url = `http://127.0.0.1:${server.address().port}/nb-home-fixture?mode=${mode}`;
    const { stdout } = await runBrowserLayout(browser, { width, height, url, mobile: width < 700 });
    const dom = new JSDOM(stdout);
    const { buttons, left, right, top, bottom } = JSON.parse(dom.window.document.documentElement.dataset.layout);
    dom.window.close();
    const description = `${width}x${height} (${mode})`;
    assert.deepEqual(buttons.map(button => button.id), ["group_nb_participacoes", "group_personal_expenses", "open-rentals-report"]);
    assert.ok(buttons[0].bottom < buttons[1].top, description);
    assert.ok(buttons[1].bottom < buttons[2].top, description);
    for (const button of buttons) {
      assert.ok(Math.abs((button.left + button.right - left - right) / 2) <= 2, description);
    }
    assert.ok(Math.abs((buttons[0].top + buttons.at(-1).bottom - top - bottom) / 2) <= 2, description);
  }
});

test("NB keeps submenu, field and attachment controls", () => {
  const markup = renderChatMarkup({
    ...state,
    activeFlow: { id: "rent_payment", title: "Pagamento de aluguel" },
    messages: [{
      type: "poll", role: "assistant", question: "Escolha o imóvel",
      options: [area("123", "Imóvel de teste")],
    }],
  }, { portalApp });
  assert.match(markup, /data-reply-id="123"/);
  assert.match(markup, /data-action="pick-files"/);
  assert.match(markup, /data-reply-id="navigation_main_menu"/);
});

test("NB uses its own assistant identity on welcome, prompts, text and documents", () => {
  const messages = [
    { role: "assistant", type: "poll", question: "Escolha o imóvel", options: [area("123", "Imóvel de teste")] },
    { role: "assistant", type: "text", text: "Informe o valor" },
    { role: "assistant", type: "document", id: "arquivo", fileName: "recibo.pdf" },
  ];
  const welcome = renderChatMarkup({ ...state, messages: [] }, { portalApp });
  const conversation = renderChatMarkup({ ...state, messages, resuming: true }, { portalApp });
  for (const markup of [welcome, conversation]) {
    assert.match(markup, /chat-avatar--assistant[^>]*>NBPAR</);
    assert.doesNotMatch(markup, /Energético|mascote-192|app-loading__mascot/);
  }
  assert.match(renderChatMarkup({ ...state, messages }), /Mascote Energético/);
});

test("NB scopes requests while Energético keeps its existing request format", async () => {
  const headers = [];
  const options = {
    apiBaseUrl: "https://example.com",
    tokenProvider: async () => "synthetic",
    fetchImpl: async (_url, init) => {
      headers.push(new Headers(init.headers));
      return Response.json({ status: "processed", messages: [], text: "Descrição do gasto" });
    },
  };
  const nb = createChatClient({ ...options, portalApp });
  await nb.sendText({ replyId: "group_nb_participacoes" });
  await nb.sendFile(new File(["fixture"], "recibo.pdf", { type: "application/pdf" }));
  await nb.transcribeAudio(new File(["fixture"], "descricao.m4a", { type: "audio/mp4" }));
  await createChatClient(options).sendText({ replyId: "group_financial" });
  assert.deepEqual(headers.map(item => item.get("X-Portal-App")), [portalApp, portalApp, portalApp, null]);
});
