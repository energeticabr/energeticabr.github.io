import { SHAREPOINT_SITES } from "../../../../portal/config.js";
import { createGraphClient } from "../../../../portal/data/graph-client.js";
import { createSharePointRepository } from "../../../../portal/data/sharepoint-repository.js";
import {
  createSharePointAttachmentTransport,
  validateAttachment,
} from "../../../../portal/data/attachments.js";
import { payrollKey as key, payrollReferenceMonth as monthKey, payrollTotal, supplierPayrollWeek, validatePayrollDraft } from "./supplier-payroll.js";
import { payrollTaxType, payrollCompetenceMonth } from './payroll-tax-competence.js';
import { ensurePayrollTaxLink, assertPayrollTaxStorage } from './payroll-tax-links.js';
import { payrollLaunchReferenceColumn, ensurePayrollLaunchSchema, confirmPayrollLaunchReference, compatiblePayrollLaunchLink,
  payrollLaunchLinkFilter, payrollCreationKey, payrollOriginKey, withPayrollWriteLock, ensurePayrollCreation, assertPayrollCreationStorage } from './payroll-launch-reference.js';
const SITE = "personal";
// Per-call finite work plans. Unknown page totals are reported as counts only.
// Observers are optional UI: they must never change a financial operation's result.
export function createPayrollProgress(onProgress, stages) {
  const values = new Map(stages.map(stage => [stage, 0]));
  function report(stage, percent, detail = {}) {
    if (!values.has(stage)) return;
    if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100)
      values.set(stage, Math.max(values.get(stage), percent / 100));
    const units = [...values.values()];
    try { onProgress?.({ ...detail, stage, percent: units.reduce((sum, value) => sum + value, 0) * 100 / units.length,
      completed: units.filter(value => value === 1).length, total: units.length }); } catch { /* Detached progress observer. */ }
  }
  return {
    done: (stage, detail) => report(stage, 100, detail),
    child: stage => event => report(stage, event?.percent, event),
    report,
  };
}
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
  graph,
  tokenProvider,
  siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch,
  loadHoleriteLogo = async () => {
    const response = await fetchImpl(new URL("../../../../assets/logo-energetica-oficial.png", import.meta.url));
    if (!response.ok) throw new Error("Não foi possível carregar o logo da empresa para o holerite.");
    return response.arrayBuffer();
  },
  now = () => new Date(),
  assertSession = () => {},
  storage,
} = {}) {
  if (!repository) {
    if (typeof tokenProvider !== "function")
      throw new TypeError("A folha requer uma sessão Microsoft ativa.");
    graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
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
    await ensurePayrollLaunchSchema({ repository, graph, assertSession, siteKey:SITE });
    descriptions.delete('LANCAMENTOS');
  }
  async function describe(name, { signal, onProgress } = {}) {
    signal?.throwIfAborted();
    assertSession();
    const loading = createPayrollProgress(onProgress, ['list', 'columns']);
    if (descriptions.has(name)) { loading.done('list'); loading.done('columns'); return descriptions.get(name); }
    const list = await repository.resolveList(SITE, [name], { signal });
    signal?.throwIfAborted();
    if (!list?.id) throw new Error(`A lista ${name} não foi encontrada.`);
    loading.done('list');
    const columns = await repository.getColumns(SITE, list.id, { signal });
    signal?.throwIfAborted();
    assertSession();
    const descriptor = { name, id: list.id, columns };
    descriptions.set(name, descriptor);
    loading.done('columns');
    return descriptor;
  }
  async function all(descriptor, filter = "", { signal, onProgress } = {}) {
    const loading = createPayrollProgress(onProgress, ['pages']);
    const items = [];
    let cursor;
    const seen = new Set();
    for (let page = 1; page <= 100; page++) {
      assertSession();
      signal?.throwIfAborted();
      const response = await repository.getItemsPage(
        SITE,
        descriptor.id,
        `$expand=fields&$top=100${filter ? `&$filter=${filter}` : ""}`,
        {
          pageNumber: page,
          maxPages: 100,
          cursor,
          signal,
          headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
        },
      );
      assertSession();
      signal?.throwIfAborted();
      if (!Array.isArray(response?.items) || typeof response.hasMore !== 'boolean')
        throw new Error('A consulta da folha não pôde ser confirmada.');
      items.push(...response.items);
      const detail = { completedPages: page, completedItems: items.length };
      if (!response.hasMore) { loading.done('pages', detail); return items; }
      loading.report('pages', undefined, detail);
      if (!response.nextLink || seen.has(response.nextLink))
        throw new Error("A consulta da folha não pôde ser concluída.");
      seen.add(response.nextLink);
      cursor = response.nextLink;
    }
    throw new Error("Há mais registros do que o limite da consulta da folha.");
  }
  async function readSource(name, { signal, onProgress }) {
    const loading = createPayrollProgress(onProgress, ['schema', 'items', 'options']);
    const descriptor = await describe(name, { signal, onProgress: loading.child('schema') });
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
    const rows = await all(descriptor, '', { signal, onProgress: loading.child('items') });
    const result = rows
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
    loading.done('options', { completedItems: rows.length }); return result;
  }
  function source(name, options = {}) {
    // Panels in the same batch share the catalogs, while posting revalidates from SharePoint.
    const { catalogCache, refreshCatalog } = options;
    if (!catalogCache) return readSource(name, options);
    if (!refreshCatalog && catalogCache.has(name)) return catalogCache.get(name);
    const request = readSource(name, options).catch(cause => {
      if (catalogCache.get(name) === request) catalogCache.delete(name);
      throw cause;
    });
    catalogCache.set(name, request);
    return request;
  }
  const loadSuppliers = async (options) =>
    (await source("FORNECEDORES", options))
      .filter((s) => key(s.status) === "ATIVO" && key(s.contractor) === "SIM")
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const loadProducts = async (supplier, options) =>
    (await source("CADASTROPRODUTO", options))
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
  const loadAccounts = async (options) => source("CADASTROCONTA", options);
  const loadStages = async (supplier, options) =>
    (await source("LANCAMENTOOBRA", options)).filter(
      (s) => key(s.branch) === key(supplier.branch),
    );
  const registeredSheets = async (supplier, options) =>
    (await source("IDFOLHA", options)).filter(
      (s) => key(s.supplier) === key(supplier.label),
    );
  async function loadSheets(supplier, {competence, ...options} = {}) {
    if (competence !== undefined) {
      const month = payrollCompetenceMonth(competence);
      if (!month) throw new Error('Informe uma competência válida.');
      return (await registeredSheets(supplier, options)).filter(s => payrollCompetenceMonth(s.label) === month);
    }
    const current = currentMonth(now());
    const order = [current, shiftMonth(current, 1), shiftMonth(current, -1)];
    return (await registeredSheets(supplier, options))
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
          : c.text ? String(value) : value;
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
  const originRows=(descriptor,id)=>all(descriptor,payrollLaunchLinkFilter(descriptor.columns,id));
  async function ensure(descriptor, fields, tokenLabel, token, checkpoint, assertExisting) {
    const c = column(descriptor.columns, [tokenLabel]);
    const payroll=descriptor.name==='FOLHAPGTO',launchId=payroll?fields[column(descriptor.columns,['IDLANCAMENTO']).name]:null;
    let origin;
    const saved=await ensurePayrollCreation({storage,assertSession,
      key:payroll?payrollOriginKey(SITE,descriptor.id,launchId):payrollCreationKey(SITE,descriptor.id,token),
      findItem:async()=>{
        let item=await findToken(descriptor,c,token);
        if(payroll){
          origin=compatiblePayrollLaunchLink({columns:descriptor.columns,rows:await originRows(descriptor,launchId),fields});
          if(item&&origin&&String(item.id)!==String(origin.id))throw new Error('O vínculo da operação está associado a outro lançamento.');
          item=origin||item;
        }
        if(!item&&checkpoint?.attempted?.[tokenLabel])throw new Error('O envio anterior ainda não foi confirmado. Confira a galeria antes de iniciar outro cadastro.');
        return item;
      },createItem:()=>repository.createItem(SITE,descriptor.id,{...fields,[c.name]:token}),
      verifyItem:async item=>{
        if(!/^[1-9]\d*$/.test(String(item?.id)))throw new Error('O SharePoint não confirmou o ID do registro.');
        const expected={...fields,...(!origin?{[c.name]:token}:{})};
        let current;
        if(!payroll){
          const links=await describe('FOLHAPGTO');
          current=await withPayrollWriteLock(payrollOriginKey(SITE,links.id,item.id),()=>confirmPayrollLaunchReference({
            columns:descriptor.columns,item,fields:expected,assertSession,assertContext:assertExisting?row=>assertExisting(String(row.id)):undefined,
            readItem:id=>repository.getItem(SITE,descriptor.id,id,'$expand=fields'),
            updateItem:(id,changes,options)=>repository.updateItem(SITE,descriptor.id,id,changes,options) }));
        }else current=await repository.getItem(SITE,descriptor.id,item.id,'$expand=fields');
        assertSession();
        if(String(current?.id)!==String(item.id))throw new Error('O SharePoint não confirmou o registro da rubrica.');
        for(const [name,value] of Object.entries(expected)){
          const actual=current.fields?.[name],date=descriptor.columns.find(c=>c.name===name)?.dateTime;
          if(!(typeof value==='number'?Number(actual)===value:scalar(actual)===scalar(value)||date&&scalar(actual).slice(0,10)===scalar(value).slice(0,10)))
            throw new Error('O SharePoint não confirmou todos os dados da rubrica.');
        }
        return current;
      } });
    return String(saved.id);
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
  async function prepareHolerite(draft, week, progress) {
    const descriptor = await describe("HOLERITE");
    const keyColumn = writableColumn(descriptor, "CHAVE");
    if (!keyColumn.text || keyColumn.indexed !== true || keyColumn.enforceUniqueValues !== true)
      throw new Error("A chave semanal de HOLERITE deve ser exclusiva e indexada.");
    const stateColumn = writableColumn(descriptor, "SITUACAO").name;
    const operationColumn = writableColumn(descriptor, "OPERACAO").name;
    const launchesColumn = writableColumn(descriptor, "LANCAMENTOS").name;
    const token = week.start + "-" + draft.supplier.id;
    const paidTotal = payrollTotal(draft.lines.filter(line => line.alreadyPaid));
    const launches = draft.lines.filter(line => !line.alreadyPaid);
    const launchTotal = payrollTotal(launches);
    const lines = draft.lines.map(line => ({
      rubrica: line.rubric, label: line.label, quantity: line.quantity, unitValue: line.unitValue,
      total: payrollTotal([line]), alreadyPaid: line.alreadyPaid === true,
      formaPgto: line.account?.label || null,
      idFolha: line.alreadyPaid ? null : Number(draft.sheet.id),
      comprovantes: line.files.map(file => ({ nome: file.name, bytes: file.size, modificado: file.lastModified })),
    }));
    const fields = fieldsFor(descriptor, {
      Title: (draft.supplier.label + " — " + week.start).slice(0, 255),
      CHAVE: token,
      FORNECEDOR: draft.supplier.label,
      IDFORNECEDOR: Number(draft.supplier.id),
      FILIAL: draft.supplier.branch,
      SEMANA_INICIO: week.start,
      SEMANA_FIM: week.end,
      DATA_PAGAMENTO: draft.date,
      ...(launches.length ? { PRODUTO: draft.product.label, ETAPA: draft.stage.label, IDFOLHA: Number(draft.sheet.id) } : {}),
      RUBRICAS: JSON.stringify(lines),
      TOTAL: draft.total,
      TOTAL_JA_PAGO: paidTotal,
      TOTAL_SUPRIMENTOS: launchTotal,
    });
    const { buildSupplierHoleritePdf } = await import("./supplier-holerite-pdf.js");
    const fileName = "Holerite-" + token + ".pdf";
    const logoBytes = await loadHoleriteLogo();
    const pdf = new File([await buildSupplierHoleritePdf({ ...draft, week, lines, paidTotal, launchTotal }, { logoBytes })],
      fileName, { type: "application/pdf" });
    const receipts = draft.lines.filter(line => line.alreadyPaid).flatMap(line => line.files.map((file, index) => ({
      file, name: line.rubric + "-" + (index + 1) + "-" + file.name.slice(-150),
    })));
    const journal = storage ?? globalThis.localStorage;
    const ownerKey = payrollCreationKey(SITE, descriptor.id, "owner:" + token);
    const owner = journal.getItem(ownerKey) || progress.operationId;
    const verify = async row => {
      const current = await repository.getItem(SITE, descriptor.id, String(row?.id || ""), "$expand=fields");
      assertSession();
      if (!/^[1-9]\d*$/.test(String(current?.id || "")) || !Object.entries(fields).every(([name, expected]) => {
        const actual = current.fields?.[name];
        const date = descriptor.columns.find(column => column.name === name)?.dateTime;
        return typeof expected === "number" ? actual != null && Number(actual) === expected
          : date ? scalar(actual).slice(0, 10) === scalar(expected).slice(0, 10)
          : scalar(actual) === scalar(expected);
      })) throw new Error("Já existe um holerite com outros dados para este fornecedor nesta semana.");
      const state = current.fields[stateColumn];
      if (state !== "FECHADO" && (state !== "EM PROCESSAMENTO" || current.fields[operationColumn] !== owner))
        throw new Error("Esta folha da semana já está em processamento em outra sessão.");
      return current;
    };
    const find = () => findToken(descriptor, keyColumn, token);
    const reserve = async fingerprint => {
      journal.setItem(ownerKey, owner);
      if (journal.getItem(ownerKey) !== owner) throw new Error("Não foi possível guardar a retomada do holerite.");
      const saved = await ensurePayrollCreation({
        key: payrollCreationKey(SITE, descriptor.id, token), storage, assertSession,
        findItem: find,
        createItem: () => repository.createItem(SITE, descriptor.id, {
          ...fields, [operationColumn]: owner, [stateColumn]: "EM PROCESSAMENTO",
        }),
        verifyItem: verify,
        onAttempt: () => { progress.fingerprint = fingerprint; },
      });
      progress.operationId = owner;
      return saved;
    };
    return { descriptor, find, reserve, stateColumn, operationColumn, launchesColumn, verify, pdf, receipts, journal, ownerKey };
  }
  async function finishHolerite(holerite, row, launches = []) {
    const { descriptor, pdf, receipts, stateColumn, launchesColumn } = holerite;
    const id = String(row.id);
    const attachments = [{ file: pdf, name: pdf.name }, ...receipts];
    const names = async () => new Set((await repository.listAttachments(SITE, descriptor.id, id))
      .map(item => item.name ?? item.fileName));
    const existing = await names();
    for (const { file, name } of attachments) {
      assertSession();
      if (!existing.has(name)) await repository.uploadAttachment(SITE, descriptor.id, id, file, name);
    }
    const confirmed = await names();
    if (!attachments.every(({ name }) => confirmed.has(name)))
      throw new Error("O SharePoint não confirmou todos os anexos do holerite.");
    if (row.fields[stateColumn] !== "FECHADO") {
      const posted = JSON.stringify(launches.filter(line => !payrollTaxType(line.payrollType)).map(({ rubric, id }) => ({ rubric, id })));
      let saved = await holerite.verify({ id });
      let failure;
      if (saved.fields[stateColumn] !== "FECHADO") {
        const eTag = saved.eTag || saved["@odata.etag"];
        try {
          await repository.updateItem(SITE, descriptor.id, id, { [stateColumn]: "FECHADO", [launchesColumn]: posted }, { eTag });
        } catch (cause) { failure = cause; }
        saved = await holerite.verify({ id });
      }
      if (saved.fields[stateColumn] !== "FECHADO" || saved.fields[launchesColumn] !== posted)
        throw failure || new Error("O SharePoint ainda não confirmou o fechamento do holerite.");
    }
    holerite.journal.removeItem(holerite.ownerKey);
    return { id, fileName: pdf.name };
  }
  async function recoverHoleriteTaxLaunch(draft, line, operationId) {
    const [launches, payments] = await Promise.all([describe("LANCAMENTOS"), describe("FOLHAPGTO")]);
    const token = column(launches.columns, ["__PowerAppsId__"]);
    const source = await findToken(launches, token, `APP-folha-${operationId}-${line.rubric}`);
    const unconfirmed = "O holerite já está fechado. Confira os registros e poste os tributos em um envio próprio.";
    if (!source || Number(source.fields?.[payrollLaunchReferenceColumn(launches.columns)?.name]) !== Number(draft.taxSheet.id))
      throw new Error(unconfirmed);
    const id = String(source.id);
    const fields = fieldsFor(payments, { ...payrollValues(draft, draft.taxSheet, line), IDLANCAMENTO: Number(id) });
    const rows = await originRows(payments, id);
    try {
      if (!compatiblePayrollLaunchLink({ columns: payments.columns, rows, fields })) throw new Error();
    } catch { throw new Error(unconfirmed); }
    return { ...line, id };
  }
  async function post(rawDraft, progress, onProgress, { weekly = false } = {}) {
    const draft = validatePayrollDraft(rawDraft);
    if (!weekly && draft.lines.some(line => line.alreadyPaid))
      throw new Error("Rubricas já pagas devem ser registradas pelo fechamento semanal.");
    if (!weekly) return postDraft(draft, progress, onProgress);
    const week = supplierPayrollWeek(draft.date);
    return withPayrollWriteLock(`energetico:holerite:${week.start}:${draft.supplier.id}`,
      () => postDraft(draft, progress, onProgress, week));
  }
  async function postDraft(draft, progress, onProgress, week) {
    if (posting) throw new Error("A folha já está sendo postada.");
    operation(progress);
    posting = true;
    try {
      const pending = draft.lines.filter(line => line.alreadyPaid !== true);
      const holeriteLines = week ? draft.lines.filter(line => !payrollTaxType(line.payrollType)) : [];
      const hasNormal = pending.some(line => !payrollTaxType(line.payrollType));
      const hasTax = pending.some(line => payrollTaxType(line.payrollType));
      const loading = createPayrollProgress(onProgress, ['supplier', 'validated',
        ...(pending.length ? ['products', 'accounts', 'stages', 'payrollSchema', 'launchSchema', 'linked'] : []),
        ...(hasNormal ? ['sheets'] : []), ...(hasTax ? ['taxSheets'] : []), ...(holeriteLines.length ? ['holerite'] : []),
        ...pending.flatMap(line => [`launch:${line.rubric}`, `payroll:${line.rubric}`, `verified:${line.rubric}`,
          ...line.files.map(file => `attachment:${line.rubric}:${file.name}`)])]);
      assertSession();assertPayrollCreationStorage(storage);
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
      const holerite = holeriteLines.length
        ? await prepareHolerite({ ...draft, lines: holeriteLines, total: payrollTotal(holeriteLines) }, week, progress)
        : null;
      const existing = await holerite?.find();
      async function recoverClosedHolerite(row) {
        const launches = JSON.parse(row.fields[holerite.launchesColumn] || "[]");
        const lines = await Promise.all(draft.lines.map(line => {
          if (line.alreadyPaid) return line;
          if (payrollTaxType(line.payrollType)) return recoverHoleriteTaxLaunch(draft, line, row.fields[holerite.operationColumn]);
          const id = String(launches.find(launch => launch.rubric === line.rubric)?.id || "");
          if (!/^[1-9]\d*$/.test(id)) throw new Error("O holerite fechado não contém o ID do lançamento da rubrica.");
          return { ...line, id };
        }));
        const saved = await finishHolerite(holerite, row);
        loading.done('holerite');
        return { ...draft, lines, holerite: saved };
      }
      if (existing) {
        const saved = await holerite.verify(existing);
        if (saved.fields[holerite.stateColumn] === "FECHADO") return await recoverClosedHolerite(saved);
        progress.fingerprint = fingerprint;
      }
      const suppliers = await loadSuppliers({ onProgress: loading.child('supplier') });
      const supplier = suppliers.find((s) => s.id === draft.supplier.id);
      if (
        !supplier ||
        key(supplier.label) !== key(draft.supplier.label) ||
        key(supplier.branch) !== key(draft.supplier.branch)
      )
        throw new Error(
          "O fornecedor ou sua filial foi alterado; revise o cadastro.",
        );
      if (hasTax && !progress.fingerprint) assertPayrollTaxStorage(storage);
      const [products, accounts, stages, sheets, taxSheets] = await Promise.all([
        pending.length ? loadProducts(supplier, { onProgress: loading.child('products') }) : [],
        pending.length ? loadAccounts({ onProgress: loading.child('accounts') }) : [],
        pending.length ? loadStages(supplier, { onProgress: loading.child('stages') }) : [],
        // Once posting starts, keep its validated sheet across month rollover.
        !hasNormal ? [] : progress.fingerprint
          ? registeredSheets(supplier, { onProgress: loading.child('sheets') })
          : loadSheets(supplier, { onProgress: loading.child('sheets') }),
        hasTax ? loadSheets(supplier, {competence:draft.taxCompetence, onProgress: loading.child('taxSheets')}) : [],
      ]);
      const product = products.find((p) => p.id === draft.product?.id),
        stage = stages.find((s) => s.id === draft.stage?.id);
      if (pending.length && (!product || key(product.label) !== key(draft.product.label)))
        throw new Error("O produto selecionado não está ativo.");
      if (pending.length && (!stage || key(stage.label) !== key(draft.stage.label)))
        throw new Error("A etapa não pertence à filial do fornecedor.");
      const normalSheet = hasNormal ? sheets.find((s) => s.id === draft.sheet.id) : null;
      if (hasNormal && (!normalSheet || key(normalSheet.label) !== key(draft.sheet.label)))
        throw new Error("Selecione um IDFOLHA válido desse fornecedor.");
      if (normalSheet && sheets.filter(s => monthKey(s.label) === monthKey(normalSheet.label)).length !== 1)
        throw new Error("O IDFOLHA do fornecedor está ambíguo para o mês selecionado.");
      const taxSheet = hasTax ? taxSheets.find(s => s.id === draft.taxSheet.id) : null;
      if (hasTax && (taxSheets.length !== 1 || !taxSheet || payrollCompetenceMonth(taxSheet.label) !== payrollCompetenceMonth(draft.taxCompetence)))
        throw new Error('Selecione um IDFOLHA único desse fornecedor para a competência de INSS/FGTS.');
      const sheet = normalSheet || taxSheet;
      for (const line of draft.lines) {
        const names = new Set();
        for (const file of line.files) {
          if (names.has(file.name))
            throw new Error("Há comprovantes com nome repetido na rubrica.");
          names.add(file.name);
          const validation = validateAttachment(file);
          if (!validation.valid) throw new Error(validation.message);
        }
      }
      const payrollDescriptor = pending.length ? await describe("FOLHAPGTO", { onProgress: loading.child('payrollSchema') }) : null;
      const descriptor = pending.length ? await describe("LANCAMENTOS", { onProgress: loading.child('launchSchema') }) : null;
      if (pending.length) {
        writableColumn(payrollDescriptor, "Title");
        writableColumn(payrollDescriptor, "IDLANCAMENTO");
        for (const line of pending)
          fieldsFor(payrollDescriptor, payrollValues({ ...draft, supplier }, payrollTaxType(line.payrollType) ? taxSheet : sheet, line));
        if (!payrollLaunchReferenceColumn(descriptor.columns))
          throw new Error('IDFOLHA de LANCAMENTOS não está disponível; nenhum pagamento foi criado.');
        column(descriptor.columns, ["__PowerAppsId__"]);
      }
      const values = pending.map((line) => {
        const account = accounts.find((a) => a.id === line.account.id);
        if (!account || key(account.label) !== key(line.account.label))
          throw new Error("A conta selecionada não está cadastrada.");
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
            IDFOLHA: Number((payrollTaxType(line.payrollType) ? taxSheet : sheet).id),
            OBS: `FOLHA DE PAGAMENTO — ${line.label.toUpperCase()}`,
          },
          ["UN", "TIPO DESPESA", "GERADESEMBOLSO", "APROVACAO", "FRETE", "OBS"],
        );
      });
      const reservation = await holerite?.reserve(fingerprint);
      loading.done('validated');
      progress.fingerprint = fingerprint;
      if (reservation?.fields[holerite.stateColumn] === "FECHADO") return await recoverClosedHolerite(reservation);
      progress.lines ??= {};
      const lines = [];
      for (const [index, line] of pending.entries()) {
        const selectedSheet = payrollTaxType(line.payrollType) ? taxSheet : sheet;
        const currentSheets = await registeredSheets(supplier);
        const exact = currentSheets.filter(s=>monthKey(s.label) === monthKey(selectedSheet.label));
        if (exact.length !== 1 || exact[0].id !== selectedSheet.id) throw new Error('O IDFOLHA do fornecedor foi alterado ou está ambíguo; confira antes de retomar.');
        const saved = (progress.lines[line.rubric] ??= {});
        const id = await ensure(
          descriptor,
          values[index],
          "__PowerAppsId__",
          `APP-folha-${progress.operationId}-${line.rubric}`,
          saved,
          async id => {
            compatiblePayrollLaunchLink({ columns:payrollDescriptor.columns, rows:await originRows(payrollDescriptor,id),
              fields:fieldsFor(payrollDescriptor,{...payrollValues({...draft,supplier},selectedSheet,line),IDLANCAMENTO:Number(id)}) });
          },
        );
        saved.id = id;
        loading.done(`launch:${line.rubric}`);
        const postedLine = { ...line, id };
        // A receipt failure must never leave a launch without its payroll link.
        await linkPayroll({ ...draft, supplier, product, stage, sheet, ...(hasTax ? {taxSheet} : {}), lines:[postedLine] }, sheet.id, progress);
        loading.done(`payroll:${line.rubric}`);
        if (line.files.length) {
          const existing = await repository.listAttachments(
            SITE,
            descriptor.id,
            id,
          );
          for (const file of line.files) {
            assertSession();
            if (!existing.some((a) => (a.name ?? a.fileName) === file.name)) {
              await repository.uploadAttachment(SITE, descriptor.id, id, file);
              assertSession();
              const verified = await repository.listAttachments(
                SITE,
                descriptor.id,
                id,
              );
              if (!verified.some((a) => (a.name ?? a.fileName) === file.name))
                throw new Error("O SharePoint não confirmou o comprovante.");
            }
            loading.done(`attachment:${line.rubric}:${file.name}`);
          }
        }
        lines.push(postedLine);
      }
      for (let index = 0; index < lines.length; index++) {
        await confirmPayrollLaunchReference({ columns:descriptor.columns, item:lines[index], assertSession,
          fields:{...values[index],[column(descriptor.columns,['__PowerAppsId__']).name]:`APP-folha-${progress.operationId}-${lines[index].rubric}`},
          readItem:id=>repository.getItem(SITE,descriptor.id,id,'$expand=fields'),
          updateItem:async()=>{throw new Error('A referência IDFOLHA mudou durante o envio; confira antes de concluir.');} });
        loading.done(`verified:${lines[index].rubric}`);
      }
      const result = { ...draft, supplier, product, stage, sheet, ...(hasTax ? {taxSheet} : {}), lines };
      if (pending.length) {
        const linked = await linkPayroll(result, sheet.id, progress);
        result.sheet = linked.sheet;
        loading.done('linked');
      }
      if (holerite) {
        result.holerite = await finishHolerite(holerite, reservation, lines);
        result.lines = draft.lines.map(line => lines.find(posted => posted.rubric === line.rubric) || line);
        loading.done('holerite');
      }
      return result;
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
      const sheets = await registeredSheets(result.supplier);
      const sheet = sheets.find(
        (s) =>
          s.id === String(sheetId) && key(s.label) === key(result.sheet.label),
      );
      if (!sheet) throw new Error("Escolha uma folha válida desse fornecedor.");
      if (sheets.filter(s=>monthKey(s.label) === monthKey(sheet.label)).length !== 1) throw new Error('O IDFOLHA do fornecedor está ambíguo.');
      const taxLines = result.lines.filter(line => payrollTaxType(line.payrollType));
      const taxSheets = sheets.filter(s => payrollCompetenceMonth(s.label) === payrollCompetenceMonth(result.taxCompetence));
      const taxSheet = taxSheets.find(s => s.id === result.taxSheet?.id);
      if (taxLines.length && (taxSheets.length !== 1 || !taxSheet)) throw new Error('O IDFOLHA da competência de INSS/FGTS foi alterado; revise a seleção.');
      const descriptor = await describe("FOLHAPGTO");
      const payloads = result.lines.map((line) =>
        fieldsFor(descriptor, {
          ...payrollValues(result, payrollTaxType(line.payrollType) ? taxSheet : sheet, line),
          IDLANCAMENTO: Number(line.id),
        }),
      );
      if (progress.sheetId && progress.sheetId !== sheet.id)
        throw new Error("O vínculo já começou em outra folha.");
      progress.sheetId = sheet.id;
      for (let i = 0; i < result.lines.length; i++) {
        const line = result.lines[i];
        const launches = await describe('LANCAMENTOS'), reference = payrollLaunchReferenceColumn(launches.columns);
        const source = await repository.getItem(SITE, launches.id, line.id, '$expand=fields'); assertSession();
        const supplierColumn = column(launches.columns, ['FORNECEDOR']);
        const selectedSheet = payrollTaxType(line.payrollType) ? taxSheet : sheet;
        if (!reference || String(source?.id) !== line.id || key(source.fields?.[supplierColumn.name]) !== key(result.supplier.label)
          || Number(source.fields?.[reference.name]) !== Number(selectedSheet.id)) throw new Error('O fornecedor ou IDFOLHA do lançamento foi alterado; confira o vínculo.');
        if (payrollTaxType(line.payrollType)) {
          const fields={...payloads[i],...fieldsFor(descriptor,{Title:`APP-folha-encargo-lancamento-${line.id}-${key(line.payrollType)}`})};
          const saved=await ensurePayrollTaxLink({descriptor,fields,siteKey:SITE,storage,assertSession,matchFinancials:true,
            allRows:()=>originRows(descriptor,line.id),readItem:async id=>{
              const item=await repository.getItem(SITE,descriptor.id,id,'$expand=fields');
              if(String(item?.id)!==id)throw new Error('O vínculo do encargo não foi confirmado.');return item;
            },createItem:fields=>repository.createItem(SITE,descriptor.id,fields),
            assertContext:async()=>{
              const exact=(await registeredSheets(result.supplier)).filter(s=>payrollCompetenceMonth(s.label)===payrollCompetenceMonth(result.taxCompetence));
              if(exact.length!==1||exact[0].id!==result.taxSheet.id)throw new Error('O IDFOLHA da competência de INSS/FGTS foi alterado.');
              const launches=await describe('LANCAMENTOS'),source=await repository.getItem(SITE,launches.id,line.id,'$expand=fields');
              const supplierColumn=column(launches.columns,['FORNECEDOR']);
              const reference=payrollLaunchReferenceColumn(launches.columns);
              if(!reference||String(source?.id)!==line.id||key(source.fields?.[supplierColumn.name])!==key(result.supplier.label)
                ||Number(source.fields?.[reference.name])!==Number(taxSheet.id))throw new Error('O fornecedor ou IDFOLHA do lançamento do encargo foi alterado.');
            }});
          progress.lines[line.rubric].payrollId=String(saved.id);continue;
        }
        progress.lines[line.rubric].payrollId = await ensure(
          descriptor,
          payloads[i],
          "Title",
          `APP-folha-${progress.operationId}-${line.id}`,
          progress.lines[line.rubric],
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
