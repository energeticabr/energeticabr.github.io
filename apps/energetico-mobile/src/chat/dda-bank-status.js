import { ddaPaidManually } from './dda-payment-confirmation.js';

const statusLabels = new Map([
  ['em aberto', 'Em aberto'],
  ['agendado', 'Agendado'],
  ['pago', 'Pago'],
  ['pago (liquidado)', 'Pago'],
  ['liquidado', 'Pago'],
  ['baixado', 'Baixado'],
  ['nao confirmado', 'Não confirmado'],
]);

export const ddaSearchKey = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function normalizeDdaStatus(value) {
  const label = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return statusLabels.get(ddaSearchKey(label).replace(/\s+/g, ' ')) || label || 'Não informado';
}

const scheduleLabels = {
  scheduled: 'AGENDADO',
  unscheduled: 'NÃO AGENDADO',
  unknown: 'AGENDAMENTO NÃO CONFIRMADO',
};

export function ddaBankSchedule(readField) {
  const bankStatus = String(readField('STATUS_DDA') ?? '').trim();
  // Legacy SITUACAO represents the bank status unless the reader overlays a manual confirmation.
  const status = normalizeDdaStatus(bankStatus || (!ddaPaidManually(readField('PGTO_CONFIRMADO')) && readField('SITUACAO')));
  let state = 'unknown';
  if (status === 'Agendado') state = 'scheduled';
  else if (['Em aberto', 'Pago', 'Baixado'].includes(status)) state = 'unscheduled';
  return { state, label: scheduleLabels[state] };
}
