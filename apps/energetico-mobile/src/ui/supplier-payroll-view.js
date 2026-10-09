import { applyScreenNavigation } from "./screen-navigation.js";
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import {
  PAYROLL_RUBRICS,
  payrollTotal,
  payrollDecimal,
  validPayrollDate,
  validatePayrollDraft,
  validatePayrollLines,
} from "../chat/supplier-payroll.js";
import { createLoadingIndicator } from "./loading-indicator.js";
import { openPayrollReceiptPicker } from "./payroll-receipt-picker.js";
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
      fresh();
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
  let destroyed = false,
    opened = false,
    busy = false,
    mutating = false,
    epoch = 0,
    step = "date",
    draft,
    progress,
    result = null,
    previousFocus = null;
  let accountPickers = null;
  let receiptPicker = null;
  let suppliers = [],
    products = [],
    accounts = [],
    stages = [],
    sheets = [];
  const fresh = () => {
    draft = {
      date: "",
      supplier: null,
      product: null,
      stage: null,
      sheet: null,
      lines: PAYROLL_RUBRICS.map((r) => ({
        rubric: r.id,
        quantity: "1",
        unitValue: "",
        account: null,
        files: [],
      })),
    };
    progress = {
      operationId:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    result = null;
    step = "date";
  };
  fresh();
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
      await action(assertCurrent);
      assertCurrent();
      busy = false;
      mutating = false;
      render();
      focus();
      return true;
    } catch (cause) {
      if (!destroyed && opened && attempt === epoch) {
        busy = false;
        mutating = false;
        render();
        showError(cause);
      }
      return false;
    }
  }
  function heading(text) {
    content.append(element("h2", "supplier-payroll-question", text));
  }
  function identity() {
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
    content.append(summary);
  }
  function choiceList(options, select) {
    const filter = element("input", "supplier-payroll-search");
    filter.type = "search";
    filter.placeholder = "Digite para filtrar as opções";
    filter.setAttribute("aria-label", "Filtrar opções");
    const list = element("div", "supplier-payroll-choices");
    const buttons = [];
    for (const option of options) {
      const el = button(
        `${option.recommended ? "⭐ " : ""}${option.label}${step === "sheet" ? ` — ID ${option.id}` : ""}`,
        null,
        () => select(option),
      );
      el.dataset.payrollOption = option.id;
      list.append(el);
      buttons.push([el, option.label]);
    }
    const empty = element(
      "p",
      "supplier-payroll-empty",
      options.length
        ? "Nenhuma opção corresponde à pesquisa."
        : "Nenhuma opção cadastrada disponível.",
    );
    empty.hidden = options.length > 0;
    filter.addEventListener("input", () => {
      const search = filter.value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      let visible = 0;
      for (const [el, label] of buttons) {
        el.hidden = !label
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .includes(search);
        if (!el.hidden) visible++;
      }
      empty.hidden = visible > 0;
    });
    content.append(filter, list, empty);
  }
  function field(labelText, input) {
    const label = element("label", "supplier-payroll-field");
    label.append(element("span", "", labelText), input);
    return label;
  }
  function updateTotal() {
    try {
      content.querySelector("[data-payroll-total]").textContent =
        `Total pago: ${money(payrollTotal(draft.lines))}`;
    } catch {
      content.querySelector("[data-payroll-total]").textContent =
        "Total pago: confira os valores informados";
    }
  }
  function renderRubrics() {
    heading("Informe os valores de cada rubrica");
    identity();
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
        updateTotal();
      });
      const value = element("input");
      value.type = "text";
      value.inputMode = "decimal";
      value.name = `${rubric.id}-value`;
      value.value = line.unitValue;
      value.placeholder = "Digite o valor";
      value.addEventListener("input", () => {
        line.unitValue = value.value;
        updateCompletion();
        updateTotal();
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
        const started = hasValue || String(line.quantity).trim() !== "1" || line.account || line.files.length;
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
          ? "Pendente: sem valor unitário, esta rubrica não será enviada."
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
            if (!opened || destroyed || attempt !== epoch || step !== "rubrics")
              throw new Error("Esta edição da folha foi encerrada.");
            line.files.push(...candidates);
            error.hidden = true;
            drawFiles();
            updateCompletion();
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
    content.append(grid);
    accountPickers = bindSearchableFilterSelects(grid);
    const total = element("p", "supplier-payroll-total");
    total.setAttribute("data-payroll-total", "");
    total.setAttribute("aria-live", "polite");
    content.append(total);
    updateTotal();
  }
  function summary() {
    heading("Resumo da folha");
    identity();
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
    context.append(detailsTable("Referência da folha", [
      ["Etapa", draft.stage.label],
      ["IDFOLHA", String(draft.sheet.id)],
      ["Referência", draft.sheet.label],
    ]));
    const list = element("div", "supplier-payroll-summary");
    for (const line of validatePayrollDraft(draft).lines) {
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
      element("strong", "", money(payrollTotal(draft.lines))),
    );
    content.append(context, list, total);
  }
  async function next() {
    error.hidden = true;
    if (step === "date") {
      if (!validPayrollDate(draft.date)) {
        showError(new Error("Selecione uma data válida."));
        return;
      }
      return work(async (assertCurrent) => {
        const loaded = await data.loadSuppliers();
        assertCurrent();
        suppliers = loaded;
        step = "supplier";
      });
    }
    if (step === "rubrics") {
      try {
        validatePayrollLines(draft.lines);
      } catch (cause) {
        showError(cause);
        return;
      }
      return work(async (assertCurrent) => {
        const loaded = await data.loadStages(draft.supplier);
        assertCurrent();
        stages = loaded;
        step = "stage";
      });
    }
  }
  function back() {
    if (progress.fingerprint) return;
    const previous = {
      supplier: "date",
      product: "supplier",
      rubrics: "product",
      stage: "rubrics",
      sheet: "stage",
      summary: "sheet",
    }[step];
    if (previous) {
      step = previous;
      error.hidden = true;
      render();
      focus();
    }
  }
  function navigateBack() {
    if (destroyed || !opened || mutating) return;
    if (step === "date" || step === "linked" || progress.fingerprint) {
      close();
      return;
    }
    if (busy) {
      epoch++;
      busy = false;
    }
    back();
  }
  function render(loadingLabel) {
    receiptPicker?.close();
    accountPickers?.destroy(); accountPickers = null;
    content.replaceChildren();
    footer.replaceChildren();
    footer.classList.toggle("supplier-payroll-footer--rubrics", step === "rubrics");
    footer.hidden = true;
    backButton.disabled = mutating;
    homeButton.disabled = mutating;
    if (busy) {
      content.append(
        createLoadingIndicator(doc, loadingLabel || "Carregando folha…"),
      );
      return;
    }
    if (step === "date") {
      heading("Qual é a data da folha de pagamento?");
      const input = element("input");
      input.type = "date";
      input.name = "date";
      input.value = draft.date;
      input.addEventListener("input", () => {
        draft.date = input.value;
      });
      content.append(field("Data", input));
    }
    if (step === "supplier") {
      heading("DESEJA EFETUAR A FOLHA DE QUAL FORNECEDOR?");
      choiceList(suppliers, (option) =>
        work(async (assertCurrent) => {
          const loaded = await data.loadProducts(option);
          assertCurrent();
          if (draft.supplier?.id !== option.id) {
            draft.lines = PAYROLL_RUBRICS.map((r) => ({
              rubric: r.id,
              quantity: "1",
              unitValue: "",
              account: null,
              files: [],
            }));
            draft.stage = null;
            draft.sheet = null;
            draft.product = null;
          }
          draft.supplier = option;
          products = loaded;
          step = "product";
        }),
      );
    }
    if (step === "product") {
      heading("Qual produto deseja utilizar?");
      content.append(
        element(
          "p",
          "",
          `Fornecedor: ${draft.supplier.label}. ⭐ Profissão do fornecedor.`,
        ),
      );
      choiceList(products, (option) =>
        work(async (assertCurrent) => {
          const loaded = await data.loadAccounts();
          assertCurrent();
          draft.product = option;
          accounts = loaded;
          step = "rubrics";
        }),
      );
    }
    if (step === "rubrics") renderRubrics();
    if (step === "stage") {
      heading("Indique a etapa");
      identity();
      choiceList(stages, (option) =>
        work(async (assertCurrent) => {
          const loaded = await data.loadSheets(draft.supplier);
          assertCurrent();
          draft.stage = option;
          draft.sheet = null;
          sheets = loaded;
          step = "sheet";
        }),
      );
    }
    if (step === "summary") {
      summary();
      footer.append(
        button(
          progress.fingerprint ? "Retomar postagem" : "Postar",
          "data-payroll-post",
          () =>
            work(
              async (assertCurrent) => {
                const posted = await data.post(
                  validatePayrollDraft(draft),
                  progress,
                );
                assertCurrent();
                result = posted;
                step = "linked";
              },
              "Postando lançamentos, comprovantes e vínculo ao IDFOLHA…",
              true,
            ),
        ),
      );
    }
    if (step === "sheet") {
      heading(`Qual IDFOLHA de ${draft.supplier.label} deseja utilizar?`);
      content.append(
        element(
          "p",
          "",
          "O IDFOLHA é obrigatório. Selecione a folha que receberá todas as rubricas.",
        ),
      );
      choiceList(sheets, (option) => {
        draft.sheet = option;
        step = "summary";
        render();
        focus();
      });
      if (!sheets.length) {
        content.append(
          element(
            "p",
            "",
            "O fornecedor não possui folha do mês vigente, anterior ou próximo. Cadastre um IDFOLHA válido para esse fornecedor e volte para selecioná-lo antes de postar.",
          ),
        );
      }
    }
    if (step === "linked") {
      heading("Folha postada e vinculada ao IDFOLHA");
      content.append(
        element(
          "p",
          "",
          `IDFOLHA: ${result.sheet.id} · Referência: ${result.sheet.label}. Lançamentos: ${result.lines.map((l) => l.id).join(", ")}.`,
        ),
        element(
          "p",
          "supplier-payroll-total",
          `Total pago: ${money(payrollTotal(draft.lines))}`,
        ),
      );
      footer.append(button("Concluir", null, close));
    }
    if (step === "rubrics")
      footer.append(button("Voltar", "data-payroll-back", navigateBack));
    if (["date", "rubrics"].includes(step))
      footer.append(button("Continuar", "data-payroll-next", next));
    footer.hidden = footer.childElementCount === 0;
  }
  function close() {
    if (destroyed || !opened || mutating) return false;
    opened = false;
    epoch++;
    busy = false;
    page.hidden = true;
    receiptPicker?.close();
    accountPickers?.close();
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
          "button:not([disabled]),input:not([type=file]),select",
        ),
      ].filter((el) => !el.hidden && !el.closest("[hidden]"));
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
      if (step === "linked") fresh();
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
      receiptPicker?.close();
      accountPickers?.destroy(); accountPickers = null;
      destroyed = true;
      opened = false;
      epoch++;
      page.removeEventListener("keydown", keydown);
      page.remove();
      draft = null;
      progress = null;
      result = null;
      suppliers = products = accounts = stages = sheets = [];
    },
  });
}
