import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { createSharePointAttachmentTransport, validateAttachment } from '../../../../portal/data/attachments.js';
import { mealVoucherKey as key, validateMealVoucherDraft } from './meal-voucher.js';
import { payrollDecimal } from './supplier-payroll.js';
import { PAYROLL_RUBRICS } from './supplier-payroll.js';
import { MEAL_VOUCHER_CONTROL_COLUMN, mealVoucherControlColumn, ensureMealVoucherSchema } from './meal-voucher-schema.js';
import { createMealVoucherAttachments } from './meal-voucher-attachments.js';

const scalar = value => String(value && typeof value === 'object' ? value.LookupValue ?? value.Value ?? value.value ?? '' : value ?? '').trim();
const numericId = value => /^[1-9]\d{0,14}$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value));
const pending = value => /^(?:PENDENTE|RASCUNHO|EMABERTO)/.test(key(value));
const amount = value => payrollDecimal(value || 0).toDecimalPlaces(2);
const mealPaymentType = PAYROLL_RUBRICS.find(rubric => rubric.id === 'meal').payrollType;
// Instances share this fallback; Web Locks also coordinate other tabs/WebViews
// sharing this origin. A pending draft's random operation ID is local to it.
const pendingOperations = new Set();
async function guardOperation(progress, action, inspection = false) {
  const id = String(progress.operationId || '');
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('A operação não foi identificada.');
  const unavailable = () => { if (inspection) return false; throw new Error('Este lote já está sendo enviado em outra tela. Aguarde a conclusão antes de retomar.'); };
  if (pendingOperations.has(id)) return unavailable();
  pendingOperations.add(id);
  try {
    const locks = globalThis.navigator?.locks;
    return locks?.request
      ? await locks.request(`energetico:meal-voucher:operation:${id}`, { mode:'exclusive', ifAvailable:true }, lock => lock ? action() : unavailable())
      : await action();
  } finally { pendingOperations.delete(id); }
}
async function revisionMarker(draft, operationId) {
  const canonical = JSON.stringify({ orderMode:draft.orderMode, orderId:draft.orderMode === 'existing' ? String(draft.orderId) : '',
    date:draft.date, dueDate:draft.dueDate, paymentDate:draft.paymentDate || '', referenceMonth:draft.referenceMonth,
    account:draft.account, stage:draft.stage, obs:draft.obs, files:draft.files.map(({ name,size,lastModified }) => ({ name,size,lastModified })),
    lines:draft.lines.map(({ supplier,quantity,unitValue }) => ({ supplier,quantity,unitValue })).sort((a,b) => String(a.supplier.id).localeCompare(String(b.supplier.id))) });
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return `[VALE REVISÃO ${operationId} ${hash}]`;
}
function revisions(obs, operationId) { return scalar(obs).split('\n').filter(line => line.startsWith(`[VALE REVISÃO ${operationId} `)); }
function appendedNotes(actual, expected) {
  const suffix = scalar(actual).slice(expected.length);
  return suffix && !suffix.startsWith('\n') ? `\n${suffix}` : suffix;
}
function monthKey(raw) {
  const text = scalar(raw), brazil = text.match(/^(0?[1-9]|1[0-2])[/-](\d{4})$/), iso = text.match(/^(\d{4})[-/](0?[1-9]|1[0-2])(?:$|[-/T])/);
  return brazil ? `${brazil[2]}-${brazil[1].padStart(2, '0')}` : iso ? `${iso[1]}-${iso[2].padStart(2, '0')}` : '';
}

