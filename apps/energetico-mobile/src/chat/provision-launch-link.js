import { provisionDateKey, provisionTotal } from './pending-provision-dates.js';

const PARENT = { paidDate: ['DATAPGTOEFETUADO', 'dateTime'], dueDate: ['DATAPREVISTOPGTO', 'dateTime'] };
const CHILD = {
  ...PARENT, parent: ['DESCRITIVOPROVISAO'], launch: ['IDLANCAMENTOS'], status: ['STATUS'], paid: ['PGTOAGENDADO'],
  supplier: ['FORNECEDOR'], branch: ['FILIAL'], product: ['PRODUTO'], quantity: ['QTD'], unit: ['VALORTOTAL'], freight: ['FRETE'],
};
const LAUNCH = {
  paidDate: ['DATAPGTOEFETUADO', 'dateTime'], child: ['IDPGTOAGENDADO'], supplier: ['FORNECEDOR'], branch: ['FILIAL'],
  quantity: ['QUANTIDADE', 'number'], unit: ['VALORUNITARIO', 'number'], freight: ['FRETE', 'number'],
};
const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const text = value => String(value ?? '').trim();
const branch = value => text(value).match(/^\d+(?=\s*(?:-|$))/)?.[0] || key(value);
const etag = row => text(row?.eTag || row?.['@odata.etag'] || row?.['odata.etag']);
const isPaid = row => Boolean(row.paidDate) && (key(row.paid) === 'PAGO' || key(row.status) === 'PAGAMENTOEFETUADO');
const isPending = row => key(row.status) === 'PAGAMENTOPREVISTO' && !row.rawDate && key(row.paid) !== 'PAGO';
const sameFinancialDetails = (left, right) => ['supplier', 'branch', 'product', 'unit', 'quantity', 'freight']
  .every(field => left[field] === right[field]);
const dateField = value => /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value).toISOString() : `${provisionDateKey(value)}T12:00:00Z`;

function requireId(value) {
  const id = text(value);
  if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error('Informe um ID válido do lançamento ou da provisão.');
  return id;
}

