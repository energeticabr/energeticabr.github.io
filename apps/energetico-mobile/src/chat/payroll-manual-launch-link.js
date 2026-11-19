/** Manual links choose payroll ownership independently from the financial source. */
export function isManualPayrollLaunchLink({title,launchId,paymentType}={}) {
  const token=String(title??''),id=String(launchId??'').trim(),type=String(paymentType??'').trim();
  if(!/^[1-9]\d{0,14}$/.test(id))return false;
  return !['INSS','FGTS'].includes(type)&&/^APP-folha-vinculo-[A-Za-z0-9-]{1,80}$/.test(token)
    || ['INSS','FGTS'].includes(type)&&token===`APP-folha-encargo-lancamento-${id}-${type}`;
}
