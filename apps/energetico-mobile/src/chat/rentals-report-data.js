import Decimal from 'decimal.js';
import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { calendarDays } from './operations-reports-model.js';
import { provisionDateKey, provisionNumericValue } from './pending-provision-dates.js';

const LAUNCHES = '02b3ceec-2b03-42e9-b87f-5fb02851caa8';
const CONTRACTS = 'e6b7fbf3-b5ce-406a-8ec8-8d0e8eff7885';
const text = value => String(value ?? '').trim();
const sourceDate = value => provisionDateKey(value ?? '');
const list = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

function cents(value) {
  const amount = provisionNumericValue(value);
  if (!Number.isFinite(amount)) return null;
  const result = new Decimal(amount).times(100).toDecimalPlaces(0).toNumber();
  return Number.isSafeInteger(result) ? result : null;
}

function readLaunch(item) {
  const f = item.fields;
  const paidDate = sourceDate(f.DATAPGTOEFETUADO);
  if (text(f.DATAPGTOEFETUADO) && !paidDate) throw new Error('Data de pagamento inválida no lançamento de aluguel.');
  return {
    id: item.id,
    property: text(f.DESCRICAO),
    tenant: text(f.INQUILINO),
    dueDate: sourceDate(f.DATAVENCIMENTO),
    paidDate,
    paymentMethod: text(f.FORMAPGTO),
    contractId: text(f.NUM_x002e_CONTRATOALUGUEL),
    grossCents: cents(f.VALORBRUTO),
  };
}

function readContract(item) {
  const f = item.fields;
  return {
    id: item.id,
    property: text(f.DESCRICAOIMOVEL),
    tenant: text(f.INQUILINO),
    paymentMethod: text(f.FORMADEPGTO),
    status: text(f.STATUS).toUpperCase(),
    amountCents: cents(f.VALOR),
    adjustmentDate: sourceDate(f.DATAREAJUSTE),
    expiryDate: sourceDate(f.DATAVENCIMENTO),
    index: text(f.INDEX),
  };
}

export function rentalsFilterOptions({ launches, contracts }, today) {
  const all = [...launches, ...contracts];
  return {
    year: list([...launches.map(row => row.dueDate.slice(0, 4)), today.slice(0, 4)]),
    property: list(all.map(row => row.property)),
    tenant: list(all.map(row => row.tenant)),
    paymentMethod: list(all.map(row => row.paymentMethod)),
    status: list(['ATIVO', 'INATIVO', ...contracts.map(row => row.status)]),
  };
}

export function buildRentalsReport({ launches, contracts }, filters, today) {
  const matches = row => ['property', 'tenant', 'paymentMethod'].every(key => !filters[key] || row[key] === filters[key]);
  const contractsById = new Map(contracts.map(row => [row.id, row]));
  const byDate = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || Number(a.id) - Number(b.id);
  const rows = launches.filter(matches).sort(byDate);
  // No Power Apps, ano só filtra o quadro anual. STATUS só filtra as duas tabelas de contratos.
  const open = rows.filter(row => !row.paidDate).map(row => ({
    ...row,
    amountCents: contractsById.get(row.contractId)?.amountCents ?? null,
    days: calendarDays(today, row.dueDate),
  }));
  const newMonths = () => Array.from({ length: 12 }, () => ({ amountCents: 0, records: [], shifted: [] }));
  const groups = new Map();
  const monthlyTotals = Array(12).fill(0);
  for (const row of rows) {
    if (filters.year && !row.dueDate.startsWith(filters.year)) continue;
    const annualDate = row.paidDate || row.dueDate;
    if (!annualDate) continue;
    if (!groups.has(row.property)) groups.set(row.property, {
      property: row.property, months: newMonths(), criticalDate: '', totalCents: 0,
    });
    const group = groups.get(row.property);
    const month = Number(annualDate.slice(5, 7)) - 1;
    const monthData = group.months[month];
    const amount = row.grossCents ?? 0;
    monthData.amountCents += amount;
    monthData.records.push({ ...row, days: calendarDays(today, row.dueDate) });
    const dueMonth = row.dueDate ? Number(row.dueDate.slice(5, 7)) - 1 : month;
    if (dueMonth !== month) group.months[dueMonth].shifted.push(row);
    monthlyTotals[month] += amount;
    group.totalCents += amount;
    if (!row.paidDate && row.dueDate && !group.criticalDate) group.criticalDate = row.dueDate;
  }
  const annual = [...groups.values()].sort((a, b) =>
    (a.criticalDate || '9999').localeCompare(b.criticalDate || '9999') || a.property.localeCompare(b.property, 'pt-BR'));
  const selectedContracts = contracts.filter(row => matches(row) && (!filters.status || row.status === filters.status));
  const calendar = field => selectedContracts.map(row => ({
    ...row, date: row[field], days: calendarDays(today, row[field]),
  })).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.property.localeCompare(b.property, 'pt-BR'));
  return {
    open, annual, monthlyTotals, totalCents: monthlyTotals.reduce((total, amount) => total + amount, 0),
    adjustments: calendar('adjustmentDate'), expirations: calendar('expiryDate'),
  };
}

export function createRentalsReportData({ tokenProvider, repository = createSharePointRepository(
  createGraphClient(tokenProvider), SHAREPOINT_SITES,
) }) {
  async function readList(id, map, signal) {
    const items = [], seenIds = new Set(), cursors = new Set();
    let cursor;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber++) {
      signal?.throwIfAborted();
      const query = new URLSearchParams({ $expand: 'fields', $top: '100' }).toString();
      const page = await repository.getItemsPage('personal', id, query, { signal, cursor, pageNumber, maxPages: 100 });
      signal?.throwIfAborted();
      if (page.hasMore !== Boolean(page.nextLink)) throw new Error('Paginação incompleta no relatório de aluguéis.');
      for (const item of page.items) {
        if (!item.fields || !item.id || seenIds.has(item.id)) throw new Error('O SharePoint retornou um lançamento ou contrato inválido.');
        seenIds.add(item.id);
        items.push(map(item));
      }
      if (!page.hasMore) return items;
      cursor = page.nextLink;
      if (cursors.has(cursor)) throw new Error('Paginação repetida no relatório de aluguéis.');
      cursors.add(cursor);
    }
    throw new Error('O relatório de aluguéis excedeu o limite de paginação.');
  }

  return Object.freeze({
    async loadSnapshot({ signal } = {}) {
      const [launches, contracts] = await Promise.all([
        readList(LAUNCHES, readLaunch, signal), readList(CONTRACTS, readContract, signal),
      ]);
      return { launches, contracts };
    },
  });
}