export function createProvisionLaunchLink({ repository, siteKey = 'personal', assertSession = () => {} }) {
  const operations = new WeakMap();
  let saving = false;

  async function remote(method, ...args) {
    assertSession();
    try { return await repository[method](siteKey, ...args); }
    finally { assertSession(); }
  }

  async function describe(names, fields, writable) {
    const list = await remote('resolveList', names);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`Lista ${names[0]} indisponível.`);
    const columns = await remote('getColumns', list.id);
    if (!Array.isArray(columns) || columns.complete === false || columns.partial || columns.truncated) {
      throw new Error(`Metadados incompletos de ${names[0]}.`);
    }
    const mapping = Object.fromEntries(Object.entries(fields).map(([name, [label, type = 'text']]) => {
      const matches = columns.filter(column => !column.hidden && !column.computed && !column.calculated
        && column[type] && [column.name, column.displayName].some(value => key(value) === label));
      const internal = matches.filter(column => key(column.name) === label);
      const candidates = internal.length ? internal : matches;
      if (candidates.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidates[0].name)
        || writable.includes(name) && candidates[0].readOnly) throw new Error(`Campo ${label} indisponível em ${names[0]}.`);
      return [name, candidates[0].name];
    }));
    return { id: list.id, fields: mapping };
  }

  function parse(item, schema) {
    const eTag = etag(item);
    if (!item?.fields || !/^(?:W\/)?"[^"\r\n]+"$/.test(eTag) || eTag === '"*"') {
      throw new Error('Não foi possível confirmar a versão do registro.');
    }
    const values = Object.fromEntries(Object.entries(schema.fields).map(([name, field]) => [name, text(item.fields[field])]));
    return { ...values, id: requireId(item.id), eTag, rawDate: values.paidDate, rawDue: values.dueDate,
      paidDate: provisionDateKey(values.paidDate), dueDate: provisionDateKey(values.dueDate) };
  }

  async function read(schema, id) {
    const row = parse(await remote('getItem', schema.id, id, '$expand=fields'), schema);
    if (row.id !== id) throw new Error('A identidade do registro mudou.');
    return row;
  }

  async function scan(schema, parentId, launchId) {
    const children = [], seen = new Set(), cursors = new Set();
    const query = `$expand=fields($select=${Object.values(schema.fields).join(',')})&$top=100`;
    let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      const page = await remote('getItemsPage', schema.id, query, { pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || page.complete === false || page.partial || page.truncated) break;
      for (const item of page.items) {
        const id = requireId(item.id);
        if (!item.fields || seen.has(id)) throw new Error('A consulta das provisões retornou registros inconsistentes.');
        seen.add(id);
        if (text(item.fields[schema.fields.parent]) === parentId || text(item.fields[schema.fields.launch]) === launchId) {
          children.push(parse(item, schema));
        }
      }
      if (!page.hasMore && !page.nextLink) return children;
      if (!page.hasMore || !page.nextLink || cursors.has(page.nextLink)) break;
      cursors.add(page.nextLink);
      cursor = page.nextLink;
    }
    throw new Error('Não foi possível consultar todas as provisões vinculadas.');
  }

  function eligible(child, launch) {
    return (isPending(child) || isPaid(child) && child.launch === launch.id && child.paidDate === launch.paidDate)
      && (!child.launch || child.launch === launch.id)
      && (!launch.child || launch.child === child.id)
      && Boolean(key(child.supplier) && branch(child.branch))
      && key(child.supplier) === key(launch.supplier) && branch(child.branch) === branch(launch.branch);
  }

  async function preview(parentId, launchId) {
    parentId = requireId(parentId);
    launchId = requireId(launchId);
    const [parentSchema, childSchema, launchSchema] = await Promise.all([
      describe(['DESCRITIVOPROVISAO'], PARENT, ['paidDate', 'dueDate']),
      describe(['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'], CHILD, ['paidDate', 'paid', 'launch']),
      describe(['LANCAMENTOS'], LAUNCH, ['child']),
    ]);
    let launch;
    try { launch = await read(launchSchema, launchId); }
    catch (error) {
      if (Number(error?.status) === 404) throw new Error(`Lançamento ${launchId} não encontrado.`);
      throw error;
    }
    if (!launch.paidDate) throw new Error('O lançamento precisa ter data de pagamento efetivo válida.');
    const [parent, rows] = await Promise.all([read(parentSchema, parentId), scan(childSchema, parentId, launchId)]);
    if (rows.some(row => row.parent !== parentId && row.launch === launchId)
      || launch.child && !rows.some(row => row.id === launch.child && row.parent === parentId)) {
      throw new Error('O lançamento já está vinculado a outra provisão.');
    }
    const existingLinks = rows.filter(row => row.launch === launchId);
    if (existingLinks.length > 1 || existingLinks.length && launch.child && existingLinks[0].id !== launch.child) {
      throw new Error('O lançamento tem vínculos inconsistentes. Confira as provisões antes de continuar.');
    }
    const children = rows.filter(row => row.parent === parentId && eligible(row, launch)
      && (!existingLinks.length || existingLinks[0].id === row.id));
    if (!children.length) throw new Error('Não há provisão disponível para este lançamento no mesmo fornecedor e filial.');
    const details = row => Object.freeze({
      id: row.id, supplier: row.supplier, branch: row.branch, product: row.product,
      paidDate: row.paidDate, total: provisionTotal(row.unit, row.quantity, row.freight),
    });
    const confirmation = Object.freeze({ id: parentId, launch: details(launch), children: Object.freeze(children.map(details)) });
    operations.set(confirmation, { parent, launch, children, parentSchema, childSchema, launchSchema, selected: '' });
    return confirmation;
  }

  // A lost response can follow a successful write. Re-read the exact item before
  // reporting failure, and never retry a conditional write against a new version.
  async function update(schema, row, changes, matches) {
    if (matches(row)) return row;
    const fields = Object.fromEntries(Object.entries(changes).map(([name, value]) => [schema.fields[name], value]));
    let writeError;
    try { await remote('updateItem', schema.id, row.id, fields, { eTag: row.eTag }); }
    catch (error) { writeError = error; }
    const after = await read(schema, row.id);
    if (!matches(after)) throw writeError || new Error('O SharePoint não confirmou a gravação. Confira o vínculo e tente novamente.');
    return after;
  }

  async function save(confirmation, childId, { beforePayment = () => {} } = {}) {
    const op = operations.get(confirmation);
    const chosen = op?.children.find(row => row.id === childId);
    if (!chosen || op.selected && op.selected !== childId || saving) throw new Error('Confira a provisão antes de confirmar o vínculo.');
    const { parent, launch, parentSchema, childSchema, launchSchema } = op;
    const linked = row => row.parent === parent.id && row.launch === launch.id;
    const paid = row => linked(row) && row.paidDate === launch.paidDate && isPaid(row);
    const reverseLinked = row => row.child === childId && row.paidDate === launch.paidDate;
    saving = true;
    try {
      let [currentChild, currentLaunch, liveParent] = await Promise.all([
        read(childSchema, childId), read(launchSchema, launch.id), read(parentSchema, parent.id),
      ]);
      if (!eligible(currentChild, currentLaunch) || currentChild.parent !== parent.id
        || currentLaunch.rawDate !== launch.rawDate
        || !sameFinancialDetails(currentLaunch, launch) || !sameFinancialDetails(currentChild, chosen)
        || !op.selected && (currentChild.eTag !== chosen.eTag || currentLaunch.eTag !== launch.eTag || liveParent.eTag !== parent.eTag)) {
        throw new Error('O lançamento ou a provisão foi alterado. Consulte novamente.');
      }
      op.selected = childId;

      // Reserve the provision first, so a second launch cannot replace it during a retry.
      currentChild = await update(childSchema, currentChild, { launch: launch.id }, linked);
      try {
        currentLaunch = await update(launchSchema, currentLaunch, { child: childId }, reverseLinked);
      } catch (error) {
        const freshLaunch = await read(launchSchema, launch.id);
        if (freshLaunch.child && freshLaunch.child !== childId && isPending(currentChild)) {
          await update(childSchema, currentChild, { launch: null },
            row => row.parent === parent.id && !row.launch && isPending(row));
          throw new Error('O lançamento já está vinculado a outra provisão.');
        }
        throw error;
      }

      const date = dateField(currentLaunch.rawDate);
      const snapshot = async () => {
        const rows = await scan(childSchema, parent.id, launch.id);
        if (rows.some(row => row.launch === launch.id && (row.id !== childId || row.parent !== parent.id))) {
          throw new Error('O lançamento aparece em outra provisão. Confira os vínculos antes de continuar.');
        }
        const children = rows.filter(row => row.parent === parent.id);
        if (!children.some(linked)) throw new Error('A provisão vinculada mudou de descritivo.');
        return children;
      };
      const syncParent = async children => {
        const pending = children.filter(isPending);
        const due = pending.map(row => row.dueDate).sort()[0];
        if (pending.length && !due) throw new Error('Há provisão em aberto sem vencimento válido neste descritivo.');
        const parentPaid = !pending.length;
        const paidRows = children.filter(isPaid);
        const paidDate = parentPaid ? paidRows.map(row => row.paidDate).sort().at(-1) : '';
        const live = await read(parentSchema, parent.id);
        if (live.rawDate && (!live.paidDate || live.paidDate !== paidDate)) {
          throw new Error('A data de pagamento do descritivo foi alterada. Confira os registros.');
        }
        const fields = parentPaid ? { paidDate: paidDate === launch.paidDate ? date : dateField(paidDate) }
          : { dueDate: dateField(due) };
        const confirmed = await update(parentSchema, live, fields, row => row.paidDate === paidDate && (parentPaid || row.dueDate === due));
        if (parentPaid && (await snapshot()).some(isPending)) {
          if (!live.rawDate) await update(parentSchema, confirmed, { paidDate: null }, row => !row.rawDate);
          throw new Error('Uma provisão voltou a ficar pendente durante o fechamento. Confira e retome o vínculo.');
        }
        const sum = rows => {
          const values = rows.map(row => provisionTotal(row.unit, row.quantity, row.freight));
          return values.some(value => value === '') ? null : values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
        };
        return { parentPaid, pendingChildIds: pending.map(row => row.id), dueDate: due || '',
          amountDue: sum(pending.filter(row => row.dueDate === due)), amountPaid: sum(paidRows) };
      };

      const before = await snapshot();
      if (before.some(row => row.id !== childId && isPending(row) && !row.dueDate)) {
        throw new Error('Há provisão em aberto sem vencimento válido neste descritivo.');
      }
      const verifiedLaunch = await read(launchSchema, launch.id);
      if (!reverseLinked(verifiedLaunch) || verifiedLaunch.rawDate !== launch.rawDate
        || !sameFinancialDetails(verifiedLaunch, launch) || !eligible(currentChild, verifiedLaunch)) {
        throw new Error('O lançamento foi alterado durante o vínculo. Confira os registros.');
      }
      // Preserve the operation identity before the child can leave the pending report.
      beforePayment({ id: parent.id, launchId: launch.id, childId });
      await update(childSchema, currentChild, { paidDate: date, paid: 'PAGO' }, paid);
      const after = await snapshot();
      if (!after.some(paid)) throw new Error('A baixa da provisão não foi confirmada.');
      return { id: parent.id, paidDate: launch.paidDate, ...await syncParent(after) };
    } finally {
      saving = false;
    }
  }
  return Object.freeze({ preview, save });
}
