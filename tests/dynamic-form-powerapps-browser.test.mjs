import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean).find(candidate => fs.existsSync(candidate));

const fixture = `<!doctype html>
<html lang="pt-BR"><body><pre id="result">pending</pre><script type="module">
import { renderDynamicForm } from "/portal/ui/dynamic-form.js";
const createRoot = () => document.body.appendChild(document.createElement("section"));
const submit = async root => {
  root.querySelector("form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
};
const results = {};

let remotePayload = null;
const remoteRoot = createRoot();
renderDynamicForm(remoteRoot, {
  entity: { title: "Lancamentos" },
  mode: "create",
  values: { CONTRATO: "", MEDICAOPARCIAL: "" },
  powerAppsOptionDebounceMs: 0,
  columns: [{
    name: "CONTRATO", label: "Contrato e medição", control: "select", choices: [], editable: true, hidden: false,
    powerApps: {
      closed: true,
      optionSources: [{ kind: "related", listName: "DESCRICAOMEDICOES", valueField: "NUMEROCONTRATO", additionalFields: ["ID"] }],
      sharedOutputs: [
        { fieldName: "CONTRATO", sourceField: "NUMEROCONTRATO" },
        { fieldName: "MEDICAOPARCIAL", sourceField: "ID" },
      ],
    },
  }],
  async powerAppsOptionSearch() {
    return [{ value: "CT-12", label: "34 - Fornecedor (CT-12)", data: { NUMEROCONTRATO: "CT-12", ID: "34" } }];
  },
  onSubmit(fields) { remotePayload = fields; },
});
const remoteInput = remoteRoot.querySelector(".searchable-select-input");
remoteInput.value = "34";
remoteInput.dispatchEvent(new Event("input", { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 10));
remoteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
remoteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await submit(remoteRoot);
const remoteNative = remoteRoot.querySelector('select[name="CONTRATO"]');
results.remote = remoteNative.value === "CT-12"
  && remoteNative.querySelector('option[value="CT-12"]')?.textContent === "34 - Fornecedor (CT-12)"
  && remotePayload?.CONTRATO === "CT-12"
  && remotePayload?.MEDICAOPARCIAL === "34";

const recurrenceColumns = [
  { name: "RECORRENCIA", label: "Recorrência", control: "select", choices: ["Diário", "Semanal", "Mensal", "Anual"], editable: true, hidden: false },
  { name: "RECORRENCIADIAS", label: "Dias da recorrência", control: "text", editable: true, hidden: false },
];
const recurrenceRoot = createRoot();
let clearedRecurrencePayload = null;
renderDynamicForm(recurrenceRoot, {
  entity: { id: "despesas-recorrentes", title: "Despesas recorrentes" },
  mode: "create",
  values: { RECORRENCIA: "", RECORRENCIADIAS: "10" },
  columns: recurrenceColumns,
  onSubmit(fields) { clearedRecurrencePayload = fields; },
});
const recurrenceInput = recurrenceRoot.querySelector(".searchable-select-input");
const recurrenceDays = recurrenceRoot.querySelector('[name="RECORRENCIADIAS"]');
const recurrenceDaysField = recurrenceDays.closest("label");
const daysInitiallyAccepted = !recurrenceDaysField.hidden && !recurrenceInput.required;
recurrenceInput.value = "Mensal";
recurrenceInput.dispatchEvent(new Event("input", { bubbles: true }));
recurrenceInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
recurrenceInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
const recurrenceSelected = recurrenceRoot.querySelector('select[name="RECORRENCIA"]').value === "Mensal"
  && recurrenceDays.value === ""
  && recurrenceDaysField.hidden;
const clearRecurrence = recurrenceRoot.querySelector('[data-clear-choice="RECORRENCIA"]');
clearRecurrence?.click();
const recurrenceCleared = recurrenceRoot.querySelector('select[name="RECORRENCIA"]').value === ""
  && recurrenceInput.value === ""
  && !recurrenceDaysField.hidden
  && !recurrenceDays.disabled
  && recurrenceInput.required;
await submit(recurrenceRoot);
const clearedBlankBlocked = clearedRecurrencePayload === null;
recurrenceDays.value = "12";
recurrenceDays.dispatchEvent(new Event("input", { bubbles: true }));
await submit(recurrenceRoot);
const clearedDaysAccepted = !Object.hasOwn(clearedRecurrencePayload || {}, "RECORRENCIA")
  && clearedRecurrencePayload?.RECORRENCIADIAS === "12";

let daysOnlySubmissions = 0;
const daysOnlyRoot = createRoot();
renderDynamicForm(daysOnlyRoot, {
  entity: { id: "despesas-recorrentes", title: "Despesas recorrentes" },
  mode: "create",
  values: { RECORRENCIA: "", RECORRENCIADIAS: "" },
  columns: recurrenceColumns,
  onSubmit() { daysOnlySubmissions += 1; },
});
const daysOnlyInput = daysOnlyRoot.querySelector(".searchable-select-input");
const daysOnlyDays = daysOnlyRoot.querySelector('[name="RECORRENCIADIAS"]');
const blankState = !daysOnlyDays.closest("label").hidden && daysOnlyInput.required;
await submit(daysOnlyRoot);
const blankBlocked = daysOnlySubmissions === 0;
daysOnlyDays.value = "5, 20";
daysOnlyDays.dispatchEvent(new Event("input", { bubbles: true }));
await submit(daysOnlyRoot);
results.recurrence = daysInitiallyAccepted && recurrenceSelected && recurrenceCleared
  && clearedBlankBlocked && clearedDaysAccepted && blankState && blankBlocked
  && daysOnlySubmissions === 1;

const provisaoRoot = createRoot();
renderDynamicForm(provisaoRoot, {
  entity: { id: "provisoes-de-pagamento", title: "Provisão de pagamento" },
  mode: "create",
  columns: [
    { name: "DATA", label: "Data", control: "date", editable: true, hidden: false },
    { name: "DATAPREVISTOPGTO", label: "Data prevista", control: "date", editable: true, hidden: false },
    { name: "DATAPGTOEFETUADO", label: "Data do pagamento", control: "date", editable: true, hidden: false },
  ],
});
const stage = provisaoRoot.querySelector("[data-provisao-payment-stage]");
const data = provisaoRoot.querySelector('[name="DATA"]');
const prevista = provisaoRoot.querySelector('[name="DATAPREVISTOPGTO"]');
const paga = provisaoRoot.querySelector('[name="DATAPGTOEFETUADO"]');
stage.value = "EMPENHADO, LIQUIDADO E PAGO HOJE";
stage.dispatchEvent(new Event("change", { bubbles: true }));
const today = data.value;
data.value = "2026-08-01";
prevista.value = "2026-10-01";
paga.value = "2026-10-02";
stage.value = "EMPENHADO HOJE";
stage.dispatchEvent(new Event("change", { bubbles: true }));
const incompatibleDatesCleared = data.value === "2026-08-01" && prevista.value === "" && paga.value === "";
paga.value = "2026-10-02";
stage.value = "LIQUIDADO HOJE";
stage.dispatchEvent(new Event("change", { bubbles: true }));
const unchangedFormulaPreservesManual = prevista.value === today && paga.value === "2026-10-02";
stage.value = "PAGO HOJE";
stage.dispatchEvent(new Event("change", { bubbles: true }));
const changedFormulasReapply = data.value === "2026-08-01" && prevista.value === "" && paga.value === today;
results.provisao = incompatibleDatesCleared && unchangedFormulaPreservesManual && changedFormulasReapply;

document.querySelector("#result").textContent = JSON.stringify(results);
</script></body></html>`;

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

function serveProject() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname === "/dynamic-form-powerapps-rules") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(fixture);
      return;
    }
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

function dumpDom(url, userDataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      "--virtual-time-budget=3000",
      "--dump-dom",
      url,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`Chrome encerrou com ${code}: ${stderr}`)));
  });
}

test("ComboBox remoto, recorrência F21 e datas F3 preservam as regras publicadas", { skip: !chrome }, async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const userDataDir = path.join(tempRoot, `chrome-dynamic-powerapps-${process.pid}-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const server = await serveProject();
  try {
    const address = server.address();
    const dom = await dumpDom(`http://127.0.0.1:${address.port}/dynamic-form-powerapps-rules`, userDataDir);
    const encoded = dom.match(/<pre id="result">([^<]+)<\/pre>/)?.[1] || "";
    const decoded = encoded.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    assert.deepEqual(JSON.parse(decoded), { remote: true, recurrence: true, provisao: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (userDataDir.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
