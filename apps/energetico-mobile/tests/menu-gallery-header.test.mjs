import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createChatView, renderChatMarkup } from "../src/ui/chat-view.js";

const option = (id, label) => ({ id, reply: id, label });
const poll = (question, options) => ({ id: "menu", role: "assistant", type: "poll", question, options });
const state = (overrides = {}) => ({ sessionStatus: "authenticated", account: { name: "Bernardo" }, messages: [], pendingFiles: [], draft: "", ...overrides });
const assetOptions = [
  option("action_register_fixed_asset_product", "📦 CADASTRAR PRODUTO IMOBILIZADO"),
  option("action_register_fixed_asset_group", "🗂️ CADASTRAR GRUPO IMOBILIZADO"),
  option("action_register_fixed_asset", "🏷️ CADASTRAR IMOBILIZADO"),
  option("action_register_fixed_asset_function", "🛠️ CADASTRAR FUNÇÃO DO IMOBILIZADO"),
];
const assetQuestion = "🏷️ IMOBILIZADOS\nQUAL OPERAÇÃO DE IMOBILIZADOS VOCÊ DESEJA EFETUAR?";
const diaryOptions = [
  option("action_construction_diary_section", "📔 DIÁRIO DE OBRAS"),
  option("action_construction_stage_section", "🏗️ ETAPA OBRA E DEMONSTRATIVO ETAPA"),
  option("action_construction_stage_contracts", "📑 CONTRATO"),
  option("action_report_employee_inconsistency", "⚠️ APONTAR INCONSISTÊNCIA"),
];
const contractQuestion = "📑 CONTRATO\nQUAL OPERAÇÃO DE CONTRATO VOCÊ DESEJA EFETUAR?";
const contractOptions = [
  option("action_register_contractor_contract", "📑 CADASTRAR CONTRATO DE EMPREITEIRO"),
  option("action_register_contract_line", "➕ CADASTRAR LINHA CONTRATO"),
  option("action_register_measurement", "📏 CADASTRAR MEDIÇÃO"),
  option("action_register_measurement_line", "📐 CADASTRAR LINHA MEDIÇÃO"),
];
const stageQuestion = "🏗️ ETAPA OBRA E DEMONSTRATIVO ETAPA\nQUAL OPERAÇÃO DE ETAPA OBRA OU DEMONSTRATIVO ETAPA VOCÊ DESEJA EFETUAR?";
const stageOptions = [
  option("action_create_construction_stage_demonstrative", "📊 CRIAR DEMONSTRATIVO DE ETAPA"),
  option("action_close_construction_stage_demonstrative", "🏁 BAIXAR DEMONSTRATIVO ETAPA"),
  option("action_close_construction_stage", "✅ EFETUAR BAIXA EM ETAPA OBRA"),
  option("action_register_construction_stage", "🏗️ CADASTRO DE ETAPA OBRA"),
];
const ids = element => [...element.querySelectorAll("[data-reply-id]")].map(button => button.dataset.replyId);

function markupDocument(message, overrides = {}) {
  return new JSDOM(renderChatMarkup(state({ messages: [message], ...overrides })));
}

test("Imobilizados pairs each catalog action with its gallery in catalog order", () => {
  const dom = markupDocument(poll(assetQuestion, assetOptions));
  const message = dom.window.document.querySelector(".chat-message--asset-menu");
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.deepEqual([...message.querySelectorAll(".chat-menu-gallery-pair")].map(ids), [
    ["action_register_fixed_asset_product", "action_asset_product_gallery"],
    ["action_register_fixed_asset_group", "action_asset_group_gallery"],
    ["action_register_fixed_asset", "action_asset_gallery"],
    ["action_register_fixed_asset_function", "action_asset_function_gallery"],
  ]);
  assert.equal(message.querySelector('[data-reply-id="action_asset_gallery"]').textContent, "GALERIA DE IMOBILIZADO");
  dom.window.close();
});

