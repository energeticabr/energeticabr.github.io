import { payrollFieldKey as key } from './payroll-editor-policy.js';

const scalar=value=>String(value&&typeof value==='object'?value.LookupValue??value.lookupValue??value.Value??value.value??'':value??'').trim();
const checkedId=value=>{const id=String(value??'').trim();if(!/^[1-9]\d{0,14}$/.test(id))throw new Error('O vínculo IDLANCAMENTO é inválido. Selecione um ID de lançamento cadastrado.');return id;};
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta cancelada.','AbortError');};

/** Values remain IDs; supplier labels are presentation only. */
export function createPayrollLaunchReader(repository,siteKey) {
  let descriptorPromise;
  async function descriptor(signal) {
    abort(signal);
    const result=await (descriptorPromise ||= (async()=>{
      const list=await repository.resolveList(siteKey,['LANCAMENTOS','LANÇAMENTOS']);
      if(list?.status!=='resolved'||!list.id)throw new Error('A base LANCAMENTOS não está disponível.');
      const columns=await repository.getColumns(siteKey,list.id);
      const field=name=>{const matches=columns.filter(c=>[c.name,c.displayName].some(n=>key(n)===name));return matches.length===1?matches[0].name:null;};
      const supplier=field('FORNECEDOR'),contractor=field('EMPREITEIRO');
      if(!supplier||!contractor)throw new Error('Fornecedor e EMPREITEIRO não foram identificados em LANCAMENTOS.');
      return {list,supplier,contractor};
    })().catch(error=>{descriptorPromise=null;throw error;}));
    abort(signal);return result;
  }
  const eligible=(row,description)=>row?.fields?.[description.contractor]===true||key(scalar(row?.fields?.[description.contractor]))==='SIM';
  async function options({signal}={}) {
    const description=await descriptor(signal),rows=[],seen=new Set();let cursor;
    for(let pageNumber=1;pageNumber<=100;pageNumber++) {
      abort(signal);
      const page=await repository.getItemsPage(siteKey,description.list.id,'$expand=fields&$top=100',{pageNumber,maxPages:100,...(cursor?{cursor}:{}),...(signal?{signal}:{})});
      abort(signal);
      if(!Array.isArray(page?.items))throw new Error('A consulta dos lançamentos não pôde ser concluída.');
      rows.push(...page.items);
      if(!page.hasMore){
        const values=new Map();
        for(const row of rows.filter(row=>eligible(row,description))){
          const value=checkedId(row.id),supplier=scalar(row.fields[description.supplier]);
          if(!supplier)throw new Error(`O fornecedor do lançamento ${value} não foi identificado.`);
          if(values.has(value)&&values.get(value)!==supplier)throw new Error('A consulta dos lançamentos retornou IDs conflitantes.');
          values.set(value,supplier);
        }
        return [...values].sort(([a],[b])=>Number(b)-Number(a)).map(([value,supplier])=>({value,label:`${value} - ${supplier}`}));
      }
      if(!page.nextLink||seen.has(page.nextLink))throw new Error('A consulta dos lançamentos não pôde ser concluída.');
      cursor=page.nextLink;seen.add(cursor);
    }
    throw new Error('A consulta dos lançamentos excedeu o limite de páginas.');
  }
  async function assertLaunch(value) {
    const id=checkedId(value),description=await descriptor();
    const row=await repository.getItem(siteKey,description.list.id,id,'$expand=fields');
    if(String(row?.id)!==id||!eligible(row,description))throw new Error('Selecione um lançamento cadastrado com EMPREITEIRO = SIM.');
  }
  return Object.freeze({options,assertLaunch});
}
