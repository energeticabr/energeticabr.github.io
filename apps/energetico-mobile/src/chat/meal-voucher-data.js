import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createSharePointAttachmentTransport, validateAttachment } from '../../../../portal/data/attachments.js';
import { mealVoucherKey as key, validateMealVoucherDraft } from './meal-voucher.js';
import { payrollDecimal } from './supplier-payroll.js';
import { PAYROLL_RUBRICS } from './supplier-payroll.js';

const scalar = value => String(value && typeof value === 'object' ? value.LookupValue ?? value.Value ?? value.value ?? '' : value ?? '').trim();
const numericId = value => /^[1-9]\d{0,14}$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value));
const pending = value => /^(?:PENDENTE|RASCUNHO|EMABERTO)/.test(key(value));
const amount = value => payrollDecimal(value || 0).toDecimalPlaces(2);
const mealPaymentType = PAYROLL_RUBRICS.find(rubric => rubric.id === 'meal').payrollType;
function monthKey(raw) {
  const text = scalar(raw), brazil = text.match(/^(0?[1-9]|1[0-2])[/-](\d{4})$/), iso = text.match(/^(\d{4})[-/](0?[1-9]|1[0-2])(?:$|[-/T])/);
  return brazil ? `${brazil[2]}-${brazil[1].padStart(2, '0')}` : iso ? `${iso[1]}-${iso[2].padStart(2, '0')}` : '';
}

