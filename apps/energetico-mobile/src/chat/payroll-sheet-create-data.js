import { payrollFieldKey as fieldKey } from './payroll-editor-policy.js';

const scalar = value => String(value && typeof value === 'object'
  ? value.LookupValue ?? value.Value ?? value.value ?? '' : value ?? '').trim();
const supplierKey = value => scalar(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
function canonicalId(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Selecione um ID de fornecedor cadastrado.');
  return id;
}
function validMonth(value) {
  return typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) > 0;
}
function referenceMonth(value) {
  const raw = scalar(value), br = raw.match(/^(0?[1-9]|1[0-2])\/(\d{4})$/);
  if (br) { const result = `${br[2]}-${br[1].padStart(2, '0')}`; return validMonth(result) ? result : ''; }
  if (validMonth(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw) && validMonth(raw.slice(0, 7))) {
    const date = new Date(`${raw.slice(0, 10)}T12:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw.slice(0, 10)) return raw.slice(0, 7);
  }
  return '';
}
function column(columns, aliases, { required = true } = {}) {
  const accepted = new Set(aliases.map(fieldKey));
  const matches = columns.filter(c => c?.name && !/^LINKTITLE/i.test(fieldKey(c.name))
    && [c.name, c.displayName].some(name => accepted.has(fieldKey(name))));
  const names = new Set(matches.map(c => c.name));
  if (!names.size && !required) return null;
  if (names.size !== 1) throw new Error(`O campo ${aliases[0]} não foi identificado de forma única; ausente ou ambíguo.`);
  return matches[0];
}
function writable(column, { date = false } = {}) {
  if (column.readOnly || column.computed || column.calculated || column.lookup || column.personOrGroup
    || column.number || column.currency || column.boolean || column.dateTime && !date || column.choice?.allowMultipleValues) {
    throw new Error(`O campo ${column.displayName || column.name} não permite esse cadastro.`);
  }
}
function fieldValue(column, value) {
  if (column.choice && !column.choice.choices?.includes(value)
    || column.text?.maxLength && value.length > column.text.maxLength) {
    throw new Error(`O valor de ${column.displayName || column.name} não é permitido pelos metadados.`);
  }
  return value;
}

/** Creates only IDFOLHA, and only when save is explicitly invoked by its composer. */
export function createPayrollSheetCreateData({ repository, siteKey = 'personal', now = () => new Date(), assertSession = () => {}, attempts = new Map() } = {}) {
  const operations = new Map();
  let saving = false;
  function check(signal) {
    assertSession();
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
  }
  async function guarded(request, signal) {
    check(signal); const result = await request(); check(signal); return result;
  }
  async function describe(name, signal) {
    const options = signal ? { signal } : {};
    const list = await guarded(() => repository.resolveList(siteKey, [name], options), signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${name} não está disponível.`);
    const columns = await guarded(() => repository.getColumns(siteKey, list.id, options), signal);
    if (!Array.isArray(columns)) throw new Error(`Os metadados de ${name} não estão disponíveis.`);
    return { id: list.id, columns };
  }
  async function schema(signal) {
    const [suppliers, sheets] = await Promise.all(['FORNECEDORES', 'IDFOLHA'].map(name => describe(name, signal)));
    check(signal);
    const label = column(suppliers.columns, ['CADASTRO', 'FORNECEDOR']);
    const supplier = column(sheets.columns, ['FORNECEDOR']);
    const reference = column(sheets.columns, ['MESREFERENCIA']);
    const status = column(sheets.columns, ['STATUS'], { required: false });
    writable(supplier); writable(reference, { date: true });
    if (status) {
      writable(status);
      if (!status.text && !status.choice) throw new Error('O campo STATUS possui metadados incompatíveis com o cadastro.');
      fieldValue(status, 'ATIVO');
    }
    return { suppliers, sheets, label, supplier, reference, status };
  }
  async function all(descriptor, signal) {
    const rows = [], seen = new Set(); let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      const page = await guarded(() => repository.getItemsPage(siteKey, descriptor.id, '$expand=fields&$top=100', {
        pageNumber, maxPages: 100, ...(cursor ? { cursor } : {}), ...(signal ? { signal } : {}),
      }), signal);
      if (!Array.isArray(page?.items)) throw new Error('A consulta dos fornecedores e folhas não pôde ser concluída.');
      rows.push(...page.items);
      if (!page.hasMore) return rows;
      if (!page.nextLink || seen.has(page.nextLink)) throw new Error('A paginação da consulta dos fornecedores e folhas não pôde ser concluída.');
      cursor = page.nextLink; seen.add(cursor);
    }
    throw new Error('A consulta dos fornecedores e folhas excedeu o limite de páginas.');
  }
  async function get(descriptor, id, signal) {
    const result = await guarded(() => repository.getItem(siteKey, descriptor.id, canonicalId(id), '$expand=fields', signal ? { signal } : {}), signal);
    if (canonicalId(result?.id) !== id || !result?.fields) throw new Error('O registro selecionado não foi confirmado pelo SharePoint.');
    return result;
  }
  async function loadOptions({ signal } = {}) {
    const { suppliers, label } = await schema(signal);
    const rows = await all(suppliers, signal), ids = new Set();
    const options = rows.flatMap(row => {
      const id = canonicalId(row.id), name = scalar(row.fields?.[label.name]);
      if (ids.has(id)) throw new Error('A consulta retornou um ID de fornecedor duplicado.');
      ids.add(id);
      return name ? [{ id, label: name }] : [];
    }).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }) || Number(a.id) - Number(b.id));
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now());
    const defaultMonth = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
    check(signal);
    return { suppliers: options, defaultMonth };
  }
  async function verify(description, item, name, month, signal, expected) {
    const verified = await get(description.sheets, canonicalId(item?.id), signal);
    if (supplierKey(verified.fields[description.supplier.name]) !== supplierKey(name)
      || referenceMonth(verified.fields[description.reference.name]) !== month) {
      throw new Error('O SharePoint não confirmou o fornecedor e o mês da folha. Tente novamente.');
    }
    if (expected && (scalar(verified.fields[description.supplier.name]) !== expected[description.supplier.name]
      || (description.reference.dateTime
        ? scalar(verified.fields[description.reference.name]).slice(0, 10) !== expected[description.reference.name].slice(0, 10)
        : scalar(verified.fields[description.reference.name]) !== expected[description.reference.name]))) {
      throw new Error('O SharePoint não confirmou os dados cadastrados na folha. Tente novamente.');
    }
    if (expected && description.status && Object.hasOwn(expected, description.status.name)
      && scalar(verified.fields[description.status.name]) !== expected[description.status.name]) {
      throw new Error('O SharePoint não confirmou o STATUS ATIVO da folha. Tente novamente.');
    }
    return verified;
  }
  async function existing(description, name, month, signal) {
    const rows = await all(description.sheets, signal);
    const matches = rows.filter(row => supplierKey(row.fields?.[description.supplier.name]) === supplierKey(name)
      && referenceMonth(row.fields?.[description.reference.name]) === month);
    if (matches.length > 1) throw new Error('Mais de uma folha foi encontrada para esse fornecedor e mês; revise o cadastro.');
    return matches[0];
  }
  async function save(draft, { operationId, signal } = {}) {
    check(signal);
    if (saving) throw new Error('O cadastro da folha já está em andamento.');
    if (typeof operationId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(operationId)) throw new Error('A operação não foi identificada.');
    const selection = { supplierId: canonicalId(draft?.supplierId), month: draft?.month };
    if (!validMonth(selection.month)) throw new Error('Selecione um mês de referência válido (AAAA-MM).');
    const fingerprint = JSON.stringify(selection), previous = operations.get(operationId) || attempts.get(fingerprint);
    if (previous && previous.fingerprint !== fingerprint) throw new Error('A operação não pode ser alterada depois de iniciar o cadastro.');
    saving = true;
    try {
      const description = await schema(signal);
      // A lost response must recover the original tuple even if the supplier was renamed later.
      if (previous) {
        const found = await existing(description, previous.name, selection.month, signal);
        if (found) return await verify(description, found, previous.name, selection.month, signal, previous.fields);
        if (previous.fields) {
          throw Object.assign(new Error('Ainda não foi possível confirmar a folha no SharePoint. Aguarde e tente confirmar novamente; o cadastro não será reenviado.'), {
            code: 'payroll_sheet_create_uncertain', payrollSheetCreateUncertain: true,
          });
        }
      }
      const selected = await get(description.suppliers, selection.supplierId, signal);
      const name = scalar(selected.fields[description.label.name]);
      if (!name) throw new Error('O fornecedor selecionado não possui um nome cadastrado.');
      const supplierRows = await all(description.suppliers, signal);
      const matches = supplierRows.filter(row => supplierKey(row.fields?.[description.label.name]) === supplierKey(name));
      if (matches.length !== 1 || canonicalId(matches[0].id) !== selection.supplierId) {
        throw new Error('O fornecedor não foi identificado de forma única; revise o cadastro ambíguo.');
      }
      if (previous && name !== previous.name) throw new Error('O fornecedor foi alterado após a tentativa; confira a folha antes de repetir o cadastro.');
      const found = await existing(description, name, selection.month, signal);
      if (found) {
        const verified = await verify(description, found, name, selection.month, signal);
        operations.set(operationId, { fingerprint, name });
        return verified;
      }
      const current = await get(description.suppliers, selection.supplierId, signal);
      if (scalar(current.fields[description.label.name]) !== name) throw new Error('O fornecedor foi alterado; revise a seleção.');
      const reference = description.reference.dateTime ? `${selection.month}-01T12:00:00Z` : selection.month.split('-').reverse().join('/');
      const fields = {
        [description.supplier.name]: fieldValue(description.supplier, name),
        [description.reference.name]: fieldValue(description.reference, reference),
        ...(description.status ? { [description.status.name]: fieldValue(description.status, 'ATIVO') } : {}),
      };
      // A second composer/service may have passed preflight concurrently.
      // Claim this tuple synchronously before yielding to the POST transport.
      if (attempts.has(fingerprint)) {
        throw Object.assign(new Error('A folha já está aguardando confirmação. Aguarde e tente confirmar novamente.'), {
          code: 'payroll_sheet_create_uncertain', payrollSheetCreateUncertain: true,
        });
      }
      const attempt = { fingerprint, name, fields };
      operations.set(operationId, attempt);
      attempts.set(fingerprint, attempt);
      try {
        const created = await guarded(() => repository.createItem(siteKey, description.sheets.id, fields, signal ? { signal } : {}), signal);
        return await verify(description, created, name, selection.month, signal, fields);
      } catch (error) {
        // Once POST was attempted, explicit retries only reconcile the tuple.
        // Empty/stale reads never authorize a second POST for this operation.
        if (error instanceof Error && Object.isExtensible(error)) {
          error.payrollSheetCreateUncertain = true;
          error.code ||= 'payroll_sheet_create_uncertain';
        }
        throw error;
      }
    } finally { saving = false; }
  }
  return Object.freeze({ loadOptions, save });
}
