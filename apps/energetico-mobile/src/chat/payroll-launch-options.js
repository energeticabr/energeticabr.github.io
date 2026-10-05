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
      if(!supplier)throw new Error('Fornecedor não foi identificado em LANCAMENTOS.');
      if(contractor)return {list,supplier,contractor};
      const suppliers=await repository.resolveList(siteKey,['FORNECEDORES']);
      if(suppliers?.status!=='resolved'||!suppliers.id)throw new Error('A base FORNECEDORES não está disponível para conferir EMPREITEIRO.');
      const supplierColumns=await repository.getColumns(siteKey,suppliers.id);
      const supplierField=aliases=>{const matches=supplierColumns.filter(c=>[c.name,c.displayName].some(n=>aliases.includes(key(n))));return matches.length===1?matches[0].name:null;};
      const name=supplierField(['CADASTRO','FORNECEDOR']),flag=supplierField(['EMPREITEIRO']),status=supplierField(['STATUS']);
      if(!name||!flag||!status)throw new Error('Os metadados de fornecedor, EMPREITEIRO e STATUS não foram identificados em FORNECEDORES.');
      return {list,supplier,suppliers:{list:suppliers,name,flag,status}};
    })().catch(error=>{descriptorPromise=null;throw error;}));
    abort(signal);return result;
  }
  const contractor=value=>value===true||key(scalar(value))==='SIM';
  const eligible=(row,description,suppliers)=>description.contractor?contractor(row?.fields?.[description.contractor]):
    suppliers.filter(s=>key(scalar(s.fields?.[description.suppliers.name]))===key(scalar(row?.fields?.[description.supplier]))
      &&contractor(s.fields?.[description.suppliers.flag])&&key(scalar(s.fields?.[description.suppliers.status]))==='ATIVO').length===1;
  async function readRows(list,signal) {
    const rows=[],seen=new Set();let cursor;
    for(let pageNumber=1;pageNumber<=100;pageNumber++) {
      abort(signal);
      const page=await repository.getItemsPage(siteKey,list.id,'$expand=fields&$top=100',{pageNumber,maxPages:100,...(cursor?{cursor}:{}),...(signal?{signal}:{})});
      abort(signal);
      if(!Array.isArray(page?.items))throw new Error('A consulta dos lançamentos não pôde ser concluída.');
      rows.push(...page.items);
      if(!page.hasMore)return rows;
      if(!page.nextLink||seen.has(page.nextLink))throw new Error('A consulta dos lançamentos não pôde ser concluída.');
      cursor=page.nextLink;seen.add(cursor);
    }
    throw new Error('A consulta dos lançamentos excedeu o limite de páginas.');
  }
  async function options({signal}={}) {
    const description=await descriptor(signal);
    const [rows,suppliers]=await Promise.all([readRows(description.list,signal),description.suppliers?readRows(description.suppliers.list,signal):[]]);
    const values=new Map();
    for(const row of rows.filter(row=>eligible(row,description,suppliers))){
      const value=checkedId(row.id),supplier=scalar(row.fields[description.supplier]);
      if(!supplier)throw new Error(`O fornecedor do lançamento ${value} não foi identificado.`);
      if(values.has(value)&&values.get(value)!==supplier)throw new Error('A consulta dos lançamentos retornou IDs conflitantes.');
      values.set(value,supplier);
    }
    return [...values].sort(([a],[b])=>Number(b)-Number(a)).map(([value,supplier])=>({value,label:`${value} - ${supplier}`}));
  }
  async function assertLaunch(value) {
    const id=checkedId(value),description=await descriptor();
    const row=await repository.getItem(siteKey,description.list.id,id,'$expand=fields');
    const suppliers=description.suppliers?await readRows(description.suppliers.list):[];
    if(String(row?.id)!==id||!eligible(row,description,suppliers))throw new Error('Selecione um lançamento cadastrado de um fornecedor ativo com EMPREITEIRO = SIM.');
  }
  return Object.freeze({options,assertLaunch});
}
