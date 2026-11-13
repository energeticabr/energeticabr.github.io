export function parseBenefitAmount(value) {
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 999999999 ? cents : null;
}
