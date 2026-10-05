import { payrollFieldKey as key } from './payroll-editor-policy.js';

const scalar=value=>String(value&&typeof value==='object'?value.LookupValue??value.Value??value.value??'':value??'').trim();
function month(value) {
  const raw=scalar(value),br=raw.match(/^(\d{1,2})\/(\d{4})$/),iso=raw.match(/^(\d{4})-(\d{2})(?:$|[-T])/);
  const year=br?.[2]||iso?.[1],number=Number(br?.[1]||iso?.[2]);
  return year&&number>=1&&number<=12?`${year}-${String(number).padStart(2,'0')}`:'';
}
function monthWindow(now) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(now);
  const year=Number(parts.find(p=>p.type==='year').value),number=Number(parts.find(p=>p.type==='month').value);
  return [-1,0,1].map(offset=>new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7));
}
const checkedId=value=>{const id=String(value??'').trim();if(!/^[1-9]\d{0,14}$/.test(id))throw new Error('Selecione um ID de folha cadastrado.');return id;};
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta cancelada.','AbortError');};

export function createPayrollSheetReader(repository,siteKey,now=()=>new Date()) {
  let descriptorPromise;
  async function descriptor(signal) {
    abort(signal);
    return descriptorPromise ||= (async()=>{
      const list=await repository.resolveList(siteKey,['IDFOLHA']);
      if(list?.status!=='resolved'||!list.id)throw new Error('A base IDFOLHA não está disponível.');
      const columns=await repository.getColumns(siteKey,list.id);
      const field=aliases=>columns.find(c=>[c.name,c.displayName].some(n=>aliases.includes(key(n))))?.name;
      const supplier=field(['FORNECEDOR']),reference=field(['MESREFERENCIA']);
      if(!supplier||!reference)throw new Error('Fornecedor e mês de referência não foram identificados em IDFOLHA.');
      return {list,supplier,reference};
    })().catch(error=>{descriptorPromise=null;throw error;});
  }
  function eligible(row,description,supplier) {
    return key(scalar(row.fields?.[description.supplier]))===key(supplier)&&monthWindow(now()).includes(month(row.fields?.[description.reference]));
  }
  async function options(supplier,{signal}={}) {
    if(!scalar(supplier))throw new Error('O fornecedor do pagamento não foi identificado.');
    const description=await descriptor(signal),rows=[],seen=new Set();let cursor;
    for(let pageNumber=1;pageNumber<=100;pageNumber++) {
      abort(signal);
      const page=await repository.getItemsPage(siteKey,description.list.id,'$expand=fields&$top=100',{pageNumber,maxPages:100,...(cursor?{cursor}:{}),...(signal?{signal}:{})});
      abort(signal);if(!Array.isArray(page?.items))throw new Error('A consulta das folhas não pôde ser concluída.');rows.push(...page.items);
      if(!page.hasMore)return rows.filter(row=>eligible(row,description,supplier)).sort((a,b)=>month(a.fields[description.reference]).localeCompare(month(b.fields[description.reference]))||Number(a.id)-Number(b.id)).map(row=>{
        const value=checkedId(row.id),reference=month(row.fields[description.reference]).split('-').reverse().join('/');
        return {value,label:`${value}-${reference} (${scalar(row.fields[description.supplier])})`};
      });
      if(!page.nextLink||seen.has(page.nextLink))throw new Error('A consulta das folhas não pôde ser concluída.');cursor=page.nextLink;seen.add(cursor);
    }
    throw new Error('A consulta das folhas excedeu o limite de páginas.');
  }
  async function assertSheet(value,supplier) {
    const id=checkedId(value),description=await descriptor();
    const row=await repository.getItem(siteKey,description.list.id,id,'$expand=fields');
    if(String(row?.id)!==id||!scalar(supplier)||!eligible(row,description,supplier))throw new Error('Selecione uma folha desse fornecedor do mês anterior, atual ou próximo.');
  }
  return Object.freeze({options,assertSheet});
}
