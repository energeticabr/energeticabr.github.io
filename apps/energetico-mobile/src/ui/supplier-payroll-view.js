import {
  PAYROLL_RUBRICS,
  payrollTotal,
  validPayrollDate,
  validatePayrollDraft,
} from "../chat/supplier-payroll.js";
import { createLoadingIndicator } from "./loading-indicator.js";
import { validateAttachment } from "../../../../portal/data/attachments.js";
const money = (value) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
let sequence = 0;
export function createSupplierPayrollView({
  data,
  root,
  documentRef = globalThis.document,
  onClose = () => {},
  assertSession = () => {},
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
  const closeButton = element("button", "supplier-payroll-button", "Fechar");
  closeButton.type = "button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
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
    const summary = element(
      "p",
      "supplier-payroll-identity",
      `${draft.supplier?.label || ""} · ${draft.product?.label || ""} · ${draft.date.split("-").reverse().join("/")} · ${draft.supplier?.branch || ""}`,
    );
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
      });
      row.append(
        field("Quantidade", quantity),
        field("Valor unitário (R$)", value),
        field("Forma de pagamento", account),
      );
      const attachments = element("div", "supplier-payroll-attachments");
      const fileInput = element("input", "sr-only");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.name = `${rubric.id}-files`;
      fileInput.setAttribute("aria-label", `Comprovantes de ${rubric.label}`);
      const fileList = element("ul", "supplier-payroll-file-list");
      const drawFiles = () => {
        fileList.replaceChildren();
        for (const file of line.files) {
          const item = element("li");
          item.append(element("span", "", file.name));
          const remove = button("×", null, () => {
            line.files = line.files.filter((f) => f !== file);
            drawFiles();
          });
          remove.setAttribute("aria-label", `Remover ${file.name}`);
          item.append(remove);
          fileList.append(item);
        }
      };
      drawFiles();
      fileInput.addEventListener("change", () => {
        try {
          const candidates = [...fileInput.files];
          for (const file of candidates) {
            const valid = validateAttachment(file);
            if (!valid.valid) throw new Error(valid.message);
            if (
              [...line.files, ...candidates.filter((f) => f !== file)].some(
                (f) => f.name === file.name,
              )
            )
              throw new Error(
                "Já existe um comprovante com esse nome na rubrica.",
              );
          }
          line.files.push(...candidates);
          error.hidden = true;
          drawFiles();
        } catch (cause) {
          showError(cause);
        }
        fileInput.value = "";
      });
      const upload = button("📎 Comprovante", null, () => fileInput.click());
      attachments.append(upload, fileInput, fileList);
      row.append(attachments);
      grid.append(row);
    }
    content.append(grid);
    const total = element("p", "supplier-payroll-total");
    total.setAttribute("data-payroll-total", "");
    total.setAttribute("aria-live", "polite");
    content.append(total);
    updateTotal();
  }
  function summary() {
    heading("Resumo da folha");
    identity();
    const list = element("div", "supplier-payroll-summary");
    for (const line of validatePayrollDraft(draft).lines) {
      const row = element("article");
      row.append(
        element("strong", "", line.label),
        element(
          "p",
          "",
          `${line.quantity} × ${money(line.unitValue)} = ${money(payrollTotal([line]))}`,
        ),
        element("p", "", `Forma de pagamento: ${line.account.label}`),
        element(
          "small",
          "",
          line.files.length
            ? `Comprovantes: ${line.files.map((f) => f.name).join(", ")}`
            : "Sem comprovantes",
        ),
      );
      list.append(row);
    }
    content.append(
      element("p", "", `Etapa: ${draft.stage.label}`),
      list,
      element(
        "p",
        "supplier-payroll-total",
        `Total pago: ${money(payrollTotal(draft.lines))}`,
      ),
    );
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
        validatePayrollDraft({
          ...draft,
          stage: { id: "pending", label: "a selecionar" },
        });
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
      summary: "stage",
    }[step];
    if (previous) {
      step = previous;
      error.hidden = true;
      render();
      focus();
    }
  }
  function render(loadingLabel) {
    content.replaceChildren();
    footer.replaceChildren();
    closeButton.disabled = mutating;
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
      choiceList(stages, (option) => {
        draft.stage = option;
        step = "summary";
        render();
        focus();
      });
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
                step = "link";
              },
              "Postando lançamentos e comprovantes…",
              true,
            ),
        ),
      );
    }
    if (step === "link") {
      heading("Deseja vincular os lançamentos ao IDFOLHA do fornecedor?");
      content.append(
        element(
          "p",
          "",
          `Lançamentos gravados: ${result.lines.map((l) => l.id).join(", ")}.`,
        ),
      );
      footer.append(
        button("Sim", "data-payroll-link-yes", () =>
          work(async (assertCurrent) => {
            const loaded = await data.loadSheets(draft.supplier);
            assertCurrent();
            sheets = loaded;
            step = "sheet";
          }),
        ),
        button("Não", "data-payroll-link-no", () => {
          step = "done";
          render();
        }),
      );
    }
    if (step === "sheet") {
      heading(`Qual IDFOLHA de ${draft.supplier.label} deseja utilizar?`);
      choiceList(sheets, (option) =>
        work(
          async (assertCurrent) => {
            await data.linkPayroll(result, option.id, progress);
            assertCurrent();
            step = "linked";
          },
          "Vinculando rubricas à folha…",
          true,
        ),
      );
      if (!sheets.length) {
        content.append(
          element(
            "p",
            "",
            "O fornecedor não possui folha do mês vigente, anterior ou próximo. Os lançamentos estão gravados e permanecem sem vínculo.",
          ),
        );
        footer.append(
          button("Concluir", null, () => {
            step = "done";
            render();
          }),
        );
      }
    }
    if (step === "done" || step === "linked") {
      heading(
        step === "linked"
          ? "Folha postada e vinculada ao IDFOLHA"
          : "Folha postada",
      );
      content.append(
        element(
          "p",
          "",
          `Lançamentos: ${result.lines.map((l) => l.id).join(", ")}.`,
        ),
        element(
          "p",
          "supplier-payroll-total",
          `Total pago: ${money(payrollTotal(draft.lines))}`,
        ),
      );
      footer.append(button("Concluir", null, close));
    }
    if (
      ["supplier", "product", "rubrics", "stage", "summary"].includes(step) &&
      !progress.fingerprint
    )
      footer.prepend(button("Voltar", "data-payroll-back", back));
    if (["date", "rubrics"].includes(step))
      footer.append(button("Continuar", "data-payroll-next", next));
  }
  function close() {
    if (destroyed || !opened || mutating) return false;
    opened = false;
    epoch++;
    busy = false;
    page.hidden = true;
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
      if (["done", "linked"].includes(step)) fresh();
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
