import { ddaPaidManually } from './dda-payment-confirmation.js';

export const DDA_UNLINKED_REVIEW_FIELD = 'DDA_x0020_sem_x0020_vincula_x00e';

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

export function isDdaOpenStatus(value) {
  const status = normalizeDdaStatus(value);
  return status === 'Em aberto' || status === 'Agendado';
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
  // The open-title scan can update the record before the separate status reconciliation finishes.
  const awaitingReconciliation = Date.parse(readField('ULTIMA_CONSULTA')) > Date.parse(readField('STATUS_CONSULTADO_EM'));
  let state = 'unknown';
  if (!awaitingReconciliation) {
    if (status === 'Agendado') state = 'scheduled';
    else if (['Em aberto', 'Pago', 'Baixado'].includes(status)) state = 'unscheduled';
  }
  return { state, label: scheduleLabels[state] };
}
