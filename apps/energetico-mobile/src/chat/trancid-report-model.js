// Current collector contract: these four cards must all be present. A newly
// enrolled card requires updating this set and the complete-snapshot contract;
// until then an unfamiliar ID rejects the export instead of showing partial totals.
const CARD_IDS = Object.freeze(['06850000084216', '06850000084217', '06850000084218', '06850000084219']);
const cardIds = new Set(CARD_IDS);
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit' });

function invalid(message = 'Snapshot Trancid inválido ou incompleto.') { throw new TypeError(message); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value.trim();
}
function integer(value, { nullable = false, minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < minimum) invalid('Valor inteiro ou monetário Trancid inválido.');
  return value;
}
function timestamp(value) {
  const stamp = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(stamp);
  if (!match) invalid('Data Trancid deve conter fuso horário explícito.');
  const [, year, month, day, hour, minute, second, fraction = '', offset] = match;
  if (+year < 1900 || +month < 1 || +month > 12 || +day < 1
    || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
    || +hour > 23 || +minute > 59 || +second > 59
    || offset !== 'Z' && (+offset.slice(1, 3) > 23 || +offset.slice(4) > 59)) invalid('Data Trancid inválida.');
  const milliseconds = Date.parse(stamp);
  if (!Number.isFinite(milliseconds)) invalid('Data Trancid inválida.');
  const secondsAt = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
  return { value: stamp, milliseconds, time: BigInt(secondsAt) * 1_000_000n + BigInt(fraction.padEnd(9, '0')) };
}
function calendarDate(milliseconds) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(milliseconds).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function card(value) { if (!cardIds.has(value)) invalid('Cartão Trancid ausente ou desconhecido.'); return value; }
function source(value) {
  const result = text(value);
  let url;
  try { url = new URL(result); } catch { invalid('URL da origem Trancid inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) invalid('URL da origem Trancid inválida.');
  return result;
}
function money(value) {
  const amount = text(value);
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+),\d{2}$/.test(amount)) invalid('Saldo Trancid inválido.');
  const cents = BigInt(amount.replaceAll('.', '').replace(',', ''));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) invalid('Saldo Trancid excede a precisão segura.');
  return Number(cents);
}
function later(a, b) {
  return !b || a.time > b.time || a.time === b.time && (a.rank > b.rank || a.rank === b.rank && a.priority > b.priority);
}

function inspectSnapshot(input) {
  const data = object(input);
  if (data.schema_version !== 1 || data.currency !== 'BRL' || data.money_unit !== 'centavos'
    || !Array.isArray(data.positions) || !Array.isArray(data.runs)) invalid();
  const observations = [], runsById = new Map(), successfulSlots = new Set();
  let lastRun;
  const runs = data.runs.map(raw => {
    const row = object(raw), id = integer(row.id, { minimum: 1 }), slot = text(row.slot);
    if (runsById.has(id)) invalid('Execução Trancid duplicada.');
    const checked = timestamp(row.checked_at), inserted = integer(row.inserted, { minimum: 0 });
    if (!['ok', 'error'].includes(row.status)) invalid('Estado de execução Trancid inválido.');
    const run = { id, slot, checked_at: checked.value, report_at: null, status: row.status,
      inserted, digest: null, error: null, snapshot: null };
    const details = { ...checked, rank: id, priority: 1, row: run, balances: new Map() };
    if (row.status === 'ok') {
      // Monitor's SQLite index is unique on slot only WHERE status='ok'. Failed
      // attempts (including publication failures after success) retain the slot.
      if (successfulSlots.has(slot)) invalid('Execução Trancid concluída duplicada no mesmo período.');
      successfulSlots.add(slot);
      const report = timestamp(row.report_at);
      run.report_at = report.value;
      run.digest = text(row.digest);
      if (row.error !== null) invalid('Execução Trancid concluída contém erro.');
      if (typeof row.snapshot !== 'string') invalid('Snapshot da execução Trancid ausente.');
      let body;
      try { body = JSON.parse(row.snapshot); } catch { invalid('JSON da execução Trancid inválido.'); }
      object(body);
      if (timestamp(body.checked_at).time !== checked.time || timestamp(body.report_generated_at).time !== report.time) {
        invalid('Relógios da execução Trancid inconsistentes.');
      }
      const sourceUrl = source(body.source_url);
      if (!Array.isArray(body.balances) || body.balances.length !== CARD_IDS.length) invalid('Consulta Trancid não contém todos os cartões.');
      for (const entry of body.balances) {
        object(entry);
        const cardId = card(entry.card);
        if (details.balances.has(cardId)) invalid('Saldo de cartão Trancid duplicado.');
        const employee = text(entry.employee), balanceCents = money(entry.balance);
        details.balances.set(cardId, balanceCents);
        observations.push({ card: cardId, supplier: employee, balanceCents, checkedAt: checked.value,
          date: calendarDate(checked.milliseconds), time: checked.time, rank: id, priority: 1 });
      }
      run.snapshot = JSON.stringify({ checked_at: checked.value, report_generated_at: report.value,
        source_url: sourceUrl, balances: body.balances.map(entry => ({ card: entry.card,
          employee: text(entry.employee), balance: text(entry.balance) })) });
    } else {
      if (row.report_at !== null || row.digest !== null || row.snapshot !== null || inserted !== 0) invalid('Execução Trancid com erro contém dados financeiros parciais.');
      run.error = text(row.error);
    }
    runsById.set(id, details);
    if (later(details, lastRun)) lastRun = details;
    return Object.freeze(run);
  });
  const positionIds = new Set(), positionKeys = new Set();
  const positions = data.positions.map(raw => {
    const row = object(raw), id = integer(row.id, { minimum: 1 });
    if (positionIds.has(id)) invalid('Posição Trancid duplicada.');
    positionIds.add(id);
    const runId = integer(row.run_id, { nullable: true, minimum: 1 }), cardId = card(row.card);
    const checked = timestamp(row.checked_at), report = row.report_at === null ? null : timestamp(row.report_at);
    const employee = text(row.employee), balanceCents = integer(row.balance_cents, { minimum: 0 });
    const previousCents = integer(row.previous_cents, { nullable: true, minimum: 0 });
    const deltaCents = integer(row.delta_cents, { nullable: true });
    if (previousCents !== null && (deltaCents === null || balanceCents - previousCents !== deltaCents)) invalid('Variação financeira Trancid inconsistente.');
    const kind = text(row.kind);
    if (!['Inicial', 'Alteração'].includes(kind)) invalid('Tipo de posição Trancid inválido.');
    const key = `${runId ?? checked.time}:${cardId}`;
    if (positionKeys.has(key)) invalid('Saldo de posição Trancid duplicado.');
    positionKeys.add(key);
    if (runId !== null) {
      const linked = runsById.get(runId);
      if (!linked || linked.row.status !== 'ok' || linked.time !== checked.time || linked.balances.get(cardId) !== balanceCents
        || !report || timestamp(linked.row.report_at).time !== report.time) invalid('Posição Trancid diverge da execução de origem.');
    }
    observations.push({ card: cardId, supplier: employee, balanceCents, checkedAt: checked.value,
      date: calendarDate(checked.milliseconds), time: checked.time, rank: runId ?? 0, priority: 0 });
    return Object.freeze({ id, run_id: runId, card: cardId, employee, checked_at: checked.value,
      report_at: report?.value ?? null, previous_cents: previousCents, balance_cents: balanceCents,
      delta_cents: deltaCents, kind, source_url: source(row.source_url) });
  });
  if (CARD_IDS.some(id => !observations.some(entry => entry.card === id))) invalid('Snapshot Trancid não contém observações de todos os cartões.');
  return { snapshot: Object.freeze({ schema_version: 1, currency: 'BRL', money_unit: 'centavos',
    positions: Object.freeze(positions), runs: Object.freeze(runs) }), observations, lastRun };
}

