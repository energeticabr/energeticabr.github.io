import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import Decimal from 'decimal.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createSharePointAttachmentTransport } from '../../../../portal/data/attachments.js';
import { createPayrollBreakdownAttachments } from './payroll-breakdown-attachments.js';
import { createSupplierPayrollData, createPayrollProgress } from './supplier-payroll-data.js';
import { payrollKey, PAYROLL_RUBRICS, validPayrollDate } from './supplier-payroll.js';
import { createPayrollBreakdownSourceReader } from './payroll-breakdown-source.js';
import { payrollProvisionTitle } from './payroll-provision-source.js';
import { ensurePayrollProvisionSchema } from './payroll-provision-schema.js';
import { validatePayrollBreakdown, payrollBreakdownSupplierMatches } from './payroll-breakdown.js';

const SITE = 'personal';
const CHILD_NAMES = ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'];
const id = value => /^[1-9]\d*$/.test(String(value || ''));
const blank = value => value == null || value === '';
const scalar = value => String(value?.LookupValue ?? value?.Value ?? value?.value ?? value ?? '');

export function createPayrollBreakdownData({ repository, tokenProvider, siteConfig = SHAREPOINT_SITES,
  fetchImpl = globalThis.fetch, assertSession = () => {}, schemaGraph } = {}) {
  if (!repository) {
    if (typeof tokenProvider !== 'function') throw new TypeError('É necessária uma sessão Microsoft ativa.');
    schemaGraph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    repository = createSharePointRepository(schemaGraph, siteConfig, { attachmentTransport: createSharePointAttachmentTransport({ tokenProvider, allowedSites: Object.values(siteConfig), fetch: fetchImpl }) });
  }
  // Every read and mutation is scoped to the same active account, including after awaits.
  const scoped = Object.fromEntries(['resolveList', 'getColumns', 'getItems', 'getItemsPage', 'getItem', 'createItem', 'listAttachments', 'uploadAttachment', 'downloadAttachment'].map(method => [method, async (...args) => {
    assertSession(); const value = await repository[method](...args); assertSession(); return value;
  }]));
  const suppliers = createSupplierPayrollData({ repository: scoped, tokenProvider, siteConfig, assertSession });
  const readPayrollSource = createPayrollBreakdownSourceReader(scoped, SITE);
  scoped.clearCache = () => { assertSession(); repository.clearCache?.(); };
  const attachments = createPayrollBreakdownAttachments({ repository: scoped, assertSession });
  let posting = false;
  async function prepare() {
    assertSession();
    if (typeof tokenProvider === 'function') {
      const token = await tokenProvider(['Sites.Read.All', 'Sites.ReadWrite.All']);
      assertSession();
      if (!token) throw new Error('Não foi possível autorizar a criação das provisões.');
      const attachmentToken = await tokenProvider([`https://${siteConfig[SITE].host}/AllSites.Read`, `https://${siteConfig[SITE].host}/AllSites.Write`]);
      assertSession(); if (!attachmentToken) throw new Error('Não foi possível autorizar os anexos das provisões.');
    }
    if (schemaGraph) await ensurePayrollProvisionSchema({ repository, graph: schemaGraph, assertSession });
  }
  async function describe(names, { signal, onProgress } = {}) {
    signal?.throwIfAborted();
    const loading = createPayrollProgress(onProgress, ['list', 'columns']);
    const list = await scoped.resolveList(SITE, names, { signal });
    signal?.throwIfAborted();
    if (!list?.id || list.status && list.status !== 'resolved') throw new Error(`A lista ${names[0]} não foi localizada.`);
    loading.done('list');
    const columns = await scoped.getColumns(SITE, list.id, { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(columns)) throw new Error('Não foi possível ler os campos das provisões.');
    loading.done('columns');
    return { id: list.id, columns, name: names[0] };
  }
  function column(descriptor, label, optional = false) {
    const writable = descriptor.columns.filter(c => !c.readOnly && !c.computed && !c.hidden);
    const exact = writable.filter(c => payrollKey(c.name) === payrollKey(label));
    const found = exact.length ? exact : writable.filter(c => payrollKey(c.displayName) === payrollKey(label));
    if (!found.length && optional) return null;
    if (found.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(found[0].name)) throw new Error(`O campo ${label} de ${descriptor.name} não foi identificado de forma única.`);
    return found[0];
  }
  function payload(descriptor, fields, optional = []) {
    const output = {}, assigned = new Set();
    for (const [label, value] of Object.entries(fields)) {
      const c = column(descriptor, label, optional.includes(label)); if (!c) continue;
      if (assigned.has(c.name)) throw new Error(`Os campos de ${descriptor.name} estão conflitantes.`); assigned.add(c.name);
      if (value === null) { output[c.name] = c.dateTime ? null : ''; continue; }
      if (c.dateTime) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`Data inválida em ${label}.`); output[c.name] = `${value}T00:00:00Z`; }
      else if (c.text) output[c.name] = String(value);
      else if (c.number || c.currency) {
        const number = Number(value); if (!Number.isFinite(number)) throw new Error(`Número inválido em ${label}.`); output[c.name] = number;
      } else if (c.choice) {
        if (c.choice.choices?.length && value !== '' && !c.choice.choices.includes(String(value))) throw new Error(`A opção ${value} não existe em ${label}.`);
        output[c.name] = String(value);
      } else throw new Error(`O tipo do campo ${label} não é compatível com a provisão.`);
    }
    return output;
  }
  async function rows(descriptor, { signal, onProgress } = {}) {
    signal?.throwIfAborted();
    // Complete collection API paginates and refuses incomplete responses.
    const result = await scoped.getItems(SITE, descriptor.id, '$expand=fields', { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(result)) throw new Error('A consulta das provisões está incompleta.');
    createPayrollProgress(onProgress, ['items']).done('items', { completedItems: result.length });
    return result;
  }
  function readValue(descriptor, row, label, optional = false) {
    const matches = descriptor.columns.filter(c => !c.computed && [c.name,c.displayName].some(name => payrollKey(name) === payrollKey(label)));
    const exact = matches.filter(c => payrollKey(c.name) === payrollKey(label));
    const found = exact.length ? exact : matches;
    if (!found.length && optional) return undefined;
    if (found.length !== 1) throw new Error(`O campo ${label} de ${descriptor.name} não foi identificado de forma única.`);
    return row.fields?.[found[0].name];
  }
  async function sheetFor(supplier, month, { signal, onProgress } = {}) {
    const loading = createPayrollProgress(onProgress, ['schema', 'items', 'matched']);
    const sheets = await describe(['IDFOLHA'], { signal, onProgress: loading.child('schema') });
    const normalize = value => {
      const raw = scalar(value).trim(), br = raw.match(/^(\d{1,2})[/-](\d{4})$/), iso = raw.match(/^(\d{4})-(\d{2})(?:$|[-T])/);
      return br ? `${br[2]}-${br[1].padStart(2,'0')}` : iso ? `${iso[1]}-${iso[2]}` : '';
    };
    const found = (await rows(sheets, { signal, onProgress: loading.child('items') })).filter(row => payrollKey(readValue(sheets,row,'FORNECEDOR')) === payrollKey(supplier.label)
      && normalize(readValue(sheets,row,'MESREFERENCIA')) === month);
    if (found.length !== 1 || !id(found[0]?.id)) throw new Error(`É necessária exatamente uma folha IDFOLHA de ${supplier.label} em ${month.split('-').reverse().join('/')}. Confira o cadastro da folha.`);
    loading.done('matched');
    return String(found[0].id);
  }
  async function loadPayrollContext(supplier, month, { signal, onProgress } = {}) {
    const loading = createPayrollProgress(onProgress, ['sheet', 'schema', 'items', 'sources', 'totals']);
    scoped.clearCache();
    const sheetId = await sheetFor(supplier, month, { signal, onProgress: loading.child('sheet') }),
      payments = await describe(['FOLHAPGTO'], { signal, onProgress: loading.child('schema') });
    const paid = Object.fromEntries(PAYROLL_RUBRICS.map(r => [r.id, 0])), history = [], seen = new Set();
    const paymentRows = await rows(payments, { signal, onProgress: loading.child('items') });
    const checked = index => loading.report('sources', (index + 1) * 100 / paymentRows.length, { completedItems: index + 1, totalItems: paymentRows.length });
    for (const [index, row] of paymentRows.entries()) {
      signal?.throwIfAborted();
      if (String(readValue(payments,row,'IDFOLHA') ?? '').trim() !== sheetId) { checked(index); continue; }
      if (payrollKey(readValue(payments,row,'FORNECEDOR')) !== payrollKey(supplier.label)) throw new Error('O fornecedor do pagamento diverge da folha.');
      const rubric = PAYROLL_RUBRICS.find(r => payrollKey(r.payrollType) === payrollKey(readValue(payments,row,'TIPOPGTO')));
      if (!rubric) throw new Error('Há uma rubrica de pagamento não reconhecida nesta folha. Confira os pagamentos antes de desdobrar.');
      const fields = { Title: readValue(payments,row,'Title'), IDPROVISAO: readValue(payments,row,'IDPROVISAO',true), IDFOLHA: sheetId, FORNECEDOR: supplier.label, TIPOPGTO: rubric.payrollType,
        IDLANCAMENTO: readValue(payments,row,'IDLANCAMENTO') };
      const source = await readPayrollSource(fields,supplier);
      signal?.throwIfAborted();
      if (source.PGTOAGENDADO === 'PENDENTE') { checked(index); continue; }
      if (source.VALORUNITARIO == null || source.QTD == null) throw new Error(`Não foi possível apurar o pagamento ${row.id} da folha.`);
      const total = source.TOTALCENTAVOS != null ? new Decimal(source.TOTALCENTAVOS).div(100)
        : new Decimal(source.VALORUNITARIO).times(source.QTD).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
      const next = new Decimal(paid[rubric.id]).plus(total);
      if (!Number.isSafeInteger(next.times(100).toNumber())) throw new Error('O total pago excede o limite monetário.');
      paid[rubric.id] = next.toNumber();
      const date = String(source.DATA || readValue(payments,row,'DATA') || '').slice(0,10);
      if (!validPayrollDate(date) || !id(row.id) || seen.has(String(row.id))) throw new Error(`Confira a data e a identidade do pagamento ${row.id}.`);
      seen.add(String(row.id));
      history.push({ id: String(row.id), date, rubric: rubric.id, label: rubric.label,
        quantity: source.QTD, unitValue: source.VALORUNITARIO, total: total.toNumber(),
        provisionId: source.IDPROVISAO || '', launchId: String(fields.IDLANCAMENTO || '') });
      checked(index);
    }
    loading.done('sources');
    const total = Object.values(paid).reduce((sum, value) => sum.plus(value), new Decimal(0));
    if (!Number.isSafeInteger(total.times(100).toNumber())) throw new Error('O total pago excede o limite monetário.');
    loading.done('totals');
    return { sheetId, paid, paidTotal: total.toNumber(), payments: history };
  }
  function verify(descriptor, row, fields) {
    if (!id(row?.id)) throw new Error('O SharePoint não confirmou o registro.');
    const settlementFields = new Set(['DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO','FORMAPGTO','STATUS','OBS']);
    for (const [name, expected] of Object.entries(fields)) {
      const c = descriptor.columns.find(c => c.name === name);
      // Scheduling/settlement may advance after creation while this batch is recovered.
      if ([name,c?.displayName].some(label => settlementFields.has(payrollKey(label)))) continue;
      const actual = row.fields?.[name], date = descriptor.columns.find(c => c.name === name)?.dateTime;
      if (!(blank(actual) && blank(expected) || typeof expected === 'number' && actual != null && Number(actual) === expected
        || scalar(actual) === String(expected) || date && !blank(actual) && !blank(expected) && Date.parse(actual) === Date.parse(expected)))
        throw new Error(`O registro ID ${row.id} mudou no campo ${name}. Confira-o antes de retomar.`);
    }
    return String(row.id);
  }
  async function ensure(descriptor, fields, state, changed) {
    const title = column(descriptor, 'Title').name;
    if (state.id) {
      const row = await scoped.getItem(SITE, descriptor.id, state.id, '$expand=fields');
      if (String(row?.id) !== String(state.id)) throw new Error('A identidade da provisão mudou.');
      return verify(descriptor, row, fields);
    }
    const find = async () => {
      const matches = (await rows(descriptor)).filter(row => scalar(row.fields?.[title]) === fields[title]);
      if (matches.length > 1) throw new Error('Há registros duplicados desta operação. Confira as provisões.');
      return matches[0];
    };
    let found = await find();
    if (!found) {
      if (state.attempted) throw new Error('A resposta do envio anterior ainda está pendente. Retome o mesmo envio para recuperar a provisão.');
      state.attempted = true; changed();
      try { found = await scoped.createItem(SITE, descriptor.id, fields); }
      catch (cause) {
        // The unique provision key arbitrates simultaneous recoveries in other tabs.
        if ([400,409].includes(cause?.status)) {
          found = await find();
          if (found) {
            state.id = String(found.id); changed();
            return verify(descriptor, await scoped.getItem(SITE, descriptor.id, state.id, '$expand=fields'), fields);
          }
        }
        // Explicit validation/auth/throttling rejections did not commit the POST.
        // Transport failures and server errors remain recovery-only.
        if ([400, 401, 403, 429].includes(cause?.status)) { state.attempted = false; changed(); throw cause; }
        found = await find(); if (!found) throw cause;
      }
      if (!id(found?.id)) found = await find();
      if (!id(found?.id)) throw new Error('O envio ainda não retornou um ID confirmado. Retome o mesmo envio.');
    }
    state.id = String(found.id); changed();
    const saved = await scoped.getItem(SITE, descriptor.id, state.id, '$expand=fields');
    if (String(saved?.id) !== state.id) throw new Error('A identidade do registro não foi confirmada.');
    return verify(descriptor, saved, fields);
  }
  async function post(rawDraft, progress = {}, onProgress = () => {}) {
    if (posting) throw new Error('O desdobramento já está sendo enviado.');
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    posting = true;
    try {
      assertSession(); repository.clearCache?.();
      const draft = validatePayrollBreakdown(rawDraft), signature = JSON.stringify(draft);
      const fileKeys = (rawDraft.lines || []).filter(line => line.files?.length).map(line => `${line.date}:${line.rubric}`);
      const loading = createPayrollProgress(onProgress, ['supplier', 'sheet', 'parentSchema', 'childSchema', 'payrollSchema', 'validated',
        ...fileKeys.flatMap(key => [`prepared:${key}`, `attachments:${key}`]),
        ...draft.lines.flatMap(line => [`parent:${line.date}:${line.rubric}`, `child:${line.date}:${line.rubric}`, `payroll:${line.date}:${line.rubric}`])]);
      if (progress.signature && progress.signature !== signature) throw new Error('O desdobramento não pode ser alterado depois do início do envio.');
      const uploads = new Map(), manifests = {};
      for (const raw of rawDraft.lines || []) {
        const key = `${raw.date}:${raw.rubric}`, files = raw.files || [], previous = progress.attachments?.[key]?.manifest;
        if (!files.length && previous?.length) throw new Error('Selecione novamente os mesmos arquivos da linha para retomar o envio.');
        if (!files.length) continue;
        if (!draft.lines.some(line => `${line.date}:${line.rubric}` === key)) throw new Error('Preencha quantidade e valor da linha que possui anexos antes de seguir.');
        const manifest = await prepareFiles(files, { onProgress: loading.child(`prepared:${key}`) });
        if (previous && JSON.stringify(previous) !== JSON.stringify(manifest)) throw new Error('Selecione novamente os mesmos arquivos, com o mesmo conteúdo, para retomar.');
        uploads.set(key,files); manifests[key] = manifest;
      }
      const live = (await suppliers.loadSuppliers({ onProgress: loading.child('supplier') })).find(row => row.id === draft.supplier.id);
      if (!live || !payrollBreakdownSupplierMatches(live, draft.supplier)) throw new Error('O fornecedor, sua filial ou profissão mudou. Confira o cadastro antes de submeter.');
      const sheetId = await sheetFor(live, draft.month, { onProgress: loading.child('sheet') });
      if (progress.sheetId && progress.sheetId !== sheetId) throw new Error('A folha vinculada mudou durante o envio. Confira o IDFOLHA antes de retomar.');
      const [parent, child, payroll] = await Promise.all([describe(['DESCRITIVOPROVISAO'], { onProgress: loading.child('parentSchema') }),
        describe(CHILD_NAMES, { onProgress: loading.child('childSchema') }), describe(['FOLHAPGTO'], { onProgress: loading.child('payrollSchema') })]);
      if (new Set([parent.id, child.id, payroll.id]).size !== 3) throw new Error('As listas da provisão, do descritivo e da folha devem ser distintas.');
      const sourceKey = column(payroll, 'IDPROVISAO');
      if (sourceKey.enforceUniqueValues !== true || sourceKey.indexed !== true) throw new Error('IDPROVISAO deve ser indexado e ter valores exclusivos em FOLHAPGTO antes de criar os pagamentos.');
      if (column(payroll,'IDLANCAMENTO').required) throw new Error('IDLANCAMENTO deve ser opcional em FOLHAPGTO para registrar provisões ainda pendentes.');
      for (const descriptor of [parent, child]) {
        const key = column(descriptor,'FOLHAOPERACAO');
        if (!key.text || key.enforceUniqueValues !== true || key.indexed !== true)
          throw new Error(`FOLHAOPERACAO deve ser texto indexado com valores exclusivos em ${descriptor.name}.`);
      }
      const pairs = draft.lines.map(line => {
        const token = `folha-${progress.operationId}-${line.date}-${line.rubric}`;
        const common = { FILIAL: live.branch, FORNECEDOR: live.label, FORMAPGTO: '', OBS: line.observation,
          DATAPREVISTOPGTO: line.date, DATAPGTOEFETUADO: null, DATAPGTOAGENDADO: null, DATAEXECUCAOAGENDAMENTO: null };
        const parentFields = payload(parent, { Title: `descritivo:${token}`, FOLHAOPERACAO: token, ...common, VALORTOTAL: line.total, PGTOAGENDADO: null });
        const childFields = payload(child, { Title: `provisao:${token}`, FOLHAOPERACAO: token, ...common, PRODUTO: live.profession, QTD: line.quantity,
          VALORTOTAL: line.unitValue, FRETE: 0, ETAPA: '', STATUS: 'PAGAMENTO PREVISTO', PGTOAGENDADO: 'PENDENTE', TIPOPGTO: line.payrollType, DESCRITIVOPROVISAO: '1', IDFOLHA: sheetId }, ['ETAPA', 'TIPOPGTO']);
        const payrollFields = payload(payroll, { Title: payrollProvisionTitle('1'), FORNECEDOR: live.label,
          TIPOPGTO: line.payrollType, VALORUNITARIO: line.unitValue, QTD: line.quantity, DATA: line.date, IDFOLHA: sheetId, IDPROVISAO: '1' });
        return { line, parentFields, childFields, payrollFields, key: `${line.date}:${line.rubric}` };
      });
      loading.done('validated');
      // All field mappings and amounts are validated before the first financial write.
      progress.signature = signature; progress.sheetId = sheetId; progress.lines ??= {}; progress.attachments ??= {};
      for (const [key,manifest] of Object.entries(manifests)) progress.attachments[key] ??= { manifest };
      onProgress();
      const result = [];
      for (const pair of pairs) {
        assertSession();
        const state = progress.lines[pair.key] ??= { parent: {}, child: {} };
        const parentId = await ensure(parent, pair.parentFields, state.parent, onProgress);
        loading.done(`parent:${pair.key}`);
        const link = column(child, 'DESCRITIVOPROVISAO');
        const fields = { ...pair.childFields, [link.name]: link.text ? parentId : Number(parentId) };
        const childId = await ensure(child, fields, state.child, onProgress);
        loading.done(`child:${pair.key}`);
        state.payroll ??= {};
        const paymentFields = { ...pair.payrollFields, ...payload(payroll, { Title: payrollProvisionTitle(childId), IDPROVISAO: childId }) };
        const paymentId = await ensure(payroll, paymentFields, state.payroll, onProgress);
        loading.done(`payroll:${pair.key}`);
        if (uploads.has(pair.key)) await submitAttachments({ supplier: live, sheetId, paymentId,
          files: uploads.get(pair.key), progress: progress.attachments[pair.key], onProgress: event => {
            if (event) loading.child(`attachments:${pair.key}`)(event); else onProgress();
          } });
        result.push({ ...pair.line, parentId, id: childId, paymentId, sheetId });
      }
      return { lines: result, total: draft.total, rubrics: draft.rubrics };
    } finally { posting = false; }
  }
  async function prepareFiles(files, { signal, onProgress } = {}) {
    const loading = createPayrollProgress(onProgress, [...(Array.isArray(files) ? files : []).map((_file, index) => `read:${index}`), 'validated']);
    // Observe the same reads used by the existing validator/hash operation.
    const observed = Array.isArray(files) ? files.map((file, index) => ({
      name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
      async arrayBuffer() {
        signal?.throwIfAborted(); const bytes = await file.arrayBuffer(); signal?.throwIfAborted();
        loading.done(`read:${index}`, { completedItems: index + 1, totalItems: files.length }); return bytes;
      },
    })) : files;
    const result = await attachments.prepareFiles(observed); signal?.throwIfAborted(); loading.done('validated'); return result;
  }
  async function submitAttachments(options) {
    const onProgress = options.onProgress || (() => {}), loading = createPayrollProgress(onProgress, ['prepared', 'receipts', 'confirmed']);
    let prepared = false, receipts = 0, total = 0;
    const journal = options.progress || {};
    const result = await attachments.submit({ ...options, progress: journal, onProgress: () => {
      onProgress();
      if (!prepared) {
        prepared = true;
        // The first callback checkpoints resolved destinations, before any receipt.
        const evidence = JSON.parse(journal.targets);
        total = new Set(evidence.filter(row => ['provision', 'launch', 'order'].includes(row.kind)).map(row => `${row.kind}:${row.listId}:${row.id}`)).size * journal.manifest.length;
        loading.done('prepared');
      } else {
        receipts++; loading.report('receipts', total ? receipts * 100 / total : undefined, { completedItems: receipts, totalItems: total });
      }
    } });
    loading.done('confirmed'); return result;
  }
  return Object.freeze({ prepare, loadSuppliers: suppliers.loadSuppliers, loadPayrollContext, post,
    prepareFiles, submitAttachments });
}