export function createMealVoucherData({ repository, tokenProvider, siteConfig = SHAREPOINT_SITES, fetchImpl = globalThis.fetch, siteKey = 'personal', assertSession = () => {} } = {}) {
  if (!repository) {
    if (typeof tokenProvider !== 'function') throw new TypeError('É necessária uma sessão Microsoft ativa.');
    const graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    repository = createSharePointRepository(graph, siteConfig, { attachmentTransport: createSharePointAttachmentTransport({ tokenProvider, allowedSites: Object.values(siteConfig), fetch: fetchImpl }) });
  }
  const descriptors = new Map();
  let posting = false;
  async function prepare() {
    if (!tokenProvider) return;
    for (const scopes of [['Sites.Read.All', 'Sites.ReadWrite.All'], [`https://${siteConfig[siteKey].host}/AllSites.Read`, `https://${siteConfig[siteKey].host}/AllSites.Write`]]) {
      assertSession();
      if (!await tokenProvider(scopes)) throw new Error('Não foi possível autorizar os lançamentos.');
    }
  }
  async function describe(name) {
    assertSession();
    if (!descriptors.has(name)) {
      const list = await repository.resolveList(siteKey, [name]);
      if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} não está disponível.`);
      const columns = await repository.getColumns(siteKey, list.id);
      assertSession();
      descriptors.set(name, { id: list.id, columns });
    }
    return descriptors.get(name);
  }
  function column(descriptor, aliases, required = true) {
    const found = descriptor.columns.find(c => [c.name, c.displayName].some(name => aliases.some(alias => key(name) === key(alias))));
    if (!found && required) throw new Error(`A coluna ${aliases[0]} não foi identificada.`);
    return found;
  }
  function value(descriptor, row, aliases, required = true) { const c = column(descriptor, aliases, required); return c ? scalar(row.fields?.[c.name]) : ''; }
  function payload(descriptor, values, optional = []) {
    const result = {};
    for (const [name, raw] of Object.entries(values)) {
      const c = column(descriptor, [name], !optional.includes(name));
      if (!c) continue;
      if (c.readOnly || c.calculated || c.lookup || c.personOrGroup) throw new Error(`A coluna ${name} não permite gravação.`);
      if (c.choice?.choices?.length && c.choice.allowTextEntry !== true && !c.choice.choices.some(option => key(option) === key(raw))) throw new Error(`O valor de ${name} não está cadastrado.`);
      result[c.name] = c.dateTime && /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? `${raw}T12:00:00Z` : raw;
    }
    return result;
  }
  function orderTotal(descriptor, value) { return column(descriptor, ['VALORTOTAL']).text ? String(value) : value; }
  async function all(descriptor) {
    const result = [], seen = new Set(); let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      assertSession();
      const page = await repository.getItemsPage(siteKey, descriptor.id, '$expand=fields&$top=100', { pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}), headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      assertSession();
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean') throw new Error('A resposta do SharePoint está incompleta.');
      result.push(...page.items);
      if (!page.hasMore) return result;
      if (!page.nextLink || seen.has(page.nextLink)) throw new Error('A paginação do SharePoint está incompleta.');
      seen.add(page.nextLink); cursor = page.nextLink;
    }
    throw new Error('A lista ultrapassou o limite seguro de páginas.');
  }
  async function suppliers() {
    const descriptor = await describe('FORNECEDORES');
    return (await all(descriptor)).filter(row => key(value(descriptor, row, ['STATUS'])) === 'ATIVO' && key(value(descriptor, row, ['EMPREITEIRO'])) === 'SIM')
      .map(row => ({ id: String(row.id), label: value(descriptor, row, ['CADASTRO', 'FORNECEDOR']), branch: value(descriptor, row, ['FILIAL']), profession: value(descriptor, row, ['PROFISSAO', 'PROFISSÃO'], false) }))
      .filter(row => numericId(row.id) && row.label).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }
  async function options(name, label, extra = {}) {
    const descriptor = await describe(name);
    return (await all(descriptor)).map(row => ({ id: String(row.id), label: value(descriptor, row, [label]), ...Object.fromEntries(Object.entries(extra).map(([property, aliases]) => [property, value(descriptor, row, aliases)])) }))
      .filter(row => numericId(row.id) && row.label);
  }
  async function loadOptions() {
    const [available, accounts, stages] = await Promise.all([suppliers(), options('CADASTROCONTA', 'CONTA'), options('LANCAMENTOOBRA', 'ETAPA', { branch: ['FILIAL'] })]);
    return { suppliers: available, accounts, stages };
  }
  async function loadOrders(branch) {
    const descriptor = await describe('NOTASPENDENTES');
    return (await all(descriptor)).filter(row => numericId(row.id) && key(value(descriptor, row, ['FILIAL'])) === key(branch) && pending(value(descriptor, row, ['STATUS'])))
      .map(row => ({ id: String(row.id), label: `Pedido ${row.id} · ${value(descriptor, row, ['FORNECEDOR'])} · ${value(descriptor, row, ['VALORTOTAL'], false) || '0'}`, supplier: value(descriptor, row, ['FORNECEDOR']) }))
      .sort((a, b) => Number(b.id) - Number(a.id));
  }
  async function loadSheetAssignments(referenceMonth, selectedSuppliers) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(referenceMonth || ''))) throw new Error('Informe um mês de referência válido.');
    if (new Set(selectedSuppliers.map(supplier => key(supplier.label))).size !== selectedSuppliers.length) throw new Error('Fornecedores homônimos não podem compartilhar a mesma IDFOLHA; confira os cadastros.');
    const descriptor = await describe('IDFOLHA');
    const rows = await all(descriptor), assignments = {};
    for (const supplier of selectedSuppliers) {
      const matching = rows.filter(row => monthKey(value(descriptor, row, ['MESREFERENCIA', 'MES REFERENCIA'])) === referenceMonth
        && key(value(descriptor, row, ['FORNECEDOR'])) === key(supplier.label));
      if (matching.length !== 1 || !numericId(matching[0]?.id)) throw new Error(`O fornecedor ${supplier.label} precisa ter exatamente uma IDFOLHA em ${referenceMonth}.`);
      assignments[supplier.id] = { id: String(matching[0].id), supplier: supplier.label, referenceMonth };
    }
    return assignments;
  }
  async function get(descriptor, id) {
    if (!numericId(id)) throw new Error('ID inválido.');
    const row = await repository.getItem(siteKey, descriptor.id, String(id), '$expand=fields');
    assertSession();
    if (String(row?.id) !== String(id)) throw new Error('O registro não foi confirmado no SharePoint.');
    return row;
  }
  async function findToken(descriptor, label, token, tokenCache) {
    const name = column(descriptor, [label]).name;
    if (!tokenCache.has(descriptor.id)) tokenCache.set(descriptor.id, await all(descriptor));
    const matches = tokenCache.get(descriptor.id).filter(row => scalar(row.fields?.[name]) === token);
    if (matches.length > 1) throw new Error('Foram encontrados registros duplicados da operação.');
    return matches[0];
  }
  async function ensure(descriptor, fields, label, token, tokenCache) {
    const name = column(descriptor, [label]).name;
    let row = await findToken(descriptor, label, token, tokenCache);
    if (!row) { assertSession(); row = await repository.createItem(siteKey, descriptor.id, { ...fields, [name]: token }); assertSession(); tokenCache.get(descriptor.id).push(row); }
    if (!numericId(row?.id)) throw new Error('O SharePoint não confirmou o ID criado.');
    const saved = await get(descriptor, row.id);
    for (const [field, expected] of Object.entries({ ...fields, [name]: token })) {
      const actual = saved.fields?.[field];
      const date = descriptor.columns.find(c => c.name === field)?.dateTime;
      if (!(typeof expected === 'number' ? Number(actual) === expected : scalar(actual) === String(expected) || date && String(actual ?? '').slice(0, 10) === String(expected).slice(0, 10)))
        throw new Error('O SharePoint não confirmou os dados gravados.');
    }
    return String(row.id);
  }
  async function ensureOrder(descriptor, fields, marker, tokenCache) {
    const obsName = column(descriptor, ['OBS']).name;
    if (!tokenCache.has(descriptor.id)) tokenCache.set(descriptor.id, await all(descriptor));
    const matches = tokenCache.get(descriptor.id).filter(row => scalar(row.fields?.[obsName]).includes(marker));
    if (matches.length > 1) throw new Error('Foram encontrados pedidos duplicados da operação. Confira os registros antes de retomar.');
    let row = matches[0];
    if (!row) {
      assertSession();
      row = await repository.createItem(siteKey, descriptor.id, fields);
      assertSession();
      tokenCache.get(descriptor.id).push(row);
    }
    if (!numericId(row?.id)) throw new Error('O SharePoint não confirmou o ID do pedido.');
    const saved = await get(descriptor, row.id);
    for (const [field, expected] of Object.entries(fields)) {
      const actual = saved.fields?.[field];
      const date = descriptor.columns.find(c => c.name === field)?.dateTime;
      if (field === obsName ? !scalar(actual).includes(marker)
        : !(typeof expected === 'number' ? Number(actual) === expected : scalar(actual) === String(expected) || date && String(actual ?? '').slice(0, 10) === String(expected).slice(0, 10)))
        throw new Error('O SharePoint não confirmou os dados do pedido gravado.');
    }
    return String(row.id);
  }
  async function canEditPending(rawDraft, progress = {}) {
    assertSession();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    if (progress.orderUpdated || ['lines', 'payroll', 'uploadedFiles'].some(name => Object.keys(progress[name] || {}).length)) return false;
    let original = rawDraft;
    if (progress.signature) {
      try { original = JSON.parse(progress.signature); } catch { throw new Error('Não foi possível conferir o lote anterior.'); }
      if (!original || !['new', 'existing'].includes(original.orderMode)) throw new Error('O lote anterior está incompleto.');
    }
    if (original.orderMode === 'new' && progress.orderId) return false;
    const [orders, launches, payroll] = await Promise.all([describe('NOTASPENDENTES'), describe('LANCAMENTOS'), describe('FOLHAPGTO')]);
    const obs = column(orders, ['OBS']).name, title = column(orders, ['Title'], false)?.name;
    const launchToken = column(launches, ['__PowerAppsId__']).name, payrollToken = column(payroll, ['Title']).name;
    const records = await Promise.all([orders, launches, payroll].map(all));
    if (records.some(rows => rows.some(row => !numericId(row?.id) || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))))
      throw new Error('Não foi possível confirmar todos os registros da tentativa anterior.');
    const prefix = `APP-vale-alimentacao-${progress.operationId}`.toUpperCase();
    const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`.toUpperCase();
    const ownsToken = (raw, start) => { const token = scalar(raw).toUpperCase(); return token.startsWith(start) && /^\d+$/.test(token.slice(start.length)); };
    assertSession();
    return !records[0].some(row => scalar(row.fields[obs]).toUpperCase().includes(marker) || title && scalar(row.fields[title]).toUpperCase() === prefix)
      && !records[1].some(row => ownsToken(row.fields[launchToken], `${prefix}-`))
      && !records[2].some(row => ownsToken(row.fields[payrollToken], `${prefix}-FOLHA-`));
  }
  async function post(rawDraft, progress = {}, onProgress = () => {}) {
    if (posting) throw new Error('O lote já está sendo enviado.');
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    posting = true;
    try {
      const draft = validateMealVoucherDraft(rawDraft);
      const signature = JSON.stringify({ ...draft, files: draft.files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })) });
      if (progress.signature && progress.signature !== signature) {
        if (!await canEditPending(rawDraft, progress)) throw new Error('O lote não pode ser alterado porque já existem registros gravados. Retome o envio com os dados originais.');
        for (const name of ['orderId', 'orderUpdated', 'lines', 'payroll', 'uploadedFiles']) delete progress[name];
      }
      progress.editable = false;
      const live = await loadOptions();
      for (const line of draft.lines) {
        const match = live.suppliers.find(row => row.id === line.supplier.id);
        if (!match || key(match.label) !== key(line.supplier.label) || key(match.branch) !== key(draft.branch) || key(match.profession) !== key(line.supplier.profession)) throw new Error('O cadastro de um fornecedor mudou; revise o lote.');
      }
      if (!live.stages.some(row => row.id === draft.stage.id && key(row.branch) === key(draft.branch) && key(row.label) === key(draft.stage.label))) throw new Error('A etapa foi alterada no cadastro; revise o lote.');
      if (!live.accounts.some(row => row.id === draft.account.id && key(row.label) === key(draft.account.label))) throw new Error('A conta foi alterada no cadastro; revise o lote.');
      for (const file of draft.files) { const validation = validateAttachment(file); if (!validation.valid) throw new Error(validation.message); }
      const sheets = await loadSheetAssignments(draft.referenceMonth, draft.lines.map(line => line.supplier));
      const [orders, launches, payroll] = await Promise.all([describe('NOTASPENDENTES'), describe('LANCAMENTOS'), describe('FOLHAPGTO')]);
      const tokenCache = new Map();
      column(launches, ['__PowerAppsId__']);
      column(payroll, ['Title']);
      for (const line of draft.lines) payload(payroll, { FORNECEDOR: line.supplier.label, TIPOPGTO: mealPaymentType, VALORUNITARIO: line.unitValue, QTD: line.quantity, DATA: draft.date, IDFOLHA: Number(sheets[line.supplier.id].id), IDLANCAMENTO: 1 });
      let orderId = progress.orderId;
      if (draft.orderMode === 'existing') {
        orderId = draft.orderId;
        if (progress.orderId && progress.orderId !== orderId) throw new Error('O pedido foi alterado depois do início da postagem.');
        const order = await get(orders, orderId);
        const supplier = value(orders, order, ['FORNECEDOR']);
        if (key(value(orders, order, ['FILIAL'])) !== key(draft.branch)) throw new Error('O pedido pertence a outra filial.');
        if (!pending(value(orders, order, ['STATUS']))) throw new Error('O pedido não está pendente.');
        if (key(supplier) !== 'DIVERSOS' && (draft.lines.length !== 1 || key(supplier) !== key(draft.lines[0].supplier.label))) throw new Error('O fornecedor do pedido não é compatível com o lote.');
        if (draft.files.length) {
          const existingFiles = await repository.listAttachments(siteKey, orders.id, orderId);
          for (const file of draft.files) if (existingFiles.some(row => row.fileName === file.name) && !progress.uploadedFiles?.[file.name])
            throw new Error(`O pedido já possui um anexo chamado ${file.name}. Renomeie o novo arquivo antes de enviar.`);
        }
      } else {
        const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`;
        const orderObs = `${draft.obs}${draft.obs ? '\n' : ''}${marker}`;
        const fields = payload(orders, { FILIAL: draft.branch, FORNECEDOR: draft.lines.length === 1 ? draft.lines[0].supplier.label : 'DIVERSOS', VALORTOTAL: orderTotal(orders, draft.total), 'DATA PEDIDO': draft.date, STATUS: 'PENDENTE AUDITORIA', OBS: orderObs, FORMAPGTO: draft.account.label, 'NOTA FISCAL': 'PENDENTE' }, ['DATA PEDIDO','STATUS','FORMAPGTO','NOTA FISCAL']);
        progress.signature = signature;
        onProgress();
        const legacyToken = `APP-vale-alimentacao-${progress.operationId}`;
        const legacy = column(orders, ['Title'], false) && await findToken(orders, 'Title', legacyToken, tokenCache);
        if (legacy) {
          const saved = await get(orders, legacy.id);
          const expectedSupplier = draft.lines.length === 1 ? draft.lines[0].supplier.label : 'DIVERSOS';
          if (key(value(orders, saved, ['FORNECEDOR'])) !== key(expectedSupplier)
            || !amount(value(orders, saved, ['VALORTOTAL'])).equals(amount(draft.total))
            || !pending(value(orders, saved, ['STATUS'])))
            throw new Error('O pedido da tentativa anterior mudou; confira-o antes de retomar.');
          const currentObs = value(orders, saved, ['OBS']);
          if (key(value(orders, saved, ['FILIAL'])) !== key(draft.branch) || !currentObs.includes(marker)) {
            const nextObs = currentObs.includes(marker) ? currentObs : `${currentObs}${currentObs ? '\n' : ''}${marker}`;
            const repair = payload(orders, { FILIAL: draft.branch, OBS: nextObs });
            await repository.updateItem(siteKey, orders.id, legacy.id, repair, { eTag: saved.eTag || saved['@odata.etag'] });
            assertSession();
          }
          const repaired = await get(orders, legacy.id);
          if (key(value(orders, repaired, ['FILIAL'])) !== key(draft.branch) || !value(orders, repaired, ['OBS']).includes(marker))
            throw new Error('O pedido anterior não foi confirmado no SharePoint.');
          orderId = String(legacy.id);
        } else orderId = await ensureOrder(orders, fields, marker, tokenCache);
      }
      progress.orderId = orderId;
      progress.signature = signature;
      onProgress();
      progress.lines ??= {};
      const resultLines = [];
      for (const line of draft.lines) {
        const fields = payload(launches, { AGRUPAR: String(orderId), FILIAL: draft.branch, 'TIPO TRANSAÇÃO': 'CUSTO', DATA: draft.date, 'DATA PGTO PREVISTO': draft.dueDate, ...(draft.paymentDate ? { 'DATA PGTO EFETUADO': draft.paymentDate } : {}), FORNECEDOR: line.supplier.label, PRODUTO: line.supplier.profession, ETAPA: draft.stage.label, QUANTIDADE: line.quantity, 'VALOR UNITÁRIO': line.unitValue, CONTA: draft.account.label, FRETE: 0, OBS: `VALE ALIMENTAÇÃO${draft.obs ? ` — ${draft.obs}` : ''}` }, ['FRETE','OBS']);
        const launchId = await ensure(launches, fields, '__PowerAppsId__', `APP-vale-alimentacao-${progress.operationId}-${line.supplier.id}`, tokenCache);
        progress.lines[line.supplier.id] = launchId;
        onProgress();
        resultLines.push({ supplier: line.supplier.label, id: launchId, total: line.total });
      }
      if (draft.orderMode === 'existing' && !progress.orderUpdated) {
        const current = await get(orders, orderId);
        const previous = amount(value(orders, current, ['VALORTOTAL'], false));
        const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`;
        const obs = value(orders, current, ['OBS']);
        if (!obs.includes(marker)) {
          const target = previous.plus(amount(draft.total)).toDecimalPlaces(2);
          const update = payload(orders, { VALORTOTAL: orderTotal(orders, target.toNumber()), OBS: `${obs}${obs ? '\n' : ''}${marker}` });
          await repository.updateItem(siteKey, orders.id, orderId, update, { eTag: current.eTag || current['@odata.etag'] });
          assertSession();
          const saved = await get(orders, orderId);
          if (!amount(value(orders, saved, ['VALORTOTAL'])).equals(target) || !value(orders, saved, ['OBS']).includes(marker)) throw new Error('O total do pedido não foi confirmado.');
        }
        progress.orderUpdated = true;
        onProgress();
      }
      if (draft.files.length) {
        const existing = await repository.listAttachments(siteKey, orders.id, orderId);
        progress.uploadedFiles ??= {};
        for (const file of draft.files) {
          if (existing.some(row => row.fileName === file.name)) {
            if (!progress.uploadedFiles[file.name]) throw new Error(`O pedido já possui um anexo chamado ${file.name}. Renomeie o arquivo.`);
            continue;
          }
          await repository.uploadAttachment(siteKey, orders.id, orderId, file);
          assertSession();
          const verified = await repository.listAttachments(siteKey, orders.id, orderId);
          if (!verified.some(row => row.fileName === file.name)) throw new Error(`O anexo ${file.name} não foi confirmado.`);
          progress.uploadedFiles[file.name] = true;
          onProgress();
        }
      }
      progress.payroll ??= {};
      const sheetDescriptor = await describe('IDFOLHA');
      for (let index = 0; index < draft.lines.length; index++) {
        const line = draft.lines[index], sheet = sheets[line.supplier.id], resultLine = resultLines[index];
        const currentSheet = await get(sheetDescriptor, sheet.id);
        if (monthKey(value(sheetDescriptor, currentSheet, ['MESREFERENCIA', 'MES REFERENCIA'])) !== draft.referenceMonth
          || key(value(sheetDescriptor, currentSheet, ['FORNECEDOR'])) !== key(line.supplier.label))
          throw new Error(`A IDFOLHA de ${line.supplier.label} mudou durante o lançamento; confira e retome.`);
        const fields = payload(payroll, { FORNECEDOR: line.supplier.label, TIPOPGTO: mealPaymentType, VALORUNITARIO: line.unitValue, QTD: line.quantity, DATA: draft.date, IDFOLHA: Number(sheet.id), IDLANCAMENTO: Number(resultLine.id) });
        const payrollId = await ensure(payroll, fields, 'Title', `APP-vale-alimentacao-${progress.operationId}-folha-${line.supplier.id}`, tokenCache);
        progress.payroll[line.supplier.id] = payrollId;
        onProgress();
        resultLine.sheetId = sheet.id;
        resultLine.payrollId = payrollId;
      }
      return { orderId, lines: resultLines, total: draft.total };
    } finally { posting = false; }
  }
  return Object.freeze({ prepare, loadOptions, loadOrders, loadSheetAssignments, canEditPending, post });
}