test("Etapa Obra places the diary gallery beside the diary and preserves other actions", () => {
  const dom = markupDocument(poll("🏗️ ETAPA OBRA\nQUAL FLUXO VOCÊ DESEJA INICIAR?", diaryOptions));
  const message = dom.window.document.querySelector(".chat-message--construction-menu");
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.deepEqual([...message.querySelectorAll(".chat-menu-gallery-pair")].map(ids), [
    ["action_construction_diary_section", "action_work_diary_gallery"],
    ["action_construction_stage_section"], ["action_construction_stage_contracts"], ["action_report_employee_inconsistency"],
  ]);
  dom.window.close();
});

test("Contrato pairs contracts and their lines with measurements and their lines in catalog order", () => {
  const dom = markupDocument(poll(contractQuestion, contractOptions));
  const message = dom.window.document.querySelector(".chat-message--contract-menu");
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.deepEqual([...message.querySelectorAll(".chat-menu-gallery-pair")].map(ids), [
    ["action_register_contractor_contract", "action_contract_gallery"],
    ["action_register_contract_line", "action_contract_line_gallery"],
    ["action_register_measurement", "action_measurement_gallery"],
    ["action_register_measurement_line", "action_measurement_line_gallery"],
  ]);
  assert.deepEqual([...message.querySelectorAll("[data-gallery-button]")].map(button => button.textContent), [
    "GALERIA DE CONTRATOS", "GALERIA DE LINHAS DE CONTRATO", "GALERIA DE MEDIÇÕES", "GALERIA DE LINHAS DE MEDIÇÃO",
  ]);
  dom.window.close();
});

test("Stage submenu pairs demonstratives and stage registration while preserving both closure actions", () => {
  const dom = markupDocument(poll(stageQuestion, stageOptions));
  const message = dom.window.document.querySelector(".chat-message--construction-stage-menu");
  assert.ok(message);
  assert.equal(message.querySelector(".chat-avatar"), null);
  assert.deepEqual([...message.querySelectorAll(".chat-menu-gallery-pair")].map(ids), [
    ["action_create_construction_stage_demonstrative", "action_stage_demonstrative_gallery"],
    ["action_close_construction_stage_demonstrative"],
    ["action_close_construction_stage"],
    ["action_register_construction_stage", "action_construction_stage_gallery"],
  ]);
  assert.deepEqual([...message.querySelectorAll("[data-gallery-button]")].map(button => button.textContent), [
    "GALERIA DE DEMONSTRATIVO ETAPA", "GALERIA DE ETAPA OBRA",
  ]);
  dom.window.close();
});

test("New contract and stage galleries dispatch their exact local action IDs once", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const events = [];
  view.on("select-reply", event => events.push(event.replyId));
  for (const [question, options] of [[contractQuestion, [...contractOptions, option("action_contract_gallery", "OLD GALLERY")]], [stageQuestion, [...stageOptions, option("action_construction_stage_gallery", "OLD GALLERY")]]]) {
    view.render(state({ messages: [poll(question, options)] }));
    for (const button of root.querySelectorAll("[data-gallery-button]")) button.click();
  }
  assert.deepEqual(events, ["action_contract_gallery", "action_contract_line_gallery", "action_measurement_gallery", "action_measurement_line_gallery", "action_stage_demonstrative_gallery", "action_construction_stage_gallery"]);
  view.destroy();
  dom.window.close();
});

test("Supplies removes Obter Dados and pairs quotations while preserving existing galleries", () => {
  const options = [option("action_supply_launches", "🧾 LANÇAMENTOS"), option("action_supply_provisions", "💳 PROVISÃO DE PAGAMENTO E DESPESAS RECORRENTES"),
    option("action_supply_registrations", "🗂️ EFETUAR CADASTROS"), option("action_launch_report", "📊 OBTER DADOS"),
    option("action_new_quotation", "📝 NOVA COTAÇÃO"), option("action_supply_fixed_assets", "🏷️ IMOBILIZADOS")];
  const dom = markupDocument(poll("📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", options));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('[data-reply-id="action_launch_report"]'), null);
  assert.deepEqual([...doc.querySelectorAll(".chat-supplies-extra-pair")].map(ids), [
    ["action_supply_registrations"], ["action_new_quotation", "action_quote_gallery"], ["action_supply_fixed_assets"],
  ]);
  assert.deepEqual([...doc.querySelectorAll(".chat-supplies-pair")].map(ids), [
    ["action_supply_launches", "action_orders_gallery", "action_launch_gallery"],
    ["action_supply_provisions", "action_payment_programming_gallery", "action_recurring_expenses_gallery"],
  ]);
  dom.window.close();
});

