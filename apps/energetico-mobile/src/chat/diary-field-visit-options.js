/** Only actual diary choices may receive a field-visit indicator. */
export function diaryFieldVisitOptionId(option) {
  const reply = String(option?.reply || option?.id || '').trim();
  const match = reply.match(/^(?:choice:diario_obra_pendente:)?([1-9]\d*)$/);
  return match && Number.isSafeInteger(Number(match[1])) ? match[1] : '';
}

const words = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A type question must identify one selected diary, including after resume. */
export function selectedDiaryTypeVisitId(poll, activeFlow) {
  if (activeFlow?.id !== 'construction_diary_fill' || activeFlow.paused
    || !String(activeFlow.contextId || '').trim() || !Array.isArray(activeFlow.rows)
    || !/\bQUAL (?:E )?O TIPO DO DIARIO DE OBRA\b/.test(words(poll?.question || poll?.prompt))) return '';
  const selected = activeFlow.rows.filter(row => words(row?.label) === 'ID');
  return selected.length === 1 ? diaryFieldVisitOptionId({ id: selected[0].value }) : '';
}

export function isInLocoDiaryOption(option) {
  return /^(?:\d+ )?IN LOCO$/.test(words(option?.label || option?.title));
}