export function createMealVoucherData({ repository, graph, tokenProvider, siteConfig = SHAREPOINT_SITES, fetchImpl = globalThis.fetch, siteKey = 'personal', assertSession = () => {} } = {}) {
  if (!repository) {
    if (typeof tokenProvider !== 'function') throw new TypeError('É necessária uma sessão Microsoft ativa.');
    graph = createGraphClient(tokenProvider, { fetch: fetchImpl });
    repository = createSharePointRepository(graph, siteConfig, { attachmentTransport: createSharePointAttachmentTransport({ tokenProvider, allowedSites: Object.values(siteConfig), fetch: fetchImpl }) });
  }
  const descriptors = new Map();
  const attachments = createMealVoucherAttachments({ repository, assertSession, siteKey });
  let posting = false;
  async function prepare() {
    if (!tokenProvider) return;
    for (const scopes of [['Sites.Read.All', 'Sites.ReadWrite.All'], [`https://${siteConfig[siteKey].host}/AllSites.Read`, `https://${siteConfig[siteKey].host}/AllSites.Write`]]) {
      assertSession();
      if (!await tokenProvider(scopes)) throw new Error('Não foi possível autorizar os lançamentos.');
    }
    await ensureMealVoucherSchema({ repository, graph, assertSession, siteKey });
    descriptors.delete('NOTASPENDENTES');
  }
  async function describe(name) {
    assertSession();
    if (!descriptors.has(name)) {
      const list = await repository.resolveList(siteKey, [name]);
      if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} não está disponível.`);
      const columns = [...await repository.getColumns(siteKey, list.id, name === 'NOTASPENDENTES' ? { includeHidden:true } : {})];
      assertSession();
      // Legacy inspection stays read-only even before the schema migration.
      if (name === 'NOTASPENDENTES' && !mealVoucherControlColumn(columns)) columns.push({ name:MEAL_VOUCHER_CONTROL_COLUMN,
        hidden:true, text:{allowMultipleLines:true}, virtual:true });
      descriptors.set(name, { id: list.id, name, columns });
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
  function control(descriptor) { return column(descriptor, [MEAL_VOUCHER_CONTROL_COLUMN]).name; }
  function readQuery(descriptor) {
    if (descriptor.name !== 'NOTASPENDENTES' || column(descriptor,[MEAL_VOUCHER_CONTROL_COLUMN]).virtual) return '$expand=fields';
    // Graph omits hidden values from a bare expand, even when the column exists.
    const names = descriptor.columns.filter(c=>!c.virtual && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name)).map(c=>c.name);
    return `$expand=fields($select=${names.join(',')})`;
  }
  function normalizedOrder(descriptor, row) {
    if (descriptor.name !== 'NOTASPENDENTES' || !row?.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) return row;
    const obsName = column(descriptor,['OBS']).name, controlName = control(descriptor);
    const technical = /^\[VALE (?:ALIMENTAÇÃO [A-Za-z0-9-]{1,80}|REVISÃO [A-Za-z0-9-]{1,80} [a-f0-9]{64}|DESTINO [A-Za-z0-9-]{1,80} [1-9]\d*)\]$/;
    const lines = scalar(row.fields[obsName]).split('\n'), legacy = lines.filter(line=>technical.test(line));
    if (!legacy.length) return row;
    const existing = scalar(row.fields[controlName]).split('\n').filter(Boolean);
    return { ...row, mealLegacyObs:true, fields:{ ...row.fields,
      [obsName]:lines.filter(line=>!technical.test(line)).join('\n').trim(),
      [controlName]:[...new Set([...existing,...legacy])].join('\n') } };
  }
  async function orderFields(descriptor, draft, operationId, versioned = true) {
    const marker = `[VALE ALIMENTAÇÃO ${operationId}]`;
    const revision = versioned ? `\n${await revisionMarker(draft, operationId)}` : '';
    const destination = versioned && draft.files.length ? `\n[VALE DESTINO ${operationId} ${draft.lines.at(-1).supplier.id}]` : '';
    return payload(descriptor, { FILIAL:draft.branch, FORNECEDOR:draft.lines.length === 1 ? draft.lines[0].supplier.label : 'DIVERSOS',
      VALORTOTAL:orderTotal(descriptor, draft.total), 'DATA PEDIDO':draft.date, STATUS:'PENDENTE AUDITORIA',
      OBS:draft.obs, [MEAL_VOUCHER_CONTROL_COLUMN]:`${marker}${revision}${destination}`, FORMAPGTO:draft.account.label, 'NOTA FISCAL':'PENDENTE' }, ['DATA PEDIDO','STATUS','FORMAPGTO','NOTA FISCAL']);
  }
  function matchesFields(descriptor, row, fields) {
    return Object.entries(fields).every(([name, expected]) => {
      const actual = row.fields?.[name];
      return typeof expected === 'number' ? Number(actual) === expected : scalar(actual) === scalar(expected)
        || descriptor.columns.find(c => c.name === name)?.dateTime && String(actual ?? '').slice(0, 10) === String(expected).slice(0, 10);
    });
  }
  function launchFields(descriptor, draft, line, orderId) {
    return payload(descriptor, { AGRUPAR:String(orderId), FILIAL:draft.branch, 'TIPO TRANSAÇÃO':'CUSTO', DATA:draft.date,
      'DATA PGTO PREVISTO':draft.dueDate, ...(draft.paymentDate ? { 'DATA PGTO EFETUADO':draft.paymentDate } : {}),
      FORNECEDOR:line.supplier.label, PRODUTO:line.supplier.profession, ETAPA:draft.stage.label, QUANTIDADE:line.quantity,
      'VALOR UNITÁRIO':line.unitValue, CONTA:draft.account.label, FRETE:0, OBS:`VALE ALIMENTAÇÃO${draft.obs ? ` — ${draft.obs}` : ''}` }, ['FRETE','OBS']);
  }
  function payrollFields(descriptor, draft, line, sheet, launchId) {
    return payload(descriptor, { FORNECEDOR:line.supplier.label, TIPOPGTO:mealPaymentType, VALORUNITARIO:line.unitValue,
      QTD:line.quantity, DATA:draft.date, IDFOLHA:Number(sheet.id), IDLANCAMENTO:Number(launchId) });
  }
  async function preflightLines(launches, payroll, draft, sheets, orderId, operationId, tokenCache) {
    const [savedLaunches, savedPayroll] = await Promise.all([all(launches), all(payroll)]);
    if ([...savedLaunches,...savedPayroll].some(row => !numericId(row?.id) || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)))
      throw new Error('Não foi possível confirmar todos os dados da tentativa anterior.');
    const launchToken = column(launches, ['__PowerAppsId__']).name, payrollToken = column(payroll, ['Title']).name;
    const paidColumn = column(launches, ['DATA PGTO EFETUADO'], false)?.name;
    const prefix = `APP-vale-alimentacao-${operationId}-`;
    const selected = new Map(draft.lines.map(line => [String(line.supplier.id), line]));
    const owned = (rows, tokenName, start) => rows.filter(row => scalar(row.fields?.[tokenName]).startsWith(start) && /^\d+$/.test(scalar(row.fields[tokenName]).slice(start.length)));
    for (const row of owned(savedLaunches, launchToken, prefix)) {
      const line = selected.get(scalar(row.fields[launchToken]).slice(prefix.length));
      if (!line || !matchesFields(launches, row, launchFields(launches, draft, line, orderId))
        || !draft.paymentDate && paidColumn && scalar(row.fields[paidColumn])) throw new Error('A revisão do lote está desatualizada ou os dados de um lançamento foram alterados. Confira antes de retomar.');
    }
    const payrollPrefix = `${prefix}folha-`;
    for (const row of owned(savedPayroll, payrollToken, payrollPrefix)) {
      const supplierId = scalar(row.fields[payrollToken]).slice(payrollPrefix.length), line = selected.get(supplierId);
      const launch = savedLaunches.find(item => scalar(item.fields?.[launchToken]) === `${prefix}${supplierId}`);
      if (!line || !launch || !matchesFields(payroll, row, payrollFields(payroll, draft, line, sheets[supplierId], launch.id))) throw new Error('A revisão do lote está desatualizada ou os dados da folha foram alterados. Confira antes de retomar.');
    }
    tokenCache.set(launches.id, savedLaunches); tokenCache.set(payroll.id, savedPayroll);
  }
  async function confirmOrderRevision(orders, orderId, draft, operationId) {
    const row = await get(orders, orderId), controlName = control(orders), revision = await revisionMarker(draft, operationId);
    const known = revisions(row.fields[controlName], operationId);
    if (known.length && (known.length !== 1 || known[0] !== revision)) throw new Error('Esta tela está com uma revisão desatualizada do lote. Reabra o lançamento antes de continuar.');
    if (!known.length && draft.orderMode === 'new' || row.mealLegacyObs) {
      const eTag = row.eTag || row['@odata.etag'];
      if (!eTag || eTag === '*') throw new Error('A versão do pedido não foi confirmada.');
      const next = known.length || draft.orderMode !== 'new' ? scalar(row.fields[controlName]) : `${scalar(row.fields[controlName])}\n${revision}`;
      const obsName = column(orders,['OBS']).name;
      await repository.updateItem(siteKey, orders.id, orderId, { [controlName]:next,
        ...(row.mealLegacyObs ? {[obsName]:row.fields[obsName]} : {}) }, { eTag });
      assertSession();
      const saved = await get(orders, orderId);
      if (saved.mealLegacyObs || JSON.stringify(revisions(saved.fields[controlName], operationId)) !== JSON.stringify(known.length || draft.orderMode === 'new' ? [revision] : [])) throw new Error('A revisão do pedido não foi confirmada.');
    }
    return revision;
  }
  async function all(descriptor) {
    const result = [], seen = new Set(); let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      assertSession();
      const page = await repository.getItemsPage(siteKey, descriptor.id, `${readQuery(descriptor)}&$top=100`, { pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}), headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
      assertSession();
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean') throw new Error('A resposta do SharePoint está incompleta.');
      result.push(...page.items.map(row=>normalizedOrder(descriptor,row)));
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
    const row = await repository.getItem(siteKey, descriptor.id, String(id), readQuery(descriptor));
    assertSession();
    if (String(row?.id) !== String(id)) throw new Error('O registro não foi confirmado no SharePoint.');
    return normalizedOrder(descriptor,row);
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
  async function ensureOrder(descriptor, fields, marker, tokenCache, edit) {
    const obsName = column(descriptor, ['OBS']).name, controlName = control(descriptor);
    const totalName = column(descriptor,['VALORTOTAL']).name;
    if (!tokenCache.has(descriptor.id)) tokenCache.set(descriptor.id, await all(descriptor));
    const matches = tokenCache.get(descriptor.id).filter(row => scalar(row.fields?.[controlName]).includes(marker));
    if (matches.length > 1) throw new Error('Foram encontrados pedidos duplicados da operação. Confira os registros antes de retomar.');
    let row = matches[0] || edit?.row;
    if (edit) {
      if (String(row?.id) !== String(edit.row.id)) throw new Error('O pedido da tentativa anterior mudou; confira antes de retomar.');
      const current = await get(descriptor, row.id);
      if (!matchesFields(descriptor, current, edit.fields)) throw new Error('O pedido foi alterado por outra operação. Reabra a tela para conferir.');
      // Preserve notes appended by an auditor/automation after our marker.
      const suffix = appendedNotes(current.fields[obsName], edit.expectedObs);
      const nextObs = fields[obsName];
      fields = { ...fields, [obsName]:fields[obsName] + suffix };
      if (!matchesFields(descriptor, current, fields)) {
        const eTag = current.eTag || current['@odata.etag'];
        if (!eTag || eTag === '*') throw new Error('A versão do pedido não foi confirmada; reabra a tela antes de editar.');
        edit.progress.orderEdit = { id:String(row.id), before:edit.fields, after:fields, beforeObs:edit.expectedObs, afterObs:nextObs };
        edit.onProgress();
        const latest = await inspectPending({}, edit.progress);
        if (!latest.editable || String(latest.order?.row.id) !== String(row.id)) throw new Error('O pedido já recebeu registros ou mudou durante a conferência. Reabra a tela para retomar.');
        await repository.updateItem(siteKey, descriptor.id, row.id, fields, { eTag });
        assertSession();
      }
    }
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
      if (field === totalName) continue; // Verified against all recognized batches before any launch write below.
      if (field === controlName ? !scalar(actual).includes(marker)
        : field === obsName ? !(scalar(actual) === scalar(expected) || scalar(actual).startsWith(`${scalar(expected)}${scalar(expected) ? '\n' : ''}`))
        : !(typeof expected === 'number' ? Number(actual) === expected : scalar(actual) === String(expected) || date && String(actual ?? '').slice(0, 10) === String(expected).slice(0, 10)))
        throw new Error('O SharePoint não confirmou os dados do pedido gravado.');
    }
    return String(row.id);
  }
  async function confirmOriginatingOrderTotal(orders,launches,orderId,draft,operationId,tokenCache) {
    const row = await get(orders,orderId), actual = amount(value(orders,row,['VALORTOTAL']));
    const controls = scalar(row.fields[control(orders)]).split('\n');
    const otherOperations = [...new Set(controls.map(line=>line.match(/^\[VALE ALIMENTAÇÃO ([A-Za-z0-9-]{1,80})\]$/)?.[1]).filter(id=>id && id !== operationId))];
    let expected = amount(draft.total);
    for (const id of otherOperations) {
      if (revisions(row.fields[control(orders)],id).length !== 1) throw new Error('O total acumulado do pedido não foi confirmado.');
      const prefix = `APP-vale-alimentacao-${id}-`;
      const additions = tokenCache.get(launches.id).filter(item=>value(launches,item,['AGRUPAR'],false) === String(orderId)
        && scalar(item.fields?.[column(launches,['__PowerAppsId__']).name]).startsWith(prefix)
        && /^\d+$/.test(scalar(item.fields[column(launches,['__PowerAppsId__']).name]).slice(prefix.length)));
      if (!additions.length) throw new Error('O total acumulado do pedido não foi confirmado.');
      for (const addition of additions) {
        const quantity = payrollDecimal(value(launches,addition,['QUANTIDADE'])), unit = payrollDecimal(value(launches,addition,['VALOR UNITÁRIO']));
        if (!quantity.gt(0) || !unit.gt(0) || !amount(value(launches,addition,['FRETE'],false)).isZero()) throw new Error('Os valores do lote adicional do pedido mudaram.');
        expected = expected.plus(quantity.times(unit).toDecimalPlaces(2));
      }
    }
    if (!actual.equals(expected)) throw new Error('O SharePoint não confirmou o total acumulado do pedido. Confira os registros antes de retomar.');
  }
  async function attachmentDestination(orders, orderId, draft, progress, {mayInfer = true, replace = false} = {}) {
    const row = await get(orders,orderId), name = control(orders);
    const prefix = `[VALE DESTINO ${progress.operationId} `;
    const matches = scalar(row.fields[name]).split('\n').filter(line=>line.startsWith(prefix));
    if (matches.length > 1) throw new Error('O destino dos anexos do lote está ambíguo.');
    let saved = matches[0]?.slice(prefix.length,-1);
    if (replace) saved = undefined;
    if (!saved && !mayInfer) throw new Error('Não foi possível recuperar a ordem original deste lote legado. Retome com o rascunho original para definir o último lançamento; nenhum anexo foi enviado.');
    const supplierId = saved || String(draft.lines.at(-1).supplier.id);
    if (saved && matches[0] !== `${prefix}${supplierId}]` || !draft.lines.some(line=>String(line.supplier.id)===supplierId)
      || progress.attachmentSupplierId && progress.attachmentSupplierId !== supplierId) throw new Error('O destino dos anexos deste lote mudou. Confira a tentativa original.');
    if (!saved) {
      const eTag = row.eTag || row['@odata.etag'];
      if (!eTag || eTag === '*') throw new Error('A versão do destino dos anexos não foi confirmada.');
      const previous = scalar(row.fields[name]).split('\n').filter(line=>!line.startsWith(prefix)).join('\n');
      await repository.updateItem(siteKey,orders.id,orderId,{[name]:`${previous}\n${prefix}${supplierId}]`},{eTag}); assertSession();
      const confirmed = await get(orders,orderId);
      if (!scalar(confirmed.fields[name]).split('\n').includes(`${prefix}${supplierId}]`)) throw new Error('O destino dos anexos não foi confirmado.');
    }
    return supplierId;
  }
  async function inspectPending(rawDraft, progress = {}) {
    assertSession();
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    const blocked = { editable:false };
    if (progress.orderUpdated || ['lines', 'payroll', 'uploadedFiles'].some(name => Object.keys(progress[name] || {}).length)) return blocked;
    let original = rawDraft;
    if (progress.signature) {
      try { original = JSON.parse(progress.signature); } catch { throw new Error('Não foi possível conferir o lote anterior.'); }
      if (!original || !['new', 'existing'].includes(original.orderMode)) throw new Error('O lote anterior está incompleto.');
    }
    const [orders, launches, payroll] = await Promise.all([describe('NOTASPENDENTES'), describe('LANCAMENTOS'), describe('FOLHAPGTO')]);
    const obs = column(orders, ['OBS']).name, controlName = control(orders), title = column(orders, ['Title'], false)?.name;
    const launchToken = column(launches, ['__PowerAppsId__']).name, payrollToken = column(payroll, ['Title']).name;
    const records = await Promise.all([orders, launches, payroll].map(all));
    if (records.some(rows => rows.some(row => !numericId(row?.id) || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields))))
      throw new Error('Não foi possível confirmar todos os registros da tentativa anterior.');
    const prefix = `APP-vale-alimentacao-${progress.operationId}`.toUpperCase();
    const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`.toUpperCase();
    const ownsToken = (raw, start) => { const token = scalar(raw).toUpperCase(); return token.startsWith(start) && /^\d+$/.test(token.slice(start.length)); };
    assertSession();
    const ownedOrders = records[0].filter(row => scalar(row.fields[controlName]).toUpperCase().includes(marker) || title && scalar(row.fields[title]).toUpperCase() === prefix);
    if (ownedOrders.length > 1 || records[1].some(row => ownsToken(row.fields[launchToken], `${prefix}-`)
      || ownedOrders.some(order => scalar(value(launches, row, ['AGRUPAR'], false)) === String(order.id)))
      || records[2].some(row => ownsToken(row.fields[payrollToken], `${prefix}-FOLHA-`))) return blocked;
    if (!ownedOrders.length) return original.orderMode === 'new' && progress.orderId ? blocked : { editable:true };
    if (original.orderMode !== 'new' || progress.orderId && String(progress.orderId) !== String(ownedOrders[0].id)) return blocked;
    const row = await get(orders, ownedOrders[0].id);
    if (!(row.eTag || row['@odata.etag']) || (row.eTag || row['@odata.etag']) === '*') return blocked;
    if (!pending(value(orders, row, ['STATUS']))) return blocked;
    const verified = validateMealVoucherDraft(original);
    const baseline = await orderFields(orders, verified, progress.operationId);
    const candidates = [{ fields:baseline, expectedObs:baseline[obs] }];
    if (!revisions(row.fields[controlName], progress.operationId).length) {
      const legacy = await orderFields(orders, verified, progress.operationId, false);
      candidates.push({ fields:legacy, expectedObs:legacy[obs] });
      // The first app version stored the operation token in Title, which can
      // also be FILIAL's internal column, before OBS carried our marker.
      if (title && scalar(row.fields[title]).toUpperCase() === prefix) {
        const branchColumn = column(orders, ['FILIAL']).name;
        const required = ['FORNECEDOR','VALORTOTAL','STATUS'].map(name => column(orders, [name]).name);
        const known = Object.fromEntries(Object.entries(legacy).filter(([name]) => name !== obs && name !== branchColumn
          && (required.includes(name) || scalar(row.fields[name]))));
        const actualObs = scalar(row.fields[obs]);
        const previousObs = actualObs === legacy[obs] || actualObs.startsWith(`${legacy[obs]}\n`) ? legacy[obs] : verified.obs;
        const sameBranch = branchColumn === title || !scalar(row.fields[branchColumn]) || key(row.fields[branchColumn]) === key(verified.branch);
        if (sameBranch && matchesFields(orders, row, known) && (!previousObs || actualObs === previousObs || actualObs.startsWith(`${previousObs}\n`))) {
          const actual = Object.fromEntries(Object.keys(legacy).map(name => [name, row.fields[name] ?? '']));
          candidates.push({ fields:actual, expectedObs:previousObs });
        }
      }
    }
    // Both outcomes of a lost PATCH response remain recognizable after reopening.
    if (String(progress.orderEdit?.id) === String(row.id)) for (const phase of ['before','after']) {
      const fields = progress.orderEdit[phase], expectedObs = progress.orderEdit[`${phase}Obs`];
      if (!fields || typeof expectedObs !== 'string') continue;
      candidates.push({ fields:normalizedOrder(orders,{fields}).fields,
        expectedObs:normalizedOrder(orders,{fields:{[obs]:expectedObs}}).fields[obs] });
    }
    const expected = candidates.find(({ fields, expectedObs }) => fields && typeof expectedObs === 'string' && Object.keys(baseline).every(name => Object.hasOwn(fields, name))
      && matchesFields(orders, row, { ...fields, [obs]:scalar(row.fields[obs]), [controlName]:scalar(row.fields[controlName]) })
      && JSON.stringify(revisions(row.fields[controlName], progress.operationId)) === JSON.stringify(revisions(fields[controlName], progress.operationId))
      && (!expectedObs || scalar(row.fields[obs]) === expectedObs || scalar(row.fields[obs]).startsWith(`${expectedObs}\n`)));
    if (!expected) return blocked;
    const attachments = await repository.listAttachments(siteKey, orders.id, row.id);
    assertSession();
    if (!Array.isArray(attachments)) throw new Error('Não foi possível conferir os anexos do pedido.');
    if (attachments.length) return blocked;
    return { editable:true, order:{ row, fields:{ ...expected.fields, [obs]:scalar(row.fields[obs]) }, expectedObs:expected.expectedObs } };
  }
  async function canEditPending(rawDraft, progress = {}) {
    return guardOperation(progress, async () => {
      const result = await inspectPending(rawDraft, progress);
      if (result.editable && result.order) progress.orderId = String(result.order.row.id);
      return result.editable;
    }, true);
  }
  async function postUnlocked(rawDraft, progress, onProgress) {
    if (posting) throw new Error('O lote já está sendo enviado.');
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(progress.operationId || ''))) throw new Error('A operação não foi identificada.');
    posting = true;
    try {
      const draft = validateMealVoucherDraft(rawDraft);
      const hadOriginalDraft = Boolean(progress.signature);
      const signature = JSON.stringify({ ...draft, files: draft.files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })) });
      let edit;
      if (progress.signature && progress.signature !== signature) {
        edit = await inspectPending(rawDraft, progress);
        if (!edit.editable) throw new Error('O lote não pode ser alterado porque já existem registros gravados. Retome o envio com os dados originais.');
        if (edit.order && draft.orderMode !== 'new') throw new Error('O pedido desta tentativa já existe e será reutilizado. Não troque para outro pedido.');
        if (!edit.order) delete progress.orderId;
        for (const name of ['orderUpdated', 'lines', 'payroll', 'uploadedFiles', 'fileManifest', 'attachmentSupplierId']) delete progress[name];
      }
      // An earlier PATCH may have failed before committing despite a saved new signature.
      if (!edit && progress.orderEdit) {
        edit = await inspectPending(rawDraft, progress);
        if (!edit.editable) throw new Error('O pedido em edição não pôde ser confirmado. Confira os registros antes de retomar.');
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
      if (column(orders,[MEAL_VOUCHER_CONTROL_COLUMN]).virtual) throw new Error('VALECONTROLE não está disponível. Prepare o controle técnico antes de enviar; nenhum registro financeiro foi criado.');
      const entries = await attachments.prepare(draft.files,progress.fileManifest);
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
        await attachments.check({listId:orders.id,id:orderId},entries);
      } else {
        const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`;
        const fields = await orderFields(orders, draft, progress.operationId);
        if (edit?.order) {
          const obsName = column(orders, ['OBS']).name;
          const suffix = appendedNotes(edit.order.row.fields[obsName], edit.order.expectedObs);
          // Persist both recognizable outcomes BEFORE advancing the signature or
          // performing another read: even a failed lookup must remain resumable.
          progress.orderEdit = { id:String(edit.order.row.id), before:edit.order.fields,
            after:{ ...fields, [obsName]:fields[obsName] + suffix }, beforeObs:edit.order.expectedObs, afterObs:fields[obsName] };
        }
        progress.signature = signature;
        onProgress();
        const legacyToken = `APP-vale-alimentacao-${progress.operationId}`;
        const legacy = column(orders, ['Title'], false) && await findToken(orders, 'Title', legacyToken, tokenCache);
        if (legacy && !edit?.order) {
          const saved = await get(orders, legacy.id);
          const expectedSupplier = draft.lines.length === 1 ? draft.lines[0].supplier.label : 'DIVERSOS';
          if (key(value(orders, saved, ['FORNECEDOR'])) !== key(expectedSupplier)
            || !pending(value(orders, saved, ['STATUS'])))
            throw new Error('O pedido da tentativa anterior mudou; confira-o antes de retomar.');
          const currentControl = scalar(saved.fields[control(orders)]);
          if (key(value(orders, saved, ['FILIAL'])) !== key(draft.branch) || !currentControl.includes(marker) || saved.mealLegacyObs) {
            const next = currentControl.includes(marker) ? currentControl : `${currentControl}${currentControl ? '\n' : ''}${marker}`;
            const repair = payload(orders, { FILIAL: draft.branch, [MEAL_VOUCHER_CONTROL_COLUMN]:next,
              ...(saved.mealLegacyObs ? {OBS:value(orders,saved,['OBS'])} : {}) });
            await repository.updateItem(siteKey, orders.id, legacy.id, repair, { eTag: saved.eTag || saved['@odata.etag'] });
            assertSession();
          }
          const repaired = await get(orders, legacy.id);
          if (key(value(orders, repaired, ['FILIAL'])) !== key(draft.branch) || !scalar(repaired.fields[control(orders)]).includes(marker))
            throw new Error('O pedido anterior não foi confirmado no SharePoint.');
          orderId = String(legacy.id);
        } else orderId = await ensureOrder(orders, fields, marker, tokenCache, edit?.order && { ...edit.order, progress, onProgress });
      }
      await preflightLines(launches, payroll, draft, sheets, orderId, progress.operationId, tokenCache);
      if (draft.orderMode === 'new') await confirmOriginatingOrderTotal(orders,launches,orderId,draft,progress.operationId,tokenCache);
      const revision = await confirmOrderRevision(orders, orderId, draft, progress.operationId);
      if (entries.length) {
        const prefix = `APP-vale-alimentacao-${progress.operationId}-`;
        const hasPreviousLaunch = tokenCache.get(launches.id).some(row=>scalar(row.fields?.[column(launches,['__PowerAppsId__']).name]).startsWith(prefix));
        progress.attachmentSupplierId = await attachmentDestination(orders,orderId,draft,progress,
          {mayInfer:hadOriginalDraft || !hasPreviousLaunch,replace:edit?.editable === true});
      }
      progress.orderId = orderId;
      progress.signature = signature;
      progress.fileManifest = entries.map(entry=>entry.manifest);
      delete progress.orderEdit;
      onProgress();
      progress.lines ??= {};
      const resultLines = [];
      for (const line of draft.lines) {
        const fields = launchFields(launches, draft, line, orderId);
        const launchId = await ensure(launches, fields, '__PowerAppsId__', `APP-vale-alimentacao-${progress.operationId}-${line.supplier.id}`, tokenCache);
        progress.lines[line.supplier.id] = launchId;
        onProgress();
        resultLines.push({ supplier: line.supplier.label, id: launchId, total: line.total });
      }
      if (draft.orderMode === 'existing') {
        const current = await get(orders, orderId);
        const previous = amount(value(orders, current, ['VALORTOTAL'], false));
        const marker = `[VALE ALIMENTAÇÃO ${progress.operationId}]`;
        const currentControl = scalar(current.fields[control(orders)]);
        if (!currentControl.includes(marker)) {
          const target = previous.plus(amount(draft.total)).toDecimalPlaces(2);
          const update = payload(orders, { VALORTOTAL: orderTotal(orders, target.toNumber()),
            [MEAL_VOUCHER_CONTROL_COLUMN]:`${currentControl}${currentControl ? '\n' : ''}${marker}\n${revision}` });
          await repository.updateItem(siteKey, orders.id, orderId, update, { eTag: current.eTag || current['@odata.etag'] });
          assertSession();
          const saved = await get(orders, orderId);
          if (!amount(value(orders, saved, ['VALORTOTAL'])).equals(target) || !scalar(saved.fields[control(orders)]).includes(marker)) throw new Error('O total do pedido não foi confirmado.');
        }
        progress.orderUpdated = true;
        onProgress();
      }
      if (entries.length) {
        const launchId = progress.lines[progress.attachmentSupplierId];
        const destination = await get(launches,launchId);
        if (value(launches,destination,['AGRUPAR']) !== String(orderId)
          || scalar(destination.fields[column(launches,['__PowerAppsId__']).name]) !== `APP-vale-alimentacao-${progress.operationId}-${progress.attachmentSupplierId}`)
          throw new Error('O vínculo do último lançamento mudou. Confira os anexos antes de retomar.');
        await attachments.submit([{listId:orders.id,id:orderId},{listId:launches.id,id:launchId}],entries,() => onProgress());
      }
      progress.payroll ??= {};
      const sheetDescriptor = await describe('IDFOLHA');
      for (let index = 0; index < draft.lines.length; index++) {
        const line = draft.lines[index], sheet = sheets[line.supplier.id], resultLine = resultLines[index];
        const currentSheet = await get(sheetDescriptor, sheet.id);
        if (monthKey(value(sheetDescriptor, currentSheet, ['MESREFERENCIA', 'MES REFERENCIA'])) !== draft.referenceMonth
          || key(value(sheetDescriptor, currentSheet, ['FORNECEDOR'])) !== key(line.supplier.label))
          throw new Error(`A IDFOLHA de ${line.supplier.label} mudou durante o lançamento; confira e retome.`);
        const fields = payrollFields(payroll, draft, line, sheet, resultLine.id);
        const payrollId = await ensure(payroll, fields, 'Title', `APP-vale-alimentacao-${progress.operationId}-folha-${line.supplier.id}`, tokenCache);
        progress.payroll[line.supplier.id] = payrollId;
        onProgress();
        resultLine.sheetId = sheet.id;
        resultLine.payrollId = payrollId;
      }
      return { orderId, lines: resultLines, total: draft.total };
    } finally { posting = false; }
  }
  async function post(rawDraft, progress = {}, onProgress = () => {}) {
    return guardOperation(progress, () => postUnlocked(rawDraft, progress, onProgress));
  }
  return Object.freeze({ prepare, loadOptions, loadOrders, loadSheetAssignments, canEditPending, post });
}