test("Gallery additions deduplicate server options and keep actions disabled while busy", () => {
  const dom = markupDocument(poll(assetQuestion, [...assetOptions, option("action_asset_gallery", "OLD GALLERY")]), { activeText: "sending" });
  assert.equal(dom.window.document.querySelectorAll('[data-reply-id="action_asset_gallery"]').length, 1);
  assert.ok([...dom.window.document.querySelectorAll(".chat-message button")].every(button => button.disabled));
  dom.window.close();
});

test("Catalog reply IDs preserve the correct gallery even when an old display label disagrees", () => {
  const dom = markupDocument(poll(assetQuestion, [option("action_register_fixed_asset", "CADASTRAR PRODUTO IMOBILIZADO")]));
  assert.deepEqual(ids(dom.window.document.querySelector(".chat-menu-gallery-pair")), ["action_register_fixed_asset", "action_asset_gallery"]);
  dom.window.close();
});

test("Unrelated forms keep Obter Dados and receive no asset or diary galleries", () => {
  for (const question of ["👥 RECURSOS HUMANOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", "INFORME O GRUPO DO IMOBILIZADO", "🏗️ ETAPA OBRA E DEMONSTRATIVO ETAPA\nQUAL OPERAÇÃO?"]) {
    const dom = markupDocument(poll(question, [option("data", "📊 OBTER DADOS"), ...assetOptions, ...diaryOptions]));
    assert.ok(dom.window.document.querySelector('[data-reply-id="data"]'));
    assert.equal(dom.window.document.querySelector('[data-gallery-button]'), null);
    dom.window.close();
  }
});

