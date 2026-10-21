const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const payrollTaxType = value => ['INSS','FGTS'].includes(normalized(value));
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime()) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;

export function payrollCompetenceMonth(value) {
  const text = String(value ?? '').trim(), br = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (br) return Number(br[1]) >= 1 && Number(br[1]) <= 12 ? `${br[2]}-${br[1].padStart(2,'0')}` : '';
  if (/^\d{4}-\d{2}$/.test(text)) return Number(text.slice(5)) >= 1 && Number(text.slice(5)) <= 12 ? text : '';
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text) && validDay(text.slice(0,10))) return text.slice(0,7);
  return '';
}

export function previousPayrollCompetence(date) {
  if (!validDay(String(date ?? ''))) return '';
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth()-1);
  return day.toISOString().slice(0,7);
}

export function payrollTaxSheet(draft) {
  const competence = payrollCompetenceMonth(draft?.taxCompetence), sheet = draft?.taxSheet;
  return competence && /^[1-9]\d*$/.test(String(sheet?.id ?? '')) && payrollCompetenceMonth(sheet?.label) === competence ? sheet : null;
}
