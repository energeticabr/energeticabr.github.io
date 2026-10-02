import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import {
  createSharePointAttachmentTransport,
  validateAttachment,
} from "../../../../portal/data/attachments.js";
import { payrollKey as key, validatePayrollDraft } from "./supplier-payroll.js";
const SITE = "personal";
const scalar = (value) =>
  value && typeof value === "object"
    ? String(value.LookupValue ?? value.Value ?? value.value ?? "")
    : String(value ?? "");
const SOURCES = {
  FORNECEDORES: {
    label: ["CADASTRO", "FORNECEDOR"],
    status: ["STATUS"],
    contractor: ["EMPREITEIRO"],
    branch: ["FILIAL"],
    profession: ["PROFISSAO"],
  },
  CADASTROPRODUTO: {
    label: ["PRODUTO"],
    status: ["SATUS", "STATUS"],
    type: ["TIPO"],
    unit: ["UNIDADE"],
    expenseType: ["TIPODESPESA"],
  },
  CADASTROCONTA: { label: ["CONTA"] },
  LANCAMENTOOBRA: { label: ["ETAPA"], branch: ["FILIAL"] },
  IDFOLHA: {
    label: ["MESREFERENCIA", "MES REFERENCIA"],
    supplier: ["FORNECEDOR"],
  },
};
function column(columns, aliases, required = true) {
  const found = aliases.flatMap((alias) =>
    columns.filter((c) =>
      [c.name, c.displayName].some((n) => key(n) === key(alias)),
    ),
  )[0];
  if (!found && required)
    throw new Error(
      `O campo ${aliases[0]} não foi identificado no SharePoint.`,
    );
  return found;
}
function monthKey(value) {
  const source = String(value || "").trim();
  let m = source.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m)
    return Number(m[1]) >= 1 && Number(m[1]) <= 12
      ? `${m[2]}-${m[1].padStart(2, "0")}`
      : "";
  m = source.match(/^(\d{4})[-/](\d{1,2})(?:[-/].*)?$/);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12
    ? `${m[1]}-${m[2].padStart(2, "0")}`
    : "";
}
function currentMonth(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}
function shiftMonth(value, delta) {
  const [y, m] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
export function createSupplierPayrollData({
  repository,
  tokenProvider,
  siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  assertSession = () => {},
} = {}) {
  if (!repository) {
    if (typeof tokenProvider !== "function")
      throw new TypeError("A folha requer uma sessão Microsoft ativa.");
    const graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    const attachmentTransport = createSharePointAttachmentTransport({
      tokenProvider,
      allowedSites: Object.values(siteConfig),
      fetch: fetchImpl,
    });
    repository = createSharePointRepository(graph, siteConfig, {
      attachmentTransport,
    });
  }
  const descriptions = new Map();
  let posting = false,
    linking = false;
  async function prepare() {
    assertSession();
    if (typeof tokenProvider !== "function") return;
    // Consent happens before entering any values or creating financial rows.
    const permissions = [
      ["Sites.Read.All", "Sites.ReadWrite.All"],
      [
        `https://${siteConfig[SITE].host}/AllSites.Read`,
        `https://${siteConfig[SITE].host}/AllSites.Write`,
      ],
    ];
    for (const scopes of permissions) {
      const token = await tokenProvider(scopes);
      assertSession();
      if (!token)
        throw new Error(
          "Não foi possível autorizar a folha e seus comprovantes.",
        );
    }
  }
  async function describe(name) {
    assertSession();
    if (descriptions.has(name)) return descriptions.get(name);
    const list = await repository.resolveList(SITE, [name]);
    if (!list?.id) throw new Error(`A lista ${name} não foi encontrada.`);
    const columns = await repository.getColumns(SITE, list.id);
    assertSession();
    const descriptor = { name, id: list.id, columns };
    descriptions.set(name, descriptor);
    return descriptor;
  }
  async function all(descriptor, filter = "") {
    const items = [];
    let cursor;
    const seen = new Set();
    for (let page = 1; page <= 100; page++) {
      assertSession();
      const response = await repository.getItemsPage(
        SITE,
        descriptor.id,
        `$expand=fields&$top=100${filter ? `&$filter=${filter}` : ""}`,
        {
          pageNumber: page,
          maxPages: 100,
          cursor,
          headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
        },
      );
      assertSession();
      items.push(...(response.items || []));
      if (!response.hasMore) return items;
      if (!response.nextLink || seen.has(response.nextLink))
        throw new Error("A consulta da folha não pôde ser concluída.");
      seen.add(response.nextLink);
      cursor = response.nextLink;
    }
    throw new Error("Há mais registros do que o limite da consulta da folha.");
  }
  async function source(name) {
    const descriptor = await describe(name);
    const definitions = SOURCES[name];
    const resolved = Object.fromEntries(
      Object.entries(definitions).map(([k, aliases]) => [
        k,
        column(
          descriptor.columns,
          aliases,
          !["unit", "expenseType", "profession"].includes(k),
        ),
      ]),
    );
    return (await all(descriptor))
      .map((item) => ({
        id: String(item.id),
        ...Object.fromEntries(
          Object.entries(resolved).map(([k, c]) => [
            k,
            c ? scalar(item.fields?.[c.name]) : "",
          ]),
        ),
      }))
      .filter((item) => /^[1-9]\d*$/.test(item.id) && item.label);
  }
  const loadSuppliers = async () =>
    (await source("FORNECEDORES"))
      .filter((s) => key(s.status) === "ATIVO" && key(s.contractor) === "SIM")
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const loadProducts = async (supplier) =>
    (await source("CADASTROPRODUTO"))
      .filter((p) => key(p.status) === "ATIVO" && key(p.type) === "DESPESA")
      .map((p) => ({
        ...p,
        recommended:
          Boolean(supplier.profession) &&
          key(p.label) === key(supplier.profession),
      }))
      .sort(
        (a, b) =>
          Number(b.recommended) - Number(a.recommended) ||
          a.label.localeCompare(b.label, "pt-BR"),
      );
  const loadAccounts = async () => source("CADASTROCONTA");
  const loadStages = async (supplier) =>
    (await source("LANCAMENTOOBRA")).filter(
      (s) => key(s.branch) === key(supplier.branch),
    );
  const registeredSheets = async (supplier) =>
    (await source("IDFOLHA")).filter(
      (s) => key(s.supplier) === key(supplier.label),
    );
  async function loadSheets(supplier) {
    const current = currentMonth(now());
    const order = [current, shiftMonth(current, 1), shiftMonth(current, -1)];
    return (await registeredSheets(supplier))
      .filter((s) => order.includes(monthKey(s.label)))
      .map((s) => ({ ...s, recommended: monthKey(s.label) === current }))
      .sort(
        (a, b) =>
          order.indexOf(monthKey(a.label)) - order.indexOf(monthKey(b.label)),
      );
  }
  function writableColumn(descriptor, label, required = true) {
    const c = column(descriptor.columns, [label], required);
    if (!c) return null;
    if (c.readOnly || c.calculated)
      throw new Error(`O campo ${label} não permite gravação.`);
    if (c.lookup || c.personOrGroup)
      throw new Error(
        `O campo ${label} requer um vínculo relacional que não foi identificado.`,
      );
    return c;
  }
  function fieldsFor(descriptor, values, optional = []) {
    const result = {};
    for (const [label, value] of Object.entries(values)) {
      const c = writableColumn(descriptor, label, !optional.includes(label));
      if (!c) continue;
      if (
        c.choice?.choices?.length &&
        c.choice.allowTextEntry !== true &&
        !c.choice.choices.some((v) => key(v) === key(value))
      )
        throw new Error(`O valor de ${label} não está cadastrado.`);
      result[c.name] = c.boolean
        ? value === true || ["SIM", "TRUE", "1"].includes(key(value))
        : c.dateTime && /^\d{4}-\d{2}-\d{2}$/.test(String(value))
          ? `${value}T12:00:00Z`
          : value;
    }
    return result;
  }
  async function findToken(descriptor, tokenColumn, token) {
    const filter = `fields/${tokenColumn.name} eq '${token.replace(/'/g, "''")}'`;
    let rows;
    try {
      rows = await all(descriptor, filter);
    } catch (error) {
      if (error?.status !== 400) throw error;
      rows = await all(descriptor);
    }
    const matches = rows.filter(
      (r) => String(r.fields?.[tokenColumn.name] || "") === token,
    );
    if (matches.length > 1)
      throw new Error(
        "Mais de um registro foi encontrado para a mesma rubrica.",
      );
    return matches[0];
  }
  async function ensure(descriptor, fields, tokenLabel, token) {
    const c = column(descriptor.columns, [tokenLabel]);
    let item = await findToken(descriptor, c, token);
    if (!item) {
      assertSession();
      item = await repository.createItem(SITE, descriptor.id, {
        ...fields,
        [c.name]: token,
      });
      assertSession();
    }
    if (!/^[1-9]\d*$/.test(String(item?.id)))
      throw new Error("O SharePoint não confirmou o ID do registro.");
    const saved = await repository.getItem(
      SITE,
      descriptor.id,
      item.id,
      "$expand=fields",
    );
    assertSession();
    for (const [name, value] of Object.entries({
      ...fields,
      [c.name]: token,
    })) {
      const actual = saved?.fields?.[name];
      const equal =
        typeof value === "number"
          ? Number(actual) === value
          : String(actual ?? "") === String(value) ||
            (descriptor.columns.find((c) => c.name === name)?.dateTime &&
              String(actual || "").slice(0, 10) === String(value).slice(0, 10));
      if (!equal)
        throw new Error(
          "O SharePoint não confirmou todos os dados da rubrica.",
        );
    }
    return String(item.id);
  }
  function operation(progress) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(String(progress?.operationId || "")))
      throw new Error("A operação da folha não foi identificada.");
  }
  function payrollValues(result, sheet, line) {
    return {
      FORNECEDOR: result.supplier.label,
      TIPOPGTO: line.payrollType,
      VALORUNITARIO: line.unitValue,
      QTD: line.quantity,
      DATA: result.date,
      IDFOLHA: Number(sheet.id),
    };
  }
  async function post(rawDraft, progress) {
    if (posting) throw new Error("A folha já está sendo postada.");
    operation(progress);
    posting = true;
    try {
      const draft = validatePayrollDraft(rawDraft);
      const fingerprint = JSON.stringify({
        ...draft,
        lines: draft.lines.map((l) => ({
          ...l,
          files: l.files.map((f) => ({
            name: f.name,
            size: f.size,
            lastModified: f.lastModified,
          })),
        })),
      });
      if (progress.fingerprint && progress.fingerprint !== fingerprint)
        throw new Error(
          "A folha não pode ser alterada depois de iniciar a postagem.",
        );
      const suppliers = await loadSuppliers();
      const supplier = suppliers.find((s) => s.id === draft.supplier.id);
      if (
        !supplier ||
        key(supplier.label) !== key(draft.supplier.label) ||
        key(supplier.branch) !== key(draft.supplier.branch)
      )
        throw new Error(
          "O fornecedor ou sua filial foi alterado; revise o cadastro.",
        );
      const [products, accounts, stages, sheets] = await Promise.all([
        loadProducts(supplier),
        loadAccounts(),
        loadStages(supplier),
        // Once posting starts, keep its validated sheet across month rollover.
        progress.fingerprint
          ? registeredSheets(supplier)
          : loadSheets(supplier),
      ]);
      const product = products.find((p) => p.id === draft.product.id),
        stage = stages.find((s) => s.id === draft.stage.id);
      if (!product || key(product.label) !== key(draft.product.label))
        throw new Error("O produto selecionado não está ativo.");
      if (!stage || key(stage.label) !== key(draft.stage.label))
        throw new Error("A etapa não pertence à filial do fornecedor.");
      const sheet = sheets.find((s) => s.id === draft.sheet.id);
      if (!sheet || key(sheet.label) !== key(draft.sheet.label))
        throw new Error("Selecione um IDFOLHA válido desse fornecedor.");
      const payrollDescriptor = await describe("FOLHAPGTO");
      writableColumn(payrollDescriptor, "Title");
      writableColumn(payrollDescriptor, "IDLANCAMENTO");
      for (const line of draft.lines)
        fieldsFor(
          payrollDescriptor,
          payrollValues({ ...draft, supplier }, sheet, line),
        );
      const descriptor = await describe("LANCAMENTOS");
      const values = draft.lines.map((line) => {
        const account = accounts.find((a) => a.id === line.account.id);
        if (!account || key(account.label) !== key(line.account.label))
          throw new Error("A conta selecionada não está cadastrada.");
        const names = new Set();
        for (const file of line.files) {
          if (names.has(file.name))
            throw new Error("Há comprovantes com nome repetido na rubrica.");
          names.add(file.name);
          const validation = validateAttachment(file);
          if (!validation.valid) throw new Error(validation.message);
        }
        return fieldsFor(
          descriptor,
          {
            FILIAL: supplier.branch,
            "TIPO TRANSAÇÃO": "CUSTO",
            DATA: draft.date,
            "DATA PGTO EFETUADO": draft.date,
            "DATA PGTO PREVISTO": draft.date,
            FORNECEDOR: supplier.label,
            PRODUTO: product.label,
            ETAPA: stage.label,
            QUANTIDADE: line.quantity,
            "VALOR UNITÁRIO": line.unitValue,
            CONTA: account.label,
            UN: product.unit,
            "TIPO DESPESA": product.expenseType,
            GERADESEMBOLSO: "SIM",
            APROVACAO: "PENDENTE DE APROVAÇÃO",
            FRETE: 0,
            OBS: `FOLHA DE PAGAMENTO — ${line.label.toUpperCase()}`,
          },
          ["UN", "TIPO DESPESA", "GERADESEMBOLSO", "APROVACAO", "FRETE", "OBS"],
        );
      });
      column(descriptor.columns, ["__PowerAppsId__"]);
      progress.fingerprint = fingerprint;
      progress.lines ??= {};
      const lines = [];
      for (let index = 0; index < draft.lines.length; index++) {
        const line = draft.lines[index];
        const saved = (progress.lines[line.rubric] ??= {});
        const id = await ensure(
          descriptor,
          values[index],
          "__PowerAppsId__",
          `APP-folha-${progress.operationId}-${line.rubric}`,
        );
        saved.id = id;
        if (line.files.length) {
          const existing = await repository.listAttachments(
            SITE,
            descriptor.id,
            id,
          );
          for (const file of line.files) {
            assertSession();
            if (!existing.some((a) => a.fileName === file.name)) {
              await repository.uploadAttachment(SITE, descriptor.id, id, file);
              assertSession();
              const verified = await repository.listAttachments(
                SITE,
                descriptor.id,
                id,
              );
              if (!verified.some((a) => a.fileName === file.name))
                throw new Error("O SharePoint não confirmou o comprovante.");
            }
          }
        }
        lines.push({ ...line, id });
      }
      const result = { ...draft, supplier, product, stage, sheet, lines };
      const linked = await linkPayroll(result, sheet.id, progress);
      return { ...result, sheet: linked.sheet };
    } finally {
      posting = false;
    }
  }
  async function linkPayroll(result, sheetId, progress) {
    if (linking) throw new Error("O vínculo da folha está em andamento.");
    operation(progress);
    linking = true;
    try {
      if (
        !result?.lines?.length ||
        result.lines.some((l) => progress.lines?.[l.rubric]?.id !== l.id)
      )
        throw new Error("Os lançamentos da folha não foram confirmados.");
      if (String(sheetId) !== result.sheet?.id)
        throw new Error("O IDFOLHA deve ser o selecionado antes da postagem.");
      const sheet = (await registeredSheets(result.supplier)).find(
        (s) =>
          s.id === String(sheetId) && key(s.label) === key(result.sheet.label),
      );
      if (!sheet) throw new Error("Escolha uma folha válida desse fornecedor.");
      const descriptor = await describe("FOLHAPGTO");
      const payloads = result.lines.map((line) =>
        fieldsFor(descriptor, {
          ...payrollValues(result, sheet, line),
          IDLANCAMENTO: Number(line.id),
        }),
      );
      if (progress.sheetId && progress.sheetId !== sheet.id)
        throw new Error("O vínculo já começou em outra folha.");
      progress.sheetId = sheet.id;
      for (let i = 0; i < result.lines.length; i++) {
        const line = result.lines[i];
        progress.lines[line.rubric].payrollId = await ensure(
          descriptor,
          payloads[i],
          "Title",
          `APP-folha-${progress.operationId}-${line.id}`,
        );
      }
      return { sheet, lines: result.lines };
    } finally {
      linking = false;
    }
  }
  return Object.freeze({
    prepare,
    loadSuppliers,
    loadProducts,
    loadAccounts,
    loadStages,
    loadSheets,
    post,
    linkPayroll,
  });
}