test("Menu pairs use two flexible columns and wrapping buttons", () => {
  const dom = markupDocument(poll(assetQuestion, assetOptions));
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  dom.window.document.head.append(style);
  const pair = dom.window.document.querySelector(".chat-menu-gallery-pair");
  assert.ok(pair);
  assert.equal(dom.window.getComputedStyle(pair).gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
  for (const button of pair.querySelectorAll("button")) {
    assert.equal(dom.window.getComputedStyle(button).whiteSpace, "normal");
    assert.equal(dom.window.getComputedStyle(button).overflowWrap, "anywhere");
  }
  dom.window.close();
});

test("Paired primary buttons match Supplies blue styling while galleries retain gray styling", () => {
  const dom = new JSDOM(renderChatMarkup(state({ messages: [
    poll("📦 SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?", [option("action_supply_launches", "🧾 LANÇAMENTOS")]),
    poll(assetQuestion, assetOptions),
    poll("🏗️ ETAPA OBRA\nQUAL FLUXO VOCÊ DESEJA INICIAR?", diaryOptions),
    poll(contractQuestion, contractOptions),
    poll(stageQuestion, stageOptions),
  ] })));
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  dom.window.document.head.append(style);
  const reference = dom.window.getComputedStyle(dom.window.document.querySelector(".chat-supplies-pair__primary button"));
  for (const button of dom.window.document.querySelectorAll(".chat-menu-gallery-pair__primary button")) {
    const actual = dom.window.getComputedStyle(button);
    for (const property of ["background", "color", "border-width", "border-radius", "font-size", "font-weight", "line-height"]) {
      assert.equal(actual.getPropertyValue(property), reference.getPropertyValue(property), `${button.textContent}: ${property}`);
    }
  }
  for (const button of dom.window.document.querySelectorAll(".chat-menu-gallery-pair [data-gallery-button]")) {
    const actual = dom.window.getComputedStyle(button);
    assert.equal(actual.backgroundColor, "rgb(69, 76, 83)");
    assert.equal(actual.color, "rgb(255, 255, 255)");
  }
  dom.window.close();
});

test("Both header mascot and name are native keyboard buttons emitting only the today page event", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const events = [];
  view.on("open-rhid-attendance-today", event => events.push(event));
  view.on("rhid-attendance-report-today", () => assert.fail("header must preserve the separate PDF shortcut"));
  view.render(state());
  const buttons = [...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')];
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.type, "button");
    assert.match(button.getAttribute("aria-label"), /RHID.*hoje/);
    button.focus();
    assert.equal(dom.window.document.activeElement, button);
    (button.querySelector("img, strong") || button).click();
  }
  assert.deepEqual(events, [{ type: "open-rhid-attendance-today" }, { type: "open-rhid-attendance-today" }]);
  root.querySelector('[data-action="sign-out"]').click();
  assert.equal(events.length, 2);
  assert.ok(root.querySelector('[data-action="confirm-sign-out"]'));
  assert.ok([...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')].every(button => button.disabled));
  view.destroy();
  dom.window.close();
});

test("Header report shortcuts respect blocking session states and restore after recovery", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const events = [];
  view.on("open-rhid-attendance-today", event => events.push(event));
  for (const overrides of [{ activeText: "sending" }, { resuming: true }, { recoveryBlocked: true }, { recoveryUncertain: true }, { responseTransitionPending: true }, { pendingFiles: [{ id: "upload", status: "sending" }] }]) {
    view.render(state(overrides));
    const buttons = root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]');
    assert.equal(buttons.length, 2);
    for (const button of buttons) { assert.equal(button.disabled, true); button.click(); }
  }
  assert.equal(events.length, 0);
  view.render(state());
  assert.ok([...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')].every(button => !button.disabled));
  view.render(state({ sessionStatus: "signed-out" }));
  assert.equal(root.querySelector('[data-action="open-rhid-attendance-today"]'), null);
  view.destroy();
  dom.window.close();
});

test("Opening today's report renders loading immediately and errors retry that date without a calendar", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  view.render(state());
  assert.equal(typeof view.openRhidAttendanceToday, "function");
  assert.equal(view.openRhidAttendanceToday({ date: "2026-10-02" }), true);
  assert.equal(view.openRhidAttendanceToday({ date: "2026-10-03" }), false);
  assert.match(root.querySelector('[role="status"]').textContent, /RHID|Consultando/);
  assert.match(root.querySelector(".chat-rhid-report-loading").textContent, /02\/10\/2026/);
  assert.equal(root.querySelector('[data-role="rhid-calendar-day"]'), null);
  assert.equal(view.setRhidAttendanceReportStatus({ busy: false, error: "Falha ao consultar" }), true);
  assert.match(root.querySelector('[role="alert"]').textContent, /Falha ao consultar/);
  assert.equal(root.querySelector('[data-role="rhid-calendar-day"]'), null);
  assert.match(root.querySelector(".chat-rhid-report-page").textContent, /02\/10\/2026/);
  const retries = [];
  view.on("open-rhid-attendance-today", event => retries.push(event));
  root.querySelector('.chat-rhid-report-page [data-action="open-rhid-attendance-today"]').click();
  assert.deepEqual(retries, [{ type: "open-rhid-attendance-today" }]);
  assert.equal(view.closeRhidAttendanceReport(), true);
  assert.equal(root.querySelector(".chat-rhid-report-page"), null);
  view.destroy();
  dom.window.close();
});

test("Header shortcuts update when synchronization changes without replacing the conversation", () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector("#app");
  const view = createChatView(root);
  const initial = state();
  view.render(initial);
  view.render({ ...initial, recoveryUncertain: true });
  assert.ok([...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')].every(button => button.disabled));
  view.render(initial);
  assert.ok([...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')].every(button => !button.disabled));
  view.setRhidRefreshStatus({ busy: true });
  assert.ok([...root.querySelectorAll('.chat-header [data-action="open-rhid-attendance-today"]')].every(button => button.disabled));
  view.destroy();
  dom.window.close();
});
