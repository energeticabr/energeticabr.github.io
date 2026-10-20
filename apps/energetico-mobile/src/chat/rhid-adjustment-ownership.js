export function canDeleteRhidAdjustment(adjustment, account) {
  const email = String(account?.username || '').trim().toLowerCase();
  return /^[1-9]\d*$/.test(String(adjustment?.id || ''))
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(adjustment?.time || ''))
    && Boolean(email) && String(adjustment?.actorEmail || '').trim().toLowerCase() === email;
}
