const scalar = value => String(value ?? '').trim();
const key = value => scalar(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const numericId = value => /^[1-9]\d{0,14}$/.test(scalar(value)) && Number.isSafeInteger(Number(value));
const named = (columns, label) => columns.filter(c => [c.name, c.displayName].some(name => key(name) === key(label)));
const equal = (columns, name, actual, expected) => typeof expected === 'number'
  ? Number(actual) === expected
  : scalar(actual) === scalar(expected) || Boolean(columns.find(c => c.name === name)?.dateTime
    && scalar(actual).slice(0, 10) === scalar(expected).slice(0, 10));

export function payrollLaunchReferenceColumn(columns) {
  const matches = named(columns, 'IDFOLHA');
  if (!matches.length) return null;
  const c = matches[0];
  if (matches.length !== 1 || !c.number || c.readOnly || c.required || c.enforceUniqueValues || c.calculated || c.computed
    || c.lookup || c.personOrGroup || c.text || c.boolean || c.currency || c.choice)
    throw new Error('IDFOLHA de LANCAMENTOS deve ser uma coluna numérica, opcional e gravável.');
  return c;
}

/** Only schema setup, before any financial write. Existing access is sufficient once provisioned. */
export async function ensurePayrollLaunchSchema({ repository, graph, assertSession = () => {}, siteKey = 'personal' }) {
  assertSession();
  const list = await repository.resolveList(siteKey, ['LANCAMENTOS']); assertSession();
  if (!list?.id || list.status === 'unavailable') throw new Error('A lista LANCAMENTOS não está disponível.');
  const columns = await repository.getColumns(siteKey, list.id); assertSession();
  if (payrollLaunchReferenceColumn(columns)) return;
  if (!graph?.request) throw new Error('IDFOLHA de LANCAMENTOS não está disponível. Prepare a referência antes de enviar; nenhum registro financeiro foi criado.');
  const sites = await repository.resolveSites(); assertSession();
  const site = sites[siteKey];
  if (!site?.id || site.status === 'unavailable') throw new Error('O site da referência IDFOLHA não está disponível.');
  let failure;
  try {
    assertSession();
    await graph.request(`/sites/${site.id}/lists/${encodeURIComponent(list.id)}/columns`, {
      method:'POST', scopes:['Sites.Manage.All'], body:{ name:'IDFOLHA', displayName:'IDFOLHA', required:false,
        description:'ID da folha selecionada na criação do lançamento de pagamento. Não preencher por suposição.',
        number:{ decimalPlaces:'none' } },
    });
  } catch (cause) { failure = cause; }
  assertSession(); repository.clearCache();
  const confirmed = await repository.getColumns(siteKey, list.id); assertSession();
  if (!payrollLaunchReferenceColumn(confirmed)) throw failure || new Error('O SharePoint não confirmou IDFOLHA. Nenhum registro financeiro foi criado.');
}

/** Adopt only an empty legacy reference, with an exact original payload and a conditional write. */
export async function confirmPayrollLaunchReference({ columns, item, fields, readItem, updateItem, assertSession = () => {}, assertContext = async () => {} }) {
  const reference = payrollLaunchReferenceColumn(columns);
  if (!reference || !numericId(fields[reference.name]) || !numericId(item?.id)) throw new Error('IDFOLHA do lançamento não foi confirmada.');
  const id = String(item.id), expected = Number(fields[reference.name]);
  const matches = row => String(row?.id) === id && Object.entries(fields).every(([name, value]) => name === reference.name || equal(columns, name, row.fields?.[name], value));
  assertSession(); let saved = await readItem(id); assertSession();
  if (!matches(saved)) throw new Error('Os dados do lançamento foram alterados; a referência IDFOLHA não será modificada.');
  await assertContext(saved); assertSession();
  const current = scalar(saved.fields?.[reference.name]);
  if (current && Number(current) === expected) return saved;
  if (current) throw new Error('O lançamento já possui outra IDFOLHA. Confira o vínculo antes de retomar.');
  const eTag = saved.eTag || saved['@odata.etag'];
  if (!eTag || eTag === '*') throw new Error('A versão do lançamento não foi confirmada para preencher IDFOLHA.');
  let failure;
  try { assertSession(); await updateItem(id, { [reference.name]:expected }, { eTag }); }
  catch (cause) { failure = cause; }
  assertSession(); saved = await readItem(id); assertSession();
  if (!matches(saved) || !scalar(saved.fields?.[reference.name]) || Number(saved.fields[reference.name]) !== expected)
    throw failure || new Error('O SharePoint não confirmou IDFOLHA do lançamento.');
  return saved;
}

/** A source launch may have only one normal payroll association, regardless of its technical title. */
export function compatiblePayrollLaunchLink({ columns, rows, fields }) {
  const origins = named(columns, 'IDLANCAMENTO'), titles = named(columns, 'Title');
  if (origins.length !== 1 || !numericId(fields[origins[0].name]) || !Array.isArray(rows)) throw new Error('O vínculo do lançamento não foi identificado.');
  const origin = origins[0].name;
  const matches = rows.filter(row => numericId(row?.fields?.[origin]) && Number(row.fields[origin]) === Number(fields[origin]));
  if (matches.length > 1) throw new Error('Mais de um vínculo foi encontrado para o lançamento; confira os registros duplicados.');
  if (!matches.length) return null;
  const row = matches[0], title = titles[0]?.name;
  if (!numericId(row?.id) || !Object.entries(fields).every(([name, expected]) => name === title || equal(columns, name, row.fields?.[name], expected)))
    throw new Error('O vínculo do lançamento possui dados ou IDFOLHA divergentes. Confira antes de retomar.');
  return row;
}

export function payrollLaunchLinkFilter(columns, launchId) {
  const origins = named(columns,'IDLANCAMENTO');
  if (origins.length !== 1 || !numericId(launchId)) throw new Error('A origem do vínculo da folha não foi identificada.');
  const c=origins[0];
  return `fields/${c.name} eq ${c.number ? Number(launchId) : `'${launchId}'`}`;
}

const activeWrites = new Set();
export const payrollCreationKey = (siteKey,listId,token) => `energetico:payroll-create:${siteKey}:${listId}:${token}`;
export const payrollOriginKey = (siteKey,listId,launchId) => payrollCreationKey(siteKey,listId,`origin:${launchId}`);
function journalFor(storage) {
  try {
    const journal=storage ?? globalThis.localStorage;
    if(!journal?.getItem || !journal?.setItem || !journal?.removeItem) throw new Error();
    return journal;
  } catch { throw new Error('O armazenamento da retomada está indisponível. Nenhum novo registro financeiro será enviado.'); }
}
export function assertPayrollCreationStorage(storage) {
  const journal=journalFor(storage),probe=`energetico:payroll-create-probe:${globalThis.crypto.randomUUID()}`;
  try { journal.setItem(probe,'ready'); if(journal.getItem(probe)!=='ready')throw new Error('Não foi possível confirmar o armazenamento da retomada.'); }
  finally { journal.removeItem(probe); }
}
export const pendingPayrollCreation = (storage,key) => Boolean(journalFor(storage).getItem(key));
export const clearPayrollCreation = (storage,key) => journalFor(storage).removeItem(key);

/** Coordinate participating app writers by operation or by financial origin. */
export async function withPayrollWriteLock(key, action) {
  const run=async()=>{
    if(activeWrites.has(key))throw new Error('O envio desta origem já está em andamento. Aguarde a confirmação.');
    activeWrites.add(key);
    try { return await action(); } finally { activeWrites.delete(key); }
  };
  const locks=globalThis.navigator?.locks;
  return locks?.request ? locks.request(key,{mode:'exclusive',ifAvailable:true},lock=>{
    if(!lock)throw new Error('O envio desta origem já está em andamento em outra tela.');
    return run();
  }) : run();
}

/** Persist uncertainty BEFORE POST. An invisible pending commit is not permission to retry. */
export async function ensurePayrollCreation({key,storage,findItem,createItem,verifyItem,assertSession=()=>{},onAttempt=()=>{}}) {
  return withPayrollWriteLock(key,async()=>{
    assertSession(); const journal=journalFor(storage),existing=await findItem(); assertSession();
    if(existing) {
      const saved=await verifyItem(existing);assertSession();journal.removeItem(key);return saved;
    }
    if(journal.getItem(key))throw new Error('O envio anterior ainda está pendente de confirmação. Aguarde a reconciliação; não será criado outro registro.');
    journal.setItem(key,'pending');
    if(journal.getItem(key)!=='pending')throw new Error('Não foi possível salvar a retomada antes do envio.');
    try { onAttempt();assertSession(); } catch(cause) {journal.removeItem(key);throw cause;}
    let item;
    try { item=await createItem(); }
    catch(cause) {
      // A definitive HTTP rejection did not accept a write. Network/timeout/5xx
      // errors remain pending until a fresh authoritative lookup finds the row.
      const rejected=[401,403,404,409,412,422,429].includes(cause?.status)
        || cause?.status===400 && /^(invalidRequest|invalidPayload|badRequest|requestValidationFailed|invalidArgument)$/i.test(cause.code||'');
      if(rejected)journal.removeItem(key);
      throw cause;
    }
    assertSession();const saved=await verifyItem(item);assertSession();journal.removeItem(key);return saved;
  });
}