/** Validate the entire private export before making any financial data available. */
export function validateTrancidSnapshot(input) { return inspectSnapshot(input).snapshot; }

function nextDate(date, amount = 1) {
  const stamp = new Date(`${date}T12:00:00Z`);
  stamp.setUTCDate(stamp.getUTCDate() + amount);
  return stamp.toISOString().slice(0, 10);
}
function validMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) || +value.slice(0, 4) < 1900) invalid('Mês Trancid inválido.');
  return value;
}

/** Current balances always use the latest observation; month selects history only. */
export function buildTrancidReport(input, { month, now = new Date() } = {}) {
  const { observations, lastRun } = inspectSnapshot(input);
  const nowMs = now instanceof Date ? now.getTime() : timestamp(now).milliseconds;
  if (!Number.isFinite(nowMs)) invalid('Data atual inválida.');
  const today = calendarDate(nowMs);
  const selected = month === undefined ? today.slice(0, 7) : validMonth(month);
  const byCard = new Map(CARD_IDS.map(id => [id, { current: null, days: new Map() }]));
  let lastObservation, firstDate;
  for (const entry of observations) {
    const record = byCard.get(entry.card);
    if (later(entry, record.current)) record.current = entry;
    if (later(entry, record.days.get(entry.date))) record.days.set(entry.date, entry);
    if (later(entry, lastObservation)) lastObservation = entry;
    if (!firstDate || entry.date < firstDate) firstDate = entry.date;
  }
  const months = new Set([selected]);
  for (let cursor = firstDate.slice(0, 7); cursor <= today.slice(0, 7);) {
    months.add(cursor);
    const [year, mon] = cursor.split('-').map(Number);
    cursor = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  }
  let totalCents = 0, lowCount = 0;
  const cards = CARD_IDS.map(id => {
    const { current, days } = byCard.get(id), history = [];
    const start = `${selected}-01` > firstDate ? `${selected}-01` : firstDate;
    for (let date = start; date.slice(0, 7) === selected && date <= today; date = nextDate(date)) {
      const observation = days.get(date), previous = days.get(nextDate(date, -1));
      history.push(Object.freeze({ date, balanceCents: observation?.balanceCents ?? null,
        variationCents: observation && previous ? observation.balanceCents - previous.balanceCents : null,
        status: observation ? 'observed' : 'unavailable', checkedAt: observation?.checkedAt ?? null }));
    }
    totalCents += current.balanceCents;
    if (!Number.isSafeInteger(totalCents)) throw new RangeError('Total Trancid excede a precisão monetária segura.');
    const low = current.balanceCents < 4000;
    if (low) lowCount++;
    return Object.freeze({ card: id, supplier: current.supplier, balanceCents: current.balanceCents,
      low, observedAt: current.checkedAt, history: Object.freeze(history) });
  });
  return Object.freeze({ month: selected, months: Object.freeze([...months].sort().reverse()),
    lastCheckedAt: lastRun && !later(lastObservation, lastRun) ? lastRun.value : lastObservation.checkedAt,
    lastError: lastRun?.row.status === 'error' ? lastRun.row.error : null,
    cards: Object.freeze(cards), totalCents, lowCount });
}
