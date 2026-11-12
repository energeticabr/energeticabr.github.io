import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import { applyScreenNavigation } from "./screen-navigation.js";
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import {
  PAYROLL_RUBRICS,
  payrollTotal,
  payrollDecimal,
  validPayrollDate,
  validatePayrollDraft,
} from "../chat/supplier-payroll.js";
import { createLoadingIndicator, updateLoadingIndicator } from "./loading-indicator.js";
import { beginLoadingTask } from './loading-task.js';
import { openPayrollReceiptPicker } from "./payroll-receipt-picker.js";
import { payrollTaxType, payrollCompetenceMonth, previousPayrollCompetence } from '../chat/payroll-tax-competence.js';
const money = (value) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
let sequence = 0;
export function createSupplierPayrollView({
  data,
  root,
  documentRef = globalThis.document,
  onClose = () => {},
  onHome = () => {},
  assertSession = () => {},
  getReceiptAttachments = () => [],
  readReceiptAttachment = async () => { throw new Error("O comprovante não está disponível na bandeja."); },
  pickReceiptAttachments,
} = {}) {
  if (!documentRef?.createElement || !data)
    throw new TypeError("A página de folha requer dados e documento.");
  const doc = documentRef,
    id = ++sequence;
  const element = (tag, className, text) => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const page = element("section", "supplier-payroll-page");
  page.hidden = true;
  page.tabIndex = -1;
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-modal", "true");
  page.setAttribute("aria-labelledby", `supplier-payroll-title-${id}`);
  const header = element("header", "supplier-payroll-header"),
    title = element("h1", "", "EFETUAR FOLHA DE PAGAMENTO");
  title.id = `supplier-payroll-title-${id}`;
  function navigationButton(label, attribute, handler) {
    const control = element("button", "supplier-payroll-button supplier-payroll-navigation", label);
    control.type = "button";
    control.setAttribute(attribute, "");
    control.addEventListener("click", handler);
    return control;
  }
  const backButton = navigationButton("Voltar", "data-payroll-header-back", navigateBack);
  const homeButton = navigationButton("Início", "data-payroll-home", () => {
    if (close()) {
      if (!hasPendingPosting()) reset();
      onHome();
    }
  });
  applyScreenNavigation({ header, back: backButton, home: homeButton, title });
  const body = element("div", "supplier-payroll-body"),
    error = element("p", "supplier-payroll-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const content = element("div", "supplier-payroll-content"),
    footer = element("footer", "supplier-payroll-footer");
  body.append(error, content);
  page.append(header, body, footer);
  (root || doc.body).append(page);
  let destroyed = false;
  let opened = false;
  let busy = false;
  let mutating = false;
  let epoch = 0;
  let step = "date";
  let date = "";
  let entries = [];
  let search = "";
  let previousFocus = null;
  let receiptPicker = null;
  let loadingOperation = null;
  let batchRequest = null;
  let pickers = [];

  function makeEntry(supplier) {
    return {
      draft: {
        date, supplier, product: null, stage: null, sheet: null,
        taxCompetence: "", taxSheet: null,
        lines: PAYROLL_RUBRICS.map(({ id }) => ({
          rubric: id, quantity: "1", unitValue: "", account: null, files: [],
        })),
      },
      progress: {
        operationId: globalThis.crypto?.randomUUID?.() ||
          String(Date.now()) + "-" + Math.random().toString(36).slice(2),
      },
      expanded: false,
      selected: false,
    };
  }
  function hasPendingPosting() {
    return entries.some(entry => entry.progress.fingerprint && !entry.result);
  }
  function reset() {
    step = "date";
    date = "";
    entries = [];
    search = "";
  }
  function button(label, attribute, handler) {
    const el = element("button", "supplier-payroll-button", label);
    el.type = "button";
    if (attribute) el.setAttribute(attribute, "");
    el.disabled = busy;
    el.addEventListener("click", () => {
      if (!busy && !destroyed) void handler();
    });
    return el;
  }
  function showError(cause) {
    error.textContent =
      cause?.message || "Não foi possível concluir. Tente novamente.";
    error.hidden = false;
  }
  function focus() {
    const target =
      content.querySelector("input:not([type=file]), select, button") || page;
    target.focus?.();
  }
  async function work(
    action,
    loadingLabel = "Carregando opções da folha…",
    mutation = false,
  ) {
    if (busy || destroyed || !opened) return false;
    const attempt = epoch;
    const operation = { abort: new AbortController(), snapshot: { percent: 0 }, loader: null };
    loadingOperation = operation;
    const isCurrent = () => {
      if (destroyed || !opened || attempt !== epoch || loadingOperation !== operation) return false;
      try { assertSession(); return true; } catch { return false; }
    };
    const task = operation.task = beginLoadingTask(value => {
      operation.snapshot = value;
      if (operation.loader) updateLoadingIndicator(operation.loader, { progress: value.percent, progressLabel: value.progressLabel });
    }, { signal: operation.abort.signal, isCurrent });
    const assertCurrent = () => {
      assertSession();
      if (destroyed || !opened || attempt !== epoch)
        throw new Error("Esta consulta da folha foi encerrada.");
    };
    busy = true;
    mutating = mutation;
    error.hidden = true;
    render(loadingLabel);
    try {
      assertCurrent();
      task.prepared();
      await action(assertCurrent, { signal: operation.abort.signal, onProgress: task.report });
      assertCurrent();
      task.acquired();
      busy = false;
      mutating = false;
      render();
      focus();
      task.complete();
      return true;
    } catch (cause) {
      task.stop();
      if (!destroyed && opened && attempt === epoch) {
        busy = false;
        mutating = false;
        render();
        showError(cause);
      }
      return false;
    }
  }
  function identity(draft) {
    const summary = element("div", "supplier-payroll-identity");
    const table = element("table", "supplier-payroll-identity-table");
    table.setAttribute("aria-label", "Dados da folha");
    const body = element("tbody");
    for (const [label, value] of [
      ["Fornecedor", draft.supplier?.label],
      ["Profissão", String(draft.supplier?.profession ?? "").trim() || draft.product?.label],
      ["Data", draft.date.split("-").reverse().join("/")],
      ["Filial", draft.supplier?.branch],
    ]) {
      const row = element("tr");
      const field = element("th", "", label);
      field.scope = "row";
      row.append(field, element("td", "", String(value ?? "").trim() || "—"));
      body.append(row);
    }
    table.append(body);
    summary.append(table);
    return summary;
  }
  function field(labelText, input) {
    const label = element("label", "supplier-payroll-field");
    label.append(element("span", "", labelText), input);
    return label;
  }
  function renderRubrics({ draft, options }, changed) {
    const { accounts } = options;
    const grid = element("div", "supplier-payroll-rubrics");
    for (const rubric of PAYROLL_RUBRICS) {
      const line = draft.lines.find((l) => l.rubric === rubric.id);
      const row = element("section", "supplier-payroll-rubric");
      row.dataset.payrollRubric = rubric.id;
      row.setAttribute("aria-label", rubric.label);
      row.append(element("h3", "", rubric.label));
      const quantity = element("input");
      quantity.type = "text";
      quantity.inputMode = "decimal";
      quantity.name = `${rubric.id}-quantity`;
      quantity.value = line.quantity;
      quantity.placeholder = "Quantidade";
      quantity.addEventListener("input", () => {
        line.quantity = quantity.value;
        updateCompletion();
        changed();
      });
      const value = element("input");
      value.type = "text";
      value.inputMode = "decimal";
      value.name = `${rubric.id}-value`;
      value.value = line.unitValue;
      value.placeholder = "Digite o valor";
      value.addEventListener("input", () => {
        line.unitValue = value.value;
        if (!line.unitValue.trim()) {
          line.account = null;
          account.value = "";
        }
        updateCompletion();
        changed();
      });
      const account = element("select");
      account.name = `${rubric.id}-account`;
      const blank = element("option", "", "Selecione");
      blank.value = "";
      account.append(blank);
      for (const option of accounts) {
        const item = element("option", "", option.label);
        item.value = option.id;
        account.append(item);
      }
      account.value = line.account?.id || "";
      account.addEventListener("change", () => {
        line.account = accounts.find((a) => a.id === account.value) || null;
        updateCompletion();
        changed();
      });
      const accountField = field("Forma de pagamento", account);
      const lineStatus = element("p", "supplier-payroll-line-status");
      lineStatus.setAttribute("data-payroll-line-status", "");
      lineStatus.setAttribute("role", "status");
      function updateCompletion() {
        const hasValue = String(line.unitValue ?? "").trim() !== "";
        let isZero = false;
        try { isZero = hasValue && payrollDecimal(line.unitValue).isZero(); } catch { /* Invalid values remain pending. */ }
        const needsPayment = hasValue && !isZero;
        (account.closest('.supplier-payroll-field') || accountField).hidden = !needsPayment;
        account.disabled = !needsPayment;
        account.required = needsPayment;
        const started = lineEdited(line);
        let complete = false;
        if (hasValue) {
          try {
            complete = payrollDecimal(line.quantity).gt(0) && payrollDecimal(line.unitValue).gt(0) &&
              Boolean(line.account?.id && line.account?.label);
            if (complete) payrollTotal([line]);
          } catch { complete = false; }
        }
        row.dataset.payrollCompletion = complete ? "complete" : started ? "pending" : "empty";
        lineStatus.hidden = !started;
        lineStatus.textContent = complete ? "✓ Completa — será incluída na folha" : isZero
          ? "Valor zero: esta rubrica não será enviada."
          : !hasValue
          ? "Pendente: informe o valor unitário desta rubrica."
          : "Pendente: confira quantidade, valor unitário e forma de pagamento.";
      }
      row.append(
        field("Quantidade", quantity),
        field("Valor unitário (R$)", value),
        accountField,
      );
      const attachments = element("div", "supplier-payroll-attachments");
      const fileList = element("ul", "supplier-payroll-file-list");
      const drawFiles = () => {
        fileList.replaceChildren();
        for (const file of line.files) {
          const item = element("li");
          item.append(element("span", "", file.name));
          const remove = button("×", null, () => {
            line.files = line.files.filter((f) => f !== file);
            drawFiles();
            updateCompletion();
            changed();
          });
          remove.setAttribute("aria-label", `Remover ${file.name}`);
          item.append(remove);
          fileList.append(item);
        }
      };
      drawFiles();
      const upload = button("📎 Comprovante", null, () => {
        if (receiptPicker) return;
        upload.focus();
        const attempt = epoch;
        receiptPicker = openPayrollReceiptPicker({
          root: page, label: rubric.label, files: line.files,
          getReceiptAttachments, readReceiptAttachment, pickReceiptAttachments,
          onConfirm: candidates => {
            assertSession();
            if (!opened || destroyed || attempt !== epoch || step !== "batch")
              throw new Error("Esta edição da folha foi encerrada.");
            line.files.push(...candidates);
            error.hidden = true;
            drawFiles();
            updateCompletion();
            changed();
          },
          onClose: () => { receiptPicker = null; },
        });
      });
      upload.dataset.payrollReceipts = rubric.id;
      attachments.append(upload, fileList);
      row.append(attachments);
      row.append(lineStatus);
      updateCompletion();
      grid.append(row);
    }
    return grid;
  }
  function renderSummary(container, draft) {
    const hasTax = draft.lines.some(line => payrollTaxType(line.payrollType));
    const detailsTable = (label, entries) => {
      const table = element("table", "supplier-payroll-summary-table");
      table.setAttribute("aria-label", label);
      const body = element("tbody");
      for (const [label, value] of entries) {
        const row = element("tr");
        const field = element("th", "", label);
        field.scope = "row";
        row.append(field, typeof value === "string" ? element("td", "", value) : value);
        body.append(row);
      }
      table.append(body);
      return table;
    };
    const context = element("div", "supplier-payroll-summary-context");
    if (draft.sheet && draft.lines.some(line => !payrollTaxType(line.payrollType))) context.append(detailsTable("Referência da folha", [
      ["Etapa", draft.stage.label],
      ["IDFOLHA", String(draft.sheet.id)],
      ["Referência", draft.sheet.label],
    ]));
    if (hasTax) context.append(detailsTable('Referência de INSS/FGTS', [
      ['Rubricas', 'INSS e FGTS'],
      ['Competência', `${draft.taxCompetence.slice(5)}/${draft.taxCompetence.slice(0,4)}`],
      ['IDFOLHA', String(draft.taxSheet.id)],
    ]));
    const list = element("div", "supplier-payroll-summary");
    for (const line of draft.lines) {
      const row = element("article");
      const receipts = element("td");
      if (line.files.length) {
        const files = element("ul", "supplier-payroll-summary-files");
        for (const file of line.files) files.append(element("li", "", file.name));
        receipts.append(files);
      } else receipts.textContent = "Sem comprovantes";
      row.append(
        element("h3", "", line.label),
        detailsTable(`Detalhes de ${line.label}`, [
          ["Quantidade", String(line.quantity)],
          ["Valor unitário", money(line.unitValue)],
          ["Subtotal", money(payrollTotal([line]))],
          ...(hasTax ? [['IDFOLHA', String((payrollTaxType(line.payrollType) ? draft.taxSheet : draft.sheet).id)]] : []),
          ["Forma de pagamento", line.account.label],
          ["Comprovantes", receipts],
        ]),
      );
      list.append(row);
    }
    const total = element("div", "supplier-payroll-summary-total");
    total.setAttribute("data-payroll-summary-total", "");
    total.append(
      element("span", "", "Total pago"),
      element("strong", "", money(draft.total)),
    );
    container.replaceChildren(context, list, total);
  }
function lineEdited(line) {
    return line.unitValue.trim() !== "" || line.quantity.trim() !== "1" ||
      Boolean(line.account || line.files.length);
  }
  function hasAmount(line) {
    if (!line.unitValue.trim()) return false;
    try { return payrollDecimal(line.unitValue).gt(0); }
    catch { return false; }
  }
  function validateEntry(draft) {
    for (const line of draft.lines) {
      const { label } = PAYROLL_RUBRICS.find(rubric => rubric.id === line.rubric);
      if (lineEdited(line) && !line.unitValue.trim())
        throw new Error("Informe o valor unitário de " + label + ".");
      if (line.files.length && !hasAmount(line))
        throw new Error("Informe um valor positivo para enviar os comprovantes de " + label + ".");
    }
    const validated = validatePayrollDraft(draft);
    if (validated.lines.every(line => payrollTaxType(line.payrollType))) validated.sheet = null;
    if (!validated.lines.some(line => payrollTaxType(line.payrollType))) {
      validated.taxSheet = null;
      validated.taxCompetence = "";
    }
    return validated;
  }
  function optionSelect(name, label, placeholder, onChange) {
    const select = element("select");
    select.name = name;
    select.setAttribute("aria-label", label);
    select.addEventListener("change", onChange);
    function setOptions(options, selected, format = option => option.label) {
      const empty = element("option", "", placeholder);
      empty.value = "";
      select.replaceChildren(empty, ...options.map(option => {
        const item = element("option", "", format(option));
        item.value = option.id;
        return item;
      }));
      select.value = selected?.id || "";
      select.disabled = options.length === 0;
    }
    return { select, field: field(label, select), setOptions };
  }
  const sheetLabel = option => (option.recommended ? "⭐ " : "") +
    "ID " + option.id + " — " + option.label;

  function buildEditor(entry, editor, changed, catalogOptions) {
    const { draft, options } = entry;
    const { signal } = catalogOptions;
    const locked = Boolean(entry.result || entry.progress.fingerprint);
    const info = identity(draft);
    const profession = info.querySelectorAll("td")[1];
    const fields = element("fieldset", "supplier-payroll-editor");
    fields.disabled = locked;
    const selectField = (name, label, placeholder, getChoices, format) => {
      const control = optionSelect(name, label, placeholder, () => {
        draft[name] = getChoices().find(option => option.id === control.select.value) || null;
        if (name === "product" && !draft.supplier.profession?.trim())
          profession.textContent = draft.product?.label || "—";
        onEdit();
      });
      control.setOptions(getChoices(), draft[name], format);
      return control;
    };
    const product = selectField("product", "Produto", "Selecione o produto", () => options.products,
      option => (option.recommended ? "⭐ " : "") + option.label);
    const stage = selectField("stage", "Etapa", "Selecione a etapa", () => options.stages);
    const sheet = selectField("sheet", "ID da folha a vincular", "Selecione o IDFOLHA",
      () => options.sheets, sheetLabel);
    const sheetNote = element("p", "supplier-payroll-field-note",
      "O IDFOLHA é obrigatório. Cadastre uma folha válida para este fornecedor.");
    sheetNote.setAttribute("role", "status");
    const reloadSheet = button("Atualizar IDFOLHA", "data-payroll-reload-sheet", async () => {
      reloadSheet.disabled = true;
      sheetNote.hidden = false;
      sheetNote.textContent = "Buscando folhas do fornecedor…";
      try {
        const choices = await data.loadSheets(draft.supplier, { ...catalogOptions, refreshCatalog: true });
        if (signal.aborted) return;
        assertSession();
        options.sheets = choices;
        draft.sheet = choices.find(option => option.id === draft.sheet?.id) || null;
        sheet.setOptions(choices, draft.sheet, sheetLabel);
        sheetNote.textContent = "O IDFOLHA é obrigatório. Cadastre uma folha válida para este fornecedor.";
        updateSheetFields();
        changed();
      } catch (cause) {
        if (!signal.aborted) sheetNote.textContent = cause?.message || "Não foi possível buscar o IDFOLHA.";
      } finally {
        reloadSheet.disabled = false;
      }
    });
    const tax = element("div", "supplier-payroll-tax");
    const month = element("input");
    month.type = "month";
    month.name = "taxCompetence";
    month.placeholder = "AAAA-MM";
    month.value = draft.taxCompetence;
    let taxRequest = 0;
    let taxOptions = [];
    const taxSheet = optionSelect("taxSheet", "ID da folha de INSS/FGTS", "Selecione o IDFOLHA", () => {
      draft.taxSheet = taxOptions.find(option => option.id === taxSheet.select.value) || null;
      changed(true);
    });
    const taxNote = element("p", "supplier-payroll-field-note");
    taxNote.setAttribute("role", "status");
    const retryTax = button("Atualizar IDFOLHA de INSS/FGTS", null, () => loadTaxSheets(true));
    retryTax.hidden = true;
    tax.append(field("Competência de INSS/FGTS", month), taxSheet.field, taxNote, retryTax);

    function showTaxOptions(choices) {
      taxOptions = choices.length === 1 ? choices : [];
      const previous = draft.taxSheet;
      draft.taxSheet = taxOptions.find(option => option.id === previous?.id) || null;
      taxSheet.setOptions(taxOptions, draft.taxSheet, sheetLabel);
      retryTax.hidden = locked || (choices.length === 1 && !entry.failure);
      taxNote.textContent = choices.length > 1
        ? "Há mais de um IDFOLHA nessa competência. Regularize o cadastro antes de postar."
        : choices.length === 0 ? "Cadastre um IDFOLHA para este fornecedor nessa competência." : "";
      if (previous !== draft.taxSheet) changed();
    }
    async function loadTaxSheets(refresh = false) {
      const request = ++taxRequest;
      const competence = payrollCompetenceMonth(draft.taxCompetence);
      retryTax.hidden = true;
      taxSheet.setOptions([], null);
      if (!competence) {
        taxNote.textContent = "Informe a competência de INSS/FGTS.";
        return;
      }
      const current = () => !signal.aborted && request === taxRequest &&
        payrollCompetenceMonth(draft.taxCompetence) === competence;
      if (!refresh && entry.taxOptions?.competence === competence) {
        showTaxOptions(entry.taxOptions.choices);
        return;
      }
      taxNote.textContent = "Buscando IDFOLHA de INSS/FGTS…";
      try {
        const choices = await data.loadSheets(draft.supplier, {
          ...catalogOptions, competence, refreshCatalog: refresh,
        });
        if (!current()) return;
        assertSession();
        entry.taxOptions = { competence, choices };
        showTaxOptions(choices);
      } catch (cause) {
        if (!current()) return;
        taxNote.textContent = cause?.message || "Não foi possível buscar o IDFOLHA de INSS/FGTS.";
        retryTax.hidden = false;
      }
    }
    month.addEventListener("input", () => {
      if (draft.taxCompetence === month.value) return;
      draft.taxCompetence = month.value;
      draft.taxSheet = null;
      changed(true);
    });
    month.addEventListener("change", () => {
      if (draft.taxCompetence !== month.value) {
        draft.taxCompetence = month.value;
        draft.taxSheet = null;
        changed(true);
      }
      void loadTaxSheets();
    });
    function updateSheetFields() {
      const taxActive = draft.lines.some(line => ["inss", "fgts"].includes(line.rubric) && hasAmount(line));
      const normalActive = !taxActive || draft.lines.some(line => !["inss", "fgts"].includes(line.rubric) && hasAmount(line));
      sheet.select.closest(".supplier-payroll-field").hidden = !normalActive;
      sheetNote.hidden = !normalActive || options.sheets.length > 0;
      reloadSheet.hidden = locked || !normalActive || (options.sheets.length > 0 && !entry.failure);
      if (!taxActive) {
        if (!tax.hidden) {
          taxRequest++;
          draft.taxSheet = null;
          draft.taxCompetence = "";
          month.value = "";
        }
        tax.hidden = true;
        return;
      }
      if (tax.hidden) {
        tax.hidden = false;
        if (!draft.taxCompetence) draft.taxCompetence = previousPayrollCompetence(draft.date);
        month.value = draft.taxCompetence;
        void loadTaxSheets();
      }
    }
    function onEdit() {
      updateSheetFields();
      changed(true);
    }
    tax.hidden = true;
    fields.append(product.field,
      element("h3", "", "Informe os valores de cada rubrica"),
      renderRubrics(entry, onEdit),
      stage.field, sheet.field, sheetNote, reloadSheet, tax);
    editor.replaceChildren(info, fields);
    pickers.push(bindSearchableFilterSelects(fields));
    updateSheetFields();
  }

  function clearPickers() {
    for (const picker of pickers) picker.destroy();
    pickers = [];
  }

  function renderBatch() {
    batchRequest = new AbortController();
    const { signal } = batchRequest;
    const catalogOptions = { signal, catalogCache: new Map() };
    const filter = element("input", "supplier-payroll-search");
    filter.type = "search";
    filter.value = search;
    filter.placeholder = "Digite para filtrar os fornecedores";
    filter.setAttribute("aria-label", "Filtrar fornecedores");
    const list = element("div", "supplier-payroll-choices");
    const empty = element("p", "supplier-payroll-empty");
    const total = element("p", "supplier-payroll-total");
    total.setAttribute("data-payroll-batch-total", "");
    total.setAttribute("aria-live", "polite");
    const feedback = element("p", "supplier-payroll-batch-feedback");
    feedback.setAttribute("role", "status");
    const post = button("Postar", "data-payroll-post", submit);
    post.classList.add("supplier-payroll-post");
    function refreshBatch() {
      const selected = entries.filter(entry => entry.selected && !entry.result);
      try {
        const amount = payrollTotal(selected.flatMap(entry => entry.validated?.lines || entry.draft.lines));
        total.textContent = "Total selecionado (" + selected.length + "): " + money(amount);
        post.disabled = selected.length === 0;
      } catch {
        total.textContent = "Total selecionado: confira os valores informados";
        post.disabled = false;
      }
      const posted = entries.filter(entry => entry.result);
      feedback.hidden = posted.length === 0;
      if (posted.length) {
        feedback.textContent = posted.length + (posted.length === 1 ? " folha postada" : " folhas postadas");
        try {
          feedback.textContent += " · Total postado: " +
            money(payrollTotal(posted.flatMap(entry => entry.result.lines)));
        } catch { /* The count and each supplier's total remain available. */ }
      }
      post.textContent = hasPendingPosting() ? "Retomar postagem" : "Postar";
    }
    async function submit() {
      const selected = entries.filter(entry => entry.selected && !entry.result);
      const queue = [];
      for (const entry of selected) {
        try {
          queue.push({ entry, validated: validateEntry(entry.draft) });
        } catch (cause) {
          entry.expanded = true;
          search = "";
          render();
          showError(new Error(entry.draft.supplier.label + " — " + cause.message));
          error.tabIndex = -1;
          error.focus();
          return;
        }
      }
      if (!queue.length) return;
      try {
        payrollTotal(queue.flatMap(({ validated }) => validated.lines));
      } catch (cause) {
        showError(cause);
        return;
      }
      return work(async (assertCurrent, { onProgress }) => {
        const failures = [];
        for (const [index, { entry, validated }] of queue.entries()) {
          try {
            entry.result = await data.post(validated, entry.progress, event =>
              onProgress({ percent: (index + (event?.percent || 0) / 100) * 100 / queue.length }));
            entry.selected = false;
            entry.failure = null;
          } catch (cause) {
            entry.failure = cause?.message || "Não foi possível postar a folha.";
            failures.push(entry.draft.supplier.label + " — " + entry.failure);
          }
          assertCurrent();
          onProgress({ percent: (index + 1) * 100 / queue.length });
        }
        if (failures.length) {
          search = "";
          throw new Error(failures.join(" · "));
        }
      }, "Postando folhas, comprovantes e vínculos…", true);
    }

    const cards = entries.map((entry, index) => {
      const { draft } = entry;
      const card = element("section", "supplier-payroll-card");
      card.dataset.payrollSupplier = draft.supplier.id;
      const row = element("div", "supplier-payroll-card-header");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("data-payroll-select", "");
      checkbox.setAttribute("aria-label", "Selecionar " + draft.supplier.label + " para postar");
      checkbox.disabled = Boolean(entry.result || entry.progress.fingerprint);
      const checkboxLabel = element("label", "supplier-payroll-card-select");
      checkboxLabel.append(checkbox);
      const expand = button("", "data-payroll-expand", () => setExpanded(!entry.expanded));
      expand.classList.add("supplier-payroll-card-toggle");
      const supplierName = element("strong", "", draft.supplier.label);
      const amount = element("span", "supplier-payroll-card-amount");
      amount.setAttribute("data-payroll-total", "");
      const status = element("span", "supplier-payroll-card-status");
      const caret = element("span", "supplier-payroll-card-caret", "⌄");
      caret.setAttribute("aria-hidden", "true");
      expand.append(supplierName, amount, status, caret);
      row.append(checkboxLabel, expand);
      const panel = element("div", "supplier-payroll-card-panel");
      panel.id = "supplier-payroll-" + id + "-supplier-" + index;
      expand.setAttribute("aria-controls", panel.id);
      const editor = element("div");
      const details = element("details", "supplier-payroll-review");
      const review = element("div");
      details.append(element("summary", "", "Resumo da folha"), review);
      const result = element("p", "supplier-payroll-card-result");
      result.hidden = !entry.result;
      if (entry.result) {
        const sheets = new Map([entry.result.sheet, entry.result.taxSheet]
          .filter(Boolean).map(sheet => [sheet.id, sheet]));
        result.textContent = "Folha postada e vinculada. " +
          [...sheets.values()].map(sheet => "IDFOLHA: " + sheet.id + " (" + sheet.label + ")").join(" · ") +
          ". Lançamentos: " + entry.result.lines.map(line => line.id).join(", ") + ".";
      }
      panel.append(editor, result, details);
      card.append(row, panel);
      list.append(card);

      function refresh(edited = false) {
        const started = Boolean(draft.product || draft.stage || draft.sheet || draft.taxSheet ||
          draft.taxCompetence || draft.lines.some(lineEdited));
        if (edited) {
          if (started) entry.selected = true;
          entry.failure = null;
          error.hidden = true;
        }
        let validated;
        let message = "";
        if (entry.selected || started || entry.result) {
          try { validated = validateEntry(draft); }
          catch (cause) { message = cause.message; }
        }
        entry.validated = validated;
        checkbox.checked = entry.selected;
        const state = entry.result ? "posted" : entry.selected && validated && !entry.failure
          ? "ready" : entry.selected || started ? "pending" : "empty";
        card.dataset.payrollState = state;
        status.textContent = entry.failure || (state === "ready" ? "Pronto para postar"
          : state === "posted" ? "Postado" : state === "empty" ? ""
          : !entry.selected ? "Fora da postagem" : message);
        try { amount.textContent = "Total pago: " + money(validated?.total ?? payrollTotal(draft.lines)); }
        catch { amount.textContent = "Total pago: confira os valores"; }
        details.hidden = !validated;
        if (validated) renderSummary(review, validated);
      }
      checkbox.addEventListener("change", () => {
        entry.selected = checkbox.checked;
        error.hidden = true;
        refresh();
        refreshBatch();
        if (entry.selected) setExpanded(true);
      });

      let editorReady = false;
      async function loadEditor() {
        if (editorReady || signal.aborted) return;
        editorReady = true;
        try {
          if (!entry.options) {
            editor.replaceChildren(createLoadingIndicator(doc, "Carregando opções do fornecedor…"));
            const [products, accounts, stages, sheets] = await Promise.all([
              data.loadProducts(draft.supplier, catalogOptions),
              data.loadAccounts(catalogOptions),
              data.loadStages(draft.supplier, catalogOptions),
              data.loadSheets(draft.supplier, catalogOptions),
            ]);
            if (signal.aborted) return;
            assertSession();
            entry.options = { products, accounts, stages, sheets };
          }
          buildEditor(entry, editor, edited => {
            refresh(edited);
            refreshBatch();
          }, catalogOptions);
        } catch (cause) {
          if (signal.aborted) return;
          editorReady = false;
          const notice = element("p", "supplier-payroll-error", cause?.message || "Não foi possível carregar o fornecedor.");
          notice.setAttribute("role", "alert");
          editor.replaceChildren(notice, button("Tentar novamente", "data-payroll-retry-options", loadEditor));
        }
      }
      function setExpanded(expanded) {
        entry.expanded = expanded;
        expand.setAttribute("aria-expanded", String(expanded));
        panel.hidden = !expanded;
        if (expanded) void loadEditor();
      }
      setExpanded(entry.expanded);
      refresh();
      return { card, name: normalizeSearchText(draft.supplier.label) };
    });
    function filterSuppliers() {
      search = filter.value;
      const query = normalizeSearchText(search);
      for (const { card, name } of cards) card.hidden = !includesSearchText(name, query);
      empty.hidden = cards.some(({ card }) => !card.hidden);
      empty.textContent = cards.length ? "Nenhum fornecedor corresponde à pesquisa." : "Nenhum fornecedor cadastrado disponível.";
    }
    filter.addEventListener("input", filterSuppliers);
    filterSuppliers();
    refreshBatch();
    content.append(filter, list, empty, total, feedback, post);
  }

  async function next() {
    error.hidden = true;
    if (!validPayrollDate(date)) {
      showError(new Error("Selecione uma data válida."));
      return;
    }
    if (entries[0]?.draft.date === date) {
      step = "batch";
      render();
      focus();
      return;
    }
    return work(async (assertCurrent, options) => {
      const loaded = await data.loadSuppliers(options);
      assertCurrent();
      entries = loaded.map(makeEntry);
      search = "";
      step = "batch";
    });
  }
  function navigateBack() {
    if (destroyed || !opened || mutating) return;
    if (step === "date" || hasPendingPosting()) {
      close();
      return;
    }
    step = "date";
    error.hidden = true;
    render();
    focus();
  }
  function render(loadingLabel) {
    batchRequest?.abort();
    receiptPicker?.close();
    clearPickers();
    content.replaceChildren();
    footer.replaceChildren();
    footer.hidden = true;
    backButton.disabled = mutating;
    homeButton.disabled = mutating;
    if (busy) {
      const snapshot = loadingOperation?.snapshot;
      const loader = createLoadingIndicator(doc, loadingLabel || "Carregando folha…",
        { progress: snapshot?.percent, progressLabel: snapshot?.progressLabel });
      if (loadingOperation) loadingOperation.loader = loader;
      content.append(loader);
      return;
    }
    if (step === "batch") {
      content.append(element("h2", "supplier-payroll-question", "Selecione os fornecedores para a folha de pagamento"));
      renderBatch();
      return;
    }
    content.append(element("h2", "supplier-payroll-question", "Qual é a data da folha de pagamento?"));
    const input = element("input");
    input.type = "date";
    input.name = "date";
    input.value = date;
    input.addEventListener("input", () => { date = input.value; });
    content.append(field("Data", input));
    footer.append(button("Continuar", "data-payroll-next", next));
    footer.hidden = false;
  }

  function close() {
    if (destroyed || !opened || mutating) return false;
    opened = false;
    loadingOperation?.abort.abort();
    batchRequest?.abort();
    epoch++;
    busy = false;
    page.hidden = true;
    receiptPicker?.close();
    clearPickers();
    previousFocus?.focus?.();
    onClose();
    return true;
  }
  function keydown(event) {
    if (!opened) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key === "Tab") {
      const focusable = [
        ...page.querySelectorAll(
          "button, input:not([type=file]), select, summary",
        ),
      ].filter((el) => !el.matches(":disabled, [tabindex=\"-1\"]") && !el.closest("[hidden], [inert]") &&
        (!el.closest("details:not([open])") || el.matches("summary")));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  page.addEventListener("keydown", keydown);
  return Object.freeze({
    async open() {
      if (destroyed) return false;
      assertSession();
      if (opened) return true;
      previousFocus = doc.activeElement;
      opened = true;
      epoch++;
      busy = false;
      mutating = false;
      page.hidden = false;
      error.hidden = true;
      render();
      focus();
      return true;
    },
    close,
    destroy() {
      loadingOperation?.abort.abort();
      batchRequest?.abort();
      receiptPicker?.close();
      clearPickers();
      destroyed = true;
      opened = false;
      epoch++;
      page.removeEventListener("keydown", keydown);
      page.remove();
      entries = [];
    },
  });
}
