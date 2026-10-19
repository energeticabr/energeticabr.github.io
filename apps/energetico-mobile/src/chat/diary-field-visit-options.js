/** Only actual diary choices may receive a field-visit indicator. */
export function diaryFieldVisitOptionId(option) {
  const reply = String(option?.reply || option?.id || '').trim();
  const match = reply.match(/^(?:choice:diario_obra_pendente:)?([1-9]\d*)$/);
  return match && Number.isSafeInteger(Number(match[1])) ? match[1] : '';
}
