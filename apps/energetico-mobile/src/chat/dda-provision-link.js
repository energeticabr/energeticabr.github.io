import {provisionDateKey,provisionTotal} from './pending-provision-dates.js';
import {provisionDescriptionLinkColumn} from './provision-description-detail-data.js';

export const DDA_PROVISION_FIELD='DESCRITIVOPROVIS_x00c3_O';
const validId=value=>/^[1-9]\d*$/.test(String(value??''))&&Number.isSafeInteger(Number(value));
const nameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const tokens=value=>new Set(nameKey(value).split(' ').filter(part=>part.length>2&&!['LTDA','EIRELI','S A','SA','ME','EMPRESA'].includes(part)));
const amountKey=value=>{let text=String(value??'').trim().replace(/R\$|\s/g,'');if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');const number=/^\d+(?:\.\d+)?$/.test(text)?Number(text):null;return number!=null&&Number.isFinite(number)?Math.round(number*100):null;};
const columnKey=value=>nameKey(String(value??'').replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))).replace(/ /g,'');
function childField(fields,columns,...aliases){
 for(const alias of aliases){
  const key=columnKey(alias),column=columns.find(entry=>columnKey(entry.name)===key||columnKey(entry.displayName)===key);
  if(column&&fields[column.name]!=null)return fields[column.name];
  const direct=Object.entries(fields).find(([name,value])=>columnKey(name)===key&&value!=null);
  if(direct)return direct[1];
 }
}
export function rankDdaProvisionOptions(options,{supplier,amount,due}={}){
 const query=nameKey(supplier),parts=tokens(supplier),wanted=amountKey(amount);
 return options.map(item=>{
  const candidate=nameKey(item.supplier),other=tokens(item.supplier);
  const shared=[...parts].filter(part=>other.has(part)).length;
  const similarity=query&&candidate?(query===candidate?1:shared/Math.max(parts.size,other.size,1)):0;
  const supplierMatch=similarity>=0.5;
  const totalMatch=wanted!=null&&amountKey(item.amount)===wanted;
  const matches=(item.provisions||[]).filter(line=>wanted!=null&&amountKey(line.amount)===wanted);
  const amountMatch=totalMatch||matches.length>0;
  const dueTime=Date.parse(String(due||'').slice(0,10));
  const proximity=value=>{const time=Date.parse(String(value||'').slice(0,10));return Number.isFinite(dueTime)&&Number.isFinite(time)?0.25/(1+Math.abs(dueTime-time)/86400000):0;};
  matches.sort((a,b)=>proximity(b.due)-proximity(a.due)||Number(a.id)-Number(b.id));
  const matchedProvision=matches[0];
  // A matching line's own due date is stronger evidence than its group's due date.
  const dueScore=amountMatch?Math.max(totalMatch?proximity(item.due):0,...matches.map(line=>proximity(line.due))):supplierMatch?proximity(item.due):0;
  return {...item,supplierMatch,amountMatch,matchedProvision,score:(supplierMatch?2+similarity:0)+(amountMatch?2:0)+dueScore};
 }).sort((a,b)=>b.score-a.score||Number(a.id)-Number(b.id)).map((item,index)=>({...item,recommended:index===0&&item.score>0}));
}

