export const cards = ['00000000000101', '00000000000102', '00000000000103', '00000000000104'];
export const employees = ['Ana Exemplo', 'Bia Exemplo', 'Caio Exemplo', 'Davi Exemplo'];
export const sourceUrl = 'http://trancid.ddns.net:8082/frmRelConsultaSaldoCartao.aspx?report=ficticio';

export function run(id, checkedAt, balances = ['50,00', '40,00', '39,99', '0,00'], overrides = {}) {
  const snapshot = { checked_at: checkedAt, report_generated_at: checkedAt, source_url: sourceUrl,
    balances: cards.map((card, index) => ({ card, employee: employees[index], balance: balances[index] })) };
  return { id, slot: `daily:${id}`, checked_at: checkedAt, report_at: checkedAt, status: 'ok',
    inserted: 0, digest: `fictitious-digest-${id}`, error: null, snapshot: JSON.stringify(snapshot), ...overrides };
}

export function failure(id, checkedAt, error = 'Fonte temporariamente indisponível') {
  return { id, slot: `daily:${id}`, checked_at: checkedAt, report_at: null, status: 'error',
    inserted: 0, digest: null, error, snapshot: null };
}

export function position(id, runId, checkedAt, balanceCents = 5000, overrides = {}) {
  return { id, run_id: runId, card: cards[0], employee: employees[0], checked_at: checkedAt,
    report_at: checkedAt, previous_cents: null, balance_cents: balanceCents, delta_cents: null,
    kind: 'Inicial', source_url: sourceUrl, ...overrides };
}

export function snapshot(runs = [run(1, '2026-11-06T07:00:00-03:00')], positions = []) {
  return { schema_version: 1, currency: 'BRL', money_unit: 'centavos', positions, runs };
}