export function createDdaProvisionLink({repository,siteKey='personal',assertSession=()=>{}}){
 if(!repository)throw new TypeError('Repositório SharePoint obrigatório.');
 let listPromise;
 async function lists(signal){
  listPromise??=Promise.all(['DDAS SICOOB','DESCRITIVOPROVISAO'].map(name=>repository.resolveList(siteKey,[name],{signal}))).then(([dda,provision])=>{
   if(dda?.status!=='resolved'||provision?.status!=='resolved')throw new Error('Listas DDA ou de provisão indisponíveis.');
   return {dda,provision};
  }).catch(error=>{listPromise=null;throw error;});
  return listPromise;
 }
 async function loadOptions({signal}={}){
  assertSession();const {dda,provision}=await lists(signal);
  const columns=await repository.getColumns(siteKey,dda.id,{signal});
  if(!columns.some(column=>column.name===DDA_PROVISION_FIELD&&!column.readOnly))throw new Error('Coluna de vínculo DDA indisponível.');
  const items=await repository.getItems(siteKey,provision.id,'?$expand=fields',{signal});assertSession();
  if(!Array.isArray(items))throw new Error('Consulta de provisões incompleta.');
  const children=await repository.resolveList(siteKey,['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS'],{signal});assertSession();
  if(children?.status!=='resolved'||!children.id)throw new Error('Lista de provisões indisponível.');
  const childColumns=await repository.getColumns(siteKey,children.id,{signal});assertSession();
  const linkName=provisionDescriptionLinkColumn(childColumns);
  // getItems follows all repository pages, including children outside the visible gallery.
  const lines=await repository.getItems(siteKey,children.id,'?$expand=fields',{signal});assertSession();
  if(!Array.isArray(lines))throw new Error('Consulta de provisões incompleta.');
  const byParent=new Map();
  for(const line of lines){
   const fields=line?.fields,parent=String(fields?.[linkName]??'').trim();
   if(!validId(line?.id)||!validId(parent)||!fields)continue;
   const read=(...aliases)=>childField(fields,childColumns,...aliases);
   if(String(read('DATAPGTOEFETUADO')??'').trim()||nameKey(read('STATUS'))==='PAGAMENTO EFETUADO'||nameKey(read('PGTOAGENDADO'))==='PAGO')continue;
   const amount=provisionTotal(read('VALORTOTAL'),read('QTD','QUANTIDADE'),read('FRETE'));
   if(amountKey(amount)==null)continue;
   if(!byParent.has(parent))byParent.set(parent,[]);
   byParent.get(parent).push({id:String(line.id),amount,due:provisionDateKey(read('DATAPREVISTOPGTO','DATAPGTOPREVISTO'))});
  }
  return items.filter(item=>validId(item.id)&&item.fields&&!String(item.fields.DATAPGTOEFETUADO??'').trim()).map(item=>({
   id:String(item.id),supplier:String(item.fields.FORNECEDOR||'Fornecedor não informado'),amount:item.fields.VALORTOTAL??null,
   due:item.fields.DATAPREVISTOPGTO||'',label:`#${item.id} · ${item.fields.FORNECEDOR||'Fornecedor não informado'}`,provisions:byParent.get(String(item.id))||[],
  }));
 }
 async function save({ddaId,provisionId,signal}){
  if(!validId(ddaId)||!validId(provisionId))throw new RangeError('ID de vínculo inválido.');
  assertSession();const {dda,provision}=await lists(signal);
  const target=await repository.getItem(siteKey,provision.id,provisionId,'?$expand=fields',{signal});
  if(!target?.fields||String(target.fields.DATAPGTOEFETUADO??'').trim())throw new Error('O descritivo já possui pagamento efetuado. Atualize as opções.');
  const current=await repository.getItem(siteKey,dda.id,ddaId,'?$expand=fields',{signal});
  const eTag=current?.eTag||current?.['@odata.etag']||current?.fields?.['@odata.etag'];
  if(!current?.fields||!eTag)throw new Error('Não foi possível verificar a versão atual do DDA.');
  if(String(current.fields[DDA_PROVISION_FIELD]??'')===String(provisionId))return {ddaId:String(ddaId),provisionId:String(provisionId)};
  const saved=await repository.updateItem(siteKey,dda.id,ddaId,{[DDA_PROVISION_FIELD]:String(provisionId)},{eTag,signal});assertSession();
  if(String(saved?.fields?.[DDA_PROVISION_FIELD]??'')!==String(provisionId))throw new Error('O vínculo não foi confirmado no SharePoint.');
  return {ddaId:String(ddaId),provisionId:String(provisionId)};
 }
 return Object.freeze({loadOptions,save});
}
